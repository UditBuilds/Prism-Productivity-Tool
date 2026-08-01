import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const MODEL = "llama-3.3-70b-versatile";

/**
 * Output cap. A 12-exercise / 44-set session measured 937 completion tokens,
 * so 2000 leaves roughly double the headroom for the longest realistic single
 * capture. Set explicitly because this endpoint is called several times per
 * gym session — an unbounded completion on a pathological input would be both
 * slow and expensive.
 */
const MAX_TOKENS = 2000;

/** Longest raw_input we will send to the model (and store). */
export const MAX_RAW_INPUT_LENGTH = 2000;

const LB_TO_KG = 0.45359237;

/**
 * The prompt is verbatim what was validated against 14 gym-shorthand inputs
 * before this feature was built. Two rules carry most of the weight:
 *
 * 1. "One object per SET" — the model expands "3x5" into three rows itself.
 *    Asking for {sets: 3, reps: 5} and expanding in code was rejected because
 *    real input mixes forms ("100x5, 100x5, 110x3" is three different sets).
 * 2. "NEVER convert between units" — the model reports the number and unit as
 *    written and lbToKg() does the arithmetic. LLM unit conversion is the
 *    single most likely place for a silently wrong number.
 */
const SYSTEM_PROMPT = `You convert gym shorthand into structured workout sets. You return JSON only.

Output this exact JSON shape:
{"sets":[{"exercise":"Bench Press","weight":80,"unit":"kg","reps":5}]}

Rules:
- Emit ONE object per SET ACTUALLY PERFORMED. "3x5 @ 80kg" is THREE objects, not one.
- "5 sets of 5", "5x5", "5 x 5", and "5,5,5,5,5" all mean repeated sets — expand every one.
- Notation "AxB" means A sets of B reps. Notation "WxR" where W is clearly a weight
  (e.g. "100x5", "225 lb x 5") means one set of R reps at weight W.
- Keep the sets in the order they were performed.
- exercise: expand abbreviations into a conventional Title Case name
  (ohp -> Overhead Press, bb -> Barbell, db -> Dumbbell, rdl -> Romanian Deadlift,
   bp -> Bench Press, sq -> Squat, dl -> Deadlift, pd -> Pulldown).
  Always use the SINGULAR form of the name: "Squat" not "Squats", "Pull Up" not
  "Pull Ups", "Curl" not "Curls", "Calf Raise" not "Calf Raises".
  Never invent an exercise that is not in the input.
- weight: the number only, no unit text. Use null for bodyweight or when no weight is stated.
- unit: "kg" or "lb", exactly as the user stated or implied. null when weight is null.
  When a weight is given with no unit, use "kg".
- NEVER convert between units yourself. Report the number and the unit as written.
- reps: integer reps for that set. null when reps are not stated (e.g. a timed hold).
- Ignore anything that is not resistance-training sets: cardio, distances, feelings, notes.
- If the input contains no workout sets at all, return {"sets":[]}.
- Return the JSON object only. No prose, no markdown fences.`;

/** One parsed set, already normalised to kilograms. */
export interface ParsedWorkoutSet {
  exercise: string;
  weight_kg: number | null;
  reps: number | null;
}

function lbToKg(lb: number): number {
  // 2dp: heavier than gram precision is noise, and the column is numeric.
  return Math.round(lb * LB_TO_KG * 100) / 100;
}

function toFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Map whatever the model put in `unit` onto the two units we actually handle.
 *
 * The prompt asks for exactly "kg" or "lb" and the model mostly complies, but
 * not reliably: "Squats 100 kgs 5 reps" comes back with unit "kgs" while every
 * other kg input in the same run returns "kg". That drift is harmless on the
 * kg side, because unrecognised units fall through to kg anyway — but the
 * previous code compared `unit === "lb"` exactly, so the same drift on the
 * pound side ("lbs", "pounds") would have silently stored pounds as
 * kilograms, a 2.2x error with no failure anywhere to catch it.
 *
 * Measured: "Deadlift 225 lbs 5 reps 3 sets" DID return "lb" and converted
 * correctly, so this is hardening against an observed class of drift rather
 * than a reproduced corruption. Prefix matching costs nothing and removes the
 * whole class. Same reasoning as not letting the model do the arithmetic.
 *
 * Returns null for anything unrecognised; the caller treats null as kg, which
 * matches the prompt's "weight with no unit means kg".
 */
function normalizeUnit(raw: unknown): "kg" | "lb" | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  if (u.startsWith("lb") || u.startsWith("pound")) return "lb";
  if (u.startsWith("kg") || u.startsWith("kilo")) return "kg";
  return null;
}

/**
 * Turn one raw shorthand capture into ordered sets. SERVER-ONLY — touches
 * GROQ_API_KEY, so it may only be called from an API route.
 *
 * Returns [] rather than throwing when the input holds no sets ("run 5k"), so
 * the caller can still persist the raw text. It DOES throw when Groq itself
 * fails or returns unusable JSON; POST /api/workouts catches that and falls
 * back to a single unparsed row. The raw input is never lost either way.
 */
export async function parseWorkoutInput(
  rawInput: string
): Promise<ParsedWorkoutSet[]> {
  const text = rawInput.trim();
  if (!text) return [];

  let content: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, MAX_RAW_INPUT_LENGTH) },
      ],
      temperature: 0,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    });
    content = (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("Groq workout parse error:", err);
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // response_format json_object makes this very unlikely, but a truncated
    // completion would land here — treat it as a parse failure, not as "no
    // sets", so the caller stores the raw row instead of silently dropping.
    throw new Error("AI returned invalid JSON.");
  }

  const sets = (parsed as { sets?: unknown })?.sets;
  if (!Array.isArray(sets)) {
    throw new Error("AI returned unexpected format.");
  }

  return sets
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s): ParsedWorkoutSet | null => {
      const exercise =
        typeof s.exercise === "string" ? s.exercise.trim() : "";
      // An exercise name is the minimum for a row to mean anything.
      if (!exercise) return null;

      const weight = toFiniteNumber(s.weight);
      const unit = normalizeUnit(s.unit);
      const reps = toFiniteNumber(s.reps);

      return {
        exercise: exercise.slice(0, 120),
        weight_kg:
          weight === null || weight <= 0
            ? null
            : unit === "lb"
              ? lbToKg(weight)
              : Math.round(weight * 100) / 100,
        reps: reps === null || reps <= 0 ? null : Math.round(reps),
      };
    })
    .filter((s): s is ParsedWorkoutSet => s !== null);
}
