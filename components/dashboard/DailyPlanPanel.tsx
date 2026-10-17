"use client";

import { useIsRestoring } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, Check, MoreHorizontal, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDueDate, istTimeValue, type DueTone } from "@/lib/date";
import {
  activePlanItems,
  type DailyPlanViewItem,
} from "@/lib/daily-plan/view";
import { useDailyPlan, useUpdateDailyPlan } from "@/hooks/useDailyPlan";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TONE_CLASS: Record<DueTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * Today's plan, first thing on the dashboard.
 *
 * THE FIRST BLOCK BUILT TO DESIGN.md ON A SCREEN THAT IS NOT MIGRATED YET.
 * DESIGN.md lists the dashboard as "planned"; everything else on this page is
 * still the PR #48 block treatment. This panel is the screen's ONE filled
 * panel (principle 6) on the new accent-tint token, with the standard block
 * header — round icon, bold name, grey line — so the dashboard's own
 * migration can adopt it rather than redo it.
 *
 * LOW-ENERGY BY DESIGN: the plan is already made, so the whole interaction on
 * a normal day is one tap on "Looks good". Changing a row is two taps (the ⋯
 * button, then Move or Drop). No questions, no typing.
 *
 * A client island, not part of the Server Component: making the plan can
 * include a Groq call, which must never hold up the page's own render, and
 * the edits need optimistic, offline-resumable state that a server-rendered
 * section cannot have.
 */
export function DailyPlanPanel() {
  const { data, isLoading, isError } = useDailyPlan();
  const edit = useUpdateDailyPlan();
  // isLoading reads false throughout an IndexedDB restore, so it is paired
  // with useIsRestoring — the same gate every persisted-cache reader uses.
  const restoring = useIsRestoring() || isLoading;

  if (!data) {
    if (restoring) {
      return (
        <PlanShell>
          <PlanHeader line="Putting today in order" pulsing />
        </PlanShell>
      );
    }
    if (isError) {
      return (
        <PlanShell>
          <PlanHeader line="Couldn't load today's plan. Try refreshing." />
        </PlanShell>
      );
    }
    return null;
  }

  // Planner off for this account (no active anchors): render nothing at all.
  const plan = data.plan;
  if (!plan) return null;

  const items = activePlanItems(data.items);
  const moved = data.items.filter((i) => i.status === "moved").length;
  const dropped = data.items.filter(
    (i) => i.status === "dropped" || i.status === "skipped"
  ).length;
  const offPlan = [
    moved > 0 ? `${moved} moved to tomorrow` : null,
    dropped > 0 ? `${dropped} dropped` : null,
  ].filter(Boolean);

  return (
    <PlanShell>
      <PlanHeader line={plan.reason} />

      {items.length > 0 ? (
        <ol className="mt-3">
          {items.map((item, index) => (
            <PlanRow
              key={item.id}
              item={item}
              number={index + 1}
              onMove={() => edit.mutate({ action: "move", item_id: item.id })}
              onDrop={() => edit.mutate({ action: "drop", item_id: item.id })}
            />
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-base font-medium leading-[22px] text-foreground">
          Nothing left on today&apos;s plan.
        </p>
      )}

      {offPlan.length > 0 && (
        <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">
          {offPlan.join(" · ")}
        </p>
      )}

      {plan.accepted_at ? (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
          <Check aria-hidden className="h-4 w-4 text-success" />
          Plan accepted at {istTimeValue(plan.accepted_at)}
        </p>
      ) : (
        items.length > 0 && (
          <button
            type="button"
            onClick={() => edit.mutate({ action: "accept", plan_id: plan.id })}
            className="mt-4 h-12 w-full rounded-full bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-accent-hover active:bg-accent-hover"
          >
            Looks good
          </button>
        )
      )}
    </PlanShell>
  );
}

function PlanShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="daily-plan-title"
      className="mb-8 rounded-2xl bg-accent-tint p-4"
    >
      {children}
    </section>
  );
}

function PlanHeader({ line, pulsing }: { line: string; pulsing?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      {/* The panel itself is the accent-tint fill, so the round icon sits on
          the page background instead — a tint circle on a tint panel would
          vanish. */}
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-accent-soft"
      >
        <CalendarCheck className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h2
          id="daily-plan-title"
          className="text-[15px] font-bold leading-5 text-foreground"
        >
          Today&apos;s plan
        </h2>
        <p
          className={cn(
            "mt-0.5 text-[13px] leading-[18px] text-muted-foreground",
            pulsing && "animate-pulse"
          )}
        >
          {line}
        </p>
      </div>
    </div>
  );
}

function rowMeta(item: DailyPlanViewItem): { text: string; className: string } | null {
  if (item.kind === "task") {
    if (item.task_done) return { text: "Done", className: "text-success" };
    const due = formatDueDate(item.task_due_date);
    if (!due) return null;
    return {
      text: due.label === "Today" ? "Due today" : due.label,
      className: TONE_CLASS[due.tone],
    };
  }
  if (item.after_title) {
    return { text: `Right after ${item.after_title}`, className: "text-muted-foreground" };
  }
  if (item.carried) {
    return { text: "Moved from yesterday", className: "text-muted-foreground" };
  }
  return null;
}

function PlanRow({
  item,
  number,
  onMove,
  onDrop,
}: {
  item: DailyPlanViewItem;
  number: number;
  onMove: () => void;
  onDrop: () => void;
}) {
  const meta = rowMeta(item);
  return (
    <li className="flex items-center gap-3 py-1">
      <span
        aria-hidden
        className="w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums text-muted-foreground"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1 py-1.5">
        <p
          className={cn(
            "text-base font-medium leading-[22px] text-foreground",
            item.task_done && "text-muted-foreground line-through"
          )}
        >
          {item.title}
        </p>
        {meta && (
          <p className={cn("text-[13px] leading-[18px]", meta.className)}>
            {meta.text}
          </p>
        )}
      </div>
      {/* A finished task has nothing left to move or drop. */}
      {!item.task_done && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Change “${item.title}”`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-background data-[state=open]:text-foreground"
          >
            <MoreHorizontal aria-hidden className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onSelect={onMove}
              className="min-h-11 cursor-pointer text-[15px]"
            >
              <ArrowRight aria-hidden className="mr-2 h-4 w-4" />
              Move to tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDrop}
              className="min-h-11 cursor-pointer text-[15px]"
            >
              <X aria-hidden className="mr-2 h-4 w-4" />
              Drop from today
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
