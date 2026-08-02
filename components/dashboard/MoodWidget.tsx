"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTodaysMood, useLogMood } from "@/hooks/useMood";
import { MOODS, moodOption } from "@/components/dashboard/moods";
import type { MoodValue } from "@/types/database";
import { MonoLabel } from "@/components/shared/MonoLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Daily mood check-in card, shown under the dashboard greeting. */
export function MoodWidget() {
  const { data: today, isLoading } = useTodaysMood();
  const logMood = useLogMood();

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<MoodValue | null>(null);
  const [note, setNote] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  if (isLoading) return null; // tiny widget — skip the skeleton churn

  function handleSave() {
    if (!selected) return;
    logMood.mutate({ mood: selected, note: note.trim() || null });
    setSavedFlash(true);
    setTimeout(() => {
      setSavedFlash(false);
      setEditing(false);
      setSelected(null);
      setNote("");
    }, 1200);
  }

  function startEdit() {
    setSelected(today?.mood ?? null);
    setNote(today?.note ?? "");
    setEditing(true);
  }

  // Both states share this wrapper — no card chrome, and therefore identical
  // padding. They used to differ (p-4 vs px-4 py-3.5), which read as a jump
  // when the day's mood was logged.
  const WRAPPER = "mt-3";

  // State B — already logged (and not editing): calm, collapsed summary.
  if (today && !editing) {
    const opt = moodOption(today.mood);
    return (
      <div className={WRAPPER}>
        <MonoLabel>Daily check-in</MonoLabel>
        <div className="mt-1 flex items-center gap-2">
          <span aria-hidden className="shrink-0 text-2xl leading-none">
            {opt.emoji}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-foreground">
            Feeling <span className="font-semibold">{opt.label}</span>
            {today.note && (
              <span className="text-muted-foreground"> · {today.note}</span>
            )}
          </p>
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  // State A — not logged yet (or editing)
  return (
    <div className={WRAPPER}>
      {savedFlash ? (
        <p className="flex items-center gap-2 py-1 text-sm font-medium text-success">
          <Check className="h-4 w-4" />
          Logged! ✓
        </p>
      ) : (
        <>
          <MonoLabel>Daily check-in</MonoLabel>
          {/* The emoji ARE the question — the "How are you feeling today?"
              line above them said nothing the row doesn't. */}
          <div className="mt-1 flex items-center justify-between gap-1 sm:justify-start sm:gap-4">
            {MOODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setSelected(m.value)}
                aria-pressed={selected === m.value}
                aria-label={m.label}
                title={m.label}
                className={cn(
                  "rounded-lg border border-transparent px-2 py-1 text-2xl leading-none hover:bg-surface-raised",
                  selected === m.value && "border-accent/60 bg-accent/10"
                )}
              >
                <span aria-hidden>{m.emoji}</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What's on your mind? (optional)"
                className="h-9 rounded-lg text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={logMood.isPending}
                className="shrink-0 rounded-lg"
              >
                Save
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
