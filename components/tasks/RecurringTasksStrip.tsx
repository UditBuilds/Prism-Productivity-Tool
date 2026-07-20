"use client";

import { Repeat, X } from "lucide-react";

import { istWeekday, nextIstMatchingDayName } from "@/lib/date";
import {
  useRecurringTemplatesQuery,
  useStopRecurringTemplate,
} from "@/hooks/useTasks";
import type { RecurringTask } from "@/types/database";

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeDays(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "0,1,2,3,4,5,6") return "every day";
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "0,6") return "weekends";
  return sorted.map((d) => DAY_ABBREV[d]).join(" · ");
}

/** Today's (IST) instance is in the task list; otherwise say when the next
 *  one lands — the whole point of the strip is that a recurring task exists
 *  even on days it spawns nothing. */
function scheduleLabel(template: RecurringTask): string {
  const days = template.days_of_week;
  const base = describeDays(days);
  return days.includes(istWeekday())
    ? base
    : `${base} — next task ${nextIstMatchingDayName(days)}`;
}

/**
 * Persistent list of ACTIVE recurring templates above the task list. Without
 * it, a recurring task created on a non-scheduled day is invisible until its
 * first instance spawns — which historically read as "creation failed" and
 * led to the same template being re-created several times.
 */
export function RecurringTasksStrip() {
  const { data: templates } = useRecurringTemplatesQuery();
  const stopTemplate = useStopRecurringTemplate();

  if (!templates || templates.length === 0) return null;

  return (
    <div className="mt-5 rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Repeats
      </p>
      <ul className="mt-1.5 space-y-1">
        {templates.map((t) => (
          <li key={t.id} className="flex min-w-0 items-center gap-2">
            <Repeat className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="truncate text-sm text-foreground">{t.title}</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {scheduleLabel(t)}
            </span>
            <button
              type="button"
              onClick={() => stopTemplate.mutate(t.id)}
              disabled={stopTemplate.isPending}
              aria-label={`Stop repeating ${t.title}`}
              title="Stop repeating"
              className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
