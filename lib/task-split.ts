/**
 * When a dashboard capture is WORTH asking the AI to split into several tasks,
 * and what the split endpoint may return.
 *
 * This module is client-safe and pure — it makes no network call and touches no
 * secret — because the decision has to be made in the browser, before anything
 * is sent. That is the whole point: a capture that shows no sign of being more
 * than one task goes down the existing POST /api/tasks path untouched, with no
 * AI call, no rate-limit budget spent, and byte-identical behaviour to before
 * this feature existed.
 *
 * THE BIAS IS DELIBERATELY TOWARD TRIGGERING, and it is the opposite of the
 * bias this heuristic was first proposed with. The original reasoning was
 * "false negatives are fine, the AI handles it" — but a false negative means
 * the AI is never called at all, so nothing downstream corrects a missed split:
 * the whole line is filed as one garbled task and the user finds it later.
 * A false positive costs exactly one cheap Groq call, and the model is
 * instructed to hand back a single-item array when the text really is one
 * thing. So an ambiguous signal leans toward asking.
 *
 * WHAT IT IS NOT. It is not a classifier and it does not try to be right about
 * how many tasks there are — that judgement belongs to the model, which can
 * read "buy milk and eggs and bread" as one shopping errand. This only answers
 * "is there any reason to look closer?".
 */

/**
 * Most tasks a single capture may create.
 *
 * Sized off what a person plausibly types into a one-line field in one go — a
 * pasted checklist of five or six items is realistic, thirty is a document. If
 * the model returns more, the route truncates and says so rather than quietly
 * filling the task list from one paste. Deliberately NOT a rejection: the first
 * 10 are still what the user asked for.
 */
export const MAX_SPLIT_TASKS = 10;

/**
 * Longest capture the split path will look at.
 *
 * Above this the client keeps the plain path, so a very large paste behaves
 * exactly as it does today — one task holding the literal text — rather than
 * becoming an expensive prompt. 2,000 matches MAX_RAW_INPUT_LENGTH, the bound
 * the workout capture path already uses for the same reason. The route enforces
 * the same number and degrades to the literal task rather than rejecting, so a
 * client that ignores this bound still cannot lose the capture.
 */
export const MAX_SPLIT_INPUT_CHARS = 2000;

/**
 * Words that name a day on their own.
 *
 * ONE of these is enough to trigger. That is a deliberate tuning away from the
 * "needs two cues" version, for a reason beyond splitting: a single-item
 * capture that names a day ("call mom tomorrow") has a due date sitting in it
 * that today's path throws away, and picking that up is half of what this
 * feature is for. The single-word rule is what makes "gym tomorrow" reach the
 * model at all.
 *
 * Bare month names are included: "pay rent march" reads as a date. Ambiguity is
 * resolved by the model, which is told never to invent a date that isn't there.
 */
const DATE_WORDS = [
  "today",
  "tonight",
  "tomorrow",
  "tmrw",
  "tmr",
  "yesterday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mon",
  "tue",
  "tues",
  "wed",
  "weds",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
  "weekend",
  "weekday",
  "week",
  "month",
  "eod",
  "eow",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
];

const DATE_WORD_RE = new RegExp("\\b(?:" + DATE_WORDS.join("|") + ")\\b", "i");

/**
 * A written-out date that isn't a word: "12/05", "2026-09-01", "on the 3rd",
 * "in 3 days". Kept separate from DATE_WORDS so the word list stays a word
 * list.
 */
const DATE_PATTERN_RE =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2}(?:st|nd|rd|th)\b|\bin\s+\d+\s+(?:day|days|week|weeks|month|months)\b/i;

/** Two or more lines with actual content on them. */
const MULTILINE_RE = /\S[^\n]*\r?\n[^\n]*\S/;

/**
 * A bullet or a number acting as a list marker — at the start of a line, or
 * mid-string for a list typed on one line ("1. call mom 2. email sam").
 */
