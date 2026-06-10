"use client";

import { useDueCards } from "@/hooks/useSRS";
import { useRemindersQuery } from "@/hooks/useReminders";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Live counts that drive the sidebar/mobile-nav badges. Reuses the shared
 * ["srs-cards"] and ["reminders"] caches (no extra network requests).
 */
export function useNavBadgeCounts() {
  const { data: due } = useDueCards();
  const { data: reminders } = useRemindersQuery();

  const learn = due?.length ?? 0;

  const soon = Date.now() + DAY_MS;
  const remindersCount = (reminders ?? []).filter(
    (r) => !r.is_sent && new Date(r.remind_at).getTime() <= soon
  ).length;

  return { learn, reminders: remindersCount };
}

export function NavBadge({
  count,
  color,
  className,
}: {
  count: number;
  color: "violet" | "amber";
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
        color === "violet"
          ? "bg-violet-600 text-white"
          : "bg-amber-500 text-amber-950",
        className ?? "right-1 top-1"
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
