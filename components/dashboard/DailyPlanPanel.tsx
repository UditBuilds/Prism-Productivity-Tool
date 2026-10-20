"use client";

import { useIsRestoring } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDueDate, istDayLabel, istTimeValue } from "@/lib/date";
import {
  DAY_CAP,
  planSections,
  type DailyPlanViewItem,
} from "@/lib/daily-plan/view";
import {
  useCompletePlanTask,
  useDailyPlan,
  useUpdateDailyPlan,
} from "@/hooks/useDailyPlan";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
 * LEFTOVERS FIRST, NO GUILT. Tasks from earlier days sit in their own group
 * above the plan, each one tap from Done and two from Move or Drop, with one
 * button to move them all. Nothing in this panel is red or amber: a planner
 * that scolds a returning user is one they stop opening. The rest of the app's
 * overdue styling is deliberately left as it is.
 *
 * A client island, not part of the Server Component: making the plan can
 * include a Groq call, which must never hold up the page's own render, and
 * the edits need optimistic, offline-resumable state that a server-rendered
 * section cannot have.
 */
export function DailyPlanPanel() {
  const { data, isLoading, isError } = useDailyPlan();
  const edit = useUpdateDailyPlan();
  const completeTask = useCompletePlanTask();
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

  const { leftovers, openLeftovers, today, openTodayTasks, openTasks } =
    planSections(data.items, plan.plan_date);
  const onPlan = leftovers.length + today.length;
  const moved = data.items.filter((i) => i.status === "moved").length;
  const dropped = data.items.filter(
    (i) => i.status === "dropped" || i.status === "skipped"
  ).length;
  const offPlan = [
    moved > 0 ? `${moved} moved to tomorrow` : null,
    dropped > 0 ? `${dropped} dropped` : null,
  ].filter(Boolean);

  // The stored reason describes the plan's own order, opening with its first
  // item — which may now sit below a leftover. A plain count is true instead.
  const line =
    openLeftovers.length > 0
      ? [
          `${openLeftovers.length} left over`,
          openTodayTasks > 0 ? `${openTodayTasks} for today` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : plan.reason;

  return (
    <PlanShell>
      <PlanHeader line={line} />

      {/* A warning only: it never blocks, hides or removes anything. */}
      {openTasks > DAY_CAP && (
        <p className="mt-3 text-[13px] leading-[18px] text-foreground">
          {openTasks} tasks today. A realistic day is about {DAY_CAP}.
        </p>
      )}

      {leftovers.length > 0 && (
        <div className="mt-3">
          <GroupLabel>Left over</GroupLabel>
          <ul>
            {leftovers.map((item) => (
              <LeftoverRow
                key={item.id}
                item={item}
                onDone={() => item.task_id && completeTask(item.task_id)}
                onMove={() => edit.mutate({ action: "move", item_id: item.id })}
                onDrop={() => edit.mutate({ action: "drop", item_id: item.id })}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              edit.mutate({
                action: "move_all",
                item_ids: openLeftovers.map((i) => i.id),
              })
            }
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-input text-[15px] font-semibold text-foreground transition-colors hover:bg-background active:bg-background"
          >
            <ArrowRight aria-hidden className="h-4 w-4" />
            Move all leftovers to tomorrow
          </button>
        </div>
      )}

      {today.length > 0 && (
        <div className={cn(leftovers.length > 0 ? "mt-4" : "mt-3")}>
          {leftovers.length > 0 && <GroupLabel>Today</GroupLabel>}
          <ol>
            {today.map((item, index) => (
              <PlanRow
                key={item.id}
                item={item}
                number={index + 1}
                onMove={() => edit.mutate({ action: "move", item_id: item.id })}
                onDrop={() => edit.mutate({ action: "drop", item_id: item.id })}
              />
            ))}
          </ol>
        </div>
      )}

      {onPlan === 0 && (
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
        onPlan > 0 && (
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

/** DESIGN.md's eyebrow: 11/16, capitals, bold, 0.08em. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="pb-1 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-muted-foreground">
      {children}
    </h3>
  );
}

/**
 * Grey on every row, on purpose: inside the planner a date is information,
 * not a warning. A past date is a literal day ("Due Sat, Oct 17"), never a
 * count of days overdue.
 */
function rowMeta(item: DailyPlanViewItem): { text: string; className: string } | null {
  if (item.kind === "task") {
    if (item.task_done) return { text: "Done", className: "text-success" };
    const due = formatDueDate(item.task_due_date);
    if (!due || !item.task_due_date) return null;
    let text = due.label;
    if (due.label === "Today") text = "Due today";
    else if (due.tone === "danger") text = `Due ${istDayLabel(item.task_due_date)}`;
    return { text, className: "text-muted-foreground" };
  }
  if (item.after_title) {
    return { text: `Right after ${item.after_title}`, className: "text-muted-foreground" };
  }
  if (item.carried) {
    return { text: "Moved from yesterday", className: "text-muted-foreground" };
  }
  return null;
}

function RowText({ item }: { item: DailyPlanViewItem }) {
  const meta = rowMeta(item);
  return (
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
  );
}

function RowMenu({
  title,
  dropLabel,
  onMove,
  onDrop,
}: {
  title: string;
  dropLabel: string;
  onMove: () => void;
  onDrop: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Change “${title}”`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-background data-[state=open]:text-foreground"
      >
        <MoreHorizontal aria-hidden className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
          {dropLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  return (
    <li className="flex items-center gap-3 py-1">
      <span
        aria-hidden
        className="w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums text-muted-foreground"
      >
        {number}
      </span>
      <RowText item={item} />
      {/* A finished task has nothing left to move or drop. */}
      {!item.task_done && (
        <RowMenu title={item.title} dropLabel="Drop from today" onMove={onMove} onDrop={onDrop} />
      )}
    </li>
  );
}

/**
 * A task from an earlier day. Done is the round button in the number's place
 * (one tap, as on the agenda); Move and Drop are in the ⋯ menu. Drop here also
 * clears the task's date — it stays in Tasks, undated, instead of coming back
 * every morning — so the menu says so.
 */
function LeftoverRow({
  item,
  onDone,
  onMove,
  onDrop,
}: {
  item: DailyPlanViewItem;
  onDone: () => void;
  onMove: () => void;
  onDrop: () => void;
}) {
  const done = item.task_done;
  return (
    <li className="flex items-center gap-3 py-1">
      {/* 44px target; the negative margin lines the 20px circle up with the
          number column of the rows below. */}
      <button
        type="button"
        onClick={onDone}
        disabled={done || !item.task_id}
        aria-label={done ? `${item.title} marked done` : `Mark “${item.title}” done`}
        className="-mx-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {done ? (
          <CheckCircle2 aria-hidden className="h-5 w-5 animate-pop text-success" />
        ) : (
          <Circle aria-hidden className="h-5 w-5" />
        )}
      </button>
      <RowText item={item} />
      {!done && (
        <RowMenu
          title={item.title}
          dropLabel="Drop and clear its date"
          onMove={onMove}
          onDrop={onDrop}
        />
      )}
    </li>
  );
}
