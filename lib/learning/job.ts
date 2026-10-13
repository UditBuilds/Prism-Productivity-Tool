import type { SupabaseClient } from "@supabase/supabase-js";

import { checkCodeRule } from "@/lib/learning/code-rule";
import {
  ADVANCE_DEADLINE_MS,
  COPY_MAX_TOKENS,
  FIX_MAX_TOKENS,
  G2_MARK_MODE,
  JUDGE_MAX_TOKENS,
  LEARNING_COPY_MODEL,
  LEARNING_JUDGE_MODEL,
  LEARNING_SEARCH_MODEL,
  LEARNING_WRITE_MODEL,
  LESSON_BUDGET,
  LESSON_MAX_WORDS,
  MAIN_SOURCE_EXCERPT_CHARS,
  MAX_CANDIDATE_PAGES,
  MAX_COPIER_TRIES,
  MAX_RETRIES_PER_LESSON,
  MIN_ANSWER_TOKENS,
  MIN_SOURCE_WORDS,
  SEARCH_MAX_TOKENS,
  STALE_CLAIM_MS,
  WRITE_MAX_TOKENS,
} from "@/lib/learning/constants";
import { isLocalDevRuntime } from "@/lib/learning/dev-override";
import {
  CHECKER_UNUSABLE_NOTE,
  checkShape,
  explanationWords,
  lengthAtEnd,
  marksFor,
  NO_MARKS,
  renderLessonBody,
  sentencesOf,
  shortMark,
  withChanges,
  type Changes,
  type Explanation,
  type Marks,
  type Problem,
  type Sentence,
} from "@/lib/learning/explanation";
import {
  BadAnswerError,
  copySource,
  judgeWords,
  LearningAiError,
  searchForStep,
  writeExplanation,
  writeFix,
  type CallRecord,
  type RateLimits,
} from "@/lib/learning/groq";
import { checkExample, exampleRulesFor, exampleRulesText, outputByCode } from "@/lib/learning/example";
import { excerptFor, extractPage } from "@/lib/learning/html-text";
import {
  courseWordsAfterFix,
  JUDGE_EMPTY_WORDS_RETRY,
  JUDGE_SYSTEM_PROMPT,
  judgeUserMessage,
  readWords,
  sameWord,
  wordsAfterFix,
  type JudgeReading,
} from "@/lib/learning/judge";
import { budgetState, logCall } from "@/lib/learning/ledger";
import { pickStepToWrite, type StepState } from "@/lib/learning/next-step";
import {
  chooseSource,
  copierMainWordRetry,
  copierUserMessage,
  COPIER_SYSTEM_PROMPT,
  mainWordFor,
  numberPage,
  usesMainWord,
  pageThinness,
  withoutReferences,
  wordCount,
  type NumberedPage,
  type SourceBlock,
} from "@/lib/learning/passages";
import { safeFetchPage, type FetchedPage } from "@/lib/learning/safe-fetch";
import {
  isLandingPage,
  isUserContent,
  onDocsSite,
  pickCandidates,
  pickDocsCandidates,
  siteQuery,
  SourceProvenance,
  type SearchHit,
} from "@/lib/learning/sources";
import type { AdvanceResult, StepErrorCode } from "@/lib/learning/types";
import {
  readFix,
  WRITER_FORMAT_RETRY,
  writerExampleRetry,
  writerFixMessage,
  writerUserMessage,
  WRITER_SYSTEM_PROMPT,
  type WriterAnswer,
} from "@/lib/learning/writer-prompt";
import type { Database } from "@/types/database";

/**
 * One unit of the lesson job: write AT MOST ONE lesson, then return.
 *
 * The client calls this in a loop while a topic or lesson is on screen
 * (hooks/useLearning.ts). Every decision is read from the rows, so there is
 * no job state anywhere else: close the app mid-lesson and the next call
 * picks up from the same place. A request that dies mid-write leaves its
 * step "writing" with an old claimed_at, which STALE_CLAIM_MS (90s, longer
 * than the 60s function limit) lets the next call reclaim.
 *
 * The stages ("source shown + AI explains", Udit, 2026-10-10):
 *   1. search inside the topic's documentation site (20b + browser_search,
 *      "site:docs.python.org …"); the open web only when that finds nothing;
 *   2. every fetched page: the free thin-page check; then ONE fit check
 *      (20b, fit.ts) judges the examples of all of them against the plan —
 *      only the step's own idea and earlier steps' (2026-10-12); the server
 *      ranks the ones that fit, and the copier (20b) chooses 1-3 passages BY
 *      NUMBER around the best — or the next, at most MAX_COPIER_TRIES. No
 *      example that fits fails the step before any 120b token is spent; one
 *      that does not fit is never shown;
 *   3. the AI explanation (120b, JSON) from that source block only;
 *   4. its shape (explanation.ts), G1 the code rule (code-rule.ts, no AI),
 *      G2 the word check (judge.ts, 120b), which since gate 9 (Udit,
 *      2026-10-13) gives no sentence verdicts and never fails the step;
 *   5. at most ONE fix that resends only the flagged sentences and the
 *      unexplained words; a cut-off answer is never applied; then the lesson
 *      is saved — in mark mode (G2_MARK_MODE) with a visible mark on each
 *      word G2 still finds unexplained, and each course word a fix sentence
 *      brings in unexplained (code) — or the step fails with the real reason
 *      and waits for "Try again". Only the copier, the writer (its fix
 *      included), shape, G1 and the length limit can fail a step.
 * Each model has a per-lesson token budget (LESSON_BUDGET); every call is
 * given only what is left of it.
 */

