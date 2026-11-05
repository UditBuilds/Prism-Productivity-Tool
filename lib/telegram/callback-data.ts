/**
 * Button payloads. Telegram limits callback_data to 64 BYTES, so a button
 * carries only "<namespace>:<action>:<uuid>" (40 bytes) and everything else
 * is read from the database when it is tapped.
 *
 * Namespaces, one per feature, each routed to its own handler by
 * lib/telegram/callbacks.ts:
 *   p — today's plan:   a = Looks good (plan id), m = move, d = drop (item id)
 *   c — a capture:      s = Save, x = Cancel (capture id)
 * Later phases add their own letter here.
 */

const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CALLBACK_RE = new RegExp(`^([a-z]):([a-z]):(${UUID_SRC})$`, "i");

export const MAX_CALLBACK_BYTES = 64;

export type PlanAction = "a" | "m" | "d";
export type CaptureAction = "s" | "x";

export interface ParsedCallback {
  namespace: string;
  action: string;
  id: string;
}

export function planCallbackData(action: PlanAction, id: string): string {
  return `p:${action}:${id}`;
}

export function captureCallbackData(action: CaptureAction, id: string): string {
  return `c:${action}:${id}`;
}

/** null for anything that is not exactly "<letter>:<letter>:<uuid>". */
export function parseCallbackData(data: string | undefined): ParsedCallback | null {
  if (!data) return null;
  const m = CALLBACK_RE.exec(data);
  if (!m) return null;
  return { namespace: m[1], action: m[2], id: m[3].toLowerCase() };
}
