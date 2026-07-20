import type { MutationKey, QueryClient } from "@tanstack/react-query";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import {
  createTaskMutationOptions,
  deleteTaskMutationOptions,
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
 * The onSettled defaults below only fire for RESUMED mutations (live
 * useMutation calls override them with their own richer handlers); they
 * re-sync the entity cache and its derived read models after the queued
 * write lands.
 */
const RESUMABLE_MUTATION_KEYS: ReadonlyArray<MutationKey> = [
  createTaskMutationOptions.mutationKey,
  updateTaskMutationOptions.mutationKey,
  deleteTaskMutationOptions.mutationKey,
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
  // Task mutations can also change the recurring-template list (create adds a
  // template; delete/stop_recurring deactivate one) — mirror the live hooks
  // and re-sync ["recurring-tasks"] alongside ["tasks"].
  qc.setMutationDefaults(createTaskMutationOptions.mutationKey, {
    mutationFn: createTaskMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
  qc.setMutationDefaults(updateTaskMutationOptions.mutationKey, {
    mutationFn: updateTaskMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
  qc.setMutationDefaults(deleteTaskMutationOptions.mutationKey, {
    mutationFn: deleteTaskMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["recurring-tasks"] });
      invalidateDerivedCaches(qc, "tasks");
    },
  });

  qc.setMutationDefaults(createNoteMutationOptions.mutationKey, {
    mutationFn: createNoteMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
  });
  qc.setMutationDefaults(updateNoteMutationOptions.mutationKey, {
    mutationFn: updateNoteMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
  });
  qc.setMutationDefaults(deleteNoteMutationOptions.mutationKey, {
    mutationFn: deleteNoteMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  qc.setMutationDefaults(createPlanMutationOptions.mutationKey, {
    mutationFn: createPlanMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      invalidateDerivedCaches(qc, "plans");
    },
  });
  qc.setMutationDefaults(updatePlanMutationOptions.mutationKey, {
    mutationFn: updatePlanMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      invalidateDerivedCaches(qc, "plans");
    },
  });
  qc.setMutationDefaults(deletePlanMutationOptions.mutationKey, {
    mutationFn: deletePlanMutationOptions.mutationFn,
    // Deleting a plan unlinks its tasks (plan_id → null) server-side.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  qc.setMutationDefaults(createCardMutationOptions.mutationKey, {
    mutationFn: createCardMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["srs-cards"] }),
  });
  qc.setMutationDefaults(updateCardMutationOptions.mutationKey, {
    mutationFn: updateCardMutationOptions.mutationFn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["srs-cards"] }),
  });
  qc.setMutationDefaults(deleteCardMutationOptions.mutationKey, {
    mutationFn: deleteCardMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["srs-cards"] });
      invalidateDerivedCaches(qc, "srs-review");
    },
  });
  qc.setMutationDefaults(submitReviewMutationOptions.mutationKey, {
    mutationFn: submitReviewMutationOptions.mutationFn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["srs-cards"] });
      invalidateDerivedCaches(qc, "srs-review");
    },
  });
}