type Client = SupabaseClient<Database>;

interface Ctx {
  supabase: Client;
  userId: string;
  topicId: string;
  startedAt: number;
}

/** The chosen source page and what the lesson shows from it. */
interface Found {
  page: FetchedPage;
  title: string;
  siteName: string;
  source: SourceBlock;
}

async function log(ctx: Ctx, stepId: string, rec: CallRecord) {
  await logCall(ctx.supabase, ctx.userId, { topicId: ctx.topicId, stepId }, rec);
}

async function release(ctx: Ctx, stepId: string, claimedAt: string) {
  const { error } = await ctx.supabase
    .from("learning_steps")
    .update({ status: "pending", claimed_at: null })
    .eq("id", stepId)
    .eq("user_id", ctx.userId)
    .eq("claimed_at", claimedAt);
  if (error) console.error("[learning] release failed:", error.message);
}

const MAX_MESSAGE = 500;

/** A long message keeps its start and its closing "Try again.", cut between words. */
export function fitMessage(message: string): string {
  if (message.length <= MAX_MESSAGE) return message;
  const tail = message.endsWith(" Try again.") ? " Try again." : "";
  return `${message.slice(0, MAX_MESSAGE - tail.length - 1).replace(/\s+\S*$/, "")}…${tail}`;
}

/** The stored message names the real cause (Udit, 2026-10-10): it is what the reader sees under a failed step. */
async function markFailed(ctx: Ctx, stepId: string, claimedAt: string, code: StepErrorCode, message: string) {
  const { error } = await ctx.supabase
    .from("learning_steps")
    .update({ status: "failed", claimed_at: null, error_code: code, error_message: fitMessage(message) })
    .eq("id", stepId)
    .eq("user_id", ctx.userId)
    .eq("claimed_at", claimedAt);
  if (error) console.error("[learning] mark failed:", error.message);
}

/** The longest per-minute wait worth sitting out inside one request. */
const MAX_INLINE_WAIT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Make a Groq call; if the per-minute budget refuses it and the wait fits in
 * what is left of this request (keeping `reserveMs` for the stages after it),
 * wait and try once more. Without this, the stages that follow the search —
 * each on a model whose minute budget the last call just spent — would hand
 * the step back and the next request would pay for the search again.
 */
async function withShortWait<T>(ctx: Ctx, stepId: string, reserveMs: number, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof LearningAiError) || err.failure.kind !== "minute") throw err;
    const waitMs = err.failure.retryAfterSeconds * 1000;
    const elapsed = Date.now() - ctx.startedAt;
    if (waitMs > MAX_INLINE_WAIT_MS || elapsed + waitMs + reserveMs > ADVANCE_DEADLINE_MS) throw err;
    await log(ctx, stepId, err.record);
    await sleep(waitMs);
    return await call();
  }
}

function waitResult(err: unknown): AdvanceResult | null {
  if (!(err instanceof LearningAiError)) return null;
  if (err.failure.kind === "minute") return { kind: "waiting", retryAfterSeconds: err.failure.retryAfterSeconds };
  if (err.failure.kind === "day") return { kind: "groq_daily" };
  return null;
}

/** Tokens a prompt will cost: about 3.5 characters each, plus the chat wrapping. Rounded up on purpose. */
function promptTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3.5) + 50;
}
/** browser_search adds its own tool description to every search prompt: measured 1,511 prompt tokens. */
const SEARCH_PROMPT_TOKENS = 1_600;

/** What this lesson has spent per model, and what the next call may still use. */
class LessonSpend {
  private readonly used = new Map<string, number>();

  add(rec: CallRecord) {
    this.used.set(rec.model, this.spent(rec.model) + rec.total_tokens);
  }

  spent(model: string): number {
    return this.used.get(model) ?? 0;
  }

  /** max_tokens for the next call on `model`, or null when its answer would not fit in the lesson's budget. */
  room(model: string, prompt: number, wanted: number): number | null {
    const left = (LESSON_BUDGET[model] ?? Number.POSITIVE_INFINITY) - this.spent(model) - prompt;
    const n = Math.min(wanted, left);
    return n >= MIN_ANSWER_TOKENS ? n : null;
  }

  overMessage(model: string): string {
    return `the next AI call would take this lesson over its ${(LESSON_BUDGET[model] ?? 0).toLocaleString("en-US")}-token budget on ${model.replace(/^openai\//, "")} (${this.spent(model).toLocaleString("en-US")} spent)`;
  }
}

/**
 * Dev-only: write everything one advance did — the searches, every page
 * tried and why it was left, the copier's numbers, the source block, each
 * answer as it came back, every problem and verdict, and the rate-limit
 * headers after each call — to LEARNING_DEBUG_DIR, so a run can be read line
 * by line at no extra AI cost. Local development only (dev-override.ts).
 */
