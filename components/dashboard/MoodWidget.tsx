"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTodaysMood, useLogMood } from "@/hooks/useMood";
import { MOODS, moodOption } from "@/components/dashboard/moods";
import type { MoodValue } from "@/types/database";
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

  // State B — already logged (and not editing): calm, collapsed summary.
  if (today && !editing) {
    const opt = moodOption(today.mood);
    return (
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
        <span
          aria-hidden
          className="w-12 shrink-0 self-center text-center text-4xl leading-none"
        >
          {opt.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Daily check-in
          </p>
          <p className="mt-0.5 truncate text-base font-medium text-foreground">
            Feeling <span className="font-semibold">{opt.label}</span>
            {today.note && (
              <span className="text-muted-foreground"> · {today.note}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={startEdit}
          className="shrink-0 self-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Edit
        </button>
      </div>
    );
  }

  // State A — not logged yet (or editing)
  return (
    <div className="mt-5 rounded-xl border border-border bg-surface px-4 py-3.5">
      {savedFlash ? (
        <p className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-success">
          <Check className="h-4 w-4" />
          Logged! ✓
        </p>
      ) : (
        <>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/60">
            Daily check-in
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            How are you feeling today?
          </p>
          <div className="mt-3 flex items-start justify-between gap-1 sm:justify-start sm:gap-4">
            {MOODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setSelected(m.value)}
                aria-pressed={selected === m.value}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 hover:bg-surface-raised",
                  selected === m.value && "border-accent/60 bg-accent/10"
                )}
              >
                <span aria-hidden className="text-2xl">
                  {m.emoji}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {m.label}
                </span>
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
