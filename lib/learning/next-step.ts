import { STALE_CLAIM_MS } from "@/lib/learning/constants";

/**
 * Which step the job should write next. Pure, so the one-ahead rule
 * (decision 10) is pinned by tests rather than described in a comment.
 *
 * The reading point is the first step not removed and not yet opened. The
 * job keeps THAT step and the one after it written. At creation nothing is
 * open, so that is lessons 1 and 2; opening lesson 1 moves the point to 2 and
 * asks for lesson 3. A rewrite Udit asked for ("This is wrong", "Redo") jumps
 * the queue. A step that FAILED is never retried by itself — that would loop
 * on a source that is down — it waits for a "Try again" tap.
 */

export interface StepState {
  id: string;
  position: number;
  status: "pending" | "writing" | "ready" | "failed";
  removed_at: string | null;
  opened_at: string | null;
  claimed_at: string | null;
  rewrite_reason: "wrong" | "redo" | null;
}

export type NextStep =
  | { kind: "write"; stepId: string }
  /** The wanted step is being written by another request right now. */
  | { kind: "busy"; stepId: string }
  | { kind: "idle" };

export function isClaimStale(claimedAt: string | null, nowMs: number): boolean {
  if (!claimedAt) return true;
  const t = Date.parse(claimedAt);
  return !Number.isFinite(t) || nowMs - t > STALE_CLAIM_MS;
}

/** Positions of the steps the one-ahead rule wants written. */
export function wantedWindow(steps: StepState[]): StepState[] {
  const active = steps
    .filter((s) => s.removed_at === null)
    .sort((a, b) => a.position - b.position);
  let reading = active.findIndex((s) => s.opened_at === null);
  if (reading === -1) reading = active.length;
  // Everything up to and including one past the reading point.
  return active.slice(0, reading + 2);
}

/**
 * `focusStepId` is the step on screen, if any. Opening step 5 before 2–4 are
 * read is allowed, and the screen should not sit waiting for the window to
 * reach it — so it goes first, after rewrites.
 */
export function pickStepToWrite(
  steps: StepState[],
  nowMs: number,
  focusStepId: string | null = null
): NextStep {
  const active = steps.filter((s) => s.removed_at === null);
  const claimable = (s: StepState) =>
    s.status === "pending" || (s.status === "writing" && isClaimStale(s.claimed_at, nowMs));

  const focus = focusStepId ? active.find((s) => s.id === focusStepId) : undefined;

  const rewrite = active
    .filter((s) => s.rewrite_reason !== null)
    .sort((a, b) => a.position - b.position);
  for (const s of rewrite) {
    if (claimable(s)) return { kind: "write", stepId: s.id };
  }
  if (focus && claimable(focus)) return { kind: "write", stepId: focus.id };

  let busy: string | null = focus && focus.status === "writing" ? focus.id : null;
  for (const s of wantedWindow(steps)) {
    if (claimable(s)) return { kind: "write", stepId: s.id };
    if (s.status === "writing" && busy === null) busy = s.id;
  }
  for (const s of rewrite) {
    if (s.status === "writing" && busy === null) busy = s.id;
  }
  return busy ? { kind: "busy", stepId: busy } : { kind: "idle" };
}
