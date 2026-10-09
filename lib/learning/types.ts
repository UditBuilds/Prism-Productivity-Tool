/**
 * Shapes the learning routes return. Shared by app/api/learning/** and
 * hooks/useLearning.ts so the two cannot drift.
 */

export type TopicStatus = "planning" | "active" | "failed";
export type StepStatus = "pending" | "writing" | "ready" | "failed";
export type StepErrorCode = "sources_unreachable" | "ungrounded" | "truncated" | "ai_error";
export type RewriteReason = "wrong" | "redo";

export interface TopicSummary {
  id: string;
  title: string;
  status: TopicStatus;
  error_message: string | null;
  archived_at: string | null;
  created_at: string;
  counts: { steps: number; ready: number; writing: number; failed: number; removed: number };
}

export interface StepSummary {
  id: string;
  position: number;
  title: string;
  goal: string;
  status: StepStatus;
  error_code: StepErrorCode | null;
  error_message: string | null;
  rewrite_reason: RewriteReason | null;
  opened_at: string | null;
  removed_at: string | null;
  has_lesson: boolean;
}

export interface TopicDetail {
  topic: TopicSummary;
  steps: StepSummary[];
}

export interface LessonSource {
  url: string;
  title: string;
  site_name: string;
}

export interface LessonView {
  topic: { id: string; title: string };
  step: StepSummary;
  /** 1-based position among steps that are not removed; 0 when this one is removed. */
  index: number;
  total: number;
  nextStepId: string | null;
  lesson: {
    id: string;
    title: string;
    summary: string;
    body: string;
    model: string;
    reason: "first" | RewriteReason;
    created_at: string;
    minutes: number;
  } | null;
  sources: LessonSource[];
}

export type StepAction = "open" | "remove" | "restore" | "redo" | "wrong" | "retry";

/** What one call to POST /api/learning/advance did. */
export type AdvanceResult =
  | { kind: "wrote"; stepId: string; attempts: number; firstAttemptProblems: string[] }
  /** Nothing needs writing: the next lesson is already one step ahead. */
  | { kind: "idle" }
  /** Another request is writing the wanted step right now. */
  | { kind: "busy"; stepId: string }
  /** Groq's per-minute budget is spent; try again after this many seconds. */
  | { kind: "waiting"; retryAfterSeconds: number }
  /** Groq's daily limit is reached. */
  | { kind: "groq_daily" }
  /** This account's own daily learning cap is reached. */
  | { kind: "budget"; retryAfterSeconds: number; used: number; cap: number }
  | { kind: "failed"; stepId: string; code: StepErrorCode; problems?: string[] }
  | { kind: "not_found" }
  | { kind: "error"; message: string };
