/**
 * What a failed Groq call means for the learner. Pure, so the branches are
 * tested on real error text rather than reasoned about.
 *
 * Groq's free plan has two limits a lesson can hit, per model:
 *   - tokens per MINUTE (8,000): transient. Waiting the Retry-After seconds
 *     works. Measured 2026-10-09: 7 searches in ~16 s tripped it with
 *     Retry-After 5; three lesson writes back to back tripped it with 23.
 *   - tokens per DAY (200,000): nothing works until tomorrow.
 * The two arrive as the same 429 status. Only the message tells them apart
 * ("on tokens per minute (TPM)" / "on tokens per day (TPD)"), so that is the
 * one place this reads Groq's prose. A 413 on this account has been seen to
 * mean "minute budget spent" too (see app/api/notes/reformat), so it is
 * treated the same way.
 */

export type GroqFailure =
  | { kind: "minute"; retryAfterSeconds: number }
  | { kind: "day" }
  | { kind: "timeout" }
  | { kind: "other"; message: string };

const DEFAULT_WAIT_SECONDS = 20;

export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n));
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
  return null;
}

/**
 * A strict-JSON answer Groq refused (HTTP 400, code json_validate_failed).
 * groq-sdk puts the parsed body on the error's `error` field (measured
 * 2026-10-10). Two cases, told apart only by `failed_generation`:
 *   - the answer hit max_tokens: failed_generation is Groq's own sentence
 *     "max completion tokens reached before generating a valid document" —
 *     a CUT-OFF answer, which must be reported as such, not as bad format;
 *   - anything else: failed_generation is the model's raw answer.
 * Returns null for every other error body.
 */
export function jsonAnswerFailure(body: unknown): { kind: "cut_off" | "format"; reason: string; raw: string } | null {
  const err = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (typeof err !== "object" || err === null) return null;
  const e = err as { code?: unknown; message?: unknown; failed_generation?: unknown };
  if (e.code !== "json_validate_failed") return null;
  const raw = typeof e.failed_generation === "string" ? e.failed_generation : "";
  if (/max completion tokens reached/i.test(raw)) return { kind: "cut_off", reason: "it reached its token limit before it was complete", raw };
  const message = typeof e.message === "string" ? e.message : "";
  const detail = /Error:\s*(.+)$/.exec(message)?.[1] ?? "it did not match its schema";
  return { kind: "format", reason: detail.slice(0, 200), raw };
}

/** Which of Groq's limits refused a call. */
export type LimitKind = "tokens per minute" | "tokens per day" | "requests per minute" | "requests per day" | "unknown";

/**
 * A refused call (429, or the 413 this account sends for a spent minute
 * budget) as Groq sent it, for the job's trace (Udit, 2026-10-14, gate 10):
 * gate 9 could not tell why step 31's writer got "per day" refusals while
 * other 120b calls went through, because nothing kept Groq's text.
 */
export interface GroqRefusal {
  status: number;
  kind: LimitKind;
  /** Where the kind was read: Groq's message, its headers, or nowhere ("unknown"). */
  kindFrom: "message" | "headers" | null;
  /** Groq's error body, whole. */
  text: string;
  /** Every x-ratelimit-* header, retry-after and the request id, as sent. */
  headers: Record<string, string>;
}

/** Groq's message names the limit: "… on tokens per day (TPD): Limit 200000, Used …". */
const LIMIT_LABELS: { kind: Exclude<LimitKind, "unknown">; label: RegExp }[] = [
  { kind: "tokens per minute", label: /\(TPM\)|tokens per minute/i },
  { kind: "tokens per day", label: /\(TPD\)|tokens per day/i },
  { kind: "requests per minute", label: /\(RPM\)|requests per minute/i },
  { kind: "requests per day", label: /\(RPD\)|requests per day/i },
];

const KEPT_HEADER = /^(?:x-ratelimit-.+|retry-after|x-request-id)$/i;

/** A fetch Headers (what groq-sdk gives), or a plain object (tests). */
type HeaderSource = { forEach(cb: (value: string, key: string) => void): void } | Record<string, string> | null | undefined;

function keptHeaders(headers: HeaderSource): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (value: unknown, key: string) => {
    if (typeof value === "string" && KEPT_HEADER.test(key)) out[key.toLowerCase()] = value;
  };
  if (!headers) return out;
  if (typeof headers.forEach === "function") (headers as { forEach(cb: (value: string, key: string) => void): void }).forEach(add);
  else Object.entries(headers).forEach(([k, v]) => add(v, k));
  return out;
}

/**
 * Read a refusal: the kind is the one Groq's message names; when it names
 * none (or more than one), Groq's headers, which "always refer to" requests
 * per DAY (x-ratelimit-*-requests) and tokens per MINUTE
 * (x-ratelimit-*-tokens) — https://console.groq.com/docs/rate-limits, read
 * 2026-10-14 — name it only when exactly one of the two counters is at 0.
 * Otherwise "unknown": the kind is read, never guessed. Day/minute for the
 * app's own waiting is still classifyGroqFailure's.
 */
export function readRefusal(input: { status: number; body: unknown; headers?: HeaderSource }): GroqRefusal {
  const text = typeof input.body === "string" ? input.body : input.body === undefined ? "" : JSON.stringify(input.body);
  const inner = typeof input.body === "object" && input.body !== null ? (input.body as { error?: { message?: unknown } }).error : undefined;
  const message = typeof inner?.message === "string" ? inner.message : text;
  const headers = keptHeaders(input.headers);
  const named = LIMIT_LABELS.filter((l) => l.label.test(message));
  if (named.length === 1) return { status: input.status, kind: named[0].kind, kindFrom: "message", text, headers };
  const atZero = [
    headers["x-ratelimit-remaining-requests"] === "0" ? ("requests per day" as const) : null,
    headers["x-ratelimit-remaining-tokens"] === "0" ? ("tokens per minute" as const) : null,
  ].filter((k): k is "requests per day" | "tokens per minute" => k !== null);
  if (atZero.length === 1) return { status: input.status, kind: atZero[0], kindFrom: "headers", text, headers };
  return { status: input.status, kind: "unknown", kindFrom: null, text, headers };
}

export function classifyGroqFailure(input: {
  status?: number;
  message?: string;
  retryAfter?: string | null;
  timedOut?: boolean;
}): GroqFailure {
  if (input.timedOut) return { kind: "timeout" };
  const message = input.message ?? "";
  if (input.status === 429 || input.status === 413) {
    if (/per day|\(TPD\)|\(RPD\)/i.test(message)) return { kind: "day" };
    return {
      kind: "minute",
      retryAfterSeconds: parseRetryAfter(input.retryAfter) ?? DEFAULT_WAIT_SECONDS,
    };
  }
  return { kind: "other", message: message.slice(0, 300) || "the AI call failed" };
}
