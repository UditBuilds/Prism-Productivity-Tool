"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { formatCivilDate } from "@/lib/workout-analysis";
import { repeatableSessions } from "@/lib/workout-sessions";
import { type StructuredSetInput } from "@/lib/workouts";
import { useWorkoutsQuery } from "@/hooks/useWorkouts";
import { MonoLabel } from "@/components/shared/MonoLabel";

/**
 * Quick-start a session from the last time this body part was trained.
 *
 * THE PATTERN IS BORROWED, NOT INVENTED. These are the same chips TaskForm
 * uses for its due-date quick-picks and its repeat-pattern picker —
 * `rounded-full border px-3 py-1 text-xs font-medium`, accent fill when
 * active, muted border otherwise. Two existing call sites made it the
 * established way this app offers a small set of quick choices, so this adds
 * no new vocabulary.
 *
 * EVERY REPEATED WORD LIVES IN THE HEADING; THE CHIP IS THE ONE WORD THAT
 * DIFFERS. "Repeat last Legs day" is ~130px at this type size, so four of them
 * wrap to three rows inside a 311px card. The first pass moved the verb into
 * the heading but kept the date on the chip ("Legs  20 Aug", ~95px), which
 * still wrapped to two rows — measured, not assumed. Bare body-part names fit
 * one row with room to spare.
 *
 * The date is NOT lost, it is relocated: it stays in aria-label and is added
 * as `title`, so it is still reachable and still announced. That is a real
 * trade — the visible date was what made a chip a promise ("this exact day")
 * rather than a guess — and the session view the chip opens states every set
 * it loaded before anything is saved, so the claim is verifiable one tap in.
 *
 * The RotateCcw icon went with it. Once the heading carries the verb, a
 * per-chip repeat glyph restates it four more times for ~18px each, and its
 * absence puts these chips byte-for-byte on TaskForm's pattern.
 *
 * Sourced from the ["workouts"] cache, which this page already holds — no
 * extra request. That cache is the 60-day window (see GET /api/workouts), so
 * these chips reach exactly as far back as the picker's Recent list does.
 */
export function RepeatSessionChips({
  onRepeat,
  draftSetCount,
  maxSets,
}: {
  onRepeat: (sets: StructuredSetInput[]) => void;
  draftSetCount: number;
  maxSets: number;
}) {
  const { data: sets } = useWorkoutsQuery();
  const sessions = useMemo(() => repeatableSessions(sets ?? []), [sets]);
  /**
   * The hydration gate, and it is load-bearing rather than defensive.
   *
   * This component renders nothing when it has no sessions, and the server has
   * no ["workouts"] cache to read — so the server always emits null while the
   * client emits a <div> as soon as data lands. React reported that as a real
   * "Expected server HTML to contain a matching <div> in <div> at
   * RepeatSessionChips" failure, observed in the console the first time these
   * chips rendered.
   *
   * useIsRestoring was tried FIRST and is NOT sufficient — it is the
   * instrument WorkoutTodayPanel uses, so it was the obvious reach, and the
   * identical error came back. The reason is the race this page's own header
   * comment describes: the restore (or the GET fired on mount) can resolve
   * BEFORE hydration finishes, so by the time React hydrates this subtree the
   * client already has sessions and renders the div regardless of what the
   * restore flag said a moment earlier.
   *
   * A mount flag cannot lose that race: the first client render is committed
   * before any effect runs, so it is null by construction, exactly matching
   * the server. The chips then appear in the effect pass. This is the fix
   * CLAUDE.md's Known Issue #1 prescribes for the same class of defect.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Nothing trained yet, nothing to repeat. Renders NOTHING rather than an
  // empty state — the "Log sets" button directly above already says what to
  // do, and a second prompt saying it again is the "two answers to a question
  // nobody asked" the Today panel's own empty branch avoids.
  if (!mounted || sessions.length === 0) return null;

  return (
    <div className="mt-4">
      {/* Carries the verb, the recency and the noun, so the chip beneath it
          only has to say WHICH. Reads as "repeat last session: Legs". */}
      <MonoLabel>Repeat last session</MonoLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sessions.map((session) => {
          // The 50-set capture ceiling is a server rule (MAX_STRUCTURED_SETS),
          // and appending blind could push a draft past it into a 400. Real
          // sessions are 3-12 sets against a draft that is almost always
          // empty, so this is a corner — but a silent overflow at the save
          // button is worse than a chip that says why it can't.
          const overflows = draftSetCount + session.sets.length > maxSets;
          return (
            <button
              key={session.bodyPart}
              type="button"
              disabled={overflows}
              onClick={() => onRepeat(session.sets)}
              aria-label={`Repeat last ${session.bodyPart} day — ${
                session.sets.length
              } set${session.sets.length === 1 ? "" : "s"} across ${
                session.exerciseCount
              } exercise${
                session.exerciseCount === 1 ? "" : "s"
              }, from ${formatCivilDate(session.date)}`}
              title={
                overflows
                  ? `That would take this session past ${maxSets} sets — save what you have first.`
                  : // Names the exact day about to be copied, so a Chest chip
                    // pointing at 11 Aug is not mistaken for the chest work
                    // done on 17 Aug inside an Arms day.
                    `${session.sets.length} set${
                      session.sets.length === 1 ? "" : "s"
                    } from ${formatCivilDate(session.date)}`
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                overflows
                  ? "cursor-not-allowed border-border text-muted-foreground/50"
                  : "border-border text-muted-foreground hover:border-accent/60 hover:text-foreground"
              )}
            >
              {session.bodyPart}
            </button>
          );
        })}
      </div>
    </div>
  );
}
