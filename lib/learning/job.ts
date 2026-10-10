import type { SupabaseClient } from "@supabase/supabase-js";

import { checkCodeRule } from "@/lib/learning/code-rule";
import {
  ADVANCE_DEADLINE_MS,
  COPY_MAX_TOKENS,
  FIX_MAX_TOKENS,
  JUDGE_MAX_TOKENS,
  LEARNING_COPY_MODEL,
  LEARNING_JUDGE_MODEL,
  LEARNING_SEARCH_MODEL,
  LEARNING_WRITE_MODEL,
  LESSON_BUDGET,
  MAIN_SOURCE_EXCERPT_CHARS,
  MAX_CANDIDATE_PAGES,
  MAX_SOURCE_PAGES,
  MIN_ANSWER_TOKENS,
  SEARCH_MAX_TOKENS,
  STALE_CLAIM_MS,
  WRITE_MAX_TOKENS,
} from "@/lib/learning/constants";
import { isLocalDevRuntime } from "@/lib/learning/dev-override";
import { checkShape, renderLessonBody, sentencesOf, withReplacements, type Explanation, type Problem, type Sentence } from "@/lib/learning/explanation";
import {
  BadAnswerError,
  copySource,
  judgeSentences,
  LearningAiError,
  searchForStep,
  writeExplanation,
  writeFix,
  type CallRecord,
  type RateLimits,
} from "@/lib/learning/groq";
import { excerptFor, extractPage } from "@/lib/learning/html-text";
import { JUDGE_SYSTEM_PROMPT, judgeUserMessage, readVerdicts } from "@/lib/learning/judge";
import { budgetState, logCall } from "@/lib/learning/ledger";
import { pickStepToWrite, type StepState } from "@/lib/learning/next-step";
import { chooseSource, copierUserMessage, COPIER_SYSTEM_PROMPT, numberPage, pageThinness, type SourceBlock } from "@/lib/learning/passages";
import { safeFetchPage, type FetchedPage } from "@/lib/learning/safe-fetch";
import { isLandingPage, onDocsSite, pickCandidates, pickDocsCandidates, siteQuery, SourceProvenance, type SearchHit } from "@/lib/learning/sources";
import type { AdvanceResult, StepErrorCode } from "@/lib/learning/types";
import { readReplacements, writerFixMessage, writerUserMessage, WRITER_SYSTEM_PROMPT } from "@/lib/learning/writer-prompt";
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
 *   2. per page, best first: the free thin-page check, then the copier (20b)
 *      chooses 1-3 passages and one code example BY NUMBER, then the rest of
 *      the thin-page check — or the next page, at most MAX_SOURCE_PAGES; no
 *      page good enough fails the step before any 120b token is spent;
 *   3. the AI explanation (120b, JSON) from that source block only;
 *   4. its shape (explanation.ts), G1 the code rule (code-rule.ts, no AI),
 *      G2 the meaning check (judge.ts, 20b);
 *   5. at most ONE fix that resends only the flagged sentences; a cut-off
 *      answer is never applied; then the lesson is saved or the step fails
 *      with the real reason and waits for "Try again".
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
    .select("id, position, status, removed_at, opened_at, claimed_at, rewrite_reason")
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

  // ── 1-2. Sources: the documentation site first, the open web only when it finds nothing.
  const provenance = new SourceProvenance();
  const tried = new Set<string>();
  let pagesAsked = 0;
  const query = `${claimed.title} ${claimed.goal} ${claimed.search_query}`;

  /** One search and its pages. Returns the found source, null when nothing fit, or a result that ends this advance. */
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
    const viable: { page: FetchedPage; title: string; siteName: string; numbered: ReturnType<typeof numberPage> }[] = [];
    settled.forEach((r, i) => {
      tried.add(candidates[i].url);
      if (r.status !== "fulfilled") {
        left.push({ url: candidates[i].url, why: "it did not load" });
        return;
      }
      const page = r.value;
      tried.add(page.url);
      const { title, siteName, text } = extractPage(page.body, page.contentType, page.url);
      if (phase === "web" && isLandingPage(page.url, text)) {
        left.push({ url: page.url, why: "a landing page, not a page that teaches" });
        return;
      }
      const numbered = numberPage(excerptFor(text, query, MAIN_SOURCE_EXCERPT_CHARS));
      const thin = pageThinness(numbered, needsCode);
      if (thin) {
        left.push({ url: page.url, why: thin });
        return;
      }
      viable.push({ page, title, siteName, numbered });
    });

    for (const v of viable) {
      if (pagesAsked >= MAX_SOURCE_PAGES) {
        left.push({ url: v.page.url, why: `not tried: ${MAX_SOURCE_PAGES} pages already were` });
        continue;
      }
      const message = copierUserMessage({ stepTitle: claimed.title, goal: claimed.goal, siteName: v.siteName, page: v.numbered });
      const copyRoom = spend.room(LEARNING_COPY_MODEL, promptTokens(COPIER_SYSTEM_PROMPT, message), COPY_MAX_TOKENS);
      if (copyRoom === null) {
        left.push({ url: v.page.url, why: `not tried: ${spend.overMessage(LEARNING_COPY_MODEL)}` });
        continue;
      }
      pagesAsked += 1;
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
      await noted("copier", copy.record, copy.limits);
      const choice = chooseSource(copy.value, v.numbered, needsCode);
      trace.copier.push({ url: v.page.url, answer: copy.value, choice });
      if (choice.kind === "bad") {
        console.error(`[learning] the copier's answer was not used (${choice.reason}). Raw answer:`, copy.raw);
        return fail("ai_error", `The AI's choice of what to quote could not be used: ${choice.reason}. Try again.`);
      }
      if (choice.kind === "thin") {
        left.push({ url: v.page.url, why: choice.reason });
        continue;
      }
      return { page: v.page, title: v.title, siteName: v.siteName, source: choice.source };
    }
    return null;
  };

  const isFound = (r: Found | null | AdvanceResult): r is Found => r !== null && "source" in r;
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
    return fail("sources_unreachable", `No page had enough to teach this step from, so no lesson was written (${why}). Try again.`);
  }
  provenance.addFetchedUrl(found.page.url);
  const source = found.source;
  trace.stages.main = { url: found.page.url, site: found.siteName, docs: onDocsSite(found.page.url, docsSite), source };

  // ── 3. The AI explanation (120b), from the source block only.
  const userMessage = writerUserMessage({
    topicTitle: topic.title,
    stepTitle: claimed.title,
    goal: claimed.goal,
    source,
    learnerNote: claimed.rewrite_note,
    rewriteReason: claimed.rewrite_reason as "wrong" | "redo" | null,
  });
  const writeRoom = spend.room(LEARNING_WRITE_MODEL, promptTokens(WRITER_SYSTEM_PROMPT, userMessage), WRITE_MAX_TOKENS);
  if (writeRoom === null) return fail("ai_error", `The explanation was not written: ${spend.overMessage(LEARNING_WRITE_MODEL)}. Try again.`);
  let explanation: Explanation;
  try {
    const draft = await withShortWait(ctx, stepId, 20_000, () => writeExplanation(userMessage, writeRoom));
    await noted("writer", draft.record, draft.limits);
    trace.stages.writer = draft.raw;
    explanation = draft.value;
  } catch (err) {
    await notedError("writer", err);
    const wait = waitResult(err);
    if (wait) {
      await release(ctx, stepId, claimedAt);
      return wait;
    }
    const f = callFailure(err, "explanation");
    return fail(f.code, f.message);
  }

  // ── 4. Shape, G1, G2.
  const shape = checkShape(explanation, source);
  if (shape.length > 0) {
    trace.stages.shape = describe(shape);
    return fail("ai_error", `The AI's explanation did not have the lesson's shape, so it was not saved: ${describe(shape).join("; ")}. Try again.`, describe(shape));
  }

  /** G2 on these sentences. Returns its problems, or a result that ends this advance. */
  const meaningCheck = async (sentences: Sentence[]): Promise<Problem[] | AdvanceResult> => {
    if (sentences.length === 0) return [];
    const message = judgeUserMessage(source, sentences);
    const room = spend.room(LEARNING_JUDGE_MODEL, promptTokens(JUDGE_SYSTEM_PROMPT, message), JUDGE_MAX_TOKENS);
    if (room === null) return fail("ai_error", `The explanation was not checked: ${spend.overMessage(LEARNING_JUDGE_MODEL)}. Try again.`);
    try {
      // A draft has already been paid for, so a busy check is not a reason
      // to start again from the search: it fails honestly, never loops.
      const judged = await withShortWait(ctx, stepId, 8_000, () => judgeSentences(message, room));
      await noted("meaning check (G2)", judged.record, judged.limits);
      const read = readVerdicts(judged.value, sentences);
      trace.g2.push({ sentences: sentences.map((x) => ({ id: x.id, text: x.text })), answer: judged.value });
      if ("bad" in read) {
        console.error(`[learning] the meaning check's answer was not used (${read.bad}). Raw answer:`, judged.raw);
        return fail("ai_error", `The AI's meaning check could not be used: ${read.bad}. The explanation was not saved. Try again.`);
      }
      return read.problems;
    } catch (err) {
      await notedError("meaning check (G2)", err);
      const f = callFailure(err, "meaning check");
      return fail(f.code, `${f.message.replace(/ Try again\.$/, "")} The explanation was not saved. Try again.`);
    }
  };
  /** G1, then G2 on the sentences G1 did not already reject. */
  const checkSentences = async (which: Sentence[]): Promise<Problem[] | AdvanceResult> => {
    const g1 = checkCodeRule(which, source);
    const flaggedByG1 = new Set(g1.map((p) => p.sentence));
    const g2 = await meaningCheck(which.filter((s) => !flaggedByG1.has(s.id)));
    if (!Array.isArray(g2)) return g2;
    return [...g1, ...g2];
  };

  const first = await checkSentences(sentencesOf(explanation));
  if (!Array.isArray(first)) return first;
  const firstProblems = describe(first);
  trace.stages.firstProblems = firstProblems;

  // ── 5. At most one fix: only the flagged sentences go back.
  let attempts = 1;
  if (first.length > 0) {
    const flaggedIds = Array.from(new Set(first.map((p) => p.sentence as number)));
    const flagged = sentencesOf(explanation).filter((s) => flaggedIds.includes(s.id));
    if (Date.now() - ctx.startedAt > ADVANCE_DEADLINE_MS - 15_000) {
      return fail("ungrounded", `The checks rejected sentences of the explanation and there was no time left for its one fix, so it was not saved: ${firstProblems.join("; ")}. Try again.`, firstProblems);
    }
    const fixMessage = writerFixMessage(flagged, first, source);
    const fixRoom = spend.room(LEARNING_WRITE_MODEL, promptTokens(WRITER_SYSTEM_PROMPT, userMessage, fixMessage), FIX_MAX_TOKENS);
    if (fixRoom === null) {
      return fail("ungrounded", `The checks rejected sentences of the explanation and ${spend.overMessage(LEARNING_WRITE_MODEL)}, so it was not saved: ${firstProblems.join("; ")}. Try again.`, firstProblems);
    }
    let replacements: Map<number, string>;
    try {
      const fix = await withShortWait(ctx, stepId, 12_000, () => writeFix(userMessage, fixMessage, fixRoom));
      await noted("fix", fix.record, fix.limits);
      trace.stages.fix = { asked: fixMessage, answer: fix.raw };
      const read = readReplacements(fix.value, flaggedIds);
      if ("bad" in read) {
        console.error(`[learning] the fix's answer was not used (${read.bad}). Raw answer:`, fix.raw);
        return fail("ai_error", `The AI's fix could not be used: ${read.bad}. The explanation was not saved. Try again.`, firstProblems);
      }
      replacements = read.replacements;
    } catch (err) {
      await notedError("fix", err);
      // Releasing here would make the next request search and write the
      // whole lesson again — measured 2026-10-09: four full restarts in a
      // row, ~16,000 tokens. So the step fails honestly instead.
      const f = callFailure(err, "fix");
      return fail(f.code, `${f.message.replace(/ Try again\.$/, "")} The explanation was not saved. Try again.`, firstProblems);
    }

    const fixed = withReplacements(explanation, replacements);
    explanation = fixed.explanation;
    const shapeAfter = checkShape(explanation, source);
    if (shapeAfter.length > 0) {
      return fail("ai_error", `After its one fix the explanation did not have the lesson's shape, so it was not saved: ${describe(shapeAfter).join("; ")}. Try again.`, describe(shapeAfter));
    }
    const after = await checkSentences(sentencesOf(explanation).filter((s) => fixed.changed.includes(s.id)));
    if (!Array.isArray(after)) return after;
    if (after.length > 0) {
      trace.stages.afterFix = describe(after);
      return fail(
        "ungrounded",
        `After its one fix the explanation still had sentences the checks rejected, so it was not saved: ${describe(after).join("; ")}. Try again.`,
        describe(after)
      );
    }
    attempts = 2;
  }

  // ── 6. Save: the lesson once, with its one source.
  if (!provenance.isStorable(found.page.url)) {
    return fail("sources_unreachable", "The source page's address could not be stored, so the lesson was not saved. Try again.");
  }
  const body = renderLessonBody(source, explanation);
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
