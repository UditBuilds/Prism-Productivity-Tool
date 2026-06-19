"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Timer,
  Play,
  Pause,
  Square,
  CheckCircle2,
  Coffee,
  RotateCcw,
  Settings2,
  Check,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useFocusStore, formatClock } from "@/store/focus.store";
import {
  useRecentFocusSessions,
  useCreateFocusSession,
  useEndFocusSession,
} from "@/hooks/useFocus";
import { DURATIONS } from "@/components/focus/categories";
import { CATEGORY_COLORS } from "@/components/focus/category-colors";
import { useFocusCategories } from "@/hooks/useFocusCategories";
import { ManageCategoriesModal } from "@/components/focus/ManageCategoriesModal";
import type { FocusCategory } from "@/types/database";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const RING_RADIUS = 130;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function FocusPage() {
  const isRunning = useFocusStore((s) => s.isRunning);
  const justCompleted = useFocusStore((s) => s.justCompleted);

  if (isRunning) return <RunningView />;
  if (justCompleted) return <CompletedView />;
  return <IdleView />;
}

/* ── State 1: idle — pick category + duration, start ───────────── */

function IdleView() {
  const [category, setCategory] = useState("Study");
  const [duration, setDuration] = useState<number>(25);
  const [isCustom, setIsCustom] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("30");

  const startSession = useFocusStore((s) => s.startSession);
  const setSessionId = useFocusStore((s) => s.setSessionId);
  const createSession = useCreateFocusSession();
  const { data: recent, isLoading } = useRecentFocusSessions();
  const { categories } = useFocusCategories();
  const qc = useQueryClient();

  const [manageOpen, setManageOpen] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(CATEGORY_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const minutes = isCustom
    ? Math.min(600, Math.max(1, parseInt(customMinutes, 10) || 0))
    : duration;
  const canStart = minutes >= 1 && !createSession.isPending;

  async function handleStart() {
    if (!canStart) return;
    // Start the timer immediately (snappy), then attach the DB row id.
    startSession(category, minutes);
    try {
      const session = await createSession.mutateAsync({
        category,
        duration_minutes: minutes,
      });
      setSessionId(session.id);
    } catch {
      // Toast fired by the hook; timer still runs locally.
    }
  }

  function cancelNewCategory() {
    setShowNewCategory(false);
    setNewName("");
    setNewColor(CATEGORY_COLORS[0]);
    setCreateError(null);
  }

  // Create a category, then auto-select it for the session about to start.
  async function handleAddCategory() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/focus/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, color: newColor }),
      });
      const json = (await res.json()) as {
        data: FocusCategory | null;
        error: string | null;
      };
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Create failed (${res.status})`);
      }
      await qc.invalidateQueries({ queryKey: ["focus-categories"] });
      setCategory(trimmed);
      setShowNewCategory(false);
      setNewName("");
      setNewColor(CATEGORY_COLORS[0]);
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : "Failed to create category"
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Focus Timer"
        subtitle="Track your deep work sessions"
        icon={Timer}
      />

      <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      {/* Category selector */}
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/70">
          Category
        </p>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          aria-label="Manage categories"
          title="Manage categories"
          className="rounded-md p-1 text-muted-foreground hover:bg-surface-raised hover:text-foreground active:scale-95"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
      <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {categories.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => setCategory(c.label)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium",
              category === c.label
                ? c.activeClass
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            )}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowNewCategory((v) => !v)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3.5 py-1.5 text-sm font-medium transition",
            showNewCategory
              ? "border-accent text-foreground"
              : "border-border text-muted-foreground hover:border-accent/60 hover:text-foreground"
          )}
        >
          + New category
        </button>
      </div>

      {/* Inline quick-add */}
      {showNewCategory && (
        <div className="mt-3 rounded-lg border border-border bg-surface-raised/40 p-3">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (createError) setCreateError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCategory();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelNewCategory();
              }
            }}
            disabled={creating}
            placeholder="Category name"
            className="h-9 rounded-lg text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Color ${hex}`}
                disabled={creating}
                onClick={() => setNewColor(hex)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-surface transition",
                  newColor === hex ? "ring-white" : "ring-transparent"
                )}
                style={{ backgroundColor: hex }}
              >
                {newColor === hex && <Check className="h-3.5 w-3.5 text-white" />}
              </button>
            ))}
          </div>
          {createError && (
            <p className="mt-2 text-xs text-destructive">{createError}</p>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={creating}
              onClick={cancelNewCategory}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={creating || !newName.trim()}
              onClick={handleAddCategory}
              className="text-white"
            >
              {creating && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Duration selector */}
      <p className="mb-2.5 mt-6 text-xs font-medium uppercase tracking-widest text-muted-foreground/70">
        Duration
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDuration(d);
              setIsCustom(false);
            }}
            className={cn(
              "min-w-[3.5rem] rounded-lg px-3 py-1.5 text-sm font-medium tabular-nums",
              !isCustom && duration === d
                ? "bg-accent text-accent-foreground"
                : "border border-border bg-surface-raised text-muted-foreground hover:text-foreground"
            )}
          >
            {d}m
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIsCustom(true)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium",
            isCustom
              ? "bg-accent text-accent-foreground"
              : "border border-border bg-surface-raised text-muted-foreground hover:text-foreground"
          )}
        >
          Custom
        </button>
        {isCustom && (
          <Input
            type="number"
            min={1}
            max={600}
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value)}
            className="h-9 w-24 rounded-lg"
            aria-label="Custom minutes"
          />
        )}
      </div>

      {/* Start */}
      <div className="mt-7">
        <Button
          size="lg"
          disabled={!canStart}
          onClick={handleStart}
          className="w-full rounded-xl"
        >
          <Play className="mr-2 h-4 w-4" />
          Start {category} Session ({minutes}m)
        </Button>
      </div>
      </div>

      {/* Recent sessions */}
      <div className="mt-10">
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Recent sessions
        </h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : (recent?.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
            No sessions yet — your focus history will appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {recent?.map((s) => {
              const cat = categories.find((c) => c.label === s.category);
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm transition-colors hover:border-[#2A2A2A]"
                >
                  <span aria-hidden>{cat?.emoji ?? "🎯"}</span>
                  <span className="font-medium text-foreground">
                    {s.category}
                  </span>
                  <span className="text-muted-foreground">
                    {s.duration_minutes}m
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-xs font-medium",
                      s.completed ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {s.completed ? "Completed ✓" : "Stopped"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ManageCategoriesModal open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}

/* ── State 2: running — countdown + ring + controls ─────────────── */

function RunningView() {
  const isPaused = useFocusStore((s) => s.isPaused);
  const mode = useFocusStore((s) => s.mode);
  const timeLeft = useFocusStore((s) => s.timeLeft);
  const totalDuration = useFocusStore((s) => s.totalDuration);
  const category = useFocusStore((s) => s.category);
  const pauseTimer = useFocusStore((s) => s.pauseTimer);
  const resumeTimer = useFocusStore((s) => s.resumeTimer);
  const endSession = useFocusStore((s) => s.endSession);
  const endFocusSession = useEndFocusSession();
  const { categories } = useFocusCategories();

  const isBreak = mode === "break";
  const cat = categories.find((c) => c.label === category);
  const progress =
    totalDuration > 0 ? (totalDuration - timeLeft) / totalDuration : 0;

  function handleEnd() {
    const { sessionId } = useFocusStore.getState();
    if (sessionId) {
      endFocusSession.mutate({ id: sessionId, completed: false });
    }
    endSession();
  }

  return (
    <div className="flex flex-col items-center pt-4 sm:pt-10">
      <p className="text-sm font-medium text-muted-foreground">
        {isBreak ? (
          <>☕ Break</>
        ) : (
          <>
            {cat?.emoji} {category}
          </>
        )}
        {isPaused && <span className="ml-2 text-warning">· Paused</span>}
      </p>

      {/* Ring + time */}
      <div className="relative mt-6 flex items-center justify-center">
        <svg
          width={300}
          height={300}
          viewBox="0 0 300 300"
          className="-rotate-90"
          aria-hidden
        >
          <defs>
            <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: "rgb(var(--accent-rgb))" }} />
              <stop offset="100%" style={{ stopColor: "rgb(var(--accent-hover-rgb))" }} />
            </linearGradient>
          </defs>
          <circle
            cx="150"
            cy="150"
            r={RING_RADIUS}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth="8"
          />
          <circle
            cx="150"
            cy="150"
            r={RING_RADIUS}
            fill="none"
            stroke="url(#ringGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <span
          className="absolute text-7xl font-bold tabular-nums tracking-tight text-white"
          style={{ textShadow: "0 0 32px rgb(var(--accent-rgb) / 0.45)" }}
        >
          {formatClock(timeLeft)}
        </span>
      </div>

      {/* Controls */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={isPaused ? resumeTimer : pauseTimer}
          aria-label={isPaused ? "Resume" : "Pause"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg shadow-black/40 hover:bg-accent/90 active:scale-95"
        >
          {isPaused ? (
            <Play className="ml-0.5 h-6 w-6" />
          ) : (
            <Pause className="h-6 w-6" />
          )}
        </button>
        <Button
          variant="ghost"
          onClick={handleEnd}
          className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
        >
          <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
          End Session
        </Button>
      </div>
    </div>
  );
}

/* ── State 3: celebration after a completed focus session ───────── */

function CompletedView() {
  const category = useFocusStore((s) => s.category);
  const startBreak = useFocusStore((s) => s.startBreak);
  const clearCompleted = useFocusStore((s) => s.clearCompleted);

  return (
    <div className="flex flex-col items-center pt-12 text-center sm:pt-20">
      <CheckCircle2 className="h-16 w-16 text-success" />
      <h1 className="mt-5 text-2xl font-bold text-white">
        {category} session complete!
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Well done — that&apos;s real progress.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => startBreak(5)} className="rounded-lg">
          <Coffee className="mr-1.5 h-4 w-4" />
          Take a 5 min break
        </Button>
        <Button
          variant="outline"
          onClick={clearCompleted}
          className="rounded-lg"
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Start another
        </Button>
      </div>
    </div>
  );
}
