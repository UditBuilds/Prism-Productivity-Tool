import Groq from "groq-sdk";

import { MAX_SPLIT_TASKS } from "@/lib/task-split";
import { buildSummarySource, clampSummary } from "@/lib/notes/revisit-summary";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const MODEL = "openai/gpt-oss-120b";

/**
 * Output caps. Every call in this module previously ran with no `max_tokens`,
 * so a pathological input could bill an unbounded completion — the same hazard
 * lib/ai/workout.ts already documents and caps, applied to the four call sites
 * that were missed.
 *
 * Sized from the actual worst case each function can be asked for:
 * - Cards: callers clamp to 30 (/api/srs/generate, /api/pdf/analyze) or 20
 *   (/api/youtube/analyze). At 30 cards a measured front+back pair runs well
 *   under 60 tokens, so ~1,800 is realistic and 4,000 is a bit over double —
 *   the same headroom ratio workout.ts chose.
 * - Notes: one markdown section from a <=4,000-char transcript chunk. 2,000
 *   tokens is roughly 8,000 characters of output, comfortably more than a
 *   faithful summary of that input needs.
 */
const MAX_TOKENS_CARDS = 4000;
const MAX_TOKENS_NOTES = 2000;

/**
 * Output cap for a Revisit summary.
 *
 * The visible answer is 2-4 bullets — under 300 characters, well below 100
 * tokens. The budget is dominated by reasoning tokens, which
 * `openai/gpt-oss-120b` bills against this same cap.
 *
 * It also has to stay SMALL for a reason the other caps don't share. Groq
 * reserves `prompt_tokens + max_tokens` up front against an 8,000 TPM
 * account-wide ceiling, and this call runs INSIDE a user's note save — if the
 * reservation were large, saving a long note could be refused outright. With
 * a ~5,000-char digest (~1,300 tokens) plus 800 the whole reservation lands
 * near 2,200, leaving most of the minute's budget for everything else.
 *
 * It fails SAFE: a truncated completion is rejected by wasTruncated below, the
 * route catches it, and the note saves with summary null — which the widget
 * renders as a truncated excerpt.
 *
 * 1500, NOT 800, AND MEASURED RATHER THAN GUESSED. At 800 the backfill failed
 * on 6 of 12 real notes with finish_reason "length" — the cap was spent on
 * REASONING before a single visible token was emitted (2,042 reasoning tokens
 * across the 6 that did succeed). Reasoning is not proportional to output on
 * this model: the 114,787-char note needed 424, while several mid-size notes
 * blew past 800. The paired fix is reasoning_effort "low" below, which treats
 * the cause; this cap is the headroom behind it.
 */
const MAX_TOKENS_SUMMARY = 1500;

/**
 * Output cap for the capture split.
 *
 * The answer is at most MAX_SPLIT_TASKS objects of {title, due_date} — a few
 * hundred visible tokens at the very top end. The budget is dominated by
 * reasoning tokens, which `openai/gpt-oss-120b` bills against this same cap
 * (one measured reformat spent 1,133 reasoning tokens to emit 154 visible
 * ones). 1,500 leaves room for that on a ten-item list while keeping
 * prompt + max_tokens far under the account's 8,000 TPM ceiling, so a capture
 * cannot be the call that trips the shared budget.
 *
 * It fails SAFE if ever hit: a truncated JSON array does not parse, which
 * throws, which the route degrades into the single literal task.
 */
const MAX_TOKENS_TASK_SPLIT = 1500;

/**
 * Backstop on what any single call may send to the model.
 *
 * Deliberately sized so it truncates NOTHING that exists today — a backstop
 * that silently trims real content is a behaviour change wearing a security
 * fix's clothes. Measured against the live database: the largest note is
 * 18,656 characters, and PDF (9,000, lib/pdf/chunk.ts) and transcript (4,000,
 * lib/youtube/extract.ts) chunks are already far smaller. 32,000 clears the
 * real maximum by ~1.7x while still bounding the prompt at roughly 8k tokens.
 *
 * It exists so a future caller cannot reintroduce an unbounded prompt by
 * forgetting its own cap — which is exactly how this class of bug arrived the
 * first time.
 */
export const MAX_SOURCE_CHARS = 32000;

