"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Bell, CheckCircle2, XCircle, Loader2 } from "lucide-react";

import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type PermState = NotificationPermission | "unsupported" | null;

export function NotificationsCard() {
  const { subscribe } = usePushSubscription();
  const [permission, setPermission] = useState<PermState>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Determine current state on mount (client-only — Notification is undefined
  // during SSR).
  useEffect(() => {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    if (Notification.permission === "granted" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(!!sub);
      });
    }
  }, []);

  // Requests permission (the button tap satisfies iOS's user-gesture rule),
  // then subscribes if granted.
  async function enable() {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        const sub = await subscribe();
        if (sub.success) {
          setSubscribed(true);
          toast.success("Notifications enabled!");
        } else {
          // Surface the real failure (helps debug iOS push issues).
          toast.error(`Notification setup failed: ${sub.error}`);
        }
      }
    } catch {
      toast.error("Couldn't enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const { endpoint } = sub;
          await sub.unsubscribe();
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          });
        }
      }
      setSubscribed(false);
      toast.success("Notifications disabled");
    } catch {
      toast.error("Couldn't disable notifications");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 max-w-lg rounded-xl border border-border bg-surface p-6">
      <h2 className="text-base font-semibold text-foreground">Notifications</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Get reminders even when Prism is closed.
      </p>

      <div className="mt-6">
        {permission === null ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : permission === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            Notifications aren&apos;t supported on this device or browser.
          </p>
        ) : permission === "granted" && subscribed ? (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Notifications enabled ✓
            </span>
            <Button
              variant="outline"
              onClick={disable}
              disabled={busy}
              className="rounded-lg"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disable
            </Button>
          </div>
        ) : permission === "denied" ? (
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              Notifications blocked
            </span>
            <p className="mt-3 text-sm text-muted-foreground">
              To enable: open your browser or device settings and allow
              notifications for Prism, then reload this page.
            </p>
          </div>
        ) : (
          // 'default', or 'granted' but not yet subscribed → offer to enable.
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              Notifications not set up
            </span>
            <p className="mt-3 text-sm text-muted-foreground">
              Enable notifications to receive reminders even when the app is
              closed.
            </p>
            <Button
              onClick={enable}
              disabled={busy}
              className="mt-4 w-full rounded-lg"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enable Notifications
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