const LIST_MARKER_RE =
  /(?:^|\n)\s*(?:[-*•·]|\d{1,2}[.)])\s+\S|\s\d{1,2}[.)]\s+\S/;

/**
 * A separator with real content on both sides. `\S` on either side is what
 * stops a trailing "milk," from counting on its own — though a thousands
 * separator inside a longer sentence will still trip this, which is the cheap
 * direction to be wrong in.
 */
const SEPARATOR_RE = /\S\s*[,;]\s*\S/;

/**
 * A conjunction joining two chunks.
 *
 * "and" ALONE counts, with no comma required. That looks over-eager and is the
 * bias working as intended: "buy milk and eggs and bread" reaches the model and
 * comes back as one task, while "call mom and submit the report" reaches it and
 * comes back as two. Nothing local to this function can tell those apart, and
 * the one that must not be missed is the second.
 */
const CONJUNCTION_RE = /\S\s+(?:and|then|also|plus|&)\s+\S/i;

/** Every signal, named — so the reasoning is testable, not just the verdict. */
export interface SplitSignals {
  multiline: boolean;
  listMarker: boolean;
  separator: boolean;
  conjunction: boolean;
  temporal: boolean;
}

export function splitSignals(text: string): SplitSignals {
  return {
    multiline: MULTILINE_RE.test(text),
    listMarker: LIST_MARKER_RE.test(text),
    separator: SEPARATOR_RE.test(text),
    conjunction: CONJUNCTION_RE.test(text),
    temporal: DATE_WORD_RE.test(text) || DATE_PATTERN_RE.test(text),
  };
}

/**
 * Should this capture go to the AI split endpoint instead of straight to
 * POST /api/tasks?
 *
 * ANY ONE signal is enough. Requiring a combination is how a plain
 * "call mom tomorrow, submit the report friday" gets missed by a heuristic that
 * looks reasonable on paper.
 */
export function looksLikeMultipleTasks(raw: string): boolean {
  const text = raw.trim();
  // Nothing, or a single word: there is no second task hiding in "gym", and no
  // date either. The only case this forecloses is a one-word capture that is
  // also a date, which cannot be a task.
  if (!text || !/\s/.test(text)) return false;
  // Beyond the bound the plain path is kept, so a huge paste behaves exactly as
  // it does today rather than becoming a large prompt.
  if (text.length > MAX_SPLIT_INPUT_CHARS) return false;

  const s = splitSignals(text);
  return (
    s.multiline || s.listMarker || s.separator || s.conjunction || s.temporal
  );
}

/**
 * Why the route created ONE literal task instead of an AI split. `null` means
 * the AI ran and its answer is what was created.
 *
 * The taxonomy is the one lib/ai/client.ts already draws and lib/pdf/types.ts
 * already encodes, not a new one:
 *
 *   "empty"          EmptyGenerationError — the call SUCCEEDED and the model
 *                    genuinely found nothing to extract. Not a failure, and
 *                    retrying changes nothing.
 *   "ai_failed"      A real technical failure (network, a 429 from Groq itself,
 *                    unparseable JSON). A retry might work.
 *   "rate_limited"   Our own shared-tier cap said no, so the call never ran.
 *   "too_long"       Past MAX_SPLIT_INPUT_CHARS; the AI was never asked.
 *
 * In every one of them exactly one task is created holding the literal text,
 * with due_date null — precisely what this capture did before the feature
 * existed. Degrading to today's behaviour is the contract; an error state that
 * leaves the user with nothing is not an option, because the capture field has
 * already cleared by the time the response lands.
 */
export type SplitFallbackReason =
  | "empty"
  | "ai_failed"
  | "rate_limited"
  | "too_long";

/** POST /api/tasks/split response payload. */
export interface SplitTasksResult<TTask> {
  tasks: TTask[];
  /** Set when the AI did not decide the outcome. See SplitFallbackReason. */
  fallback: SplitFallbackReason | null;
  /** True when the model proposed more than MAX_SPLIT_TASKS and the first N were kept. */
  truncated: boolean;
}
