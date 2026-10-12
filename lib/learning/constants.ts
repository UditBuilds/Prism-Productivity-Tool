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
 * The fit check (fit.ts, Udit, 2026-10-12): one call per search that judges
 * the examples of every fetched page against the plan — the step's own idea
 * and earlier steps' only. On 20b, so the 120b budget stays the writer's and
 * G2's. Logged in learning_ai_calls as kind "judge" with this model: the
 * kind column's CHECK allows only plan/search/write/judge, and G2 (the only
 * other judge) runs on 120b, so model + kind name it.
 */
export const LEARNING_FIT_MODEL = "openai/gpt-oss-20b";
export const FIT_TIMEOUT_MS = 25_000;
/**
 * Examples per page the fit check judges: the shortest ones about the step.
 * 10, not fewer: on realpython.com/python-print/ the example that fits
 * "Print a greeting" is the 8th shortest of 120 about the step (measured
 * 2026-10-12). About 900 prompt tokens of code per search.
 */
export const SCREEN_EXAMPLES_PER_PAGE = 10;

/**
 * max_tokens per call: what each answer needs plus room for reasoning, which
 * gpt-oss bills against max_tokens. A strict-JSON answer that reaches it does
 * NOT come back cut off: Groq refuses it with HTTP 400 json_validate_failed,
 * "max completion tokens reached before generating a valid document"
 * (measured 2026-10-10), and groq.ts reports that as cut off.
 */
export const SEARCH_MAX_TOKENS = 800;
export const COPY_MAX_TOKENS = 1_500;
export const FIT_MAX_TOKENS = 2_500;
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
/**
 * Fitting examples the copier may be asked to quote around in one lesson,
 * best first: the next is tried only when the passage around one is too thin.
 */
export const MAX_COPIER_TRIES = 3;
/** What the copier reads around the chosen example: this many characters of paragraphs before it, and after it. */
export const SECTION_BEFORE_CHARS = 2_500;
export const SECTION_AFTER_CHARS = 800;

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

/**
 * Mark mode, "mark, don't block" (Udit, 2026-10-12): after its one fix, a
 * sentence the meaning check (G2) still rejects — in any part, with any
 * verdict — is kept and saved with a visible mark and the checker's reason
 * (explanation.ts DOUBT_LABEL), instead of failing the step (contradicts) or
 * being removed (unsupported, filler). G1 and the shape rules still block.
 * false restores the 2026-10-10 rule. The marks are part of the saved body,
 * so switching this off later does not unmark lessons already saved.
 */
export const G2_MARK_MODE = true;

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
