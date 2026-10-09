import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ADVANCE_DEADLINE_MS,
  MAX_CANDIDATE_PAGES,
  MAX_LESSON_SOURCES,
  MIN_SOURCE_CHARS,
  SOURCE_EXCERPT_CHARS,
  STALE_CLAIM_MS,
  LEARNING_WRITE_MODEL,
} from "@/lib/learning/constants";
import { checkGrounding, relabelSources, type GroundingProblem } from "@/lib/learning/grounding";
import { judgePairs } from "@/lib/learning/judge";
import {
  judgeClaims,
  LearningAiError,
  searchForStep,
  writeDraft,
  type CallRecord,
  type WriteAttempt,
} from "@/lib/learning/groq";
import { excerptFor, extractPage } from "@/lib/learning/html-text";
import { budgetState, devOverride, logCall } from "@/lib/learning/ledger";
import {
  checkLessonRules,
  claimsOf,
  LessonFormatError,
  parseDraftLesson,
  renderLessonMarkdown,
  type DraftLesson,
} from "@/lib/learning/lesson-format";
import { pickStepToWrite, type StepState } from "@/lib/learning/next-step";
import { safeFetchPage, type FetchedPage } from "@/lib/learning/safe-fetch";
import { pickCandidates, SourceProvenance } from "@/lib/learning/sources";
import type { AdvanceResult, StepErrorCode } from "@/lib/learning/types";
import { writerUserMessage, type WriterSource } from "@/lib/learning/writer-prompt";
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
 * Measured per lesson: search ~2s, fetching 3 pages 3-6s, writing ~2-5s.
 * The deadline is the backstop if any of them is slow.
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
 * what is left of this request, wait and try once more. Without this, a draft
 * that failed its checks would hit the minute limit on its corrective second
 * turn (it usually does — the first draft just spent ~5,000 tokens), release
 * the step, and the next request would pay for the search again.
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

async function fetchSources(stepQuery: string, urls: string[], provenance: SourceProvenance): Promise<FetchedSource[]> {
  const settled = await Promise.allSettled(urls.map((u) => safeFetchPage(u)));
  const out: FetchedSource[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const page = r.value;
    const { title, siteName, text } = extractPage(page.body, page.contentType, page.url);
    const excerpt = excerptFor(text, stepQuery, SOURCE_EXCERPT_CHARS);
    if (excerpt.length < MIN_SOURCE_CHARS) continue;
    provenance.addFetchedUrl(page.url);
    out.push({ n: out.length + 1, page, title, siteName, excerpt });
    if (out.length >= MAX_LESSON_SOURCES) break;
  }
  return out;
}

function describe(problems: GroundingProblem[]): string[] {
  return problems.map((p) => `${p.where} ("${p.text.slice(0, 90)}"): ${p.reason}`);
}

/**
 * Dev-only: write each draft, its sources and its check results to
 * LEARNING_DEBUG_DIR, so the grounding check's catch and false-reject rates
 * can be measured on the drafts the real pipeline produced — at no extra AI
 * cost. Never runs in a production build.
 */
