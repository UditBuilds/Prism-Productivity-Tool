import { formatReminderTime } from "@/lib/date";
import type { Reminder } from "@/types/database";
import { ReminderCard } from "./ReminderCard";

type GroupKey = "overdue" | "today" | "upcoming" | "sent";

const GROUP_ORDER: GroupKey[] = ["overdue", "today", "upcoming", "sent"];

const GROUP_LABEL: Record<GroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  sent: "Sent",
};

/** Bucket a reminder: sent ones group on their own; pending ones by IST time. */
function groupFor(reminder: Reminder): GroupKey {
  if (reminder.is_sent) return "sent";
  const tone = formatReminderTime(reminder.remind_at).tone;
  if (tone === "danger") return "overdue";
  if (tone === "warning") return "today";
  return "upcoming";
}

/** Feed of reminders, grouped with section headers. */
export function ReminderList({ reminders }: { reminders: Reminder[] }) {
  const groups: Record<GroupKey, Reminder[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    sent: [],
  };
  for (const reminder of reminders) {
    groups[groupFor(reminder)].push(reminder);
  }

  return (
    <div className="space-y-6">
      {GROUP_ORDER.filter((key) => groups[key].length > 0).map((key) => (
        <section key={key}>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {GROUP_LABEL[key]}
            <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
              {groups[key].length}
            </span>
          </h2>
          <div className="space-y-2">
            {groups[key].map((reminder) => (
              <ReminderCard key={reminder.id} reminder={reminder} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
