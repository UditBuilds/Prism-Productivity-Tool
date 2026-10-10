/**
 * Learning — the numbers in one place.
 *
 * Every figure here was measured on this Groq account on 2026-10-09 (see the
 * PR for the raw runs), not guessed. Groq's free plan gives EACH model its own
 * 8,000 tokens a minute and 200,000 tokens a day, so splitting the work across
 * two models keeps the cheap, unpredictable part (search) off the budget the
 * rest of the app spends on gpt-oss-120b.
 */

/** Writes the plan and the lessons. The model the rest of the app uses. */
export const LEARNING_WRITE_MODEL = "openai/gpt-oss-120b";

/**
 * Runs the web search (Groq's built-in browser_search tool). One search with
 * no page opened measured 1,412–1,546 tokens over 10 runs. A call that is
 * allowed to open pages measured 19,294 — so the prompt forbids opening and the
 * code counts any page that is opened anyway (pages_opened in the ledger).
 */
export const LEARNING_SEARCH_MODEL = "openai/gpt-oss-20b";

/**
 * Reads each lesson sentence next to its source passage and says whether the
 * passage supports it (judge.ts). On 20b, so it spends 20b's own daily budget,
 * not the 120b one the rest of the app shares. Measured 2026-10-09 on the
 * development set: caught 10 of 10 planted fakes and flagged 1 of 61
 * hand-checked supported sentences; about 160 tokens per sentence checked.
 */
export const LEARNING_JUDGE_MODEL = "openai/gpt-oss-20b";
export const JUDGE_TIMEOUT_MS = 20_000;

/**
 * Copies passages from the source pages word for word before anything is
 * written (passages.ts, Udit's decision 2026-10-10: quotes first). On 20b for
 * the same reason as the judge. Logged in learning_ai_calls as kind "write"
 * with this model — the kind column's CHECK allows only plan/search/write/
 * judge, and no other 20b call is a "write", so model + kind name it.
 */
export const LEARNING_COPY_MODEL = "openai/gpt-oss-20b";
export const COPY_TIMEOUT_MS = 20_000;

/**
 * max_tokens per call. Groq's per-minute counter was seen to take
 * prompt + max_tokens up front (2026-10-10: a 78-token prompt with
 * max_tokens 200 dropped "remaining" by exactly 278), so these are sized to
 * what each call returns, with room for reasoning, not "large to be safe".
 * One observation — the debug dump records the headers on every call so the
 * question can be settled.
 */
export const SEARCH_MAX_TOKENS = 800;
export const COPY_MAX_TOKENS = 2_500;
export const WRITE_MAX_TOKENS = 3_000;
export const FIX_MAX_TOKENS = 1_500;
export const JUDGE_MAX_TOKENS = 2_000;

/** Passages the writer may be given; the copier is asked for up to 20. */
export const MAX_PASSAGES = 24;
/**
 * Below this many words of verified prose passages, a 300-word lesson could
 * only be reached by padding, so the step fails before the 120b call.
 */
export const MIN_PASSAGE_WORDS = 250;
/** An example longer than this is no longer "one short example" (decision 11). */
export const MAX_EXAMPLE_CODE_LINES = 12;

/**
 * The most tokens one user's learning may spend in any rolling 24 hours,
 * across both models, counted from learning_ai_calls (so it survives cold
 * starts, unlike the in-memory rate limiter).
 *
 * 60,000 is 30% of one model's 200,000-a-day cap. A typical 8-step topic
 * measured 27,000–40,000 tokens in total, and the one-lesson-ahead rule
 * spreads that over days, so this never limits normal reading. What it stops
 * is a loop — or a run of "This is wrong" taps — eating the budget that
 * notes, flashcards and workouts share.
 */
export const LEARNING_DAILY_TOKEN_CAP = 60_000;

/** A step left "writing" longer than this belongs to a request that died. */
export const STALE_CLAIM_MS = 90_000;

/**
 * Advance stops starting new work after this much of its 60s function budget.
 * Search, fetch and write each have their own timeouts below; together they
 * fit, and this is the backstop if one of them is slow.
 */
export const ADVANCE_DEADLINE_MS = 50_000;

export const SEARCH_TIMEOUT_MS = 15_000;
export const WRITE_TIMEOUT_MS = 25_000;
export const PLAN_TIMEOUT_MS = 20_000;

/** Search result pages fetched in parallel; the first good ones are kept. */
export const MAX_CANDIDATE_PAGES = 5;
/** Sources one lesson is written from. */
export const MAX_LESSON_SOURCES = 3;
/** Characters of each source the writer sees (≈ 900 tokens). */
export const SOURCE_EXCERPT_CHARS = 3_800;
/** A page with less relevant text than this is not worth a lesson. */
export const MIN_SOURCE_CHARS = 500;

/** Lesson length, decision 11. Prose words only; the code example is extra. */
export const LESSON_MIN_WORDS = 300;
export const LESSON_MAX_WORDS = 500;

/**
 * Decision 1 (2026-10-10): a lesson may hold [teach] lines — plain-word
 * definitions, links between points, and walking through the example — that
 * cite no passage because they add nothing new. At most one for every this
 * many cited lines, so the lesson stays tied to its sources.
 */
export const CITED_LINES_PER_TEACH_LINE = 2;

export const TOPIC_TITLE_MAX = 200;
export const WRONG_NOTE_MAX = 1_000;

/** Plan size. One idea per step keeps each lesson inside 300–500 words. */
export const PLAN_MIN_STEPS = 5;
export const PLAN_MAX_STEPS = 12;

/** What the demo account sees instead of Topics (the routes refuse it, lib/learning/guard.ts). */
export const DEMO_REFUSAL =
  "Learning is switched off on the demo account, because every lesson spends the shared AI budget.";
