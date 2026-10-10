import Groq, { APIConnectionTimeoutError, APIError } from "groq-sdk";

import { AnswerError, readAnswer, type ObjectSchema } from "@/lib/learning/answers";
import {
  COPY_TIMEOUT_MS,
  JUDGE_TIMEOUT_MS,
  LEARNING_COPY_MODEL,
  LEARNING_JUDGE_MODEL,
  LEARNING_SEARCH_MODEL,
  LEARNING_WRITE_MODEL,
  PLAN_MAX_TOKENS,
  PLAN_TIMEOUT_MS,
  SEARCH_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
} from "@/lib/learning/constants";
import type { Explanation } from "@/lib/learning/explanation";
import { classifyGroqFailure, jsonAnswerFailure, type GroqFailure } from "@/lib/learning/groq-errors";
import { JUDGE_SCHEMA, JUDGE_SYSTEM_PROMPT, type JudgeAnswer } from "@/lib/learning/judge";
import { COPIER_SCHEMA, COPIER_SYSTEM_PROMPT, type CopierAnswer } from "@/lib/learning/passages";
import {
  PLAN_SCHEMA,
  PLAN_SYSTEM_PROMPT,
  PlanParseError,
  parsePlan,
  planRetryMessage,
  planUserMessage,
  stepProblem,
  type Plan,
  type PlanAnswer,
} from "@/lib/learning/plan";
import { harvestSearchResults, type SearchHarvest } from "@/lib/learning/sources";
import { FIX_SCHEMA, WRITER_SCHEMA, WRITER_SYSTEM_PROMPT, type FixAnswer } from "@/lib/learning/writer-prompt";

/**
 * Learning's Groq calls: plan, search, copy, write, fix, judge. SERVER-ONLY
 * (GROQ_API_KEY).
 *
 * Every answer except the search's is JSON in Groq's strict mode
 * (response_format json_schema, strict: true), which both gpt-oss models
 * support (probed 2026-10-10), and is checked against its schema again here
 * (answers.ts). The search is the one exception: Groq does not allow
 * structured outputs together with tools, and its text is never read — the
 * URLs come from the tool's own results (sources.ts).
 *
 * Its own client with `maxRetries: 0`. groq-sdk retries a 429 twice by
 * default, sleeping between tries — inside a 60s function that silently
 * spends the budget waiting, then fails anyway. Learning reports a 429 as
 * "waiting N seconds" and lets the client come back, so it must see the 429.
 */
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });

/** One row for learning_ai_calls. Every call produces one, success or not. */
export interface CallRecord {
  kind: "plan" | "search" | "write" | "judge";
  model: string;
  outcome: "ok" | "rate_limited" | "truncated" | "empty" | "invalid" | "error";
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  pages_opened: number;
  duration_ms: number;
}

/** The call itself failed: rate limit, timeout, or another API error. */
export class LearningAiError extends Error {
  constructor(
    readonly failure: GroqFailure,
    readonly record: CallRecord
  ) {
    super(failure.kind === "other" ? failure.message : `groq ${failure.kind}`);
    this.name = "LearningAiError";
  }
}

/**
 * The call answered, but the answer cannot be used: cut off, or not matching
 * its schema. Never applied. Groq bills such a call, but a refused one (HTTP
 * 400) reports no usage, so its record holds 0 tokens: the true cost is
 * unknown.
 */
export class BadAnswerError extends Error {
  constructor(
    readonly answer: AnswerError,
    readonly record: CallRecord
  ) {
    super(answer.message);
    this.name = "BadAnswerError";
  }
}

/**
 * Groq's per-minute counter for the model just called, from the response
 * headers. Kept OUT of CallRecord (which is inserted into learning_ai_calls
 * as is): it only goes to the dev debug dump.
 */
export interface RateLimits {
  remainingTokens: number | null;
  limitTokens: number | null;
  resetTokens: string | null;
}