async function debugDump(stepId: string, attempt: number, data: unknown): Promise<void> {
  const dir = process.env.LEARNING_DEBUG_DIR;
  if (process.env.NODE_ENV === "production" || !dir) return;
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${Date.now()}-${stepId}-attempt${attempt}.json`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[learning] debug dump failed:", err);
  }
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

  // 1. Search (gpt-oss-20b + browser_search).
  let hits;
  try {
    const search = await withShortWait(ctx, stepId, 25_000, () => searchForStep(claimed.search_query));
    await log(ctx, stepId, search.record);
    hits = search.harvest.hits;
  } catch (err) {
    if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
    const wait = onAiError(err);
    if (wait) {
      await release(ctx, stepId, claimedAt);
      return wait;
    }
    await markFailed(ctx, stepId, claimedAt, "sources_unreachable", "the search did not answer");
    return { kind: "failed", stepId, code: "sources_unreachable" };
  }

  // 2. Fetch the pages ourselves. Only tool-returned URLs are tried, and only
  //    pages that loaded can become sources.
  const provenance = new SourceProvenance();
  hits.forEach((h) => provenance.addToolUrl(h.url));
  const candidates = pickCandidates(hits, MAX_CANDIDATE_PAGES);
  const sources = await fetchSources(
    `${claimed.title} ${claimed.goal} ${claimed.search_query}`,
    candidates.map((c) => c.url),
    provenance
  );
  if (sources.length === 0) {
    await markFailed(ctx, stepId, claimedAt, "sources_unreachable");
    return { kind: "failed", stepId, code: "sources_unreachable" };
  }

  // 3. Write, check, and write once more if the checks failed.
  const writerSources: WriterSource[] = sources.map((s) => ({ n: s.n, siteName: s.siteName, text: s.excerpt }));
  const userMessage = writerUserMessage({
    topicTitle: topic.title,
    stepTitle: claimed.title,
    goal: claimed.goal,
    sources: writerSources,
    learnerNote: claimed.rewrite_note,
    rewriteReason: claimed.rewrite_reason as "wrong" | "redo" | null,
  });
  const grounding = writerSources.map((s) => ({ n: s.n, text: s.text }));
  const maxTokens = devOverride("LEARNING_TEST_WRITE_MAX_TOKENS") ?? undefined;

  let lesson: DraftLesson | null = null;
  let firstProblems: string[] = [];
  let lastProblems: string[] = [];
  let lastGroundingFailures = 0;
  let retry: { previous: string; problems: string[] } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2 && Date.now() - ctx.startedAt > ADVANCE_DEADLINE_MS - 20_000) break;
    let draft: WriteAttempt;
    try {
      const turn: { previous: string; problems: string[] } | null = retry;
      draft = await withShortWait(ctx, stepId, 15_000, () => writeDraft(userMessage, turn, maxTokens));
    } catch (err) {
      if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
      const wait = onAiError(err);
      if (wait && attempt === 1) {
        // Nothing written yet: hand the step back and let the screen wait.
        await release(ctx, stepId, claimedAt);
        return wait;
      }
      if (wait) {
        // The fix turn could not run. Releasing here made the next request
        // search and write the whole lesson again — measured 2026-10-09: four
        // full restarts in a row, ~16,000 tokens, which is a loop. So the step
        // fails honestly instead and waits for a "Try again" tap (condition 3).
        await markFailed(ctx, stepId, claimedAt, "ai_error", "the AI was too busy to finish checking it");
        return { kind: "failed", stepId, code: "ai_error", problems: firstProblems.slice(0, 10) };
      }
      const detail =
        err instanceof LearningAiError && err.failure.kind === "timeout" ? "it did not answer in time" : undefined;
      await markFailed(ctx, stepId, claimedAt, "ai_error", detail);
      return { kind: "failed", stepId, code: "ai_error" };
    }
    if (draft.truncated) {
      await log(ctx, stepId, draft.record);
      await markFailed(ctx, stepId, claimedAt, "truncated");
      return { kind: "failed", stepId, code: "truncated" };
    }
    let problems: string[];
    let parsed: DraftLesson | null = null;
    try {
      parsed = relabelSources(parseDraftLesson(draft.content), grounding).lesson;
      const groundingProblems = describe(
        checkGrounding(parsed, grounding, { topicTitle: topic.title, stepTitle: claimed.title })
      );
      lastGroundingFailures = groundingProblems.length;
      problems = [...checkLessonRules(parsed), ...groundingProblems];
    } catch (err) {
      lastGroundingFailures = 0;
      problems = [err instanceof LessonFormatError ? err.message : "the lesson could not be read"];
    }
    await log(ctx, stepId, { ...draft.record, outcome: problems.length ? "invalid" : "ok" });

    // The meaning check, only for a draft the free rules accept: one 20b call
    // that reads each sentence next to its source passage.
    let judgeLog: { where: string; ok: boolean; why: string }[] = [];
    if (problems.length === 0 && parsed) {
      const pairs = judgePairs(parsed, grounding);
      try {
        const judged = await withShortWait(ctx, stepId, 10_000, () => judgeClaims(pairs));
        await log(ctx, stepId, judged.record);
        judgeLog = pairs.map((p) => ({ where: p.where, ...(judged.verdicts.get(p.id) ?? { ok: false, why: "" }) }));
        problems = pairs
          .filter((p) => !judged.verdicts.get(p.id)?.ok)
          .map(
            (p) =>
              `${p.where} ("${p.sentence.slice(0, 90)}"): its source passage does not support it (${judged.verdicts.get(p.id)?.why || "no reason given"})`
          );
        lastGroundingFailures = problems.length;
      } catch (err) {
        if (err instanceof LearningAiError) await log(ctx, stepId, err.record);
        // A draft has already been paid for, so a busy check is not a reason
        // to start again from the search: fail honestly, never loop.
        const busy = onAiError(err) !== null;
        await markFailed(
          ctx,
          stepId,
          claimedAt,
          "ai_error",
          busy ? "the meaning check was too busy to answer" : "the meaning check did not answer"
        );
        return { kind: "failed", stepId, code: "ai_error" };
      }
    }
    await debugDump(stepId, attempt, {
      topic: topic.title,
      step: claimed.title,
      sources: sources.map((s) => ({ n: s.n, url: s.page.url, site: s.siteName, excerpt: s.excerpt })),
      content: draft.content,
      problems,
      judge: judgeLog,
      record: draft.record,
    });
    if (attempt === 1) firstProblems = problems;
    lastProblems = problems;
    if (problems.length === 0 && parsed) {
      lesson = parsed;
      break;
    }
    retry = { previous: draft.content, problems };
  }
  if (!lesson) {
    const ungrounded = lastGroundingFailures > 0;
    // At most one fix attempt (Udit, condition 3): the step is marked failed
    // and waits for a "Try again" tap. The job never retries it by itself.
    await markFailed(ctx, stepId, claimedAt, ungrounded ? "ungrounded" : "ai_error");
    console.warn("[learning] lesson rejected:", JSON.stringify(lastProblems.slice(0, 10)));
    return { kind: "failed", stepId, code: ungrounded ? "ungrounded" : "ai_error", problems: lastProblems.slice(0, 10) };
  }

  // 4. Save: the lesson once, with the sources it actually cited.
  const cited: number[] = [];
  for (const c of claimsOf(lesson)) for (const s of c.support) if (!cited.includes(s.source)) cited.push(s.source);
  for (const s of lesson.example?.support ?? []) if (!cited.includes(s.source)) cited.push(s.source);
  const used = cited
    .map((n) => sources.find((s) => s.n === n))
    .filter((s): s is FetchedSource => s !== undefined && provenance.isStorable(s.page.url));
  if (used.length === 0) {
    await markFailed(ctx, stepId, claimedAt, "ungrounded");
    return { kind: "failed", stepId, code: "ungrounded" };
  }

  const { data: saved, error: lessonError } = await supabase
    .from("learning_lessons")
    .insert({
      user_id: userId,
      step_id: stepId,
      title: lesson.title,
      summary: lesson.summary,
      body: renderLessonMarkdown(lesson),
      model: LEARNING_WRITE_MODEL,
      reason: (claimed.rewrite_reason as "wrong" | "redo" | null) ?? "first",
      feedback: claimed.rewrite_note,
    })
    .select("id")
    .single();
  if (lessonError || !saved) {
    console.error("[learning] lesson insert failed:", lessonError?.message);
    await markFailed(ctx, stepId, claimedAt, "ai_error", "it could not be saved");
    return { kind: "failed", stepId, code: "ai_error" };
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
    await markFailed(ctx, stepId, claimedAt, "ai_error", "its sources could not be saved");
    return { kind: "failed", stepId, code: "ai_error" };
  }

  const { error: readyError } = await supabase
    .from("learning_steps")
    .update({ status: "ready", claimed_at: null, rewrite_reason: null, rewrite_note: null, error_code: null, error_message: null })
    .eq("id", stepId)
    .eq("user_id", userId)
    .eq("claimed_at", claimedAt);
  if (readyError) console.error("[learning] mark ready failed:", readyError.message);

  return { kind: "wrote", stepId, attempts: firstProblems.length ? 2 : 1, firstAttemptProblems: firstProblems.slice(0, 10) };
}
