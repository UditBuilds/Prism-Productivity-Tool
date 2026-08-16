/**
 * Where a dashboard capture goes, decided from the text alone.
 *
 * DETERMINISTIC BY CONSTRUCTION — no LLM, no heuristic, no pattern sniffing.
 * Three literal prefixes and a default. The reasons this is not a matcher:
 *
 *  - It must work offline. A classifier that needs the network would make the
 *    one field on the page that is supposed to always accept input the one
 *    field that stops working in a gym basement.
 *  - A guess that is right 90% of the time files 1-in-10 captures somewhere the
 *    user will not look for them. A prefix is wrong only when mistyped, and
 *    then visibly so — the confirmation names the destination.
 *
 * The workout branch routes RAW TEXT. Parsing gym shorthand into sets is a
 * server concern (POST /api/workouts runs it inside the request), so routing
 * and parsing are separable: this decides the table, the server decides the
 * numbers, and an offline capture replays through the same single request.
 */

export type CaptureDestination = "notes" | "workouts" | "tasks";

export interface CaptureRoute {
  destination: CaptureDestination;
  /** The text actually written, with any prefix stripped. Never empty. */
  body: string;
}

/** Human name for the destination, for the inline confirmation. */
export const CAPTURE_DESTINATION_LABEL: Record<CaptureDestination, string> = {
  notes: "notes",
  workouts: "workouts",
  tasks: "tasks",
};

const PREFIXES: ReadonlyArray<{ prefix: string; destination: CaptureDestination }> =
  [
    { prefix: "/n", destination: "notes" },
    { prefix: "/w", destination: "workouts" },
  ];

/**
 * Resolve raw input to a destination and the body to write.
 *
 * Returns null when there is nothing to submit — empty input, or a bare
 * prefix with no body ("/n"). A bare prefix deliberately does NOT fall through
 * to the task branch: creating a task literally titled "/n" is never what
 * someone mid-keystroke meant, and silently doing it is exactly the kind of
 * misrouting the confirmation line exists to prevent.
 *
 * Prefix matching requires the separator (`/n ` not `/n`) so a note that
 * genuinely starts with "/note to self" is not swallowed by the note branch
 * and then double-stripped.
 */
export function routeCapture(raw: string): CaptureRoute | null {
  const text = raw.trim();
  if (!text) return null;

  for (const { prefix, destination } of PREFIXES) {
    if (text === prefix) return null; // bare prefix, nothing to write yet
    if (text.startsWith(`${prefix} `)) {
      const body = text.slice(prefix.length).trim();
      return body ? { destination, body } : null;
    }
  }

  return { destination: "tasks", body: text };
}