function limitsOf(res: Response | undefined): RateLimits {
  const num = (v: string | null | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    remainingTokens: num(res?.headers.get("x-ratelimit-remaining-tokens")),
    limitTokens: num(res?.headers.get("x-ratelimit-limit-tokens")),
    resetTokens: res?.headers.get("x-ratelimit-reset-tokens") ?? null,
  };
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function record(
  kind: CallRecord["kind"],
  model: string,
  outcome: CallRecord["outcome"],
  usage: Usage | undefined,
  startedAt: number,
  pagesOpened = 0
): CallRecord {
  return {
    kind,
    model,
    outcome,
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    pages_opened: pagesOpened,
    duration_ms: Date.now() - startedAt,
  };
}

function toFailure(err: unknown): GroqFailure {
  if (err instanceof APIConnectionTimeoutError) return classifyGroqFailure({ timedOut: true });
  if (err instanceof APIError) {
    return classifyGroqFailure({
      status: err.status,
      message: err.message,
      retryAfter: err.headers?.get?.("retry-after") ?? null,
    });
  }
  return classifyGroqFailure({ message: err instanceof Error ? err.message : String(err) });
}

function failed(kind: CallRecord["kind"], model: string, err: unknown, startedAt: number): LearningAiError {
  const failure = toFailure(err);
  if (failure.kind === "other" || failure.kind === "timeout") {
    console.error(`[learning] ${kind} call failed (${model}):`, failure.kind === "other" ? failure.message : "timeout");
  }
  const outcome = failure.kind === "minute" || failure.kind === "day" ? "rate_limited" : "error";
  return new LearningAiError(failure, record(kind, model, outcome, undefined, startedAt));
}

/** Loud by design: an unusable answer is logged with its raw text, never dropped quietly. */
function badAnswer(answer: AnswerError, rec: CallRecord): BadAnswerError {
  console.error(`[learning] ${answer.what} was not used (${answer.kind}: ${answer.reason}). Raw answer:`, answer.raw.slice(0, 4000));
  return new BadAnswerError(answer, rec);
}

export interface JsonCall<T> {
  value: T;
  /** The answer exactly as it came back. */
  raw: string;
  record: CallRecord;
  limits: RateLimits;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/**
 * One strict-JSON call. Returns the checked answer, or throws:
 * LearningAiError when the call failed, BadAnswerError when it answered with
 * something that cannot be used — cut off (a 400 that says max_tokens was
 * reached, or finish_reason "length") or not matching its schema.
 */
async function jsonCall<T>(
  kind: CallRecord["kind"],
  model: string,
  what: string,
  messages: Message[],
  schema: ObjectSchema,
  opts: { name: string; temperature: number; maxTokens: number; timeoutMs: number }
): Promise<JsonCall<T>> {
  const startedAt = Date.now();
  let completion;
  let limits: RateLimits;
  try {
    const res = await groq.chat.completions
      .create(
        {
          model,
          messages,
          response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema } },
          reasoning_effort: "low",
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
        },
        { timeout: opts.timeoutMs }
      )
      .withResponse();
    completion = res.data;
    limits = limitsOf(res.response);
  } catch (err) {
    const refused = err instanceof APIError && err.status === 400 ? jsonAnswerFailure(err.error) : null;
    if (refused) {
      const outcome = refused.kind === "cut_off" ? "truncated" : "invalid";
      throw badAnswer(new AnswerError(refused.kind, what, refused.reason, refused.raw), record(kind, model, outcome, undefined, startedAt));
    }
    throw failed(kind, model, err, startedAt);
  }
  const choice = completion.choices[0];
  const raw = choice?.message?.content ?? "";
  if (choice?.finish_reason === "length") {
    const rec = record(kind, model, "truncated", completion.usage, startedAt);
    throw badAnswer(new AnswerError("cut_off", what, "it reached its token limit before it was complete", raw), rec);
  }
  try {
    const value = readAnswer<T>(raw, schema, what);
    return { value, raw, record: record(kind, model, "ok", completion.usage, startedAt), limits };
  } catch (err) {
    if (!(err instanceof AnswerError)) throw err;
    throw badAnswer(err, record(kind, model, raw.trim() ? "invalid" : "empty", completion.usage, startedAt));
  }
}

export interface PlanResult {
  plan: Plan | null;
  /** Set when the call worked but the answer was unusable. */
  problem: string | null;
  /** One per Groq call made, in order: the plan, and the re-ask if one ran. */
  records: CallRecord[];
}

function planCall(messages: Message[]) {
  return jsonCall<PlanAnswer>("plan", LEARNING_WRITE_MODEL, "the plan", messages, PLAN_SCHEMA, {
    name: "course_plan",
    temperature: 0.3,
    maxTokens: PLAN_MAX_TOKENS,
    timeoutMs: PLAN_TIMEOUT_MS,
  });
}

/**
 * Plan a topic. If ANY step holds more than one idea or is about setting up
 * (plan.ts stepProblem), ask once more; a plan that still has such a step is
 * refused, not saved. Rate limits and failed calls are thrown
 * (LearningAiError); an unusable answer comes back as `problem`.
 */
