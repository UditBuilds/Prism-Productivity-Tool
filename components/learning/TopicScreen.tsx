"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, Clock, Loader2, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StepSummary } from "@/lib/learning/types";
import {
  learningErrorMessage,
  useArchiveTopic,
  useLearningJob,
  useLearningTopic,
  usePlanTopic,
  useUpdateStep,
} from "@/hooks/useLearning";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JobStatus } from "./JobStatus";
import { topicStateLine } from "./TopicsPanel";
import {
  BLOCK_NAME,
  EYEBROW,
  FOCUS,
  META,
  PRIMARY_PILL,
  ROUND_BUTTON,
  ROW_PILL,
  SCREEN_IN,
  SECONDARY_PILL,
  TITLE,
} from "./ui";

export function stepStateLine(s: StepSummary): string {
  if (s.removed_at) return "Removed";
  if (s.status === "writing") return s.has_lesson ? "Rewriting the lesson…" : "Writing the lesson…";
  if (s.status === "failed") return s.error_message ?? "Could not write this lesson. Try again.";
  if (s.status === "pending") return s.has_lesson && s.rewrite_reason ? "Waiting to be rewritten" : "Waiting to be written";
  return s.opened_at ? "Ready · read" : "Ready";
}

function StepNumber({ step, n }: { step: StepSummary; n: number }) {
  const base = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold";
  // A removed step has no number: the steps around it are numbered as if it were gone.
  if (step.removed_at) return <span className={cn(base, "border border-dashed border-border-col text-muted-foreground")} aria-hidden>–</span>;
  if (step.status === "writing") {
    return (
      <span className={cn(base, "bg-surface-raised text-muted-foreground")}>
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      </span>
    );
  }
  if (step.status === "failed") {
    return (
      <span className={cn(base, "bg-danger/10 text-danger")}>
        <AlertCircle className="h-4 w-4" aria-hidden />
      </span>
    );
  }
  if (step.has_lesson) return <span className={cn(base, "bg-accent-tint text-accent-soft")}>{n}</span>;
  return <span className={cn(base, "border border-border-col text-muted-foreground")}>{n}</span>;
}

