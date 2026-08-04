"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Bell, Loader2 } from "lucide-react";

import { usePushSubscription } from "@/hooks/usePushSubscription";

/**
 * Dashboard banner nudging toward browser notifications. Client island (the
 * dashboard page is a Server Component). Renders only while permission is
 * "default" — granted/denied users never see it, and the state is read after
 * mount so SSR/hydration stay in sync.
 */
export function NotificationNudge() {
  const { subscribe } = usePushSubscription();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShow(
      typeof Notification !== "undefined" &&
        Notification.permission === "default"
    );
  }, []);

  // Button tap = the user gesture iOS requires for the permission prompt.
  async function enable() {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        void subscribe(); // register Web Push for this device too
        toast.success("Notifications enabled");
      }
      setShow(result === "default");
    } catch {
      toast.error("Couldn't enable notifications");
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  // One line, one inline action: this is a one-time setup prompt, not a
  // standing feature of the dashboard, and it sits on the first screen where
  // space belongs to the user's actual tasks.
  return (
    <div className="mb-8 flex items-center gap-2 rounded-xl border border-warning/20 bg-warning/5 p-4">
      <Bell className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        Get reminded on time
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={enable}
        className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover disabled:opacity-60"
      >
        {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
        Enable
      </button>
    </div>
  );
}