export async function planTopic(topic: string): Promise<PlanResult> {
  const messages: Message[] = [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    { role: "user", content: planUserMessage(topic) },
  ];
  const records: CallRecord[] = [];
  const attempt = async (msgs: Message[]): Promise<{ plan: Plan; raw: string } | { problem: string }> => {
    try {
      const call = await planCall(msgs);
      records.push(call.record);
      return { plan: parsePlan(call.value), raw: call.raw };
    } catch (err) {
      if (err instanceof BadAnswerError) {
        records.push(err.record);
        return { problem: err.answer.kind === "cut_off" ? "The AI's plan was cut off." : `The AI's plan could not be used: ${err.answer.reason}.` };
      }
      if (err instanceof PlanParseError) return { problem: err.message };
      throw err;
    }
  };

  const first = await attempt(messages);
  if ("problem" in first) return { plan: null, problem: first.problem, records };
  if (!first.plan.steps.some((s) => stepProblem(s) !== null)) return { plan: first.plan, problem: null, records };

  let second;
  try {
    second = await attempt([
      ...messages,
      { role: "assistant", content: first.raw },
      { role: "user", content: planRetryMessage(first.plan.steps) },
    ]);
  } catch (err) {
    if (err instanceof LearningAiError) records.push(err.record);
    return { plan: null, problem: "The AI could not fix the plan's steps.", records };
  }
  if ("problem" in second) return { plan: null, problem: second.problem, records };
  const still = second.plan.steps.filter((s) => stepProblem(s) !== null);
  if (still.length > 0) {
    const names = still.map((s) => `"${s.title}" (${stepProblem(s)})`).join(", ");
    return { plan: null, problem: `The plan still had steps it cannot keep: ${names}.`, records };
  }
  return { plan: second.plan, problem: null, records };
}

const SEARCH_SYSTEM = `You find web pages for a lesson writer. Run exactly ONE browser search. Do NOT open any page. Then reply with the single word DONE.`;

export interface SearchResult {
  harvest: SearchHarvest;
  record: CallRecord;
  limits: RateLimits;
}

/** One browser_search. Its text answer is ignored: only the tool's results are used. */
export async function searchForStep(query: string, maxTokens: number): Promise<SearchResult> {
  const startedAt = Date.now();
  let completion;
  let limits: RateLimits;
  try {
    const res = await groq.chat.completions
      .create(
        {
          model: LEARNING_SEARCH_MODEL,
          messages: [
            { role: "system", content: SEARCH_SYSTEM },
            { role: "user", content: `Find beginner-friendly, reliable pages that explain: ${query.slice(0, 320)}` },
          ],
          tools: [{ type: "browser_search" }],
          tool_choice: "required",
          reasoning_effort: "low",
          temperature: 0,
          max_tokens: maxTokens,
        },
        { timeout: SEARCH_TIMEOUT_MS }
      )
      .withResponse();
    completion = res.data;
    limits = limitsOf(res.response);
  } catch (err) {
    throw failed("search", LEARNING_SEARCH_MODEL, err, startedAt);
  }
  const harvest = harvestSearchResults(completion.choices[0]?.message?.executed_tools);
  const outcome = harvest.hits.length > 0 ? "ok" : "empty";
  return {
    harvest,
    record: record("search", LEARNING_SEARCH_MODEL, outcome, completion.usage, startedAt, harvest.pagesOpened),
    limits,
  };
}

/**
 * The copier (passages.ts): gpt-oss-20b answers with sentence and code
 * numbers only. Logged as kind "write" on the 20b model — see
 * LEARNING_COPY_MODEL.
 */
export function copySource(userMessage: string, maxTokens: number): Promise<JsonCall<CopierAnswer>> {
  return jsonCall<CopierAnswer>(
    "write",
    LEARNING_COPY_MODEL,
    "the copier's answer",
    [
      { role: "system", content: COPIER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    COPIER_SCHEMA,
    { name: "source_choice", temperature: 0, maxTokens, timeoutMs: COPY_TIMEOUT_MS }
  );
}

/** The AI explanation (gpt-oss-120b), from the shown source only. */
export function writeExplanation(userMessage: string, maxTokens: number): Promise<JsonCall<Explanation>> {
  return jsonCall<Explanation>(
    "write",
    LEARNING_WRITE_MODEL,
    "the writer's answer",
    [
      { role: "system", content: WRITER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    WRITER_SCHEMA,
    { name: "explanation", temperature: 0.3, maxTokens, timeoutMs: WRITE_TIMEOUT_MS }
  );
}

/** The one fix: the source again (the writer keeps no memory) and only the flagged sentences. */
export function writeFix(userMessage: string, fixMessage: string, maxTokens: number): Promise<JsonCall<FixAnswer>> {
  return jsonCall<FixAnswer>(
    "write",
    LEARNING_WRITE_MODEL,
    "the fix's answer",
    [
      { role: "system", content: WRITER_SYSTEM_PROMPT },
      { role: "user", content: `${userMessage}\n\n${fixMessage}` },
    ],
    FIX_SCHEMA,
    { name: "sentence_fixes", temperature: 0.3, maxTokens, timeoutMs: WRITE_TIMEOUT_MS }
  );
}

/** G2, the meaning check (judge.ts), on gpt-oss-20b. */
export function judgeSentences(userMessage: string, maxTokens: number, model: string = LEARNING_JUDGE_MODEL): Promise<JsonCall<JudgeAnswer>> {
  return jsonCall<JudgeAnswer>(
    "judge",
    model,
    "the meaning check's answer",
    [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    JUDGE_SCHEMA,
    { name: "verdicts", temperature: 0, maxTokens, timeoutMs: JUDGE_TIMEOUT_MS }
  );
}
