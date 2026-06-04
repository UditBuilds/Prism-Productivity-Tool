import type { PlanStatus } from "@/types/database";

export const planStatusStyles: Record<PlanStatus, string> = {
  active: "bg-blue-500/15 text-blue-400",
  completed: "bg-success/15 text-success",
  archived: "bg-muted text-muted-foreground",
};

export const planStatusLabel: Record<PlanStatus, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};
