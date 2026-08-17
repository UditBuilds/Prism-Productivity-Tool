"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import { useUpdateTask } from "@/hooks/useTasks";
import type { DueTone } from "@/lib/date";
import type { Task } from "@/types/database";
import { priorityText } from "@/components/tasks/task-styles";
import {
  DashboardRow,
  ROW_BUBBLE,
  ROW_META,
} from "@/components/dashboard/DashboardRow";

/** Meta tint per due tone. Overdue is the only one that raises its voice. */
const TONE_CLASS: Record<DueTone, string> = {
  danger: "text-danger",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

/** The separator between meta segments. Muted so the segments rank, not it. */
function Dot() {
  return <span className="text-muted-foreground/40"> · </span>;
}

/**
 * A task row in the dashboard's agenda — overdue or due today.
 *
 * ONE META LINE, NOT THREE PLACES. This row used to state its condition in a
 * due label, a recurrence glyph and a filled priority pill in a trailing slot.
 * All three now share one mono-caps line, each segment tinted by its own rank:
 *
 *     3 DAYS OVERDUE · MEDIUM · DAILY
 *      └ danger        └ warning └ muted
 *
 * That is the same information in one sentence instead of three fragments, and
 * it gives the title back the width the pill was taking at 375px.
 *
 * THE TAP AFFORDANCE. The direction removes every surface, so the mark-done
 * control cannot be a bordered checkbox or a filled bubble — that is the chrome
 * the direction exists to delete. What is left is the glyph itself: a bare
 * circle outline sitting on the page background like punctuation, inside a 36px
 * hit box that is invisible but still finger-sized. It is the same glyph
 * TaskCard uses, minus its container. The circle is the single most
 * conventional "not done yet" mark there is, which is what lets it read as a
 * control without any box around it.
 *
 * Future-dated tasks keep the separate, static UpcomingTaskRow — mark-done is
 * offered for work that is OWED and withheld for work that isn't yet.
 *
 * `backlogCount` is the consolidation from components/tasks/group-backlog.ts.
 * Actions here complete ONLY the fronting instance — the sibling rows are never
 * merged, hidden or altered, because per-day history is what analytics read.
 */
export function AgendaTaskRow({
  task,
  dueLabel,
  dueTone = "muted",
  backlogCount = 0,
}: {
  task: Task;
  dueLabel: string | null;
  dueTone?: DueTone;
  backlogCount?: number;
}) {
  const router = useRouter();
  const updateTask = useUpdateTask();

  // Optimistic check: show the row as done the instant it's tapped, before the
  // server refresh lands. The authoritative state comes from router.refresh()
  // (the agenda queries exclude done tasks, so the row drops out on refresh).
  const [optimisticDone, setOptimisticDone] = useState(false);
  const done = task.status === "done" || optimisticDone;

  function markDone() {
    if (done || updateTask.isPending) return;
    hapticTap();
    setOptimisticDone(true);
    // Send ONLY status — the API route stamps completed_at server-side.
    updateTask.mutate(
      { id: task.id, status: "done" },
      {
        onSuccess: () => router.refresh(),
        onError: () => setOptimisticDone(false),
      }
    );
  }

  return (
    <DashboardRow
      leadingInteractive
      leading={
        <button
          type="button"
          onClick={markDone}
          disabled={done || updateTask.isPending}
          aria-label={
            done ? `${task.title} marked done` : `Mark "${task.title}" done`
          }
          // PRIORITY TINTS THIS STROKE. It replaces the 2px left accent bar,
          // which duplicated the word already on the meta line and, on a
          // one-row day, rendered as a tall coloured slab. The circle is
          // already on every row as the tap target, so the colour scan gets a
          // home without a new object being added — and a stroke is not a
          // surface. `low` resolves to muted: every task has a priority, so
          // tinting the default would tint most rows and rank nothing.
          className={cn(
            ROW_BUBBLE,
            "transition-colors",
            priorityText[task.priority],
            "hover:text-accent",
            done && "text-success"
          )}
        >
          {done ? (
            <CheckCircle2 className="h-4 w-4 animate-pop" />
          ) : (
            <Circle className="h-4 w-4" />
          )}
        </button>
      }
      href={`/dashboard/tasks/${task.id}`}
      title={
        <span className={cn(done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
      }
      meta={
        <span className={ROW_META}>
          {dueLabel && (
            <span className={TONE_CLASS[dueTone]}>{dueLabel}</span>
          )}
          {dueLabel && backlogCount > 0 && (
            <span className="text-muted-foreground">
              {" "}
              +{backlogCount} earlier
            </span>
          )}
          {dueLabel && <Dot />}
          <span className={priorityText[task.priority]}>{task.priority}</span>
          {task.recurring_task_id && (
            <>
              <Dot />
              <span className="text-muted-foreground">daily</span>
            </>
          )}
        </span>
      }
    />
  );
}
