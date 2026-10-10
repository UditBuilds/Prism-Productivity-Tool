/**
 * Every model answer in Learning is JSON, checked against a schema (Udit,
 * 2026-10-10). Pure: the schemas live next to their prompts (plan.ts,
 * passages.ts, writer-prompt.ts, judge.ts); this file holds the shapes and
 * the one checker they all go through.
 *
 * Why: labelled text failed SILENTLY twice. The copier wrote "[source 1] ```"
 * where "CODE [source 1]" was asked for, and every code block was lost; then
 * it wrote "**TERMS:**", the regex missed it, and the lesson ran with no key
 * terms at all. Both runs carried on as if nothing were wrong. A JSON answer
 * either matches its schema here or the call fails with the field that is
 * wrong and the raw answer kept for the log.
 *
 * Groq's strict mode (json_schema, strict: true) decodes against the schema,
 * so a well-formed answer is the normal case — but only the plain subset
 * below is enforced while decoding. A keyword outside it (maxItems,
 * minLength, pattern) is checked by Groq AFTER generation and turns a long
 * answer into HTTP 400 instead of a shorter one (measured 2026-10-10), so the
 * schemas use none: counts and lengths are checked in code.
 */

export type Schema =
  | { type: "string"; enum?: string[]; description?: string }
  | { type: "integer"; description?: string }
  | { type: ["string", "null"]; description?: string }
  | { type: ["integer", "null"]; description?: string }
  | { type: "array"; items: Schema; description?: string }
  | ObjectSchema;

/** A type, not an interface, so it can be passed where groq-sdk wants a plain JSON object. */
export type ObjectSchema = {
  type: "object";
  properties: Record<string, Schema>;
  /** Strict mode: every property is required (a missing value is null instead). */
  required: string[];
  additionalProperties: false;
  description?: string;
};

/** A model answer that cannot be used. `raw` is the answer exactly as it came back. */
export class AnswerError extends Error {
  constructor(
    /** "cut_off": it ended before it was complete. "format": it does not match its schema. */
    readonly kind: "cut_off" | "format",
    /** Which answer, in words: "the copier's answer". */
    readonly what: string,
    readonly reason: string,
    readonly raw: string
  ) {
    super(`${what}: ${reason}`);
    this.name = "AnswerError";
  }
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}

/** The first way `value` breaks `schema`, as "path: what is wrong"; null when it matches. */
export function schemaProblem(value: unknown, schema: Schema, path = "answer"): string | null {
  if (Array.isArray(schema.type)) {
    if (value === null) return null;
    const inner = schema.type[0] === "string" ? { type: "string" as const } : { type: "integer" as const };
    return schemaProblem(value, inner, path);
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return `${path} must be text, not ${describe(value)}`;
      if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}, not "${value.slice(0, 40)}"`;
      return null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? null : `${path} must be a whole number, not ${describe(value)}`;
    case "array": {
      if (!Array.isArray(value)) return `${path} must be a list, not ${describe(value)}`;
      for (let i = 0; i < value.length; i++) {
        const p = schemaProblem(value[i], schema.items, `${path}[${i}]`);
        if (p) return p;
      }
      return null;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path} must be an object, not ${describe(value)}`;
      const rec = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in rec)) return `${path}.${key} is missing`;
      }
      for (const key of Object.keys(rec)) {
        const sub = schema.properties[key];
        if (!sub) return `${path} has a field it should not have: "${key.slice(0, 40)}"`;
        const p = schemaProblem(rec[key], sub, `${path}.${key}`);
        if (p) return p;
      }
      return null;
    }
  }
}

/**
 * Parse and check one answer. Throws AnswerError("format") with the reason
 * and the raw text; never returns a partial value.
 */
export function readAnswer<T>(raw: string, schema: ObjectSchema, what: string): T {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AnswerError("format", what, "it is not JSON", raw);
  }
  const problem = schemaProblem(value, schema);
  if (problem) throw new AnswerError("format", what, problem, raw);
  return value as T;
}
