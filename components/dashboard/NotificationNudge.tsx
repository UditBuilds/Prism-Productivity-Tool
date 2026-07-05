"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Bell, Loader2 } from "lucide-react";

import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="mt-4 flex animate-fade-up items-center gap-3 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
      <Bell className="h-5 w-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Enable notifications
        </p>
        <p className="text-xs text-muted-foreground">
          Get reminded about tasks and reviews on time.
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0 rounded-lg"
        disabled={busy}
        onClick={enable}
      >
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Enable
      </Button>
    </div>
  );
}