async function debugDump(stepId: string, data: unknown): Promise<void> {
  const dir = process.env.LEARNING_DEBUG_DIR;
  if (!isLocalDevRuntime() || !dir) return;
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${Date.now()}-${stepId}.json`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[learning] debug dump failed:", err);
  }
}

function describe(problems: Problem[]): string[] {
  return problems.map((p) => (p.sentence === null ? p.reason : `sentence ${p.sentence} (${p.check}): ${p.reason}`));
}

/** What a failed or unusable call means for the stored message. */
function callFailure(err: unknown, what: string): { code: StepErrorCode; message: string } {
  if (err instanceof BadAnswerError) {
    return err.answer.kind === "cut_off"
      ? { code: "truncated", message: `The AI's ${what} was cut off before the end, so it was not used. Try again.` }
      : { code: "ai_error", message: `The AI's ${what} could not be used: ${err.answer.reason}. Try again.` };
  }
  if (err instanceof LearningAiError) {
    if (err.failure.kind === "minute" || err.failure.kind === "day") return { code: "ai_error", message: `The AI was too busy to give its ${what}. Try again.` };
    if (err.failure.kind === "timeout") return { code: "ai_error", message: `The AI did not give its ${what} in time. Try again.` };
  }
  return { code: "ai_error", message: `The AI's ${what} failed: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}. Try again.` };
}

