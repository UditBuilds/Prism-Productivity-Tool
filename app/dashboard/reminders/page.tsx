"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Bell, BellOff, CheckCheck, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useRemindersQuery } from "@/hooks/useReminders";
import { useCountdownsQuery } from "@/hooks/useCountdowns";
import { useUIStore } from "@/store/ui.store";
import { cn } from "@/lib/utils";
import type { Reminder } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReminderList } from "@/components/reminders/ReminderList";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { CountdownsTab } from "@/components/countdowns/CountdownsTab";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { EmptyReminders } from "@/components/shared/EmptyStates";

type Filter = "all" | "pending" | "sent" | "countdowns";

const emptyByFilter: Record<
  Exclude<Filter, "countdowns">,
  { icon: LucideIcon; title: string; description: string }
> = {
  all: {
    icon: Bell,
    title: "No reminders yet",
    description: "Create a reminder and Prism will nudge you when it's time.",
  },
  pending: {
    icon: BellOff,
    title: "Nothing pending",
    description: "Reminders waiting to fire will appear here.",
  },
  sent: {
    icon: CheckCheck,
    title: "Nothing sent yet",
    description: "Reminders that have already fired will show up here.",
  },
};

const tabs: { value: Filter; label: string; shortLabel?: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "countdowns", label: "Countdowns", shortLabel: "Events" },
];

export default function RemindersPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [showEnableBanner, setShowEnableBanner] = useState(false);
  const openCreateReminder = useUIStore((s) => s.openCreateReminder);
  const { data: reminders, isLoading, isError, refetch } = useRemindersQuery();
  const { data: countdowns } = useCountdownsQuery();

  // Nudge users to turn on notifications (client-only — Notification is
  // undefined during SSR). Only when permission hasn't been decided yet.
  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      setShowEnableBanner(true);
    }
  }, []);

  const counts = useMemo(() => {
    const list = reminders ?? [];
    return {
      all: list.length,
      pending: list.filter((r) => !r.is_sent).length,
      sent: list.filter((r) => r.is_sent).length,
      countdowns: countdowns?.length ?? 0,
    } satisfies Record<Filter, number>;
  }, [reminders, countdowns]);

  const visible = useMemo<Reminder[]>(() => {
    const list = reminders ?? [];
    if (filter === "pending") return list.filter((r) => !r.is_sent);
    if (filter === "sent") return list.filter((r) => r.is_sent);
    return list;
  }, [reminders, filter]);

  return (
    <div className="animate-fade-up">
      <PullToRefresh onRefresh={() => refetch()}>
      <PageHeader
        title="Reminders"
        subtitle="Never miss what matters"
        icon={Bell}
        actions={
          <Button onClick={openCreateReminder} className="rounded-lg">
            <Plus className="mr-1.5 h-4 w-4" />
            New Reminder
          </Button>
        }
      />

      {showEnableBanner && (
        <Link
          href="/dashboard/settings"
          className="mt-4 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-accent/15"
        >
          <Bell className="h-4 w-4 shrink-0 text-accent" />
          <span className="flex-1">
            Enable notifications in Settings to get reminders when the app is
            closed
          </span>
          <span aria-hidden className="text-accent">
            →
          </span>
        </Link>
      )}

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as Filter)}
        className="mt-5"
      >
        <TabsList className="grid w-full grid-cols-4">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="gap-1.5 text-xs sm:text-sm"
            >
              <span className="truncate">
                {tab.shortLabel ? (
                  <>
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </>
                ) : (
                  tab.label
                )}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  filter === tab.value
                    ? "bg-accent/20 text-accent"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {counts[tab.value]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-5">
        {filter === "countdowns" ? (
          <CountdownsTab />
        ) : isLoading ? (
          <LoadingSkeleton count={3} />
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load reminders"
            description="Something went wrong fetching your reminders."
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          filter === "all" ? (
            <EmptyReminders
              action={
                <Button onClick={openCreateReminder} className="rounded-lg">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Reminder
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={emptyByFilter[filter].icon}
              title={emptyByFilter[filter].title}
              description={emptyByFilter[filter].description}
            />
          )
        ) : (
          <ReminderList reminders={visible} />
        )}
      </div>

      <ReminderForm />
      </PullToRefresh>
    </div>
  );
}
