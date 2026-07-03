"use client";

import { useMemo, useState } from "react";
import { Plus, Target, AlertCircle, Archive, CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { usePlansQuery } from "@/hooks/usePlans";
import { useTasksQuery } from "@/hooks/useTasks";
import { useUIStore } from "@/store/ui.store";
import { cn } from "@/lib/utils";
import type { Plan, PlanStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanList, type PlanTaskStat } from "@/components/plans/PlanList";
import { PlanForm } from "@/components/plans/PlanForm";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { EmptyState } from "@/components/shared/EmptyState";

type Filter = "all" | PlanStatus;

const emptyByFilter: Record<
  Filter,
  { icon: LucideIcon; title: string; description: string }
> = {
  all: {
    icon: Target,
    title: "No plans yet",
    description:
      "Create a plan to group related tasks and track progress toward a goal.",
  },
  active: {
    icon: Target,
    title: "No active plans",
    description: "Plans you're working toward will appear here.",
  },
  completed: {
    icon: CheckCircle2,
    title: "Nothing completed yet",
    description: "Plans you mark completed will show up here.",
  },
  archived: {
    icon: Archive,
    title: "Nothing archived",
    description: "Archived plans are tucked away here.",
  },
};

const tabs: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

export default function PlansPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const openCreatePlan = useUIStore((s) => s.openCreatePlan);
  const { data: plans, isLoading, isError, refetch } = usePlansQuery();
  const { data: tasks } = useTasksQuery();

  // Per-plan task progress (done / total), keyed by plan id.
  const stats = useMemo(() => {
    const acc: Record<string, PlanTaskStat> = {};
    for (const task of tasks ?? []) {
      if (!task.plan_id) continue;
      const stat = (acc[task.plan_id] ??= { total: 0, done: 0 });
      stat.total += 1;
      if (task.status === "done") stat.done += 1;
    }
    return acc;
  }, [tasks]);

  const counts = useMemo(() => {
    const list = plans ?? [];
    return {
      all: list.length,
      active: list.filter((p) => p.status === "active").length,
      completed: list.filter((p) => p.status === "completed").length,
      archived: list.filter((p) => p.status === "archived").length,
    } satisfies Record<Filter, number>;
  }, [plans]);

  const visible = useMemo<Plan[]>(() => {
    const list = plans ?? [];
    return filter === "all" ? list : list.filter((p) => p.status === filter);
  }, [plans, filter]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Plans"
        subtitle="Goals and projects"
        icon={Target}
        actions={
          <Button onClick={openCreatePlan} className="rounded-lg">
            <Plus className="mr-1.5 h-4 w-4" />
            New Plan
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
            title="Couldn't load plans"
            description="Something went wrong fetching your plans."
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
                <Button onClick={openCreatePlan} className="rounded-lg">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Plan
                </Button>
              ) : undefined
            }
          />
        ) : (
          <PlanList plans={visible} stats={stats} />
        )}
      </div>

      <PlanForm />
    </div>
  );
}
