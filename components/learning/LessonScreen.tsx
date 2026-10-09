"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Flag, Globe, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { WRONG_NOTE_MAX } from "@/lib/learning/constants";
import type { LessonView } from "@/lib/learning/types";
import {
  learningErrorMessage,
  useLearningJob,
  useLearningLesson,
  useUpdateStep,
} from "@/hooks/useLearning";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JobStatus } from "./JobStatus";
import { LessonBody } from "./LessonBody";
import { DISPLAY, EYEBROW, FOCUS, META, PRESS, PRIMARY_PILL, ROUND_BUTTON, SECONDARY_PILL } from "./ui";

const WRITTEN = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function TopBar({ topicId, view }: { topicId: string; view: LessonView | undefined }) {
  return (
    <div className="sticky top-0 z-10 bg-background px-4 pb-2 pt-[calc(12px_+_env(safe-area-inset-top,0px))]">
      <div className="mx-auto flex h-11 max-w-[680px] items-center justify-between">
        <Link href={`/dashboard/learn/topics/${topicId}`} className={ROUND_BUTTON} aria-label="Close lesson, back to the topic">
          <X className="h-5 w-5" aria-hidden />
        </Link>
        {view && view.index > 0 && (
          <span className="inline-flex h-9 items-center rounded-full bg-surface-raised px-4 text-[13px] font-semibold text-foreground">
            Step {view.index} of {view.total}
          </span>
        )}
      </div>
    </div>
  );
}

