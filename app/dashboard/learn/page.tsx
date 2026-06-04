import { Brain } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

export default function LearnPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Learn</h1>
      <div className="mt-5">
        <EmptyState
          icon={Brain}
          title="Learn coming in Session 4"
          description="Spaced-repetition review (SM-2) over flashcards generated from your notes."
        />
      </div>
    </div>
  );
}
