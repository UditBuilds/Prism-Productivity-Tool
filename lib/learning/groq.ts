import Groq, { APIConnectionTimeoutError, APIError } from "groq-sdk";

import {
  LEARNING_SEARCH_MODEL,
  LEARNING_WRITE_MODEL,
  PLAN_TIMEOUT_MS,
  SEARCH_TIMEOUT_MS,
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
import { WRITER_SYSTEM_PROMPT, writerRetryMessage } from "@/lib/learning/writer-prompt";

/**
 * Learning's three Groq calls. SERVER-ONLY (GROQ_API_KEY).
 *
 * Its own client with `maxRetries: 0`. groq-sdk retries a 429 twice by
 * default, sleeping between tries — inside a 60s function that silently
 * spends the budget waiting, then fails anyway. Learning reports a 429 as
 * "waiting N seconds" and lets the client come back, so it must see the 429.
 */
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });

/** One row for learning_ai_calls. Every call produces one, success or not. */
export interface CallRecord {
  kind: "plan" | "search" | "write";
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
 * Plan a topic. If two or more steps still hold more than one idea, ask once
 * more to split them; if that second answer is unusable, the first plan
 * stands — a plan with a broad step is better than no plan.
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

  if (steps.filter((s) => isMultiIdea(s.title)).length >= 2) {
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
      // The first plan is good enough to keep; only log what the re-ask cost.
      if (err instanceof LearningAiError) records.push(err.record);
    }
  }
  return { steps, problem: null, records };
}

const SEARCH_SYSTEM = `You find web pages for a lesson writer. Run exactly ONE browser search. Do NOT open any page. Then reply with the single word DONE.`;

export interface SearchResult {
  harvest: SearchHarvest;
  record: CallRecord;
}

export async function searchForStep(query: string): Promise<SearchResult> {
  const startedAt = Date.now();
  let completion;
  try {
    completion = await groq.chat.completions.create(
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
        max_tokens: 1500,
      },
      { timeout: SEARCH_TIMEOUT_MS }
    );
  } catch (err) {
    throw failed("search", LEARNING_SEARCH_MODEL, err, startedAt);
  }
  const harvest = harvestSearchResults(completion.choices[0]?.message?.executed_tools);
  const outcome = harvest.hits.length > 0 ? "ok" : "empty";
  return {
    harvest,
    record: record("search", LEARNING_SEARCH_MODEL, outcome, completion.usage, startedAt, harvest.pagesOpened),
  };
}

export interface WriteAttempt {
  content: string;
  truncated: boolean;
  record: CallRecord;
}

/**
 * One draft, as plain text in the line format lesson-format.ts parses — not
 * JSON mode, which refused 3 of 9 quote-heavy drafts outright (HTTP 400
 * "Failed to validate JSON", measured 2026-10-09). `retry` turns this into
 * the corrective second turn: the first draft is sent back with the list of
 * checks it failed.
 */
export async function writeDraft(
  userMessage: string,
  retry: { previous: string; problems: string[] } | null,
  maxTokens = 6000
): Promise<WriteAttempt> {
  const startedAt = Date.now();
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: WRITER_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
  if (retry) {
    messages.push({ role: "assistant", content: retry.previous });
    messages.push({ role: "user", content: writerRetryMessage(retry.problems) });
  }
  let completion;
  try {
    completion = await groq.chat.completions.create(
      {
        model: LEARNING_WRITE_MODEL,
        messages,
        reasoning_effort: "low",
        temperature: 0.3,
        max_tokens: maxTokens,
      },
      { timeout: WRITE_TIMEOUT_MS }
    );
  } catch (err) {
    throw failed("write", LEARNING_WRITE_MODEL, err, startedAt);
  }
  const choice = completion.choices[0];
  const truncated = choice?.finish_reason === "length";
  const content = (choice?.message?.content ?? "").trim();
  return {
    content,
    truncated,
    record: record("write", LEARNING_WRITE_MODEL, truncated ? "truncated" : content ? "ok" : "empty", completion.usage, startedAt),
  };
}
