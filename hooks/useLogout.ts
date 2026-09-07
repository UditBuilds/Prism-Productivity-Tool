"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { clearPersistedCaches } from "@/lib/query-persister";
import { clearAllWorkoutDrafts } from "@/lib/workout-draft";
import { resetUIStore } from "@/store/ui.store";
import { resetFocusStore } from "@/store/focus.store";

/**
 * The ONLY logout path. Signing out must wipe every client-side trace of the
 * account so the next sign-in on this browser (a different user, a shared
 * device) can never see it:
 *  - Zustand stores (open dialogs hold real rows; the focus timer keeps
 *    ticking otherwise)
 *  - the in-memory React Query cache (queries AND queued mutations)
 *  - every persisted IndexedDB snapshot
 *  - every unsaved workout draft in localStorage (never sent to the server, so
 *    nothing else in this list would reach it)
 * router.refresh() then purges Next's client router cache of this account's
 * server-rendered pages.
 */
export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();

  return useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    resetUIStore();
    resetFocusStore();
    qc.clear();
    clearAllWorkoutDrafts();
    await clearPersistedCaches();
    router.push("/login");
    router.refresh();
  }, [qc, router]);
}
