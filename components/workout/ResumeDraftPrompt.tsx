"use client";

import { RotateCcw, X } from "lucide-react";

import { istDateString } from "@/lib/date";
import type { WorkoutDraft } from "@/lib/workout-draft";
import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/shared/MonoLabel";

/** "today" / "yesterday" / "Thu 20 Aug" — enough to know if a draft is stale. */
function draftDayLabel(day: string): string {
  const today = istDateString();
  if (day === today) return "today";

  const yesterday = istDateString(Date.now() - 86_400_000);
  if (day === yesterday) return "yesterday";

  const [y, m, d] = day.split("-").map((n) => Number.parseInt(n, 10));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
}

/**
 * An unsaved session draft found in storage, offered back explicitly.
 *
 * NEITHER SILENT RESTORE NOR SILENT DISCARD, which is the whole reason this
 * component exists rather than a `useState` initialiser. Silently restoring
 * puts sets into a session the user may have already logged from another
 * device, and gives them no way to tell where the numbers came from; silently
 * discarding throws away eight exercises of work. An unfinished workout is
 * exactly the kind of thing worth one tap to confirm.
 *
 * The DAY is named, not just the count. A draft from three days ago and a
 * draft from this morning need completely different answers, and "6 sets" on
 * its own cannot tell them apart.
 */
export function ResumeDraftPrompt({
  draft,
  onResume,
  onDiscard,
}: {
  draft: WorkoutDraft;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const setCount = draft.sets.length;

  return (
    <div className="mb-8 rounded-md border border-border bg-surface-raised p-4">
      <MonoLabel>Unfinished workout</MonoLabel>
      <p className="mt-2 text-sm text-foreground">
        {setCount} set{setCount === 1 ? "" : "s"} you never saved, from{" "}
        {draftDayLabel(draft.day)}.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          onClick={onResume}
          className="h-9 flex-1 rounded-md"
        >
          <RotateCcw aria-hidden className="h-4 w-4" />
          Resume workout
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDiscard}
          className="h-9 rounded-md"
        >
          <X aria-hidden className="h-4 w-4" />
          Discard
        </Button>
      </div>
    </div>
  );
}
