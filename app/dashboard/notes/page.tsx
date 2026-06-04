import { FileText } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

export default function NotesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Notes</h1>
      <div className="mt-5">
        <EmptyState
          icon={FileText}
          title="Notes coming in Session 2"
          description="A markdown editor for your notes — the source AI will read to generate flashcards."
        />
      </div>
    </div>
  );
}
