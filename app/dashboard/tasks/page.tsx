"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Inbox,
  ListTodo,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useTasksQuery } from "@/hooks/useTasks";
import { useUIStore } from "@/store/ui.store";
import { isOverdue } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskForm } from "@/components/tasks/TaskForm";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { EmptyState } from "@/components/shared/EmptyState";

type Filter = "all" | TaskStatus;

const priorityRank: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// overdue first → high → medium → low → newest
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ao = isOverdue(a.due_date, a.status === "done") ? 0 : 1;
    const bo = isOverdue(b.due_date, b.status === "done") ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (priorityRank[a.priority] !== priorityRank[b.priority]) {
      return priorityRank[a.priority] - priorityRank[b.priority];
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

const emptyByFilter: Record<
  Filter,
  { icon: LucideIcon; title: string; description: string }
> = {
  all: {
    icon: Inbox,
    title: "No tasks yet",
    description: "Create your first task to get started.",
  },
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

const tabs: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
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
    const sorted = sortTasks(tasks ?? []);
    return filter === "all"
      ? sorted
      : sorted.filter((t) => t.status === filter);
  }, [tasks, filter]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Tasks</h1>
        <Button onClick={openCreateTask} className="rounded-lg">
          <Plus className="mr-1.5 h-4 w-4" />
          New Task
        </Button>
      </div>

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
              <span className="truncate">{tab.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  filter === tab.value
                    ? "bg-accent/20 text-accent"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {counts[tab.value]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
          <EmptyState
            icon={emptyByFilter[filter].icon}
            title={emptyByFilter[filter].title}
            description={emptyByFilter[filter].description}
            action={
              filter === "all" ? (
                <Button onClick={openCreateTask} className="rounded-lg">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Task
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TaskList tasks={visible} />
        )}
      </div>

      <TaskForm />
    </div>
  );
}