function WrongDialog({
  open,
  onOpenChange,
  note,
  setNote,
  onSend,
  sending,
  error,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  note: string;
  setNote: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>What is wrong?</DialogTitle>
          <DialogDescription>
            The lesson is written again from its sources. A note helps, but you can leave it empty.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="wrong-note" className="sr-only">
          What is wrong with this lesson
        </label>
        <textarea
          id="wrong-note"
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={WRONG_NOTE_MAX}
          autoComplete="off"
          rows={4}
          placeholder="e.g. The example does not print what it says…"
          className={cn(
            "w-full rounded-2xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground",
            FOCUS
          )}
        />
        {error && (
          <p className={cn(META, "text-danger")} role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" className={PRIMARY_PILL} disabled={sending} onClick={onSend}>
            {sending ? "Sending…" : "Write it again"}
          </button>
          <button type="button" className={cn(SECONDARY_PILL, "w-full")} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LessonScreen({ topicId, stepId }: { topicId: string; stepId: string }) {
  const lessonQ = useLearningLesson(stepId);
  const update = useUpdateStep();
  const job = useLearningJob(topicId, stepId);
  const view = lessonQ.data;

  // "This is wrong": the note lives here, not in the dialog, so closing the
  // dialog or a failed send never loses what was typed.
  const [wrongOpen, setWrongOpen] = useState(false);
  const [note, setNote] = useState("");
  const [wrongError, setWrongError] = useState<string | null>(null);

  // Showing a lesson moves the reading point, which lets the job write the
  // one after next. Once per step.
  const openedFor = useRef<string | null>(null);
  const { mutate: mutateStep } = update;
  const { kick } = job;
  useEffect(() => {
    if (!view?.lesson || view.step.opened_at || openedFor.current === stepId) return;
    openedFor.current = stepId;
    mutateStep({ stepId, action: "open" }, { onSuccess: kick });
  }, [view, stepId, mutateStep, kick]);

  const step = view?.step;
  const lesson = view?.lesson ?? null;
  const rewriting = !!step && !!lesson && (step.status === "writing" || (step.status === "pending" && step.rewrite_reason !== null));
  const rewriteFailed = !!step && !!lesson && step.status === "failed";

  function sendWrong() {
    setWrongError(null);
    update.mutate(
      { stepId, action: "wrong", note },
      {
        onSuccess: () => {
          setWrongOpen(false);
          setNote("");
          kick();
        },
        onError: (err) => setWrongError(learningErrorMessage(err)),
      }
    );
  }

  return (
    <section
      aria-label="Lesson"
      className="fixed inset-0 z-40 scroll-pb-48 scroll-pt-20 overflow-y-auto overscroll-contain bg-background animate-sheet-up motion-reduce:animate-none"
    >
      <TopBar topicId={topicId} view={view} />

      <div className="mx-auto max-w-[680px] px-5 pb-48 pt-3">
        {lessonQ.isPending ? (
          <div aria-busy="true" aria-label="Loading lesson">
            <div className="h-3 w-24 rounded bg-surface-raised" />
            <div className="mt-3 h-8 w-4/5 rounded bg-surface-raised" />
            <div className="mt-3 h-4 w-3/5 rounded bg-surface-raised" />
            <div className="mt-8 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 rounded bg-surface-raised" />
              ))}
            </div>
          </div>
        ) : lessonQ.isError || !view ? (
          <div className="space-y-4" role="alert">
            <p className={META}>{learningErrorMessage(lessonQ.error)}</p>
            <button type="button" className={SECONDARY_PILL} onClick={() => lessonQ.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <p className={EYEBROW}>{view.topic.title}</p>
            <h1 className={cn(DISPLAY, "mt-2")}>{lesson?.title ?? view.step.title}</h1>
            {lesson && <p className="mt-2 text-[16px] leading-[23px] text-muted-foreground">{lesson.summary}</p>}

            {view.step.removed_at && (
              <p className={cn(META, "mt-4")} role="status">
                This step is removed from the topic. You can bring it back from the step list.
              </p>
            )}

            {rewriting && (
              <p className={cn(META, "mt-4 flex items-center gap-2 rounded-2xl bg-surface p-3")} role="status">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                Rewriting this lesson. You can keep reading this version.
              </p>
            )}
            {rewriteFailed && (
              <div className="mt-4 space-y-2 rounded-2xl bg-surface p-3" role="alert">
                <p className={cn(META, "flex items-start gap-2 text-danger")}>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  The rewrite failed: {view.step.error_message}
                </p>
                <button
                  type="button"
                  className={SECONDARY_PILL}
                  onClick={() => update.mutate({ stepId, action: "retry" }, { onSuccess: kick })}
                >
                  Try again
                </button>
              </div>
            )}

            {lesson ? (
              <>
                <div className="mt-5 flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-soft">
                    <Globe className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className={cn(EYEBROW, "truncate")}>From {view.sources[0]?.site_name}</p>
                    <p className={EYEBROW}>{lesson.minutes} min read</p>
                  </div>
                </div>

                <div className="mt-5">
                  <LessonBody body={lesson.body} />
                </div>

                <div className="mt-10 border-t border-border pt-4">
                  <h2 className={EYEBROW}>Sources</h2>
                  <ol className="mt-2 space-y-2">
                    {view.sources.map((s, i) => (
                      <li key={s.url} className="text-[15px] leading-[21px]">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn("text-accent-soft underline-offset-2 hover:underline", FOCUS, "rounded")}
                        >
                          {i + 1}. {s.title}
                        </a>
                        <span className={cn(META, "block")}>{s.site_name}</span>
                      </li>
                    ))}
                  </ol>
                  <p className={cn(META, "mt-4")}>
                    Written {WRITTEN.format(new Date(lesson.created_at))} by {lesson.model.replace(/^openai\//, "")}
                    {lesson.reason !== "first" ? " · rewritten" : ""}
                  </p>
                  <button
                    type="button"
                    className={cn(SECONDARY_PILL, "mt-4")}
                    disabled={rewriting}
                    onClick={() => {
                      setWrongError(null);
                      setWrongOpen(true);
                    }}
                  >
                    <Flag className="h-4 w-4" aria-hidden />
                    This is wrong
                  </button>
                </div>
              </>
            ) : view.step.status === "failed" ? (
              <div className="mt-6 space-y-3" role="alert">
                <p className={cn(META, "flex items-start gap-2 text-danger")}>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {view.step.error_message ?? "Could not write this lesson."}
                </p>
                <button
                  type="button"
                  className={PRIMARY_PILL}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ stepId, action: "retry" }, { onSuccess: kick })}
                >
                  Try again
                </button>
                {update.isError && <p className={cn(META, "text-danger")}>{learningErrorMessage(update.error)}</p>}
              </div>
            ) : !view.step.removed_at ? (
              <p className={cn(META, "mt-6 flex items-center gap-2")} role="status">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                This lesson is being written from web sources. It usually takes under a minute.
              </p>
            ) : null}

            <JobStatus state={job.state} className="mt-4" />
          </>
        )}
      </div>

      {view && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 bottom-0 h-32 bg-gradient-to-b from-background/0 to-background"
          />
          <div className="fixed inset-x-5 bottom-[calc(20px_+_env(safe-area-inset-bottom,0px))] mx-auto max-w-[640px]">
            <Link
              href={
                view.nextStepId
                  ? `/dashboard/learn/topics/${topicId}/lessons/${view.nextStepId}`
                  : `/dashboard/learn/topics/${topicId}`
              }
              className={cn(
                "flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-white shadow-[0_8px_24px_rgb(var(--accent-rgb)/0.35)] hover:bg-accent-hover",
                PRESS,
                FOCUS
              )}
            >
              {view.nextStepId ? "Next lesson" : "Back to the steps"}
            </Link>
          </div>
        </>
      )}

      <WrongDialog
        open={wrongOpen}
        onOpenChange={setWrongOpen}
        note={note}
        setNote={setNote}
        onSend={sendWrong}
        sending={update.isPending}
        error={wrongError}
      />
    </section>
  );
}
