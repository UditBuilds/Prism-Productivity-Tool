"use client";

import { useEffect, useState } from "react";
import { Clock, Loader2, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type { JobState } from "@/hooks/useLearning";
import { META } from "./ui";

function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

function hoursOrMinutes(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.round(seconds / 3600);
    return `about ${h} hour${h === 1 ? "" : "s"}`;
  }
  const m = Math.max(1, Math.round(seconds / 60));
  return `about ${m} minute${m === 1 ? "" : "s"}`;
}

/** One line saying what the lesson job is doing, in plain words. Nothing when idle. */
export function JobStatus({ state, className }: { state: JobState; className?: string }) {
  const until = state.phase === "waiting" || state.phase === "budget" ? state.until : null;
  const left = useSecondsLeft(until);

  let icon = <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />;
  let text: string | null = null;
  switch (state.phase) {
    case "working":
      text = "Writing the next lesson from web sources…";
      break;
    case "waiting":
      text =
        state.reason === "ai_busy"
          ? `The AI is busy. Carrying on in ${left} second${left === 1 ? "" : "s"}.`
          : "Another screen is writing this lesson. Checking again shortly.";
      icon = <Clock className="h-4 w-4" aria-hidden />;
      break;
    case "budget":
      text = `Today's learning budget is used up. Lessons carry on in ${hoursOrMinutes(left)}.`;
      icon = <Clock className="h-4 w-4" aria-hidden />;
      break;
    case "groq_daily":
      text = "The AI's daily limit is reached. Lessons carry on tomorrow.";
      icon = <Clock className="h-4 w-4" aria-hidden />;
      break;
    case "offline":
      text = state.message;
      icon = <WifiOff className="h-4 w-4" aria-hidden />;
      break;
    case "idle":
      return null;
  }
  return (
    <p className={cn(META, "flex items-center gap-2", className)} role="status" aria-live="polite">
      {icon}
      <span>{text}</span>
    </p>
  );
}
