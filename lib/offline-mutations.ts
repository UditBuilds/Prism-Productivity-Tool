import type { MutationKey, QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import {
  createTaskMutationOptions,
  deleteTaskMutationOptions,
  splitTasksMutationOptions,
  stopRecurringTemplateMutationOptions,
  updateTaskMutationOptions,
} from "@/hooks/useTasks";
import {
  createNoteMutationOptions,
  deleteNoteMutationOptions,
  updateNoteMutationOptions,
} from "@/hooks/useNotes";
import {
  createPlanMutationOptions,
  deletePlanMutationOptions,
  updatePlanMutationOptions,
} from "@/hooks/usePlans";
import {
  createCardMutationOptions,
  deleteCardMutationOptions,
  submitReviewMutationOptions,
  updateCardMutationOptions,
} from "@/hooks/useSRS";
import {
  createReminderMutationOptions,
  deleteReminderMutationOptions,
  updateReminderMutationOptions,
} from "@/hooks/useReminders";
import {
  deleteWorkoutSetMutationOptions,
  logWorkoutMutationOptions,
  updateWorkoutSetMutationOptions,
} from "@/hooks/useWorkouts";

/**
 * Mutations paused while offline are persisted to IndexedDB alongside the
 * query snapshot. A dehydrated mutation loses its functions, so
 * resumePausedMutations() after a page reload can only run mutations whose
 * mutationKey has a DEFAULT mutationFn registered on the queryClient.
 *
 * This module registers those defaults for the offline-editable entities.
 * Only mutations with a key listed here are persisted at all
 * (isResumableMutationKey gates shouldDehydrateMutation) — anything else is
 * dropped on reload rather than resumed into a guaranteed failure.
 *
 * The onSettled & onError defaults below only fire for RESUMED mutations
 * (live useMutation calls override them with their own richer handlers).
 * onSettled re-syncs the entity cache and its derived read models after the
 * queued write lands. onError shows a toast and logs to the console; it
 * deliberately does NOT roll back — the defaults have no onMutate and
 * therefore no ctx.previous, and on replay the cache was rehydrated from
 * disk rather than optimistically mutated. The existing onSettled
 * invalidation refetches and corrects the UI.
 */

/** Stable toast ids collapse repeated replay failures into one toast per
 *  entity+operation instead of stacking, since a single root cause (e.g.
 *  expired session) typically fails every queued mutation together. */
function replayToastId(entity: string, operation: string): string {
  return `offline-sync-error-${entity}-${operation}`;
}

const RESUMABLE_MUTATION_KEYS: ReadonlyArray<MutationKey> = [
  createTaskMutationOptions.mutationKey,
  // The dashboard capture's AI split path. It MUST be here: an unregistered key
  // is dropped on reload rather than replayed, so a multi-item capture typed
  // with no signal would vanish — strictly worse than the one task it becomes
  // today. Registered, it queues once and the split runs server-side on replay,
  // exactly as the workout capture carries its parse through a dead zone.
  splitTasksMutationOptions.mutationKey,
  updateTaskMutationOptions.mutationKey,
  deleteTaskMutationOptions.mutationKey,
  stopRecurringTemplateMutationOptions.mutationKey,
  createNoteMutationOptions.mutationKey,
  updateNoteMutationOptions.mutationKey,
  deleteNoteMutationOptions.mutationKey,
  createPlanMutationOptions.mutationKey,
  updatePlanMutationOptions.mutationKey,
  deletePlanMutationOptions.mutationKey,
  createCardMutationOptions.mutationKey,
  updateCardMutationOptions.mutationKey,
  deleteCardMutationOptions.mutationKey,
  submitReviewMutationOptions.mutationKey,
  createReminderMutationOptions.mutationKey,
  updateReminderMutationOptions.mutationKey,
  deleteReminderMutationOptions.mutationKey,
  // A gym is the likeliest place in this app to have no signal, so logging a
  // set MUST survive offline. The AI parse runs server-side inside POST, which
  // is why one queued mutation is enough — the replay parses on arrival.
  logWorkoutMutationOptions.mutationKey,
  updateWorkoutSetMutationOptions.mutationKey,
  deleteWorkoutSetMutationOptions.mutationKey,
];

const RESUMABLE_KEY_HASHES: ReadonlySet<string> = new Set(
  RESUMABLE_MUTATION_KEYS.map((k) => JSON.stringify(k))
);

export function isResumableMutationKey(
  mutationKey: MutationKey | undefined
): boolean {
  return (
    mutationKey !== undefined &&
    RESUMABLE_KEY_HASHES.has(JSON.stringify(mutationKey))
  );
}

/** Call once, right after creating the queryClient (before any restore). */
export function registerResumableMutations(qc: QueryClient): void {
  // ── tasks ──────────────────────────────────────────────────────────
  qc.setMutationDefaults(createTaskMutationOptions.mutationKey, {
    mutationFn: createTaskMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] });
      invalidateDerivedCaches(qc, "tasks");
      // A task save can create, update or delete its linked reminder
      // server-side (PR #19 carries `reminder` inside the task mutation), so a
      // replayed task leaves the Reminders view stale without this.
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      invalidateDerivedCaches(qc, "reminders");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] task create failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a task you created while offline", {
        id: replayToastId("task", "create"),
      });
    },
  });
  qc.setMutationDefaults(splitTasksMutationOptions.mutationKey, {
    mutationFn: splitTasksMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      invalidateDerivedCaches(qc, "tasks");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] task split failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a task you created while offline", {
        id: replayToastId("task", "create"),
      });
    },
  });
  qc.setMutationDefaults(updateTaskMutationOptions.mutationKey, {
    mutationFn: updateTaskMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] });
      invalidateDerivedCaches(qc, "tasks");
      // A task save can create, update or delete its linked reminder
      // server-side (PR #19 carries `reminder` inside the task mutation), so a
      // replayed task leaves the Reminders view stale without this.
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      invalidateDerivedCaches(qc, "reminders");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] task update failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a task you edited while offline", {
        id: replayToastId("task", "update"),
      });
    },
  });
  qc.setMutationDefaults(deleteTaskMutationOptions.mutationKey, {
    mutationFn: deleteTaskMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] });
      invalidateDerivedCaches(qc, "tasks");
      // A task save can create, update or delete its linked reminder
      // server-side (PR #19 carries `reminder` inside the task mutation), so a
      // replayed task leaves the Reminders view stale without this.
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      invalidateDerivedCaches(qc, "reminders");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] task delete failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a task you deleted while offline", {
        id: replayToastId("task", "delete"),
      });
    },
  });

  qc.setMutationDefaults(stopRecurringTemplateMutationOptions.mutationKey, {
    mutationFn: stopRecurringTemplateMutationOptions.mutationFn,
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] }),
    onError: (err, variables) => {
      console.error(
        "[offline-replay] recurring stop failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a recurring task you stopped while offline", {
        id: replayToastId("recurring", "stop"),
      });
    },
  });

  // ── notes ──────────────────────────────────────────────────────────
  qc.setMutationDefaults(createNoteMutationOptions.mutationKey, {
    mutationFn: createNoteMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
    onError: (err, variables) => {
      console.error(
        "[offline-replay] note create failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a note you created while offline", {
        id: replayToastId("note", "create"),
      });
    },
  });
  qc.setMutationDefaults(updateNoteMutationOptions.mutationKey, {
    mutationFn: updateNoteMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
    onError: (err, variables) => {
      console.error(
        "[offline-replay] note update failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a note you edited while offline", {
        id: replayToastId("note", "update"),
      });
    },
  });
  qc.setMutationDefaults(deleteNoteMutationOptions.mutationKey, {
    mutationFn: deleteNoteMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
    onError: (err, variables) => {
      console.error(
        "[offline-replay] note delete failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a note you deleted while offline", {
        id: replayToastId("note", "delete"),
      });
    },
  });

  // ── plans ──────────────────────────────────────────────────────────
  qc.setMutationDefaults(createPlanMutationOptions.mutationKey, {
    mutationFn: createPlanMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      invalidateDerivedCaches(qc, "plans");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] plan create failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a plan you created while offline", {
        id: replayToastId("plan", "create"),
      });
    },
  });
  qc.setMutationDefaults(updatePlanMutationOptions.mutationKey, {
    mutationFn: updatePlanMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      invalidateDerivedCaches(qc, "plans");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] plan update failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a plan you edited while offline", {
        id: replayToastId("plan", "update"),
      });
    },
  });
  qc.setMutationDefaults(deletePlanMutationOptions.mutationKey, {
    mutationFn: deletePlanMutationOptions.mutationFn,
    // Deleting a plan unlinks its tasks (plan_id → null) server-side.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] plan delete failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a plan you deleted while offline", {
        id: replayToastId("plan", "delete"),
      });
    },
  });

  // ── SRS cards ──────────────────────────────────────────────────────
  qc.setMutationDefaults(createCardMutationOptions.mutationKey, {
    mutationFn: createCardMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["srs-cards"] }),
    onError: (err, variables) => {
      console.error(
        "[offline-replay] card create failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a card you created while offline", {
        id: replayToastId("card", "create"),
      });
    },
  });
  qc.setMutationDefaults(updateCardMutationOptions.mutationKey, {
    mutationFn: updateCardMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["srs-cards"] }),
    onError: (err, variables) => {
      console.error(
        "[offline-replay] card update failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a card you edited while offline", {
        id: replayToastId("card", "update"),
      });
    },
  });
  qc.setMutationDefaults(deleteCardMutationOptions.mutationKey, {
    mutationFn: deleteCardMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["srs-cards"] });
      invalidateDerivedCaches(qc, "srs-review");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] card delete failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a card you deleted while offline", {
        id: replayToastId("card", "delete"),
      });
    },
  });
  qc.setMutationDefaults(submitReviewMutationOptions.mutationKey, {
    mutationFn: submitReviewMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["srs-cards"] });
      invalidateDerivedCaches(qc, "srs-review");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] review submit failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a review you submitted while offline", {
        id: replayToastId("review", "submit"),
      });
    },
  });

  // ── reminders ──────────────────────────────────────────────────────
  qc.setMutationDefaults(createReminderMutationOptions.mutationKey, {
    mutationFn: createReminderMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      invalidateDerivedCaches(qc, "reminders");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] reminder create failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a reminder you created while offline", {
        id: replayToastId("reminder", "create"),
      });
    },
  });
  qc.setMutationDefaults(updateReminderMutationOptions.mutationKey, {
    mutationFn: updateReminderMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      invalidateDerivedCaches(qc, "reminders");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] reminder update failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a reminder you edited while offline", {
        id: replayToastId("reminder", "update"),
      });
    },
  });
  qc.setMutationDefaults(deleteReminderMutationOptions.mutationKey, {
    mutationFn: deleteReminderMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      invalidateDerivedCaches(qc, "reminders");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] reminder delete failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a reminder you deleted while offline", {
        id: replayToastId("reminder", "delete"),
      });
    },
  });

  // ── workouts ───────────────────────────────────────────────────────
  // ["workout-analysis"] IS now a derived read model (progressive overload +
  // body-part balance), so each of the three replays below marks it stale.
  // This matters most for the offline path specifically: a gym is where the
  // signal is worst, so the sets most likely to be replayed are exactly the
  // ones a progression view would otherwise miss until its 5-minute staleTime
  // expired.
  qc.setMutationDefaults(logWorkoutMutationOptions.mutationKey, {
    mutationFn: logWorkoutMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["workouts"] });
      invalidateDerivedCaches(qc, "workout");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] workout log failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a set you logged while offline", {
        id: replayToastId("workout", "log"),
      });
    },
  });
  qc.setMutationDefaults(updateWorkoutSetMutationOptions.mutationKey, {
    mutationFn: updateWorkoutSetMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["workouts"] });
      invalidateDerivedCaches(qc, "workout");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] workout set update failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a set you edited while offline", {
        id: replayToastId("workout", "update"),
      });
    },
  });
  qc.setMutationDefaults(deleteWorkoutSetMutationOptions.mutationKey, {
    mutationFn: deleteWorkoutSetMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["workouts"] });
      invalidateDerivedCaches(qc, "workout");
    },
    onError: (err, variables) => {
      console.error(
        "[offline-replay] workout set delete failed",
        { variables },
        err
      );
      toast.error("Couldn't sync a set you deleted while offline", {
        id: replayToastId("workout", "delete"),
      });
    },
  });
}
