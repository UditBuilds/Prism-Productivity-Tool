"use client";

import { useMemo, useState } from "react";
import { Plus, Bell, BellOff, CheckCheck, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useRemindersQuery } from "@/hooks/useReminders";
import { useUIStore } from "@/store/ui.store";
import { cn } from "@/lib/utils";
import type { Reminder } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReminderList } from "@/components/reminders/ReminderList";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { EmptyState } from "@/components/shared/EmptyState";

type Filter = "all" | "pending" | "sent";

const emptyByFilter: Record<
  Filter,
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

const tabs: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
];

export default function RemindersPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const openCreateReminder = useUIStore((s) => s.openCreateReminder);
  const { data: reminders, isLoading, isError, refetch } = useRemindersQuery();

  const counts = useMemo(() => {
    const list = reminders ?? [];
    return {
      all: list.length,
      pending: list.filter((r) => !r.is_sent).length,
      sent: list.filter((r) => r.is_sent).length,
    } satisfies Record<Filter, number>;
  }, [reminders]);

  const visible = useMemo<Reminder[]>(() => {
    const list = reminders ?? [];
    if (filter === "pending") return list.filter((r) => !r.is_sent);
    if (filter === "sent") return list.filter((r) => r.is_sent);
    return list;
  }, [reminders, filter]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Reminders</h1>
        <Button onClick={openCreateReminder} className="rounded-lg">
          <Plus className="mr-1.5 h-4 w-4" />
          New Reminder
        </Button>
      </div>

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as Filter)}
        className="mt-5"
      >
        <TabsList className="grid w-full grid-cols-3">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="gap-1.5 text-xs sm:text-sm"
            >
              <span className="truncate">{tab.label}</span>
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
        {isLoading ? (
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
          <EmptyState
            icon={emptyByFilter[filter].icon}
            title={emptyByFilter[filter].title}
            description={emptyByFilter[filter].description}
            action={
              filter === "all" ? (
                <Button onClick={openCreateReminder} className="rounded-lg">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Reminder
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ReminderList reminders={visible} />
        )}
      </div>

      <ReminderForm />
    </div>
  );
}