function StepRow({ step, n, topicId, onChanged }: { step: StepSummary; n: number; topicId: string; onChanged: () => void }) {
  const update = useUpdateStep();
  const act = (action: "remove" | "restore" | "redo" | "retry") =>
    update.mutate({ stepId: step.id, action }, { onSuccess: onChanged });
  const removed = step.removed_at !== null;

  return (
    <li className={cn("flex min-h-[64px] items-center gap-3 py-3", removed && "opacity-70")}>
      {removed ? (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <StepNumber step={step} n={n} />
          <span className="min-w-0 flex-1">
            <span className={cn(BLOCK_NAME, "block text-muted-foreground line-through")}>{step.title}</span>
            <span className={cn(META, "mt-0.5 block")}>Removed</span>
          </span>
        </span>
      ) : (
        <Link
          href={`/dashboard/learn/topics/${topicId}/lessons/${step.id}`}
          className={cn("-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface", FOCUS)}
        >
          <StepNumber step={step} n={n} />
          <span className="min-w-0 flex-1">
            <span className={cn(BLOCK_NAME, "block")}>{step.title}</span>
            <span className={cn(META, "mt-0.5 block", step.status === "failed" && "text-danger")}>
              {update.isError ? learningErrorMessage(update.error) : stepStateLine(step)}
            </span>
          </span>
        </Link>
      )}

      {removed ? (
        <button type="button" className={ROW_PILL} disabled={update.isPending} onClick={() => act("restore")}>
          Restore
        </button>
      ) : step.status === "failed" ? (
        <button type="button" className={ROW_PILL} disabled={update.isPending} onClick={() => act("retry")}>
          Try again
        </button>
      ) : null}

      {!removed && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(ROUND_BUTTON, "bg-transparent")} aria-label={`More for step ${n}: ${step.title}`}>
              <MoreHorizontal className="h-5 w-5 text-muted-foreground" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {step.status !== "writing" && (step.has_lesson || step.status === "failed") && (
              <DropdownMenuItem onSelect={() => act("redo")}>Write this lesson again</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => act("remove")}>Remove this step</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

export function TopicScreen({ topicId }: { topicId: string }) {
  const topic = useLearningTopic(topicId);
  const plan = usePlanTopic(topicId);
  const archive = useArchiveTopic();
  const active = topic.data?.topic.status === "active" && !topic.data.topic.archived_at;
  const job = useLearningJob(active ? topicId : null);

  // A topic left "planning" (the AI was busy at creation, or the app closed
  // mid-plan) plans itself when its screen is open, after the wait it was given.
  const planTries = useRef(0);
  const planning = topic.data?.topic.status === "planning";
  const { isPending: planPending, data: planData, mutate: runPlan } = plan;
  useEffect(() => {
    if (!planning || planPending || planTries.current >= 5) return;
    const wait = (planData?.retryAfterSeconds ?? (planTries.current === 0 ? 0 : 10)) * 1000;
    const t = setTimeout(() => {
      planTries.current += 1;
      runPlan();
    }, wait);
    return () => clearTimeout(t);
  }, [planning, planPending, planData, runPlan]);

  if (topic.isPending) {
    return (
      <div className="max-w-2xl" aria-busy="true" aria-label="Loading topic">
        <div className="h-11 w-11 rounded-full bg-surface-raised" />
        <div className="mt-5 h-3 w-16 rounded bg-surface-raised" />
        <div className="mt-2 h-7 w-3/4 rounded bg-surface-raised" />
        <div className="mt-6 space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-full bg-surface-raised" />
              <span className="h-4 flex-1 rounded bg-surface-raised" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (topic.isError || !topic.data) {
    return (
      <div className="max-w-2xl space-y-4" role="alert">
        <Link href="/dashboard/learn" className={ROUND_BUTTON} aria-label="Back to Learn">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <p className={META}>{learningErrorMessage(topic.error)}</p>
        <button type="button" className={SECONDARY_PILL} onClick={() => topic.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const { topic: t, steps } = topic.data;
  let n = 0;
  const numbered = steps.map((s) => ({ step: s, n: s.removed_at ? 0 : ++n }));

  return (
    <div className={cn("max-w-2xl pb-8", SCREEN_IN)}>
      <Link href="/dashboard/learn" className={ROUND_BUTTON} aria-label="Back to Learn">
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </Link>

      <p className={cn(EYEBROW, "mt-5")}>{t.archived_at ? "Archived topic" : "Topic"}</p>
      <h1 className={cn(TITLE, "mt-1")}>{t.title}</h1>
      {t.status !== "planning" && (
        <p className={cn(META, "mt-1", t.status === "failed" && "text-danger")}>{topicStateLine(t)}</p>
      )}
      <JobStatus state={job.state} className="mt-3" />

      {t.status === "failed" && (
        <div className="mt-4 space-y-2">
          <button type="button" className={PRIMARY_PILL} disabled={plan.isPending} onClick={() => plan.mutate()}>
            {plan.isPending ? "Planning the steps…" : "Try planning again"}
          </button>
          {plan.isError && <p className={cn(META, "text-danger")} role="alert">{learningErrorMessage(plan.error)}</p>}
        </div>
      )}

      {t.status === "planning" && (
        <p className={cn(META, "mt-4 flex items-center gap-2")} role="status">
          {t.error_message ? (
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          )}
          {plan.isError
            ? learningErrorMessage(plan.error)
            : t.error_message ?? "The AI is planning the steps. This takes a few seconds."}
        </p>
      )}

      {steps.length > 0 && (
        <ol className="mt-4 divide-y divide-border border-y border-border" aria-label="Steps">
          {numbered.map(({ step, n: num }) => (
            <StepRow key={step.id} step={step} n={num || step.position + 1} topicId={topicId} onChanged={job.kick} />
          ))}
        </ol>
      )}

      {t.status !== "planning" && (
        <div className="mt-6">
          <button
            type="button"
            className={SECONDARY_PILL}
            disabled={archive.isPending}
            onClick={() => archive.mutate({ topicId, archived: !t.archived_at })}
          >
            {t.archived_at ? "Bring this topic back" : "Archive this topic"}
          </button>
          {archive.isError && <p className={cn(META, "mt-2 text-danger")} role="alert">{learningErrorMessage(archive.error)}</p>}
        </div>
      )}
    </div>
  );
}
