import type { Plan } from "@/types/database";
import { PlanCard } from "./PlanCard";

export interface PlanTaskStat {
  total: number;
  done: number;
}

/** Presentational grid of plan cards (single column on mobile, 2 on wide). */
export function PlanList({
  plans,
  stats,
}: {
  plans: Plan[];
  stats: Record<string, PlanTaskStat>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          taskCount={stats[plan.id]?.total ?? 0}
          doneCount={stats[plan.id]?.done ?? 0}
        />
      ))}
    </div>
  );
}
