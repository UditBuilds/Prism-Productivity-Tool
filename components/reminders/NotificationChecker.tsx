"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { useRemindersQuery, useUpdateReminder } from "@/hooks/useReminders";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import type { Reminder } from "@/types/database";

const CHECK_INTERVAL_MS = 60_000;
const REMINDERS_KEY = ["reminders"] as const;

/**
 * Mounted once in the dashboard layout. Every 60s it scans for reminders that
 * are due (remind_at <= now, is_sent false), fires a browser notification +
 * toast for each, and marks them sent. Renders nothing.
 */
export function NotificationChecker() {
  const qc = useQueryClient();
  const updateReminder = useUpdateReminder();
  const { subscribe } = usePushSubscription();
  // Keep the ["reminders"] cache populated/fresh app-wide.
  useRemindersQuery();

  // Reminders we've already fired this session — guards against double-firing
  // between the optimistic is_sent flip and the next refetch.
  const firedRef = useRef<Set<string>>(new Set());

  // (a) Ask for notification permission once, on mount.
  useEffect(() => {
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    } catch {
      // Browser doesn't support the Notifications API — ignore.
    }
  }, []);

  // Register/sync this device's Web Push subscription when notifications are on,
  // so reminders can fire via the server even while Prism is closed.
  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      void subscribe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (b) Poll for due reminders.
  useEffect(() => {
    const fireOne = (reminder: Reminder) => {
      // 1. Browser notification when permission is granted.
      try {
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification(reminder.title, {
            body: reminder.body || "Prism reminder",
            icon: "/favicon.ico",
          });
        }
      } catch {
        // Ignore notification construction failures.
      }

      // 3. Toast fallback regardless of browser permission.
      toast(reminder.title, { icon: "🔔" });

      // 2. Persist is_sent = true (mutation invalidates ["reminders"]).
      updateReminder.mutate({ id: reminder.id, is_sent: true });
    };

    const checkDue = () => {
      const reminders = qc.getQueryData<Reminder[]>(REMINDERS_KEY) ?? [];
      const now = Date.now();
      for (const reminder of reminders) {
        if (reminder.is_sent) continue;
        if (reminder.id.startsWith("optimistic-")) continue; // not persisted yet
        if (firedRef.current.has(reminder.id)) continue;
        if (new Date(reminder.remind_at).getTime() <= now) {
          firedRef.current.add(reminder.id);
          fireOne(reminder);
        }
      }
    };

    // Run immediately so already-due reminders don't wait a full minute.
    checkDue();
    const interval = setInterval(checkDue, CHECK_INTERVAL_MS);
    // (c) Cleanup.
    return () => clearInterval(interval);
  }, [qc, updateReminder]);

  return null;
}
