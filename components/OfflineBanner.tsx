"use client";

import { useSyncExternalStore } from "react";
import { onlineManager, useMutationState } from "@tanstack/react-query";
import { CloudUpload, WifiOff } from "lucide-react";

function subscribe(callback: () => void) {
  return onlineManager.subscribe(() => callback());
}

/**
 * Sticky amber banner while the browser is offline, with a count of queued
 * (paused) mutations waiting to sync.
 *
 * Reads connectivity from React Query's onlineManager — the exact signal the
 * query layer uses to pause/resume fetches and mutations — so the banner and
 * the cache can never disagree. onlineManager itself listens to the browser's
 * online/offline events by default.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => onlineManager.isOnline(),
    () => true // SSR snapshot: assume online, render nothing
  );

  // Mutations TanStack paused while offline; they auto-resume on reconnect.
  const queued = useMutationState({
    filters: { predicate: (mutation) => mutation.state.isPaused },
  }).length;

  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-500/90 px-4 py-2 text-sm font-medium text-black"
    >
      <WifiOff className="h-4 w-4" aria-hidden />
      You&apos;re offline — changes won&apos;t sync until you reconnect
      {queued > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-xs font-semibold">
          <CloudUpload className="h-3 w-3" aria-hidden />
          {queued} change{queued === 1 ? "" : "s"} queued
        </span>
      )}
    </div>
  );
}
