import { Brain } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

export default function ReviewPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Review</h1>
      <div className="mt-5">
        <EmptyState
          icon={Brain}
          title="Review coming in Session 4"
          description="The flashcard review session UI will live here."
        />
      </div>
    </div>
  );
}
