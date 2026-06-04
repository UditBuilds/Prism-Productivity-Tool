import { Target } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

export default function PlansPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Plans</h1>
      <div className="mt-5">
        <EmptyState
          icon={Target}
          title="Plans coming in Session 2"
          description="Group tasks under goals with target dates and track progress."
        />
      </div>
    </div>
  );
}
