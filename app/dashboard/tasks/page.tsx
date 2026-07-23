"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  ListTodo,
  Clock,
  CheckSquare,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useTasksQuery } from "@/hooks/useTasks";
import { useUIStore } from "@/store/ui.store";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskForm } from "@/components/tasks/TaskForm";
import { RecurringTasksStrip } from "@/components/tasks/RecurringTasksStrip";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { EmptyState } from "@/components/shared/EmptyState";
import { EmptyTasks } from "@/components/shared/EmptyStates";

type Filter = "all" | TaskStatus;

// The tasks API already returns rows ordered by due_date ascending (nulls last)
// then created_at descending — i.e. overdue oldest-first → today → future
// ascending → no-due-date. We only re-home completed tasks to the bottom,
// preserving each group's existing relative order (no re-sorting).
function partitionTasks(tasks: Task[]): Task[] {
  const active = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  return [...active, ...done];
}

// Filter-specific empties; the "all" case uses the custom EmptyTasks SVG.
const emptyByFilter: Record<
  Exclude<Filter, "all">,
  { icon: LucideIcon; title: string; description: string }
> = {
  todo: {
    icon: ListTodo,
    title: "Nothing to do",
    description: "Tasks you haven't started will appear here.",
  },
  in_progress: {
    icon: Clock,
    title: "Nothing in progress",
    description: "Move a task to In progress to see it here.",
  },
  done: {
    icon: CheckCircle2,
    title: "Nothing done yet",
    description: "Completed tasks will show up here.",
  },
};

const tabs: { value: Filter; label: string; shortLabel?: string }[] = [
  { value: "all", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress", shortLabel: "Active" },
  { value: "done", label: "Done" },
];

export default function TasksPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const openCreateTask = useUIStore((s) => s.openCreateTask);
  const { data: tasks, isLoading, isError, refetch } = useTasksQuery();

  const counts = useMemo(() => {
    const list = tasks ?? [];
    return {
      all: list.length,
      todo: list.filter((t) => t.status === "todo").length,
      in_progress: list.filter((t) => t.status === "in_progress").length,
      done: list.filter((t) => t.status === "done").length,
    } satisfies Record<Filter, number>;
  }, [tasks]);

  const visible = useMemo(() => {
    const ordered = partitionTasks(tasks ?? []);
    return filter === "all"
      ? ordered
      : ordered.filter((t) => t.status === filter);
  }, [tasks, filter]);

  return (
    <div>
      <PullToRefresh onRefresh={() => refetch()}>
      <PageHeader
        title="Tasks"
        subtitle="Manage and track your work"
        icon={CheckSquare}
        actions={
          <Button onClick={openCreateTask} className="rounded-lg">
            <Plus className="mr-1.5 h-4 w-4" />
            New Task
          </Button>
        }
      />

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as Filter)}
        className="mt-5"
      >
        <TabsList className="grid w-full grid-cols-4">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="gap-1.5 text-xs sm:text-sm"
            >
              <span className="truncate">
                {tab.shortLabel ? (
                  <>
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </>
                ) : (
                  tab.label
                )}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 font-mono text-[11px] font-medium tabular-nums",
                  filter === tab.value
                    ? "bg-accent/20 text-accent"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isLoading ? (
                  <span className="inline-block h-3 w-3 animate-pulse rounded-sm bg-muted-foreground/30 align-[-1px]" />
                ) : (
                  counts[tab.value]
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <RecurringTasksStrip />

      <div className="mt-5">
        {isLoading ? (
          <LoadingSkeleton count={3} />
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load tasks"
            description="Something went wrong fetching your tasks."
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          filter === "all" ? (
            <EmptyTasks
              action={
                <Button onClick={openCreateTask} className="rounded-lg">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Task
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={emptyByFilter[filter].icon}
              title={emptyByFilter[filter].title}
              description={emptyByFilter[filter].description}
            />
          )
        ) : (
          <TaskList tasks={visible} />
        )}
      </div>

      <TaskForm />
      </PullToRefresh>
    </div>
  );
}
