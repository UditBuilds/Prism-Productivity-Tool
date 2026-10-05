// Typed error + Meta error-envelope mapping for the Instagram module.
//
// The contract mirrors YoutubeExtractError (lib/youtube/extract.ts): one error
// class carrying a machine-readable code and a message already fit to show a
// person. Callers map the code; they never parse the message, and they never
// forward a raw exception. No stack trace, no Graph payload, and above all no
// token ever leaves this module.

import {
  INSTAGRAM_ERROR_HINTS,
  type InstagramErrorCode,
} from "./types";

export class InstagramError extends Error {
  code: InstagramErrorCode;
  /** Short recovery hint, safe to render under the message. */
  hint: string;
  /** Meta's numeric error code, when the failure came from Graph. */
  graphCode: number | null;
  /** Meta's fbtrace_id — the only useful thing to quote in a Meta bug report. */
  fbtraceId: string | null;

  constructor(
    code: InstagramErrorCode,
    message: string,
    options: { graphCode?: number | null; fbtraceId?: string | null } = {}
  ) {
    super(message);
    this.name = "InstagramError";
    this.code = code;
    this.hint = INSTAGRAM_ERROR_HINTS[code];
    this.graphCode = options.graphCode ?? null;
    this.fbtraceId = options.fbtraceId ?? null;
  }
}

/** Shape of Meta's error envelope. Every field is treated as untrusted. */
interface GraphErrorEnvelope {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  fbtrace_id?: unknown;
}

/**
 * Strip anything token-shaped out of text bound for a message or a log.
 *
 * Meta echoes request context into some error messages, and an access token in
 * an error string is a credential in a log file. Both long-lived tokens
 * (`EAA...`) and the `{app-id}|{app-secret}` app-token form are redacted.
 *
 * This is defence in depth, not the primary control — the primary control is
 * that this module sends the token in an Authorization header and never in a
 * URL, so it should not appear in an error in the first place.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/EAA[A-Za-z0-9_-]{10,}/g, "[redacted-token]")
    .replace(/\b\d{6,}\|[A-Za-z0-9_-]{10,}\b/g, "[redacted-app-token]")
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]");
}

/**
 * Map Meta's numeric error code onto our code space.
 *
 * Only codes whose meaning is documented and stable are mapped by number.
 * Everything else becomes GRAPH_ERROR carrying Meta's own message, which is
 * far more useful than a guessed category — a wrong category sends the reader
 * to fix the wrong thing, while an unmapped one at least quotes the truth.
 */
function codeFromGraph(graphCode: number | null): InstagramErrorCode {
  switch (graphCode) {
    // OAuthException family: token expired, revoked, or otherwise not usable.
    case 102:
    case 190:
      return "TOKEN_INVALID";
    // Throttling: app-level (4), user-level (17), page-level (32), custom (613).
    case 4:
    case 17:
    case 32:
    case 613:
      return "RATE_LIMITED";
    // Permission denied / insufficient scope.
    case 10:
    case 200:
      return "PERMISSION_DENIED";
    default:
      return "GRAPH_ERROR";
  }
}

/**
 * Turn a parsed Graph error body into an InstagramError.
 *
 * `status` is accepted but deliberately does NOT drive the mapping. Meta
 * returns 400 for a large share of unrelated failures — an expired token, a
 * missing permission and a malformed caption all arrive as 400 — so branching
 * on the status code produces confident, wrong categories. The numeric `code`
 * inside the envelope is the field that actually distinguishes them.
 */
export function instagramErrorFromGraph(
  status: number,
  body: unknown
): InstagramError {
  const envelope: GraphErrorEnvelope =
    typeof body === "object" && body !== null && "error" in body
      ? ((body as { error: unknown }).error as GraphErrorEnvelope) ?? {}
      : {};

  const graphCode =
    typeof envelope.code === "number" ? envelope.code : null;
  const fbtraceId =
    typeof envelope.fbtrace_id === "string" ? envelope.fbtrace_id : null;
  const rawMessage =
    typeof envelope.message === "string" && envelope.message.trim()
      ? envelope.message.trim()
      : `Instagram API error (HTTP ${status})`;

  // 429 is unambiguous on its own; every other status defers to the envelope.
  const code =
    status === 429 ? "RATE_LIMITED" : codeFromGraph(graphCode);

  return new InstagramError(code, redactSecrets(rawMessage), {
    graphCode,
    fbtraceId,
  });
}
