// All app times are anchored to Asia/Kolkata (IST, UTC+5:30) per the PRISM spec.
// We compute IST civil fields by shifting the instant, so it works regardless
// of the server's own timezone (e.g. UTC on Vercel).

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface IstDayContext {
  /** Current hour (0–23) in IST — for the time-aware greeting. */
  hour: number;
  /** ISO instant for 00:00 IST today. */
  startOfToday: string;
  /** ISO instant for 00:00 IST tomorrow (exclusive upper bound). */
  endOfToday: string;
  /** ISO instant for 00:00 IST on Monday of the current week. */
  startOfWeek: string;
}

export function istDayContext(now: Date = new Date()): IstDayContext {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const dow = ist.getUTCDay(); // 0=Sun … 6=Sat (in IST)
  const daysSinceMonday = (dow + 6) % 7;

  const istMidnightToUtc = (yy: number, mm: number, dd: number): string =>
    new Date(Date.UTC(yy, mm, dd, 0, 0, 0) - IST_OFFSET_MS).toISOString();

  return {
    hour: ist.getUTCHours(),
    startOfToday: istMidnightToUtc(y, m, d),
    endOfToday: istMidnightToUtc(y, m, d + 1),
    startOfWeek: istMidnightToUtc(y, m, d - daysSinceMonday),
  };
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export type DueTone = "muted" | "warning" | "danger";

export interface DueDateDisplay {
  label: string;
  tone: DueTone;
  bold: boolean;
}

/** IST calendar-day index for an instant (days since Unix epoch in IST). */
function istDayIndex(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / 86_400_000);
}

/** Public IST day index — used by the SRS streak calc (consecutive review days). */
export function istDayNumber(ms: number): number {
  return istDayIndex(ms);
}

/** IST civil date ("YYYY-MM-DD") for an instant. Defaults to now. */
export function istDateString(ms: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Whole IST days from today until a civil date ("YYYY-MM-DD").
 * 0 = today, 1 = tomorrow, negative = past.
 */
export function daysUntilIst(dateStr: string): number {
  const target = istDayIndex(Date.parse(`${dateStr}T00:00:00.000+05:30`));
  return target - istDayIndex(Date.now());
}

export interface CountdownDisplay {
  label: string;
  tone: "accent" | "warning" | "muted" | "dimmed";
}

/** % of a countdown's creation→target window already elapsed (clamped 0–100). */
export function countdownProgressPct(
  createdAtIso: string,
  targetDate: string
): number {
  const createdIdx = istDayIndex(Date.parse(createdAtIso));
  const todayIdx = istDayIndex(Date.now());
  const targetIdx = todayIdx + daysUntilIst(targetDate);
  const total = targetIdx - createdIdx;
  if (total <= 0) return 100; // target on/before creation day, or already past
  const elapsed = todayIdx - createdIdx;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

/** Label + tone for a countdown's remaining days. */
export function formatCountdown(dateStr: string): CountdownDisplay {
  const days = daysUntilIst(dateStr);
  if (days === 0) return { label: "Today!", tone: "accent" };
  if (days === 1) return { label: "Tomorrow", tone: "warning" };
  if (days < 0) {
    const n = -days;
    return { label: `${n} day${n === 1 ? "" : "s"} ago`, tone: "dimmed" };
  }
  return {
    label: `${days} days`,
    tone: days <= 7 ? "warning" : "muted",
  };
}

/**
 * Relative due-date label, by IST calendar day:
 *   overdue → "N days overdue" (danger, bold)
 *   today   → "Today" (warning)
 *   future  → "in N days" (muted)
 *   none    → null (caller hides it)
 */
export function formatDueDate(dueIso: string | null): DueDateDisplay | null {
  if (!dueIso) return null;
  const diff = istDayIndex(new Date(dueIso).getTime()) - istDayIndex(Date.now());

  if (diff === 0) return { label: "Today", tone: "warning", bold: false };
  if (diff < 0) {
    const n = -diff;
    return { label: `${n} day${n > 1 ? "s" : ""} overdue`, tone: "danger", bold: true };
  }
  if (diff === 1) return { label: "Tomorrow", tone: "muted", bold: false };
  return { label: `in ${diff} days`, tone: "muted", bold: false };
}

/** True when a task's due date is before today (IST) and it isn't done. */
export function isOverdue(dueIso: string | null, done: boolean): boolean {
  if (!dueIso || done) return false;
  return istDayIndex(new Date(dueIso).getTime()) < istDayIndex(Date.now());
}

/**
 * Combine a picked calendar date + a "HH:MM" time string into a single ISO
 * instant, interpreting the wall-clock as Asia/Kolkata (IST). Used by the
 * reminder form so "4 Jun, 09:30" always means 09:30 IST regardless of the
 * browser's own timezone.
 */
export function istDateTimeToIso(date: Date, time: string): string {
  const [hh, mm] = time.split(":").map((n) => Number.parseInt(n, 10));
  const utcMs =
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      Number.isFinite(hh) ? hh : 0,
      Number.isFinite(mm) ? mm : 0,
      0
    ) - IST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

/** "HH:MM" (24h) for an instant, rendered in IST. For the form's time input. */
export function istTimeValue(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function istClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function istWeekdayDate(iso: string): string {
  // e.g. "Wed, 4 Jun"
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

/**
 * Relative reminder-time label, by IST calendar day:
 *   overdue (in the past) → "X minutes/hours/days ago" (danger)
 *   today (still ahead)   → "Today at HH:MM"          (warning)
 *   future                → "Wed, 4 Jun at HH:MM"      (muted)
 */
export function formatReminderTime(remindIso: string): DueDateDisplay {
  const remindMs = new Date(remindIso).getTime();
  const nowMs = Date.now();
  const diff = remindMs - nowMs;

  if (diff < 0) {
    const mins = Math.floor(-diff / 60_000);
    let label: string;
    if (mins < 1) label = "just now";
    else if (mins < 60) label = `${mins} minute${mins > 1 ? "s" : ""} ago`;
    else {
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) label = `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
      else {
        const days = Math.floor(hrs / 24);
        label = `${days} day${days > 1 ? "s" : ""} ago`;
      }
    }
    return { label, tone: "danger", bold: true };
  }

  if (istDayIndex(remindMs) === istDayIndex(nowMs)) {
    return { label: `Today at ${istClock(remindIso)}`, tone: "warning", bold: false };
  }

  return {
    label: `${istWeekdayDate(remindIso)} at ${istClock(remindIso)}`,
    tone: "muted",
    bold: false,
  };
}
