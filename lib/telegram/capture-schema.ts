/**
 * The contract between the capture prompt (parseTelegramCapture in
 * lib/ai/client.ts) and the code that acts on its answer. Pure and
 * client-safe: no secret, no network, so it is unit-tested directly.
 *
 * The model is trusted with LANGUAGE only — which words are a task, which
 * day and clock time they name, which listed row they are about. Every date
 * and instant is computed afterwards in code (lib/telegram/capture.ts) with
 * the IST helpers, and every field it returns is checked here first.
 */

/** Most items one message may produce. Matches MAX_SPLIT_TASKS. */
export const MAX_CAPTURE_ITEMS = 10;

/** Longest message the bot reads. Matches MAX_SPLIT_INPUT_CHARS. */
export const MAX_CAPTURE_INPUT_CHARS = 2000;

/** Longest title accepted back from the model. */
const MAX_TITLE_CHARS = 200;

/** Furthest ahead a named day may be before it reads as a mistake. */
const MAX_DAYS_AHEAD = 730;

/** One open task the model may refer to, by its short ref ("t3"). */
export interface CapturePromptTask {
  ref: string;
  title: string;
  /** IST civil due date, or null when undated. */
  due: string | null;
}

/** One active plan anchor ("Gym"), by its short ref ("a1"). */
export interface CapturePromptAnchor {
  ref: string;
  title: string;
}

/** One validated item of the model's answer. */
export interface CaptureAiItem {
  title: string;
  /** A ref from the lists the model was given, or null. Never invented. */
  match: string | null;
  /** Refs it thought of but was not sure about. Display only. */
  similar: string[];
  /** IST civil date the message NAMES, or null when it names no day. */
  date: string | null;
  /** "HH:MM" 24h the message NAMES, or null when it names no clock time. */
  time: string | null;
  /** An hour with no am/pm that context did not settle ("call at 8"). */
  time_ambiguous: boolean;
}

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function civilMs(dateStr: string): number {
  if (!CIVIL_DATE_RE.test(dateStr)) return NaN;
  const [y, m, d] = dateStr.split("-").map((n) => Number.parseInt(n, 10));
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== m - 1 ||
    back.getUTCDate() !== d
  ) {
    return NaN;
  }
  return ms;
}

/**
 * Check the model's parsed JSON field by field.
 *
 * THROWS only when the answer has no `items` array at all — a technical
 * failure the caller reports as "couldn't read that". An EMPTY array is a
 * real answer ("lol ok" has nothing in it) and comes back as [].
 *
 * Anything doubtful is dropped to its safe value rather than repaired: a
 * date that is not a real day, or lies in the past, or is years out becomes
 * null (no day named); a ref that was not offered becomes null (no match).
 * A wrong date or a wrong match is worse than none — Save would act on it.
 */
export function validateCaptureAnswer(
  parsed: unknown,
  allowedRefs: ReadonlySet<string>,
  today: string
): CaptureAiItem[] {
  const items = (parsed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error("AI returned unexpected format.");

  const todayMs = civilMs(today);
  if (Number.isNaN(todayMs)) throw new Error("validateCaptureAnswer: bad today");

  const out: CaptureAiItem[] = [];
  for (const raw of items) {
    if (out.length >= MAX_CAPTURE_ITEMS) break;
    if (typeof raw !== "object" || raw === null) continue;
    const t = raw as Record<string, unknown>;

    const title = typeof t.title === "string" ? t.title.trim().slice(0, MAX_TITLE_CHARS) : "";
    if (!title) continue;

    const match =
      typeof t.match === "string" && allowedRefs.has(t.match.trim()) ? t.match.trim() : null;

    const similar = Array.isArray(t.similar)
      ? Array.from(
          new Set(
            t.similar
              .filter((r): r is string => typeof r === "string")
              .map((r) => r.trim())
              .filter((r) => allowedRefs.has(r) && r !== match)
          )
        ).slice(0, 3)
      : [];

    const rawDate = typeof t.date === "string" ? t.date.trim() : "";
    const dateMs = rawDate ? civilMs(rawDate) : NaN;
    const date =
      !Number.isNaN(dateMs) &&
      dateMs >= todayMs &&
      dateMs <= todayMs + MAX_DAYS_AHEAD * 86_400_000
        ? rawDate
        : null;

    const rawTime = typeof t.time === "string" ? t.time.trim() : "";
    const time = TIME_RE.test(rawTime) ? rawTime : null;

    out.push({
      title,
      match,
      similar,
      date,
      time,
      time_ambiguous: time !== null && t.time_ambiguous === true,
    });
  }
  return out;
}
