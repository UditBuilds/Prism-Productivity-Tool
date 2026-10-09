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
