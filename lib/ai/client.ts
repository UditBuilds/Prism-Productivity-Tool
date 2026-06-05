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
  noteContent: string
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
3. Generate 4-8 cards based on note complexity.
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
