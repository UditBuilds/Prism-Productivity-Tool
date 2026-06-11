"use client";

import { CalendarIcon, ListChecks, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDueDate, type DueTone } from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import { useDeletePlan } from "@/hooks/usePlans";
import type { Plan } from "@/types/database";
import { planStatusLabel, planStatusStyles } from "./plan-styles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const dueToneClass: Record<DueTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-danger",
};

export function PlanCard({
  plan,
  taskCount,
  doneCount,
}: {
  plan: Plan;
  taskCount: number;
  doneCount: number;
}) {
  const openEditPlan = useUIStore((s) => s.openEditPlan);
  const deletePlan = useDeletePlan();

  // Don't flag a target date as "overdue" once the plan is finished.
  const target =
    plan.status === "completed" ? null : formatDueDate(plan.target_date);
  const pct = taskCount === 0 ? 0 : Math.round((doneCount / taskCount) * 100);

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-surface p-4 duration-75 hover:-translate-y-0.5 hover:border-muted-foreground/40 active:scale-[0.99] active:opacity-90">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => openEditPlan(plan)}
          className="line-clamp-2 text-left text-sm font-medium text-foreground hover:text-accent"
        >
          {plan.title}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Plan actions"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => openEditPlan(plan)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-danger focus:text-danger"
              onClick={() => deletePlan.mutate(plan.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {plan.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {plan.description}
        </p>
      )}

      {/* Progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" />
            Progress
          </span>
          {taskCount > 0 && (
            <span className="text-sm font-semibold tabular-nums text-violet-400">
              {pct}%
            </span>
          )}
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: `${pct}%`,
              ...(pct > 0 && { boxShadow: "0 0 6px rgba(124,58,237,0.5)" }),
            }}
          />
        </div>
        <p className="mt-1.5 text-xs text-[#555]">
          {taskCount === 0
            ? "No tasks linked yet"
            : `${doneCount} of ${taskCount} task${taskCount === 1 ? "" : "s"} complete`}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            planStatusStyles[plan.status]
          )}
        >
          {planStatusLabel[plan.status]}
        </span>

        {target && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 text-xs",
              dueToneClass[target.tone],
              target.bold && "font-semibold"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {target.label}
          </span>
        )}
      </div>
    </div>
  );
}
