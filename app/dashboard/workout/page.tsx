"use client";

import { useEffect, useState } from "react";
import { Dumbbell, Loader2, Plus } from "lucide-react";

import { useLogWorkout } from "@/hooks/useWorkouts";
import { istCivilToLocalDate, localCivilKey } from "@/lib/date";
import {
  clearWorkoutDraft,
  readWorkoutDraft,
  writeWorkoutDraft,
  type WorkoutDraft,
} from "@/lib/workout-draft";
import {
  workoutPerformedAtIso,
  workoutToday,
  type StructuredSetInput,
} from "@/lib/workouts";
import { useUserId } from "@/components/providers/PersistBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionPanel } from "@/components/dashboard/SectionPanel";
import { WorkoutDatePicker } from "@/components/workout/WorkoutDatePicker";
import {
  MAX_SETS_PER_CAPTURE,
  WorkoutLogSheet,
} from "@/components/workout/WorkoutLogSheet";
import { RepeatSessionChips } from "@/components/workout/RepeatSessionChips";
import { ResumeDraftPrompt } from "@/components/workout/ResumeDraftPrompt";
import { WorkoutTodayPanel } from "@/components/workout/WorkoutTodayPanel";
import { FinishWorkout } from "@/components/workout/FinishWorkout";
import { WorkoutProgressPanel } from "@/components/workout/WorkoutProgressPanel";

const PLACEHOLDER = "bench 3x5 @ 80kg, squat 100x5";

/**
 * Workout's own page. Previously a card on the dashboard, where the picker CTA,
 * the free-text field and the day's sets competed for a slot too small for any
 * of them — and where a logging surface sat permanently on a screen whose job
 * is the day's tasks.
 *
 * The logging behaviour is UNCHANGED from the dashboard card: same picker, same
 * steppers, same batching, same free-text fallback. Only the container moved.
 *
 * TWO PATHS INTO ONE TABLE. "Log sets" opens the structured picker, which is
 * the primary path: pick an exercise, tap weight and reps, done — no sentence
 * to compose on a phone. The free-text field below it is UNCHANGED and stays
 * fully Groq-parsed; it is the fallback for a whole session in one line, and
 * for anything the picker doesn't know. Both submit through the same mutation
 * to the same route and land as the same rows.
 *
 * KNOWN ISSUE — dev-mode hydration warning. Next still server-renders this
 * client page, but the set list is React Query data that only exists on the
 * client, and the GET /api/workouts fired on mount can resolve before hydration
 * finishes. React then finds a <ul> where the server sent the loading <div> and
 * reports "Expected server HTML to contain a matching <ul> in <div>", switching
 * the subtree to client rendering. Logging, editing, deleting and offline
 * replay all work — but the warning is real. It is the same race that makes the
 * tasks-page filter counts flash zero (Known Issues #1 in CLAUDE.md). Attempted
 * and NOT sufficient: a useState+useEffect mounted flag, useSyncExternalStore
 * with a server snapshot, next/dynamic with ssr:false, and dropping ["workouts"]
 * from the persisted caches. Do not re-try those without reproducing first.
 */
