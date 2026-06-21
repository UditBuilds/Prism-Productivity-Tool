import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const MODEL = "llama-3.3-70b-versatile";

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

Note title: ${noteTitle}
Note content: ${noteContent}

JSON array:`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
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
    throw new Error("No valid cards generated. Try again.");
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

  const userContent = `Title: ${videoTitle}\n\nTranscript excerpt:\n${transcriptChunk}`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.5,
    });
    text = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq generate error (notes from transcript):", err);
    throw err;
  }

  if (!text) {
    throw new Error("No note content was generated.");
  }
  return text;
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

  const userContent = `Video title: ${videoTitle}\n\nTranscript excerpt:\n${transcriptChunk}`;

  let text: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
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
    throw new Error("No valid cards generated. Try again.");
  }

  return cards;
}
