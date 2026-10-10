import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ADVANCE_DEADLINE_MS,
  LESSON_MIN_WORDS,
  MAX_CANDIDATE_PAGES,
  MAX_LESSON_SOURCES,
  MIN_SOURCE_CHARS,
  SOURCE_EXCERPT_CHARS,
  STALE_CLAIM_MS,
  LEARNING_WRITE_MODEL,
} from "@/lib/learning/constants";
import { checkGrounding } from "@/lib/learning/grounding";
import { judgeItems, judgePassages } from "@/lib/learning/judge";
import {
  copyPassages,
  judgeClaims,
  LearningAiError,
  searchForStep,
  writeDraft,
  writeFix,
  type CallRecord,
  type RateLimits,
  type TextCall,
} from "@/lib/learning/groq";
import { excerptFor, extractPage } from "@/lib/learning/html-text";
import { budgetState, devOverride, logCall } from "@/lib/learning/ledger";
import {
  applyFix,
  checkLessonRules,
  claimsOf,
  LessonFormatError,
  parseDraftLesson,
  parseFixAnswer,
  proseWordCount,
  renderLessonMarkdown,
  settleExample,
  dropHeadings,
  type Claim,
  type DraftLesson,
  type LessonProblem,
} from "@/lib/learning/lesson-format";
import { pickStepToWrite, type StepState } from "@/lib/learning/next-step";
import {
  copierUserMessage,
  enoughToWrite,
  parseCopiedPassages,
  passageWords,
  verifyPassages,
  type Passage,
} from "@/lib/learning/passages";
import { safeFetchPage, type FetchedPage } from "@/lib/learning/safe-fetch";
import { isDocsUrl, isLandingPage, pickCandidates, SourceProvenance } from "@/lib/learning/sources";
import type { AdvanceResult, StepErrorCode } from "@/lib/learning/types";
import { writerFixMessage, writerUserMessage } from "@/lib/learning/writer-prompt";
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
 * The stages, quotes first (Udit's decision, 2026-10-10):
 *   1. search (20b + browser_search) for pages;
 *   2. fetch them here — documentation first, a vendor's landing page only
 *      when no documentation page loaded (decision 3);
 *   3. copy (20b): passages copied word for word, each checked against its
 *      page here and numbered (passages.ts);
 *   4. write (120b) only from those passages, then the free rules
 *      (grounding.ts) and the meaning check (20b, judge.ts);
 *   5. at most ONE fix turn that resends only the failed lines; then the
 *      lesson is saved or the step fails and waits for "Try again".
 */

type Client = SupabaseClient<Database>;

interface Ctx {
  supabase: Client;
  userId: string;
  topicId: string;
  startedAt: number;
}

interface FetchedSource {
  n: number;
  page: FetchedPage;
  title: string;
  siteName: string;
  excerpt: string;
}

const MESSAGES: Record<StepErrorCode, string> = {
  sources_unreachable: "Could not reach sources for this step. Try again.",
  ungrounded: "The AI's lesson was not tied to its sources, so it was not saved. Try again.",
  truncated: "The AI's lesson was cut off before the end, so it was not saved. Try again.",
  ai_error: "The AI could not write this lesson. Try again.",
};

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

async function markFailed(ctx: Ctx, stepId: string, claimedAt: string, code: StepErrorCode, detail?: string) {
  const { error } = await ctx.supabase
    .from("learning_steps")
    .update({
      status: "failed",
      claimed_at: null,
      error_code: code,
      error_message: detail ? `${MESSAGES[code]} (${detail})`.slice(0, 500) : MESSAGES[code],
    })
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

function onAiError(err: unknown): AdvanceResult | null {
  if (!(err instanceof LearningAiError)) return null;
  if (err.failure.kind === "minute") return { kind: "waiting", retryAfterSeconds: err.failure.retryAfterSeconds };
  if (err.failure.kind === "day") return { kind: "groq_daily" };
  return null;
}

interface SkippedPage {
  url: string;
  why: string;
}

/**
 * Fetch the candidates, keep up to MAX_LESSON_SOURCES. Decision 3: pages
 * whose URL reads as documentation come first (pickCandidates), and a
 * vendor's landing page is dropped whenever a documentation page loaded.
 */
async function fetchSources(
  stepQuery: string,
  urls: string[],
  provenance: SourceProvenance
): Promise<{ sources: FetchedSource[]; skipped: SkippedPage[] }> {
  const settled = await Promise.allSettled(urls.map((u) => safeFetchPage(u)));
  const loaded: (Omit<FetchedSource, "n"> & { landing: boolean })[] = [];
  const skipped: SkippedPage[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      skipped.push({ url: urls[i], why: "did not load" });
      return;
    }
    const page = r.value;
    const { title, siteName, text } = extractPage(page.body, page.contentType, page.url);
    const excerpt = excerptFor(text, stepQuery, SOURCE_EXCERPT_CHARS);
    if (excerpt.length < MIN_SOURCE_CHARS) {
      skipped.push({ url: page.url, why: "too little text about the step" });
      return;
    }
    loaded.push({ page, title, siteName, excerpt, landing: isLandingPage(page.url, text) });
  });
  const docsLoaded = loaded.some((p) => !p.landing && isDocsUrl(p.page.url));
  const ordered = [...loaded.filter((p) => !p.landing), ...(docsLoaded ? [] : loaded.filter((p) => p.landing))];
  for (const p of loaded) if (p.landing && docsLoaded) skipped.push({ url: p.page.url, why: "a landing page, and documentation loaded" });
  const sources = ordered.slice(0, MAX_LESSON_SOURCES).map((p, i) => {
    provenance.addFetchedUrl(p.page.url);
    return { n: i + 1, page: p.page, title: p.title, siteName: p.siteName, excerpt: p.excerpt };
  });
  return { sources, skipped };
}

