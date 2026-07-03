"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Sticky amber banner while the browser is offline. State starts false (SSR
 * has no navigator) and syncs on mount + online/offline events.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-2 text-sm font-medium text-black"
    >
      <WifiOff className="h-4 w-4" aria-hidden />
      You&apos;re offline — changes won&apos;t sync until you reconnect
    </div>
  );
}