/**
 * True when the model stopped because it hit `max_tokens` rather than
 * finishing. Callers that persist prose need this: a length-truncated
 * completion is a partial document, and saving one silently destroys content.
 * JSON callers don't — a truncated array fails to parse and throws anyway.
 */
function wasTruncated(finishReason: string | null | undefined): boolean {
  return finishReason === "length";
}

/**
 * The call succeeded and the model answered — there was simply nothing usable
 * in the answer. An empty card array, or a note section with no text.
 *
 * This is NOT a technical failure, and the difference matters to any caller
 * that reports partial results across a sequence of chunks. A 429 means "this
 * chunk never ran, try again and you may get it"; this means "this stretch of
 * the source had nothing in it", and retrying changes nothing. Counting the two
 * together makes a healthy video with a quiet passage — an intro, a sponsor
 * read, a long silence — report itself as degraded, which spends exactly the
 * trust the partial flag exists to build.
 *
 * The messages are byte-identical to when these were plain `Error`s, so
 * consumers that surface `err.message` (notably /api/srs/generate, which
 * string-matches on it) are unaffected.
 */
export class EmptyGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyGenerationError";
  }
}

/**
 * Reads a note and returns spaced-repetition flashcards. SERVER-ONLY — this
 * touches GROQ_API_KEY, so it must only be called from API routes, never a
 * client component.
 */
export async function generateFlashcardsFromNote(
  noteTitle: string,
  noteContent: string,
  cardCount: number = 8
): Promise<{ front: string; back: string }[]> {
  // Guard: too short to generate meaningful cards
  if (noteContent.trim().length < 100) {
    throw new Error(
      "Note is too short. Add more content before generating cards."
    );
  }

  const prompt = `You are a spaced repetition flashcard generator. Given this note, generate high-quality flashcards for long-term learning and retention.

RULES:
1. Return ONLY a valid JSON array. No markdown, no explanation, no preamble, no trailing text.
2. Format: [{"front":"question","back":"answer"}]
3. Generate exactly ${cardCount} cards (or fewer only if the content genuinely doesn't support that many).
4. Questions must be specific and testable, not vague.
5. Break complex ideas into multiple focused cards.
6. Never generate cards that are too obvious.
7. Use active recall — questions should make the reader retrieve the answer, not recognise it.

Note title: ${noteTitle.slice(0, 300)}
Note content: ${noteContent.slice(0, MAX_SOURCE_CHARS)}

JSON array:`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: MAX_TOKENS_CARDS,
    });
    text = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq generate error (client):", err);
    throw err;
  }

  // Parse: try direct, then extract JSON array from response
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("AI returned invalid format.");
    parsed = JSON.parse(match[0]);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI returned unexpected format.");
  }

  // Validate and sanitize each card
  const cards = (parsed as unknown[])
    .filter(
      (c): c is { front: string; back: string } =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).front === "string" &&
        typeof (c as Record<string, unknown>).back === "string" &&
        ((c as Record<string, unknown>).front as string).trim().length > 0 &&
        ((c as Record<string, unknown>).back as string).trim().length > 0
    )
    .map((c) => ({
      front: c.front.trim(),
      back: c.back.trim(),
    }));

  if (cards.length === 0) {
    throw new EmptyGenerationError("No valid cards generated. Try again.");
  }

  return cards;
}

/**
 * A structured Markdown note from a video transcript excerpt. SERVER-ONLY
 * (touches GROQ_API_KEY). Like generateFlashcardsFromTranscript, the prompt
 * keeps output self-contained — never referencing "the video"/"the speaker" —
 * but returns ready-to-store Markdown rather than JSON cards.
 */
