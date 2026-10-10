import Groq, { APIConnectionTimeoutError, APIError } from "groq-sdk";

import {
  COPY_MAX_TOKENS,
  COPY_TIMEOUT_MS,
  FIX_MAX_TOKENS,
  JUDGE_MAX_TOKENS,
  JUDGE_TIMEOUT_MS,
  LEARNING_COPY_MODEL,
  LEARNING_JUDGE_MODEL,
  LEARNING_SEARCH_MODEL,
  LEARNING_WRITE_MODEL,
  PLAN_TIMEOUT_MS,
  SEARCH_MAX_TOKENS,
  SEARCH_TIMEOUT_MS,
  WRITE_MAX_TOKENS,
  WRITE_TIMEOUT_MS,
} from "@/lib/learning/constants";
import { classifyGroqFailure, type GroqFailure } from "@/lib/learning/groq-errors";
import {
  isMultiIdea,
  PLAN_SYSTEM_PROMPT,
  parsePlan,
  planRetryMessage,
  planUserMessage,
  type PlannedStep,
} from "@/lib/learning/plan";
import { harvestSearchResults, type SearchHarvest } from "@/lib/learning/sources";
import { JUDGE_SYSTEM_PROMPT, parseVerdicts, type Verdict } from "@/lib/learning/judge";
import { COPIER_SYSTEM_PROMPT } from "@/lib/learning/passages";
import { WRITER_SYSTEM_PROMPT } from "@/lib/learning/writer-prompt";

/**
 * Learning's Groq calls: plan, search, copy, write, fix, judge. SERVER-ONLY
 * (GROQ_API_KEY).
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
 * Groq's per-minute counter for the model just called, from the response
 * headers. Kept OUT of CallRecord (which is inserted into learning_ai_calls
 * as is): it only goes to the dev debug dump, to settle whether max_tokens is
 * taken from the minute budget up front.
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

export interface PlanResult {
  steps: PlannedStep[] | null;
  /** Set when the call worked but the answer was unusable. */
  problem: string | null;
  /** One per Groq call made, in order: the plan, and the split re-ask if one ran. */
  records: CallRecord[];
}

async function planCall(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const startedAt = Date.now();
  try {
    const completion = await groq.chat.completions.create(
      {
        model: LEARNING_WRITE_MODEL,
        messages,
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        temperature: 0.3,
        max_tokens: 3000,
      },
      { timeout: PLAN_TIMEOUT_MS }
    );
    return { completion, startedAt };
  } catch (err) {
    throw failed("plan", LEARNING_WRITE_MODEL, err, startedAt);
  }
}

/**
 * Plan a topic. One idea per step (Udit, 2026-10-10): if ANY step title holds
 * more than one idea (isMultiIdea), ask once more to split them. A plan that
 * still has such a step after that is refused, not saved — the old rule kept
 * a "broad" plan, and a three-idea step title produced a lesson that was an
 * overview of everything (2026-10-10).
 */
export async function planTopic(topic: string): Promise<PlanResult> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    { role: "user", content: planUserMessage(topic) },
  ];
  const first = await planCall(messages);
  const choice = first.completion.choices[0];
  const records: CallRecord[] = [];
  if (choice?.finish_reason === "length") {
    records.push(record("plan", LEARNING_WRITE_MODEL, "truncated", first.completion.usage, first.startedAt));
    return { steps: null, problem: "The AI's plan was cut off.", records };
  }
  let steps: PlannedStep[];
  try {
    steps = parsePlan(choice?.message?.content ?? "");
  } catch (err) {
    records.push(record("plan", LEARNING_WRITE_MODEL, "invalid", first.completion.usage, first.startedAt));
    return { steps: null, problem: err instanceof Error ? err.message : "The AI's plan could not be read.", records };
  }
  records.push(record("plan", LEARNING_WRITE_MODEL, "ok", first.completion.usage, first.startedAt));

  if (steps.some((s) => isMultiIdea(s.title))) {
    try {
      const second = await planCall([
        ...messages,
        { role: "assistant", content: choice?.message?.content ?? "" },
        { role: "user", content: planRetryMessage(steps) },
      ]);
      const c2 = second.completion.choices[0];
      try {
        if (c2?.finish_reason === "length") throw new Error("cut off");
        steps = parsePlan(c2?.message?.content ?? "");
        records.push(record("plan", LEARNING_WRITE_MODEL, "ok", second.completion.usage, second.startedAt));
      } catch {
        records.push(record("plan", LEARNING_WRITE_MODEL, "invalid", second.completion.usage, second.startedAt));
      }
    } catch (err) {
      if (err instanceof LearningAiError) records.push(err.record);
      return { steps: null, problem: "The AI could not split the plan's steps into one idea each.", records };
    }
    const still = steps.filter((s) => isMultiIdea(s.title));
    if (still.length > 0) {
      const names = still.map((s) => `"${s.title}"`).join(", ");
      return { steps: null, problem: `The plan still had steps with more than one idea: ${names}.`, records };
    }
  }
  return { steps, problem: null, records };
}

