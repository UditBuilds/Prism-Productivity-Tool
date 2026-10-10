/**
 * Learning — the numbers in one place.
 *
 * Every figure here was measured on this Groq account (see the PR for the raw
 * runs), not guessed. Groq's free plan gives EACH model its own 8,000 tokens a
 * minute and 200,000 tokens a day, so splitting the work across two models
 * keeps the cheap, unpredictable part (search) off the budget the rest of the
 * app spends on gpt-oss-120b.
 */

/** Writes the plan and the AI explanation. The model the rest of the app uses. */
export const LEARNING_WRITE_MODEL = "openai/gpt-oss-120b";

/**
 * Runs the web search (Groq's built-in browser_search tool). One search with
 * no page opened measured 1,412–1,574 tokens. A call that is allowed to open
 * pages measured 19,294 — so the prompt forbids opening and the code counts
 * any page that is opened anyway (pages_opened in the ledger).
 */
export const LEARNING_SEARCH_MODEL = "openai/gpt-oss-20b";

/**
 * G2, the meaning check (judge.ts): reads each sentence of the explanation
 * next to the source shown above it. On 120b (Udit, 2026-10-10): on 20b it
 * rejected true walk-through sentences and passed pep talk, and its tokens
 * now come out of the same per-lesson 120b budget as the writer's.
 */
export const LEARNING_JUDGE_MODEL = "openai/gpt-oss-120b";
export const JUDGE_TIMEOUT_MS = 25_000;

/**
 * Chooses what the lesson quotes (passages.ts): sentence and code-example
 * NUMBERS from the page, never retyped text. Logged in learning_ai_calls as
 * kind "write" with this model — the kind column's CHECK allows only plan/
 * search/write/judge, and no other 20b call is a "write", so model + kind
 * name it.
 */
export const LEARNING_COPY_MODEL = "openai/gpt-oss-20b";
export const COPY_TIMEOUT_MS = 20_000;

/**
 * max_tokens per call: what each answer needs plus room for reasoning, which
 * gpt-oss bills against max_tokens. A strict-JSON answer that reaches it does
 * NOT come back cut off: Groq refuses it with HTTP 400 json_validate_failed,
 * "max completion tokens reached before generating a valid document"
 * (measured 2026-10-10), and groq.ts reports that as cut off.
 */
export const SEARCH_MAX_TOKENS = 800;
export const COPY_MAX_TOKENS = 1_500;
export const WRITE_MAX_TOKENS = 3_500;
export const FIX_MAX_TOKENS = 2_000;
export const JUDGE_MAX_TOKENS = 2_500;
export const PLAN_MAX_TOKENS = 6_000;

/**
 * What ONE lesson may spend, per model (Udit, 2026-10-10): on 120b the
 * writer, G2, the fix and G2 again; on 20b the searches and the copier.
 * job.ts adds up each call's real usage and gives the next call only what is
 * left, so a lesson that would go over stops with that reason instead.
 */
export const LESSON_BUDGET: Record<string, number> = {
  [LEARNING_WRITE_MODEL]: 8_000,
  [LEARNING_SEARCH_MODEL]: 15_000,
};
/** A call is not worth making with less room than this for its answer. */
export const MIN_ANSWER_TOKENS = 600;

/**
 * The source block (Udit, 2026-10-10): 1-3 passages from ONE page, at most
 * 130 quoted words, plus one code example from the same page.
 */
export const MAX_SOURCE_PASSAGES = 3;
export const SOURCE_MAX_WORDS = 130;
/** Fewer quoted words than this is not enough to teach from: try the next page. */
export const MIN_SOURCE_WORDS = 40;
/** A page whose relevant part has fewer usable words than this is not sent to the copier at all. */
export const MIN_PAGE_WORDS = 100;
/** A longer code example is no longer "one short example". */
export const MAX_EXAMPLE_CODE_LINES = 12;
/** Pages the copier may be asked about in one lesson, across both searches. */
export const MAX_SOURCE_PAGES = 3;

/**
 * The most tokens one user's learning may spend in any rolling 24 hours,
 * across both models, counted from learning_ai_calls (so it survives cold
 * starts, unlike the in-memory rate limiter).
 *
 * 60,000 is 30% of one model's 200,000-a-day cap. What it stops is a loop —
 * or a run of "This is wrong" taps — eating the budget that notes,
 * flashcards and workouts share.
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
export const PLAN_TIMEOUT_MS = 25_000;

/** Search result pages fetched in parallel, per search. */
export const MAX_CANDIDATE_PAGES = 5;
/** The part of a page the copier numbers and chooses from. */
export const MAIN_SOURCE_EXCERPT_CHARS = 7_000;

/**
 * The AI explanation's length: every sentence, the closing line included.
 * 150, not 300 (Udit, 2026-10-10): a usable 219-word explanation was thrown
 * away by the old floor, and the next one was padded to reach it.
 */
export const LESSON_MIN_WORDS = 150;
export const LESSON_MAX_WORDS = 500;

/** Shown under a source that is not on the topic's official documentation site. */
export const TUTORIAL_LABEL = "tutorial site, not official docs";

export const TOPIC_TITLE_MAX = 200;
export const WRONG_NOTE_MAX = 1_000;

/** Plan size (Udit, 2026-10-10: up to 30 steps, one idea each). */
export const PLAN_MIN_STEPS = 5;
export const PLAN_MAX_STEPS = 30;

/** What the demo account sees instead of Topics (the routes refuse it, lib/learning/guard.ts). */
export const DEMO_REFUSAL =
  "Learning is switched off on the demo account, because every lesson spends the shared AI budget.";