export async function generateNotesFromTranscript(
  videoTitle: string,
  transcriptChunk: string
): Promise<string> {
  if (transcriptChunk.trim().length < 100) {
    throw new Error("Transcript is too short to generate notes from.");
  }

  const systemPrompt = `You are an expert at turning educational video transcripts into clean, well-organized study notes in Markdown.

Rules:
- Output GitHub-flavored Markdown only — no preamble, no closing remarks, and do not wrap the whole note in a code fence.
- Use ## headers for major sections (and ### for sub-sections where helpful).
- Use bullet points for key facts, steps, and lists; use **bold** for important terms and concepts.
- Never reference 'the video', 'the speaker', 'the presenter', 'this transcript', 'as mentioned', or similar meta-phrases.
- Write self-contained notes that read naturally to someone who never saw the source.
- Preserve concrete facts, definitions, formulas, and cause-and-effect relationships; drop filler, greetings, and sponsor reads.
- Do not invent information that the transcript does not support.`;

  const userContent = `Title: ${videoTitle.slice(0, 300)}\n\nTranscript excerpt:\n${transcriptChunk.slice(0, MAX_SOURCE_CHARS)}`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.5,
      max_tokens: MAX_TOKENS_NOTES,
    });
    // This output is persisted as a note. A completion cut off at the token
    // ceiling would store a section that ends mid-sentence, so treat it as a
    // failure — /api/youtube/notes drops a failed chunk and keeps the rest,
    // which is honest, where a silently half-written section is not.
    if (wasTruncated(completion.choices[0]?.finish_reason)) {
      throw new Error("AI output was truncated.");
    }
    text = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq generate error (notes from transcript):", err);
    throw err;
  }

  if (!text) {
    throw new EmptyGenerationError("No note content was generated.");
  }
  return text;
}

/**
 * 2-4 bullet key points for a long Revisit note. SERVER-ONLY (touches
 * GROQ_API_KEY).
 *
 * Same shape as generateNotesFromTranscript above — same client, same model,
 * same truncation guard, same EmptyGenerationError — deliberately, so there is
 * one AI-calling pattern in this module rather than two.
 *
 * The two differences are both budget, not style: the source is a digest built
 * by buildSummarySource (opening prose + heading outline) rather than a raw
 * slice, because a leading slice of a 114,787-character note summarizes only
 * its introduction; and max_tokens is MAX_TOKENS_SUMMARY, because this call
 * runs inside a user-facing save.
 *
 * The caller is expected to treat a throw as "save without a summary". This
 * function never returns a partial or truncated answer — a half-written
 * summary shown as fact is worse than the excerpt fallback.
 */
export async function summarizeNoteContent(
  title: string,
  content: string
): Promise<string> {
  const source = buildSummarySource(content);
  if (source.trim().length < 100) {
    throw new Error("Note is too short to summarize.");
  }

  const systemPrompt = `You write ultra-short "what is this about" summaries of study notes, so someone scanning a dashboard can tell what a note covers without opening it.

Rules:
- Output 2 to 4 Markdown bullet points, each starting with "- ". Nothing else: no heading, no preamble, no closing line, no code fence.
- LENGTH IS THE HARDEST RULE: the whole summary must be 150-300 characters and must never exceed 340. Count as you go. Each bullet is a short phrase of roughly 60-90 characters — one clause, no padding, no sub-clauses after a semicolon.
- State what the note is ABOUT and its main takeaways. Do not recap it section by section.
- You may be given the note's opening followed by a "--- Section outline ---" list of its headings. The outline tells you the note's full scope; use it so the summary covers the whole note, not only the opening.
- Never mention 'the note', 'this document', 'the outline', 'the video', or 'the speaker'.
- Plain text inside bullets. No bold, no links, no nested bullets.
- Do not invent anything the source does not support.`;

  const userContent = `Title: ${title.slice(0, 300)}

Note:
${source}`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS_SUMMARY,
      // "Condense this into 3 bullets" needs no deliberation, and on
      // openai/gpt-oss-120b reasoning tokens bill against max_tokens — at the
      // default effort they consumed the entire budget on half the real notes
      // and returned EMPTY content. Low effort is the fix; the raised cap is
      // only the safety margin. Measured: 6/12 failures became 0/6.
      reasoning_effort: "low",
    });
    // Persisted and shown as the note's stand-in. A completion cut off at the
    // ceiling would store a bullet list ending mid-word, so treat it as a
    // failure and let the caller fall back to the excerpt.
    if (wasTruncated(completion.choices[0]?.finish_reason)) {
      throw new Error("AI output was truncated.");
    }
    text = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq generate error (note summary):", err);
    throw err;
  }

  if (!text) {
    throw new EmptyGenerationError("No summary was generated.");
  }
  // The length rule is enforced here, not left to the prompt — see
  // clampSummary. Whole bullets are dropped; nothing is cut mid-word.
  return clampSummary(text);
}