const SEARCH_SYSTEM = `You find web pages for a lesson writer. Run exactly ONE browser search. Do NOT open any page. Then reply with the single word DONE.`;

export interface SearchResult {
  harvest: SearchHarvest;
  record: CallRecord;
  limits: RateLimits;
}

export async function searchForStep(query: string): Promise<SearchResult> {
  const startedAt = Date.now();
  let completion;
  let limits: RateLimits;
  try {
    const res = await groq.chat.completions.create(
      {
        model: LEARNING_SEARCH_MODEL,
        messages: [
          { role: "system", content: SEARCH_SYSTEM },
          { role: "user", content: `Find beginner-friendly, reliable pages that explain: ${query.slice(0, 300)}` },
        ],
        tools: [{ type: "browser_search" }],
        tool_choice: "required",
        reasoning_effort: "low",
        temperature: 0,
        max_tokens: SEARCH_MAX_TOKENS,
      },
      { timeout: SEARCH_TIMEOUT_MS }
    ).withResponse();
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

export interface TextCall {
  content: string;
  truncated: boolean;
  record: CallRecord;
  limits: RateLimits;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/** One plain-text completion: the copier, the writer and its fix turn. */
async function textCall(
  kind: CallRecord["kind"],
  model: string,
  messages: Message[],
  opts: { temperature: number; maxTokens: number; timeoutMs: number }
): Promise<TextCall> {
  const startedAt = Date.now();
  let completion;
  let limits: RateLimits;
  try {
    const res = await groq.chat.completions
      .create(
        {
          model,
          messages,
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
    throw failed(kind, model, err, startedAt);
  }
  const choice = completion.choices[0];
  const truncated = choice?.finish_reason === "length";
  const content = (choice?.message?.content ?? "").trim();
  return {
    content,
    truncated,
    record: record(kind, model, truncated ? "truncated" : content ? "ok" : "empty", completion.usage, startedAt),
    limits,
  };
}

/**
 * The copier (passages.ts): gpt-oss-20b copies passages from the pages word
 * for word. Logged as kind "write" on the 20b model — see LEARNING_COPY_MODEL.
 */
export function copyPassages(userMessage: string): Promise<TextCall> {
  return textCall(
    "write",
    LEARNING_COPY_MODEL,
    [
      { role: "system", content: COPIER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    { temperature: 0, maxTokens: COPY_MAX_TOKENS, timeoutMs: COPY_TIMEOUT_MS }
  );
}

/**
 * One draft, as plain text in the line format lesson-format.ts parses — not
 * JSON mode, which refused 3 of 9 quote-heavy drafts outright (HTTP 400
 * "Failed to validate JSON", measured 2026-10-09).
 */
export function writeDraft(userMessage: string, maxTokens = WRITE_MAX_TOKENS): Promise<TextCall> {
  return textCall(
    "write",
    LEARNING_WRITE_MODEL,
    [
      { role: "system", content: WRITER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    { temperature: 0.3, maxTokens, timeoutMs: WRITE_TIMEOUT_MS }
  );
}

/**
 * The fix turn: the passages again (the writer keeps no memory) and only the
 * lines that failed, never the whole draft (Udit's decision, 2026-10-10).
 */
export function writeFix(userMessage: string, fixMessage: string): Promise<TextCall> {
  return textCall(
    "write",
    LEARNING_WRITE_MODEL,
    [
      { role: "system", content: WRITER_SYSTEM_PROMPT },
      { role: "user", content: `${userMessage}\n\n${fixMessage}` },
    ],
    { temperature: 0.3, maxTokens: FIX_MAX_TOKENS, timeoutMs: WRITE_TIMEOUT_MS }
  );
}

export interface JudgeResult {
  /** By judge item id. */
  verdicts: Map<number, Verdict>;
  record: CallRecord;
  limits: RateLimits;
}

/**
 * The meaning check (judge.ts): one call on gpt-oss-20b with the message
 * judgeUserMessage built (passages once, then the lines to check). A cut-off
 * or empty answer leaves lines without a verdict, and parseVerdicts counts
 * those as NOT supported — the check fails closed.
 */
export async function judgeClaims(
  userMessage: string,
  ids: number[],
  model: string = LEARNING_JUDGE_MODEL
): Promise<JudgeResult> {
  const call = await textCall(
    "judge",
    model,
    [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    { temperature: 0, maxTokens: JUDGE_MAX_TOKENS, timeoutMs: JUDGE_TIMEOUT_MS }
  );
  return {
    verdicts: parseVerdicts(call.content, ids),
    record: call.record,
    limits: call.limits,
  };
}