/**
 * Dev-only: write everything one advance did — pages, the copier's answer,
 * the passages it kept and lost, each draft, every check and verdict, and
 * the rate-limit headers after each call — to LEARNING_DEBUG_DIR, so a run
 * can be read line by line at no extra AI cost. Never runs in production.
 */
async function debugDump(stepId: string, data: unknown): Promise<void> {
  const dir = process.env.LEARNING_DEBUG_DIR;
  if (process.env.NODE_ENV === "production" || !dir) return;
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${Date.now()}-${stepId}.json`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[learning] debug dump failed:", err);
  }
}

function describe(problems: LessonProblem[]): string[] {
  return problems.map((p) => `${p.where} ("${p.text.slice(0, 90)}"): ${p.reason}`);
}

/** A problem the one fix turn can mend: a line, the title or summary, or a short lesson. */
function fixable(p: LessonProblem): boolean {
  return p.line !== null || p.where === "title" || p.where === "summary" || (p.where === "length" && Number(p.text) < LESSON_MIN_WORDS);
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
    .select("id, title, status, archived_at")
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

  const trace: Record<string, unknown> = { topic: topic.title, step: claimed.title, calls: [] as unknown[] };
  const calls = trace.calls as { kind: string; model: string; total_tokens: number; limits: RateLimits | null }[];
  const note = (rec: CallRecord, limits: RateLimits | null) =>
    calls.push({ kind: rec.kind, model: rec.model, total_tokens: rec.total_tokens, limits });
  const fail = async (code: StepErrorCode, detail?: string, problems?: string[]): Promise<AdvanceResult> => {
    await markFailed(ctx, stepId, claimedAt, code, detail);
    trace.outcome = { failed: code, detail, problems };
    await debugDump(stepId, trace);
    return { kind: "failed", stepId, code, problems: problems?.slice(0, 10) };
  };

  // 1. Search (gpt-oss-20b + browser_search).
  let hits;
  try {
    const search = await withShortWait(ctx, stepId, 40_000, () => searchForStep(claimed.search_query));
    await log(ctx, stepId, search.record);
    note(search.record, search.limits);
    hits = search.harvest.hits;
  } catch (err) {
    if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
    const wait = onAiError(err);
    if (wait) {
      await release(ctx, stepId, claimedAt);
      return wait;
    }
    return fail("sources_unreachable", "the search did not answer");
  }

  // 2. Fetch the pages ourselves. Only tool-returned URLs are tried, and only
  //    pages that loaded can become sources.
  const provenance = new SourceProvenance();
  hits.forEach((h) => provenance.addToolUrl(h.url));
  const candidates = pickCandidates(hits, MAX_CANDIDATE_PAGES);
  const { sources, skipped } = await fetchSources(
    `${claimed.title} ${claimed.goal} ${claimed.search_query}`,
    candidates.map((c) => c.url),
    provenance
  );
  trace.search = { hits: hits.map((h) => h.url), candidates: candidates.map((c) => c.url), skipped };
  trace.sources = sources.map((s) => ({ n: s.n, url: s.page.url, site: s.siteName, excerpt: s.excerpt }));
  if (sources.length === 0) return fail("sources_unreachable");

  // 3. Copy passages word for word (gpt-oss-20b), then check each one here.
  const copierMessage = copierUserMessage({
    stepTitle: claimed.title,
    goal: claimed.goal,
    sources: sources.map((s) => ({ n: s.n, siteName: s.siteName, text: s.excerpt })),
  });
  let copy: TextCall;
  try {
    copy = await withShortWait(ctx, stepId, 30_000, () => copyPassages(copierMessage));
  } catch (err) {
    if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
    const wait = onAiError(err);
    if (wait) {
      // Nothing written yet: hand the step back and let the screen wait.
      await release(ctx, stepId, claimedAt);
      return wait;
    }
    return fail("ai_error", "the passages could not be copied");
  }
  // A cut-off copier answer still holds the passages before the cut; the
  // last, partial line simply fails verification.
  const { copied } = parseCopiedPassages(copy.content);
  const { passages, rejected } = verifyPassages(
    copied,
    sources.map((s) => ({ n: s.n, text: s.excerpt }))
  );
  await log(ctx, stepId, { ...copy.record, outcome: passages.length > 0 ? copy.record.outcome : "invalid" });
  note(copy.record, copy.limits);
  trace.copier = { content: copy.content, passages, rejected, proseWords: passageWords(passages) };
  if (!enoughToWrite(passages)) {
    return fail("sources_unreachable", `the pages had too little to quote: ${passageWords(passages)} words in ${passages.length} passages`);
  }

  // 4. Write (gpt-oss-120b) from the passages only.
  const userMessage = writerUserMessage({
    topicTitle: topic.title,
    stepTitle: claimed.title,
    goal: claimed.goal,
    passages,
    learnerNote: claimed.rewrite_note,
    rewriteReason: claimed.rewrite_reason as "wrong" | "redo" | null,
  });
  const groundingCtx = {
    topicTitle: topic.title,
    stepTitle: claimed.title,
    sourceTexts: sources.map((s) => s.excerpt),
  };
  const maxTokens = devOverride("LEARNING_TEST_WRITE_MAX_TOKENS") ?? undefined;

  let draft: TextCall;
  try {
    draft = await withShortWait(ctx, stepId, 20_000, () => writeDraft(userMessage, maxTokens));
  } catch (err) {
    if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
    const wait = onAiError(err);
    if (wait) {
      await release(ctx, stepId, claimedAt);
      return wait;
    }
    const detail = err instanceof LearningAiError && err.failure.kind === "timeout" ? "it did not answer in time" : undefined;
    return fail("ai_error", detail);
  }
  note(draft.record, draft.limits);
  trace.draft = draft.content;
  if (draft.truncated) {
    await log(ctx, stepId, draft.record);
    return fail("truncated");
  }

  const check = (l: DraftLesson): LessonProblem[] => [...checkLessonRules(l), ...checkGrounding(l, passages, groundingCtx)];
  /** Headings make no claim: one that fails a check is dropped, then the lesson is checked again. */
  const settle = (l: DraftLesson): { lesson: DraftLesson; problems: LessonProblem[] } => {
    const first = check(l);
    const headings = first.filter((p) => /^heading \d+$/.test(p.where)).map((p) => Number(p.where.slice(8)));
    if (headings.length === 0) return { lesson: l, problems: first };
    const without = dropHeadings(l, headings);
    return { lesson: without, problems: check(without) };
  };
  let lesson: DraftLesson;
  let problems: LessonProblem[];
  try {
    ({ lesson, problems } = settle(settleExample(parseDraftLesson(draft.content), passages)));
  } catch (err) {
    await log(ctx, stepId, { ...draft.record, outcome: "invalid" });
    return fail("ai_error", err instanceof LessonFormatError ? "it was not in the lesson format" : undefined);
  }
  await log(ctx, stepId, { ...draft.record, outcome: problems.length ? "invalid" : "ok" });
  trace.dropped = lesson.dropped;

  /** Lines the meaning check has already accepted, by identity: a fix keeps the others as they are. */
  const accepted = new Set<Claim>();
  const judgeLog: unknown[] = [];
  trace.judge = judgeLog;
  /** Run the meaning check on every line not yet accepted. Returns the lines it rejected. */
  const meaningCheck = async (l: DraftLesson): Promise<LessonProblem[] | AdvanceResult> => {
    const claims = claimsOf(l);
    const only = claims.map((c, i) => (accepted.has(c) ? 0 : i + 1)).filter((n) => n > 0);
    if (only.length === 0) return [];
    const items = judgeItems(l, only);
    try {
      const judged = await withShortWait(ctx, stepId, 8_000, () => judgeClaims(judgePassages(l, passages), items));
      await log(ctx, stepId, judged.record);
      note(judged.record, judged.limits);
      const out: LessonProblem[] = [];
      for (const it of items) {
        const v = judged.verdicts.get(it.id) ?? { ok: false, why: "" };
        judgeLog.push({ line: it.line, cites: it.cites, sentence: it.sentence, ...v });
        if (v.ok) accepted.add(claims[it.line - 1]);
        else {
          out.push({
            line: it.line,
            where: `line ${it.line}`,
            text: it.sentence,
            reason: `its passages do not support it (${v.why || "no reason given"})`,
          });
        }
      }
      return out;
    } catch (err) {
      if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
      // A draft has already been paid for, so a busy check is not a reason
      // to start again from the search: fail honestly, never loop.
      const busy = onAiError(err) !== null;
      return fail("ai_error", busy ? "the meaning check was too busy to answer" : "the meaning check did not answer");
    }
  };

  // The meaning check, only for a draft the free rules accept.
  if (problems.length === 0) {
    const judged = await meaningCheck(lesson);
    if (!Array.isArray(judged)) return judged;
    problems = judged;
  }
  trace.firstProblems = describe(problems);
  const firstProblems = describe(problems);

  // 5. At most one fix turn (Udit, condition 3): only the failed lines go back.
  let fixed = false;
  if (problems.length > 0) {
    const ungrounded = problems.some((p) => p.line !== null);
    if (!problems.every(fixable)) {
      return fail(ungrounded ? "ungrounded" : "ai_error", "its problems cannot be fixed one line at a time", firstProblems);
    }
    if (Date.now() - ctx.startedAt > ADVANCE_DEADLINE_MS - 20_000) {
      return fail(ungrounded ? "ungrounded" : "ai_error", "there was no time left for its one fix", firstProblems);
    }
    const short = problems.find((p) => p.where === "length");
    const asked = problems.filter((p) => p.line !== null).map((p) => p.line as number);
    const fixMessage = writerFixMessage(problems, short ? proseWordCount(lesson) : null);
    let fix: TextCall;
    try {
      fix = await withShortWait(ctx, stepId, 12_000, () => writeFix(userMessage, fixMessage));
    } catch (err) {
      if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
      // Releasing here would make the next request search and write the
      // whole lesson again — measured 2026-10-09: four full restarts in a
      // row, ~16,000 tokens. So the step fails honestly instead.
      const busy = onAiError(err) !== null;
      return fail("ai_error", busy ? "the AI was too busy to fix it" : "the fix did not answer", firstProblems);
    }
    note(fix.record, fix.limits);
    trace.fix = { asked: fixMessage, content: fix.content };
    const applied = applyFix(lesson, parseFixAnswer(fix.content), asked);
    const settled = settle(applied.lesson);
    lesson = settled.lesson;
    problems = [
      ...applied.missing.map((line) => ({ line, where: `line ${line}`, text: "", reason: "the fix gave no replacement for it" })),
      ...settled.problems,
    ];
    await log(ctx, stepId, { ...fix.record, outcome: fix.truncated ? "truncated" : problems.length ? "invalid" : "ok" });
    if (problems.length === 0) {
      const judged = await meaningCheck(lesson);
      if (!Array.isArray(judged)) return judged;
      problems = judged;
    }
    if (problems.length > 0) {
      const after = describe(problems);
      console.warn("[learning] lesson rejected after its fix:", JSON.stringify(after.slice(0, 10)));
      return fail(problems.some((p) => p.line !== null) ? "ungrounded" : "ai_error", undefined, after);
    }
    fixed = true;
  }
  // 6. Save: the lesson once, with the sources its cited passages came from.
  const byId = new Map(passages.map((p) => [p.id, p] as [number, Passage]));
  const citedPassages = [
    ...claimsOf(lesson).flatMap((c) => c.cites),
    ...(lesson.example ? [lesson.example.passage, ...(lesson.example.output !== null ? [lesson.example.output] : [])] : []),
  ];
  const cited: number[] = [];
  for (const id of citedPassages) {
    const src = byId.get(id)?.source;
    if (src !== undefined && !cited.includes(src)) cited.push(src);
  }
  const used = cited
    .map((n) => sources.find((s) => s.n === n))
    .filter((s): s is FetchedSource => s !== undefined && provenance.isStorable(s.page.url));
  if (used.length === 0) return fail("ungrounded");

  const body = renderLessonMarkdown(lesson, passages);
  trace.lesson = { title: lesson.title, summary: lesson.summary, body, words: proseWordCount(lesson) };
  const { data: saved, error: lessonError } = await supabase
    .from("learning_lessons")
    .insert({
      user_id: userId,
      step_id: stepId,
      title: lesson.title,
      summary: lesson.summary,
      body,
      model: LEARNING_WRITE_MODEL,
      reason: (claimed.rewrite_reason as "wrong" | "redo" | null) ?? "first",
      feedback: claimed.rewrite_note,
    })
    .select("id")
    .single();
  if (lessonError || !saved) {
    console.error("[learning] lesson insert failed:", lessonError?.message);
    return fail("ai_error", "it could not be saved");
  }
  const { error: sourcesError } = await supabase.from("learning_lesson_sources").insert(
    used.map((s, i) => ({
      user_id: userId,
      lesson_id: saved.id,
      position: i,
      url: s.page.url,
      title: s.title,
      site_name: s.siteName,
      origin: "search" as const,
      http_status: s.page.status,
      fetched_at: s.page.fetchedAt,
    }))
  );
  if (sourcesError) {
    // The lesson row stays but can never be shown: lesson reads require at
    // least one source (an inner join), so a source-less lesson is invisible.
    console.error("[learning] sources insert failed:", sourcesError.message);
    return fail("ai_error", "its sources could not be saved");
  }

  const { error: readyError } = await supabase
    .from("learning_steps")
    .update({ status: "ready", claimed_at: null, rewrite_reason: null, rewrite_note: null, error_code: null, error_message: null })
    .eq("id", stepId)
    .eq("user_id", userId)
    .eq("claimed_at", claimedAt);
  if (readyError) console.error("[learning] mark ready failed:", readyError.message);

  trace.outcome = { saved: saved.id, attempts: fixed ? 2 : 1 };
  await debugDump(stepId, trace);
  return { kind: "wrote", stepId, attempts: fixed ? 2 : 1, firstAttemptProblems: firstProblems.slice(0, 10) };
}