/**
 * Flashcards from a video transcript excerpt. SERVER-ONLY (touches
 * GROQ_API_KEY). Uses a transcript-specific system prompt so cards never
 * reference "the video"/"the speaker" and stay self-contained. Same model,
 * parse, and error handling as generateFlashcardsFromNote.
 */
export async function generateFlashcardsFromTranscript(
  videoTitle: string,
  transcriptChunk: string,
  count: number
): Promise<{ front: string; back: string }[]> {
  if (transcriptChunk.trim().length < 100) {
    throw new Error("Transcript is too short to generate cards from.");
  }

  const systemPrompt = `You are an expert at creating flashcards from educational video transcripts. Generate exactly ${count} flashcards from the provided transcript excerpt.

Rules:
- Never reference 'the video', 'the speaker', 'the presenter', 'as mentioned', or 'discussed in this video'
- No meta-questions about the video's structure or topics covered
- Every card must be self-contained: answerable without having watched the video
- Focus on concrete facts, formulas, definitions, and cause-effect relationships
- Questions must test understanding, not recall of phrasing
- Answers: 1–3 sentences maximum, no padding

Return ONLY a JSON array:
[{"front": "...", "back": "..."}]
No preamble. No markdown fences.`;

  const userContent = `Video title: ${videoTitle.slice(0, 300)}\n\nTranscript excerpt:\n${transcriptChunk.slice(0, MAX_SOURCE_CHARS)}`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
      max_tokens: MAX_TOKENS_CARDS,
    });
    text = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq generate error (transcript):", err);
    throw err;
  }

  // Parse: try direct, then extract a JSON array from the response.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("AI returned invalid format.");
    parsed = JSON.parse(match[0]);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI returned unexpected format.");
  }

  const cards = (parsed as unknown[])
    .filter(
      (c): c is { front: string; back: string } =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).front === "string" &&
        typeof (c as Record<string, unknown>).back === "string" &&
        ((c as Record<string, unknown>).front as string).trim().length > 0 &&
        ((c as Record<string, unknown>).back as string).trim().length > 0
    )
    .map((c) => ({
      front: c.front.trim(),
      back: c.back.trim(),
    }));

  if (cards.length === 0) {
    throw new EmptyGenerationError("No valid cards generated. Try again.");
  }

  return cards;
}

/**
 * One actionable item pulled out of a dashboard capture.
 *
 * `due_date` is a PLAIN CIVIL DATE ("YYYY-MM-DD") or null — never an instant.
 * The model is not allowed anywhere near a timestamp: tasks.due_date is a
 * noon-IST-anchored ISO string and the anchoring is done by the same helper
 * every other task-creation path uses, so an AI answer cannot invent a
 * timezone convention of its own.
 */
export interface SplitTaskDraft {
  title: string;
  due_date: string | null;
}