export default function WorkoutPage() {
  const logWorkout = useLogWorkout();
  const [input, setInput] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * The in-progress session draft lives HERE, not inside the sheet, so closing
   * the sheet — including an accidental backdrop tap — cannot discard eight
   * exercises of work. Only a successful save or an explicit Clear empties it.
   *
   * IT IS NO LONGER LOST ON NAVIGATION. It was page state, so leaving the page
   * dropped it — the same bargain the dashboard card made. It is now mirrored
   * to localStorage per user (lib/workout-draft.ts) and offered back through an
   * explicit prompt, so a phone call, a locked screen or a stray back-swipe
   * mid-session costs a tap rather than the session.
   */
  const [session, setSession] = useState<StructuredSetInput[]>([]);
  /**
   * WHEN the drafted session happened. Owned here for the same reason the
   * draft is — see the note in WorkoutLogSheet — and reset to today by the
   * sheet's own save, alongside emptying the draft.
   */
  const [sessionDate, setSessionDate] = useState<Date>(workoutToday);
  /**
   * The free-text field's date, SEPARATE from the session's. Two submissions,
   * two independent dates; sharing one would mean a session drafted for
   * Saturday silently re-dating a shorthand line typed for today.
   */
  const [textDate, setTextDate] = useState<Date>(workoutToday);
  /**
   * Bumped whenever a session is loaded into the draft from outside the sheet,
   * to remount the sheet body onto the right view. See WorkoutLogSheet's
   * `resetKey`.
   */
  const [sheetResetKey, setSheetResetKey] = useState(0);

  const userId = useUserId();
  /**
   * A stored draft the user has not yet answered on. While it is set, the
   * mirror effect below does NOT write — otherwise the empty in-memory draft
   * would overwrite the stored one before its owner ever saw the prompt.
   */
  const [pendingDraft, setPendingDraft] = useState<WorkoutDraft | null>(null);
  /**
   * The read has happened. Writing before it would clear a real stored draft
   * with the empty state this page always starts in — the mirror effect must
   * never run first.
   */
  const [draftChecked, setDraftChecked] = useState(false);

  // Read once per account. In an effect, not a useState initialiser: this page
  // is server-rendered, where localStorage does not exist, and reading during
  // render would also make the first client render disagree with the server's.
  useEffect(() => {
    if (!userId) return;
    const stored = readWorkoutDraft(userId);
    if (stored) setPendingDraft(stored);
    setDraftChecked(true);
  }, [userId]);

  // Mirror the live draft to storage. Cheap enough to run on every change
  // (a session is tens of small objects) and debouncing would only widen the
  // window in which a backgrounded tab loses the last set added.
  useEffect(() => {
    if (!userId || !draftChecked || pendingDraft) return;
    if (session.length === 0) {
      clearWorkoutDraft(userId);
      return;
    }
    writeWorkoutDraft(userId, {
      sets: session,
      day: localCivilKey(sessionDate),
    });
  }, [userId, draftChecked, pendingDraft, session, sessionDate]);

  function resumeDraft() {
    if (!pendingDraft) return;
    setSession(pendingDraft.sets);
    // The draft's own day, not today: a session started last night is still
    // last night's session, and re-dating it would file the sets on the wrong
    // day. The picker inside the sheet can move it if that is wrong.
    setSessionDate(istCivilToLocalDate(pendingDraft.day));
    setSheetResetKey((n) => n + 1);
    setPendingDraft(null);
    setSheetOpen(true);
  }

  function discardDraft() {
    if (userId) clearWorkoutDraft(userId);
    setPendingDraft(null);
  }

  /**
   * Load a past day's exercises into the draft and open the sheet on it.
   *
   * APPENDS rather than replaces, and that is the same principle that put the
   * draft in the page instead of the sheet: no single tap may destroy work
   * already entered. On an empty draft — the overwhelmingly common case — the
   * two are indistinguishable. On a non-empty one, groupStructuredSets merges
   * by exercise, so repeating a Legs day onto two Leg Press sets already
   * logged reads as one Leg Press group, which is also what actually happened.
   * Clear is one tap away in the sheet if the merge wasn't wanted.
   *
   * The date resets to TODAY, not the date being copied. The session being
   * repeated is a template for the one happening now; the existing picker is
   * right there if this is a catch-up entry for another day.
   */
  function repeatSession(sets: StructuredSetInput[]) {
    setSession((prev) => prev.concat(sets));
    setSessionDate(workoutToday());
    // Forces the sheet body to remount so it opens onto the session it was
    // just handed. Without it a chip tapped after any earlier open lands on
    // the picker — see WorkoutLogSheet's `resetKey` note.
    setSheetResetKey((n) => n + 1);
    setSheetOpen(true);
  }

  function submit() {
    const raw = input.trim();
    if (!raw || logWorkout.isPending) return;
    logWorkout.mutate({
      raw_input: raw,
      // Stamped here so a set queued offline keeps the day it was logged FOR,
      // not the time it eventually synced. Today still resolves to the live
      // instant, exactly as before backdating existed.
      performed_at: workoutPerformedAtIso(textDate),
    });
    setInput("");
    // The date deliberately SURVIVES the submit, unlike the dashboard capture
    // bar's. Catching up on a missed session is several shorthand lines for
    // one past day, and this trigger is on screen stating which day it is —
    // the stale-date hazard the capture bar has does not exist here.
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Workout"
        subtitle="Log sets as you lift — offline is fine, it syncs later."
        icon={Dumbbell}
      />

      {/* ABOVE the Log section, not inside it: it is a question about work
          that already exists, and it has to be answered before the CTA below
          it means anything. 32 to the section beneath (mb-8), the page's
          between-sections step. */}
      {pendingDraft && (
        <ResumeDraftPrompt
          draft={pendingDraft}
          onResume={resumeDraft}
          onDiscard={discardDraft}
        />
      )}

      {/* mt-0 overrides SectionPanel's between-sections 32: PageHeader already
          owns the space above the first section. */}
      <SectionPanel title="Log" className="mt-0">
        <Button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="h-9 w-full rounded-md"
        >
          <Dumbbell aria-hidden className="h-4 w-4" />
          {/* The count is the only cue that a closed sheet still holds a draft. */}
          {session.length > 0
            ? `Resume session (${session.length} set${
                session.length === 1 ? "" : "s"
              })`
            : "Log sets"}
        </Button>

        {/* Between the primary CTA and the free-text fallback, because that is
            what it is: a shortcut INTO the same picker flow, not a third way
            to log. Order reads primary -> shortcut -> fallback. */}
        <RepeatSessionChips
          onRepeat={repeatSession}
          draftSetCount={session.length}
          maxSets={MAX_SETS_PER_CAPTURE}
        />

        <WorkoutLogSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          session={session}
          setSession={setSession}
          date={sessionDate}
          setDate={setSessionDate}
          resetKey={sheetResetKey}
        />

        {/* The free-text fallback, unchanged. 16 from the primary CTA — it is a
            separate object, not part of it. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-4"
        >
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={PLACEHOLDER}
              aria-label="Log a set in gym shorthand"
              enterKeyHint="done"
              className="h-9 rounded-md font-mono text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || logWorkout.isPending}
              className="shrink-0 rounded-md"
            >
              {logWorkout.isPending ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <Plus aria-hidden className="h-4 w-4" />
              )}
              <span className="sr-only">Log set</span>
            </Button>
          </div>

          {/* BELOW the field, not beside it: at 375px the input and its submit
              already own the row, and the date qualifies what is typed rather
              than competing with it. w-auto so it sizes to its label instead
              of reading as a second full-width action. */}
          <WorkoutDatePicker
            value={textDate}
            onChange={setTextDate}
            className="mt-2"
            triggerClassName="w-auto"
          />
        </form>
      </SectionPanel>

      {/* Today's sets and the 21-day session count. `card`, not `list`: these
          rows are tier-2 bubbles grouped under per-exercise MonoLabels, not
          edge-to-edge partitions of the card — the same shape they had on the
          dashboard, kept deliberately. */}
      <SectionPanel title="Today">
        <WorkoutTodayPanel />
        {/* Inside Today, below the sets, because it acts on exactly what that
            section shows. It renders nothing until the day's first set has
            created a session — there is no "start workout" button to pair it
            with, by design. */}
        <FinishWorkout />
      </SectionPanel>

      {/* The analysis layer, reading 180 days where the two sections above read
          60. It sits BELOW logging, which stays the first thing on the page.
          Order zooms out: today's sets, then the body over time.

          ONE SECTION, NOT TWO. "Body-part balance" used to follow this one,
          restating the same sets from the other direction; between them they
          were 71.5% of a page three screens tall. Balance's per-part facts are
          now the summary line on each collapsed group header inside Progress,
          which removes a section rather than shortening one. */}
      <SectionPanel title="Progress">
        <WorkoutProgressPanel />
      </SectionPanel>
    </div>
  );
}