export async function advanceTopic(
  supabase: Client,
  userId: string,
  topicId: string,
  focusStepId: string | null
): Promise<AdvanceResult> {
  const ctx: Ctx = { supabase, userId, topicId, startedAt: Date.now() };

  const { data: topic } = await supabase
    .from("learning_topics")
    .select("id, title, status, archived_at, docs_site")
    .eq("id", topicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!topic) return { kind: "not_found" };
  if (topic.status !== "active" || topic.archived_at) return { kind: "idle" };

  const { data: steps, error: stepsError } = await supabase
    .from("learning_steps")
    .select("id, position, title, goal, status, removed_at, opened_at, claimed_at, rewrite_reason")
    .eq("topic_id", topicId)
    .eq("user_id", userId);
  if (stepsError || !steps) return { kind: "error", message: "Could not read the steps." };

  const next = pickStepToWrite(steps as StepState[], Date.now(), focusStepId);
  if (next.kind === "idle") return { kind: "idle" };
  if (next.kind === "busy") return { kind: "busy", stepId: next.stepId };

  const budget = await budgetState(supabase, userId);
  if (budget.retryAfterSeconds > 0) {
    return { kind: "budget", retryAfterSeconds: budget.retryAfterSeconds, used: budget.used, cap: budget.cap };
  }

  // Claim: only one request may write a step. The OR admits a pending step
  // or one whose claim has gone stale; a second tab racing us matches nothing.
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: claimed } = await supabase
    .from("learning_steps")
    .update({ status: "writing", claimed_at: claimedAt, error_code: null, error_message: null })
    .eq("id", next.stepId)
    .eq("user_id", userId)
    .or(`status.eq.pending,and(status.eq.writing,claimed_at.lt."${staleBefore}"),and(status.eq.writing,claimed_at.is.null)`)
    .select("id, title, goal, search_query, rewrite_reason, rewrite_note")
    .maybeSingle();
  if (!claimed) return { kind: "busy", stepId: next.stepId };
  const stepId = claimed.id;

  const docsSite = topic.docs_site;
  // A topic with an official documentation site is a code topic (the planner
  // makes every step of it something the learner tries in code), so every
  // lesson in it must show a code example.
  const needsCode = docsSite !== null;
  const spend = new LessonSpend();
  const left: { url: string; why: string }[] = [];
  const trace = {
    topic: topic.title,
    docsSite,
    step: claimed.title,
    calls: [] as { what: string; model: string; total_tokens: number; outcome: string; limits: RateLimits | null }[],
    searches: [] as { phase: string; query: string; hits: string[]; candidates: string[] }[],
    /** Every page left out, and why. */
    pages: left,
    /** Every page read: the sentences dropped because they refer to something not shown, and why. */
    references: [] as unknown[],
    copier: [] as unknown[],
    badAnswers: [] as { what: string; kind: string; reason: string; raw: string }[],
    g2: [] as unknown[],
    /** Filled in as the stages run. */
    stages: {} as Record<string, unknown>,
  };
  const noted = async (what: string, rec: CallRecord, limits: RateLimits | null) => {
    await log(ctx, stepId, rec);
    spend.add(rec);
    trace.calls.push({ what, model: rec.model, total_tokens: rec.total_tokens, outcome: rec.outcome, limits });
  };
  /** Log a call that threw, with the raw answer when it was an unusable one. */
  const notedError = async (what: string, err: unknown) => {
    if (err instanceof LearningAiError || err instanceof BadAnswerError) await noted(what, err.record, null);
    if (err instanceof BadAnswerError) trace.badAnswers.push({ what, kind: err.answer.kind, reason: err.answer.reason, raw: err.answer.raw });
  };
  const spentByModel = () => ({ [LEARNING_WRITE_MODEL]: spend.spent(LEARNING_WRITE_MODEL), [LEARNING_SEARCH_MODEL]: spend.spent(LEARNING_SEARCH_MODEL) });
  const fail = async (code: StepErrorCode, message: string, problems?: string[]): Promise<AdvanceResult> => {
    await markFailed(ctx, stepId, claimedAt, code, message);
    trace.stages.outcome = { failed: code, message, problems, spent: spentByModel() };
    await debugDump(stepId, trace);
    return { kind: "failed", stepId, code, problems: problems?.slice(0, 10) };
  };

  // ── 1-2. The quote: the documentation site first; the open web when no page
  // there gives enough (the rule for every code step, Udit 2026-10-12: never a
  // site where anyone can post, realpython.com first). Since gate 6 the page
  // gives ONLY the quote; the example is the writer's (step 3).
  const provenance = new SourceProvenance();
  const tried = new Set<string>();
  const query = `${claimed.title} ${claimed.goal} ${claimed.search_query}`;
  // The plan before this step: what the example may use besides the step's own idea.
  const position = steps.find((s) => s.id === stepId)?.position ?? Number.POSITIVE_INFINITY;
  const earlierSteps = steps.filter((s) => s.removed_at === null && s.position < position).sort((a, b) => a.position - b.position);
  // The word the quote must use: "print" for "Print a greeting" (gate 9).
  const main = mainWordFor({ title: claimed.title, goal: claimed.goal });
  trace.stages.mainWord = main;
  const isFound = (r: Found | "thin" | null | AdvanceResult): r is Found => r !== null && r !== "thin" && "source" in r;

  interface Viable {
    page: FetchedPage;
    title: string;
    siteName: string;
    /** The part of the page about the step, numbered, with every sentence that refers to something not shown made unusable. */
    view: NumberedPage;
  }
  const usableWords = (p: NumberedPage) => p.sentences.filter((s) => s.usable).reduce((n, s) => n + wordCount(s.text), 0);

  /** The copier on one page; `note` is added for its retry there. Found, "thin" (try the next page), or a result that ends this advance. */
  const quote = async (v: Viable, note?: string): Promise<Found | "thin" | AdvanceResult> => {
    const base = copierUserMessage({ stepTitle: claimed.title, goal: claimed.goal, siteName: v.siteName, page: v.view });
    const message = note ? `${base}\n\n${note}` : base;
    const copyRoom = spend.room(LEARNING_COPY_MODEL, promptTokens(COPIER_SYSTEM_PROMPT, message), COPY_MAX_TOKENS);
    if (copyRoom === null) {
      left.push({ url: v.page.url, why: `not tried: ${spend.overMessage(LEARNING_COPY_MODEL)}` });
      return "thin";
    }
    let copy;
    try {
      copy = await withShortWait(ctx, stepId, 30_000, () => copySource(message, copyRoom));
    } catch (err) {
      await notedError("copier", err);
      const wait = waitResult(err);
      if (wait) {
        // Nothing written yet: hand the step back and let the screen wait.
        await release(ctx, stepId, claimedAt);
        return wait;
      }
      const f = callFailure(err, "choice of what to quote");
      return fail(f.code, f.message);
    }
    await noted(note ? "copier, again" : "copier", copy.record, copy.limits);
    const choice = chooseSource(copy.value, v.view);
    trace.copier.push({ url: v.page.url, retry: Boolean(note), answer: copy.value, choice });
    if (choice.kind === "bad") {
      console.error(`[learning] the copier's answer was not used (${choice.reason}). Raw answer:`, copy.raw);
      return fail("ai_error", `The AI's choice of what to quote could not be used: ${choice.reason}. Try again.`);
    }
    if (choice.kind === "thin") {
      left.push({ url: v.page.url, why: choice.reason });
      return "thin";
    }
    return { page: v.page, title: v.title, siteName: v.siteName, source: choice.source };
  };

  /** One search and its pages. Returns the found quote, null when no page gave enough, or a result that ends this advance. */
  const searchPhase = async (
    phase: "docs" | "web",
    searchQuery: string,
    pick: (hits: SearchHit[]) => SearchHit[]
  ): Promise<Found | null | AdvanceResult> => {
    const room = spend.room(LEARNING_SEARCH_MODEL, SEARCH_PROMPT_TOKENS, SEARCH_MAX_TOKENS);
    if (room === null) return fail("sources_unreachable", `No source was found: ${spend.overMessage(LEARNING_SEARCH_MODEL)}. Try again.`);
    let hits: SearchHit[];
    try {
      const search = await withShortWait(ctx, stepId, 40_000, () => searchForStep(searchQuery, room));
      await noted(`search (${phase})`, search.record, search.limits);
      hits = search.harvest.hits;
    } catch (err) {
      await notedError(`search (${phase})`, err);
      const wait = waitResult(err);
      if (wait) {
        await release(ctx, stepId, claimedAt);
        return wait;
      }
      return fail("sources_unreachable", "The search for sources did not answer, so no lesson was written. Try again.");
    }
    hits.forEach((h) => provenance.addToolUrl(h.url));
    const candidates = pick(hits);
    trace.searches.push({ phase, query: searchQuery, hits: hits.map((h) => h.url), candidates: candidates.map((c) => c.url) });
    if (candidates.length === 0) {
      left.push({ url: `the ${phase === "docs" ? "documentation-site" : "open-web"} search`, why: hits.length ? "none of its results could be used" : "it found nothing" });
      return null;
    }

    const settled = await Promise.allSettled(candidates.map((c) => safeFetchPage(c.url)));
    const viable: Viable[] = [];
    settled.forEach((r, i) => {
      tried.add(candidates[i].url);
      if (r.status !== "fulfilled") {
        left.push({ url: candidates[i].url, why: "it did not load" });
        return;
      }
      const page = r.value;
      tried.add(page.url);
      // A redirect can land on a site where anyone can post.
      if (phase === "web" && isUserContent(page.url)) {
        left.push({ url: page.url, why: "a site where anyone can post" });
        return;
      }
      const { title, siteName, text } = extractPage(page.body, page.contentType, page.url);
      if (phase === "web" && isLandingPage(page.url, text)) {
        left.push({ url: page.url, why: "a landing page, not a page that teaches" });
        return;
      }
      const excerpt = numberPage(excerptFor(text, query, MAIN_SOURCE_EXCERPT_CHARS));
      const thin = pageThinness(excerpt);
      if (thin) {
        left.push({ url: page.url, why: thin });
        return;
      }
      // Never a sentence that refers to something the lesson does not show (Udit, 2026-10-12).
      const cleaned = withoutReferences(excerpt);
      trace.references.push({ url: page.url, dropped: cleaned.dropped });
      viable.push({ page, title, siteName, view: cleaned.page });
    });

    // Each search has its own tries, so thin documentation pages never use up the open web's.
    let tries = 0;
    for (const v of viable) {
      const words = usableWords(v.view);
      if (words < MIN_SOURCE_WORDS) {
        left.push({ url: v.page.url, why: `only ${words} usable words once sentences that refer to something not shown are dropped; at least ${MIN_SOURCE_WORDS} are needed` });
        continue;
      }
      // The quote must use the step's main word (Udit, 2026-10-13, gate 9):
      // a page with no usable sentence that does is left before any try.
      if (main && !v.view.sentences.some((s) => s.usable && usesMainWord(s.text, main))) {
        left.push({ url: v.page.url, why: `no usable sentence uses "${main.word}", the step's main word` });
        continue;
      }
      if (tries >= MAX_COPIER_TRIES) {
        left.push({ url: v.page.url, why: `not tried: ${MAX_COPIER_TRIES} copier tries of this search were already used` });
        continue;
      }
      tries += 1;
      let got = await quote(v);
      // A choice without it: the copier once more on the same page, as one of
      // the same tries, told the word; then the next page.
      if (main && isFound(got) && !got.source.passages.some((p) => usesMainWord(p, main))) {
        if (tries >= MAX_COPIER_TRIES) {
          left.push({ url: v.page.url, why: `its quote did not use "${main.word}", and no copier try was left to choose again` });
          continue;
        }
        tries += 1;
        got = await quote(v, copierMainWordRetry(main));
        if (isFound(got) && !got.source.passages.some((p) => usesMainWord(p, main))) {
          left.push({ url: v.page.url, why: `its quote did not use "${main.word}", twice` });
          continue;
        }
      }
      if (got !== "thin") return got;
    }
    return null;
  };

  let found: Found | null = null;
  if (docsSite) {
    const r = await searchPhase("docs", siteQuery(docsSite, claimed.search_query), (hits) => pickDocsCandidates(hits, docsSite, MAX_CANDIDATE_PAGES));
    if (r !== null && !isFound(r)) return r;
    found = r;
  }
  if (!found) {
    const r = await searchPhase("web", claimed.search_query, (hits) => pickCandidates(hits, MAX_CANDIDATE_PAGES, tried));
    if (r !== null && !isFound(r)) return r;
    found = r;
  }
  if (!found) {
    const why = left.map((p) => `${p.url.replace(/^https:\/\//, "")}: ${p.why}`).join("; ");
    return fail("sources_unreachable", `No page had enough to quote for this step that stands on its own, so no lesson was written (${why}). Try again.`);
  }
  provenance.addFetchedUrl(found.page.url);
  const quoted = found.source;
  trace.stages.main = { url: found.page.url, site: found.siteName, docs: onDocsSite(found.page.url, docsSite), source: quoted };

  // ── 3. The example and the explanation (120b), from the quote only. The
  // example is checked by code (example.ts); a code topic must show one.
  const rules = needsCode ? exampleRulesFor({ title: claimed.title, goal: claimed.goal }, earlierSteps.map((s) => ({ title: s.title, goal: s.goal }))) : null;
  const rulesText = rules ? exampleRulesText(rules) : null;
  trace.stages.exampleRules = rules ? { ...rules, text: rulesText } : null;
  const userMessage = writerUserMessage({
    topicTitle: topic.title,
    stepTitle: claimed.title,
    goal: claimed.goal,
    source: quoted,
    learnerNote: claimed.rewrite_note,
    rewriteReason: claimed.rewrite_reason as "wrong" | "redo" | null,
    exampleRules: rulesText,
  });
  // Retries (Udit, 2026-10-12): Groq refusing the writer's JSON at the schema
  // check, an example that breaks the rules, and G2 listing no words — each
  // kind at most once (G2's once per pass), and all of them together at most
  // MAX_RETRIES_PER_LESSON (gate 7). A cut-off answer is never retried; the
  // one fix is not a retry.
  const retries: { kind: string }[] = [];
  trace.stages.retries = retries;
  /** Take one of the lesson's retries; false when they are spent. */
  const takeRetry = (kind: string): boolean => {
    if (retries.length >= MAX_RETRIES_PER_LESSON) return false;
    retries.push({ kind });
    return true;
  };
  const capMessage = (kind: string) =>
    `The lesson needed a third retry (${kind}) after ${retries.map((r) => r.kind).join(" and ")}, and a lesson gets at most ${MAX_RETRIES_PER_LESSON}, so it was not saved. Try again.`;
  const notes: string[] = [];
  const writerAttempts: unknown[] = [];
  trace.stages.writerAttempts = writerAttempts;
  let formatRetried = false;
  let exampleRetried = false;
  let draft: WriterAnswer | null = null;
  while (draft === null) {
    const message = [userMessage, ...notes].join("\n\n");
    const writeRoom = spend.room(LEARNING_WRITE_MODEL, promptTokens(WRITER_SYSTEM_PROMPT, message), WRITE_MAX_TOKENS);
    if (writeRoom === null) return fail("ai_error", `The explanation was not written: ${spend.overMessage(LEARNING_WRITE_MODEL)}. Try again.`);
    let answer;
    try {
      answer = await withShortWait(ctx, stepId, 20_000, () => writeExplanation(message, writeRoom));
      await noted("writer", answer.record, answer.limits);
    } catch (err) {
      await notedError("writer", err);
      // Every attempt's whole answer is kept, refused ones too (Udit, 2026-10-13, gate 9).
      if (err instanceof BadAnswerError) writerAttempts.push({ refused: err.answer.reason, kind: err.answer.kind, raw: err.answer.raw });
      const wait = waitResult(err);
      if (wait) {
        await release(ctx, stepId, claimedAt);
        return wait;
      }
      if (err instanceof BadAnswerError && err.answer.kind === "format" && !formatRetried) {
        if (!takeRetry("the writer's JSON was refused")) return fail("ai_error", capMessage("the writer's JSON was refused"));
        formatRetried = true;
        notes.push(WRITER_FORMAT_RETRY);
        continue;
      }
      const f = callFailure(err, "explanation");
      return fail(f.code, f.message);
    }
    trace.stages.writer = answer.raw;
    if (rules) {
      const check = checkExample(answer.value.example.lines, rules);
      writerAttempts.push({ example: answer.value.example, check, raw: answer.raw });
      if (!check.ok) {
        if (!exampleRetried) {
          if (!takeRetry("the example broke a rule")) return fail("ai_error", capMessage("the example broke a rule"), check.problems);
          exampleRetried = true;
          notes.push(writerExampleRetry(check.problems));
          continue;
        }
        return fail("ai_error", `The AI's example broke the example rules twice, so no lesson was written: ${check.problems.join("; ")}. Try again.`, check.problems);
      }
    } else {
      writerAttempts.push({ example: answer.value.example, raw: answer.raw });
    }
    draft = answer.value;
  }

  // What the reader sees above the explanation: the quote, and the example
  // with its output — worked out by code when it is only print() of plain
  // text, else the AI's, labelled so. Every check below is given exactly this.
  let explanation: Explanation = { meaning: draft.meaning, walkthrough: draft.walkthrough, closing: draft.closing };
  let source: SourceBlock = quoted;
  if (rules) {
    const lines = draft.example.lines.map((l) => l.replace(/\s+$/, ""));
    const byCode = outputByCode(lines);
    source = { ...quoted, code: lines.join("\n"), output: (byCode ?? draft.example.output).join("\n"), outputBy: byCode ? "code" : "ai" };
    trace.stages.example = { lines, aiOutput: draft.example.output, codeOutput: byCode, outputBy: source.outputBy };
  }

  // ── 4. Shape, G1, G2. Length is counted once, at the end (step 6).
  trace.stages.length = { firstDraft: explanationWords(explanation) };
  const shape = checkShape(explanation, source, false);
  if (shape.length > 0) {
    trace.stages.shape = describe(shape);
    return fail("ai_error", `The AI's explanation did not have the lesson's shape, so it was not saved: ${describe(shape).join("; ")}. Try again.`, describe(shape));
  }

  /**
   * G2, the word check (120b), on the whole explanation. It never ends the
   * advance (Udit, 2026-10-13, gate 9): an answer that cannot be used — Groq
   * refused it, it was cut off or timed out, the model was too busy, the
   * lesson had no budget left for it, or it listed no words twice although
   * the lesson shows code — comes back as `unusable` with why, and the
   * lesson is saved without G2's marks, with CHECKER_UNUSABLE_NOTE on top.
   */
  const wordCheck = async (all: Sentence[], pass: string): Promise<JudgeReading | { unusable: string }> => {
    const base = judgeUserMessage(source, all);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const message = attempt === 1 ? base : `${base}\n\n${JUDGE_EMPTY_WORDS_RETRY}`;
      const label = attempt === 1 ? pass : `${pass}, again: it listed no words`;
      const room = spend.room(LEARNING_JUDGE_MODEL, promptTokens(JUDGE_SYSTEM_PROMPT, message), JUDGE_MAX_TOKENS);
      if (room === null) return { unusable: `it was not run: ${spend.overMessage(LEARNING_JUDGE_MODEL)}` };
      let answer;
      try {
        answer = await withShortWait(ctx, stepId, 8_000, () => judgeWords(message, room));
      } catch (err) {
        await notedError(`word check (G2, ${label})`, err);
        return { unusable: callFailure(err, "word check").message.replace(/ Try again\.$/, "") };
      }
      await noted(`word check (G2, ${label})`, answer.record, answer.limits);
      const read = readWords(answer.value, source, all);
      trace.g2.push({ pass: label, answer: answer.value, read });
      // With code shown, an empty word list is a broken answer, never
      // "nothing to explain" (Udit, 2026-10-12; gate 4's G2 answered
      // "words": []): one retry that says so, inside the lesson's limit.
      if (source.code !== null && answer.value.words.length === 0) {
        if (attempt === 1 && takeRetry(`G2 listed no words (${pass})`)) continue;
        return {
          unusable:
            attempt === 1
              ? `it listed no words, and the lesson's ${MAX_RETRIES_PER_LESSON} retries were already used (${retries.map((r) => r.kind).join(" and ")})`
              : "it listed no words, twice, although the lesson shows code",
        };
      }
      return read;
    }
    return { unusable: "it gave no usable answer" };
  };
  /** Each G2 pass whose answer could not be used, and why: any one, and the lesson has no G2 marks. */
  const unusable: { pass: string; why: string }[] = [];
  trace.stages.g2Unusable = unusable;

  // First pass: G1 (code) and G2's word list.
  const firstSentences = sentencesOf(explanation);
  const g1 = checkCodeRule(firstSentences, source);
  const firstCheck = await wordCheck(firstSentences, "first");
  const firstRead = "unusable" in firstCheck ? null : firstCheck;
  if ("unusable" in firstCheck) unusable.push({ pass: "first", why: firstCheck.unusable });
  const firstWords = firstRead?.words ?? [];
  const firstProblems = [...describe(g1), ...firstWords.map((w) => `unexplained word: ${w.word}`)];
  trace.stages.firstProblems = firstProblems;
  trace.stages.unexplainedWords = firstRead ? { words: firstRead.words, dropped: firstRead.dropped, inventory: firstRead.inventory } : null;

  // ── 5. At most one fix: only the flagged sentences go back, with the words to explain.
  let attempts = 1;
  /** Mark mode: the words still unexplained after the fix. */
  let marks: Marks = NO_MARKS;
  if (g1.length > 0 || firstWords.length > 0) {
    const flaggedIds = Array.from(new Set(g1.map((p) => p.sentence).filter((id): id is number => id !== null)));
    const flagged = firstSentences.filter((s) => flaggedIds.includes(s.id));
    if (Date.now() - ctx.startedAt > ADVANCE_DEADLINE_MS - 15_000) {
      return fail("ungrounded", `The checks found problems in the explanation and there was no time left for its one fix, so it was not saved: ${firstProblems.join("; ")}. Try again.`, firstProblems);
    }
    const fixMessage = writerFixMessage(flagged, g1, firstWords, source, firstSentences);
    const fixRoom = spend.room(LEARNING_WRITE_MODEL, promptTokens(WRITER_SYSTEM_PROMPT, userMessage, fixMessage), FIX_MAX_TOKENS);
    if (fixRoom === null) {
      return fail("ungrounded", `The checks found problems in the explanation and ${spend.overMessage(LEARNING_WRITE_MODEL)}, so it was not saved: ${firstProblems.join("; ")}. Try again.`, firstProblems);
    }
    let changes: Changes;
    let fixWords: { word: string; sentence: string }[];
    try {
      const fix = await withShortWait(ctx, stepId, 12_000, () => writeFix(userMessage, fixMessage, fixRoom));
      await noted("fix", fix.record, fix.limits);
      trace.stages.fix = { asked: fixMessage, answer: fix.raw };
      const read = readFix(fix.value, flaggedIds, firstWords);
      if ("bad" in read) {
        console.error(`[learning] the fix's answer was not used (${read.bad}). Raw answer:`, fix.raw);
        return fail("ai_error", `The AI's fix could not be used: ${read.bad}. The explanation was not saved. Try again.`, firstProblems);
      }
      changes = read.changes;
      fixWords = read.explanations;
      trace.stages.changes = {
        replaced: Array.from(read.changes.replace?.entries() ?? []).map(([id, sentence]) => ({ id, was: firstSentences.find((s) => s.id === id)?.text, now: sentence })),
        explained: read.explanations,
      };
    } catch (err) {
      await notedError("fix", err);
      // Releasing here would make the next request search and write the
      // whole lesson again — measured 2026-10-09: four full restarts in a
      // row, ~16,000 tokens. So the step fails honestly instead.
      const f = callFailure(err, "fix");
      return fail(f.code, `${f.message.replace(/ Try again\.$/, "")} The explanation was not saved. Try again.`, firstProblems);
    }

    const fixed = withChanges(explanation, changes);
    // The whole draft after the fix, so a step that fails on it can still be read (Udit, 2026-10-12).
    trace.stages.fixedDraft = fixed.explanation;
    const shapeAfter = checkShape(fixed.explanation, source, false);
    if (shapeAfter.length > 0) {
      return fail("ai_error", `After its one fix the explanation did not have the lesson's shape, so it was not saved: ${describe(shapeAfter).join("; ")}. Try again.`, describe(shapeAfter));
    }
    const fixedSentences = sentencesOf(fixed.explanation);
    const changed = fixedSentences.filter((s) => fixed.changed.includes(s.id));
    // G1 is unchanged (Udit, 2026-10-10): a code-rule or link problem left
    // after the fix fails the step.
    const g1After = checkCodeRule(changed, source);
    if (g1After.length > 0) {
      trace.stages.afterFix = describe(g1After);
      return fail("ungrounded", `After its one fix the explanation still broke the code rule, so it was not saved: ${describe(g1After).join("; ")}. Try again.`, describe(g1After));
    }
    // G2 again on the fixed explanation, for the words — only when its first
    // answer could be used: otherwise the lesson has no G2 marks anyway.
    let afterRead: JudgeReading | null = null;
    if (firstRead && changed.length > 0) {
      const afterCheck = await wordCheck(fixedSentences, "after fix");
      if ("unusable" in afterCheck) unusable.push({ pass: "after fix", why: afterCheck.unusable });
      else afterRead = afterCheck;
    }
    explanation = fixed.explanation;
    // Mark mode: a word still unexplained after the fix is marked, not ignored
    // (Udit, 2026-10-12) — but the after-fix pass cannot undo the first
    // (2026-10-13, gate 8): a word the first pass found explained in a sentence
    // the fix left alone stays explained. Only words the fix brought in, or
    // that were unexplained before it, are marked.
    const afterWords =
      firstRead && afterRead
        ? wordsAfterFix({ first: firstRead, after: afterRead, kept: fixed.kept, before: firstSentences, now: fixedSentences, changed: fixed.changed })
        : { mark: [], decisions: [] };
    trace.stages.wordsAfterFix = afterWords.decisions;
    trace.stages.inventoryAfterFix = afterRead?.inventory ?? null;
    // Course words in the fix's sentences (code, gate 9): explained by the
    // fix's own sentence for that word, or a sentence G2's checked quote names
    // (in the after-fix numbering), at or before the sentence that uses it.
    const explainedAt: { word: string; sentence: number; by: string }[] = [];
    for (const x of fixWords) {
      const s = changed.find((c) => c.text.trim() === x.sentence.trim());
      if (s) explainedAt.push({ word: x.word, sentence: s.id, by: "the fix's sentence for it" });
    }
    for (const w of firstRead?.inventory ?? []) {
      const at = w.explainedIn === null ? undefined : fixed.kept.get(w.explainedIn);
      if (at !== undefined) explainedAt.push({ word: w.word, sentence: at, by: "G2's first pass, its quote checked" });
    }
    for (const w of afterRead?.inventory ?? []) {
      if (w.explainedIn !== null) explainedAt.push({ word: w.word, sentence: w.explainedIn, by: "G2 after the fix, its quote checked" });
    }
    const course = courseWordsAfterFix({ now: fixedSentences, changed: fixed.changed, explainedAt });
    trace.stages.courseWords = course.decisions;
    // G2's marks only when every G2 answer could be used (Udit, 2026-10-13).
    const wordsLeft = G2_MARK_MODE && unusable.length === 0 ? afterWords.mark : [];
    const courseLeft = course.mark.filter((c) => !wordsLeft.some((w) => sameWord(w.word, c.word)));
    trace.stages.wordsMarked = wordsLeft;
    trace.stages.courseMarked = courseLeft;
    marks = marksFor(wordsLeft, courseLeft);
    attempts = 2;
  }

  // ── 6. The length rule, once, on the final explanation (Udit, 2026-10-12,
  // gate 7): the fix adds the sentences that explain words, so a draft short
  // before it may not be after it. Over the most still blocks; under the
  // least is saved with a mark at the top, not blocked.
  const length = lengthAtEnd(explanation);
  trace.stages.length = { ...(trace.stages.length as object), final: length.words, verdict: length.verdict };
  if (length.verdict === "long") {
    return fail("ai_error", `The explanation is ${length.words} words after its checks and its fix; at most ${LESSON_MAX_WORDS} are allowed, so it was not saved. Try again.`);
  }
  const top: string[] = [];
  if (unusable.length > 0) top.push(CHECKER_UNUSABLE_NOTE);
  if (length.verdict === "short") top.push(shortMark(length.words));
  if (top.length > 0) marks = { ...marks, top };

  // ── 7. Save: the lesson once, with its one source.
  if (!provenance.isStorable(found.page.url)) {
    return fail("sources_unreachable", "The source page's address could not be stored, so the lesson was not saved. Try again.");
  }
  const body = renderLessonBody(source, explanation, marks);
  trace.stages.lesson = { body, sentences: sentencesOf(explanation).length };
  const { data: saved, error: lessonError } = await supabase
    .from("learning_lessons")
    .insert({
      user_id: userId,
      step_id: stepId,
      // The plan's own words, not new AI text outside the marked explanation.
      title: claimed.title,
      summary: claimed.goal.slice(0, 400),
      body,
      model: LEARNING_WRITE_MODEL,
      reason: (claimed.rewrite_reason as "wrong" | "redo" | null) ?? "first",
      feedback: claimed.rewrite_note,
    })
    .select("id")
    .single();
  if (lessonError || !saved) {
    console.error("[learning] lesson insert failed:", lessonError?.message);
    return fail("ai_error", "The lesson was written but could not be saved. Try again.");
  }
  const { error: sourcesError } = await supabase.from("learning_lesson_sources").insert({
    user_id: userId,
    lesson_id: saved.id,
    position: 0,
    url: found.page.url,
    title: found.title,
    site_name: found.siteName,
    origin: "search" as const,
    http_status: found.page.status,
    fetched_at: found.page.fetchedAt,
  });
  if (sourcesError) {
    // The lesson row stays but can never be shown: lesson reads require at
    // least one source (an inner join), so a source-less lesson is invisible.
    console.error("[learning] sources insert failed:", sourcesError.message);
    return fail("ai_error", "The lesson was written but its source could not be saved. Try again.");
  }

  const { error: readyError } = await supabase
    .from("learning_steps")
    .update({ status: "ready", claimed_at: null, rewrite_reason: null, rewrite_note: null, error_code: null, error_message: null })
    .eq("id", stepId)
    .eq("user_id", userId)
    .eq("claimed_at", claimedAt);
  if (readyError) console.error("[learning] mark ready failed:", readyError.message);

  trace.stages.outcome = { saved: saved.id, attempts, spent: spentByModel() };
  await debugDump(stepId, trace);
  return { kind: "wrote", stepId, attempts, firstAttemptProblems: firstProblems.slice(0, 10) };
}