/** Longest title we will accept back from the model. */
const MAX_SPLIT_TITLE_CHARS = 200;
/** Furthest ahead a returned due date may sit before it reads as a mistake. */
const MAX_SPLIT_DUE_DAYS = 730;

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Midnight-UTC instant for a civil "YYYY-MM-DD", or NaN if it isn't one. */
function civilDateToUtcMs(dateStr: string): number {
  if (!CIVIL_DATE_RE.test(dateStr)) return NaN;
  const [y, m, d] = dateStr.split("-").map((n) => Number.parseInt(n, 10));
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-30 and friends, which Date.UTC silently rolls over.
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
 * Read a capture as a list of actionable tasks with optional due dates.
 * SERVER-ONLY — touches GROQ_API_KEY, so it may only be called from an API
 * route.
 *
 * `today` is the caller's IST civil date. It is passed in rather than read here
 * because "what day is it" is an IST question the app answers in exactly one
 * place (lib/date.ts), and a model asked to resolve "friday" needs the same
 * answer the rest of the app would give.
 *
 * THROWS EmptyGenerationError when the call succeeded and produced nothing
 * usable, and a plain Error for a real technical failure. That is the same
 * split the other generators in this file draw, and the caller reports the two
 * differently: an empty answer is the model saying "there is nothing here",
 * which a retry cannot improve on.
 */
export async function splitCaptureIntoTasks(
  capture: string,
  today: string
): Promise<SplitTaskDraft[]> {
  const text = capture.trim();
  if (!text) {
    throw new EmptyGenerationError("Nothing to split.");
  }

  const todayMs = civilDateToUtcMs(today);
  if (Number.isNaN(todayMs)) {
    // A caller bug, not a model failure — fail loudly rather than let the model
    // resolve "tomorrow" against a date nobody supplied.
    throw new Error("splitCaptureIntoTasks: `today` must be YYYY-MM-DD.");
  }
  const todayWeekday = WEEKDAY_NAMES[new Date(todayMs).getUTCDay()];

  const systemPrompt = `You turn a quick capture typed into a productivity app into a list of tasks.

Today is ${today} (${todayWeekday}).

Return ONLY a JSON object of this exact shape:
{"tasks":[{"title":"Call mom","due_date":"2026-09-01"},{"title":"Submit the report","due_date":null}]}

Rules:
- ONE object per distinct actionable item.
- If the text does NOT actually describe more than one distinct actionable item, return a SINGLE-item array. Do not force a split that does not make sense. "buy milk and eggs and bread" is ONE shopping task, not three. "call mom and submit the report" is two.
- title: a short imperative task name in sentence case. Strip the date words out of it — "call mom tomorrow" has the title "Call mom", not "Call mom tomorrow". Never invent a task the text does not contain.
- due_date: a plain calendar date as "YYYY-MM-DD", or null.
- Use null whenever the text does not actually state when the item is due. NEVER guess a date, never default to today, and never add a date just because the other items have one.
- Resolve relative dates against today (${today}): "today" is ${today}, "tomorrow" is the next day, a bare weekday name is the NEXT occurrence of that weekday, "next week" is seven days ahead.
- Never return a date before ${today}.
- NEVER output a time, a timezone, or a full timestamp. Date only.
- Return at most ${MAX_SPLIT_TASKS} items, the most important ones first.
- Return the JSON object only. No prose, no markdown fences.`;

  let content: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.slice(0, MAX_SOURCE_CHARS) },
      ],
      // 0: the same input should split the same way twice. This is an
      // extraction, not a piece of writing.
      temperature: 0,
      max_tokens: MAX_TOKENS_TASK_SPLIT,
      response_format: { type: "json_object" },
    });
    content = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq generate error (task split):", err);
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // json_object mode makes this unlikely, but a completion truncated at the
    // token ceiling lands here. A technical failure, not an empty answer — the
    // caller degrades to the literal task either way, and says which happened.
    throw new Error("AI returned invalid JSON.");
  }

  const items = (parsed as { tasks?: unknown })?.tasks;
  if (!Array.isArray(items)) {
    throw new Error("AI returned unexpected format.");
  }

  const drafts = items
    .filter(
      (t): t is Record<string, unknown> => typeof t === "object" && t !== null
    )
    .map((t): SplitTaskDraft | null => {
      const title = typeof t.title === "string" ? t.title.trim() : "";
      // A task with no title is not a task. Dropped rather than patched from
      // the raw capture, which would silently duplicate a sibling item.
      if (!title) return null;

      const raw = typeof t.due_date === "string" ? t.due_date.trim() : "";
      const ms = raw ? civilDateToUtcMs(raw) : NaN;
      // Anything that isn't a real calendar date in a sane window becomes null.
      // A wrong date is worse than no date: it puts the task in the agenda on a
      // day the user never asked for, where an undated task is simply undated.
      // A past date is caught here too — it can only be a resolution error,
      // since the prompt forbids one.
      const dueDate =
        !Number.isNaN(ms) &&
        ms >= todayMs &&
        ms <= todayMs + MAX_SPLIT_DUE_DAYS * 86_400_000
          ? raw
          : null;

      return { title: title.slice(0, MAX_SPLIT_TITLE_CHARS), due_date: dueDate };
    })
    .filter((t): t is SplitTaskDraft => t !== null);

  if (drafts.length === 0) {
    throw new EmptyGenerationError("Nothing actionable found in that capture.");
  }

  return drafts;
}
