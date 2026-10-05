// Environment wiring for Instagram publishing. SERVER-ONLY — reads the Meta
// app secret and a Page access token, neither of which may ever reach a client
// bundle. Nothing in this file performs network I/O.

import { InstagramError } from "./errors";

/**
 * Graph API version pinned by default, overridable by META_GRAPH_API_VERSION.
 *
 * v26.0 was the latest version on 2026-09-10 (released 2026-07-29). Meta ships
 * a new version roughly quarterly and retires each one about two years later,
 * so this WILL go stale — it is a default, not a constant to trust forever.
 * Pinning beats calling an unversioned endpoint: unversioned requests are
 * served by the oldest available version, which is the one closest to removal.
 */
export const DEFAULT_GRAPH_VERSION = "v26.0";

export const GRAPH_BASE_URL = "https://graph.facebook.com";

/** The four credentials this module cannot run without, in report order. */
export const REQUIRED_ENV_VARS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "IG_BUSINESS_ACCOUNT_ID",
  "META_PAGE_ACCESS_TOKEN",
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export interface InstagramConfig {
  appId: string;
  appSecret: string;
  /** The IG Business/Creator account id — the {ig-user-id} in every path. */
  igUserId: string;
  pageAccessToken: string;
  graphVersion: string;
}

export interface InstagramConfigResult {
  config: InstagramConfig | null;
  /** Exactly which required variables are absent or empty. */
  missing: RequiredEnvVar[];
}

/**
 * Read the Meta credentials without throwing, reporting precisely which ones
 * are absent.
 *
 * A variable set to an empty string counts as MISSING. That is not pedantry:
 * `META_APP_SECRET=` in a .env file produces a defined-but-empty value, which
 * would otherwise sail past a truthiness check on `!== undefined` and fail far
 * downstream as an opaque Meta auth error instead of "you didn't set this".
 *
 * ⚠️ Ambient shell variables win over .env.local. `@next/env` (dotenv) does not
 * override a name already present in process.env, and this repo has been bitten
 * by exactly that once already: an ambient, invalid GROQ_API_KEY shadowed the
 * good key in .env.local and made every Groq call fail 401 while the file on
 * disk looked correct. If a token here is rejected but .env.local looks right,
 * check `Object.hasOwn(process.env, "META_PAGE_ACCESS_TOKEN")` in the shell that
 * launched the server BEFORE editing anything.
 */
export function readInstagramConfig(): InstagramConfigResult {
  const missing: RequiredEnvVar[] = [];
  const values: Record<string, string> = {};

  for (const name of REQUIRED_ENV_VARS) {
    const raw = process.env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      missing.push(name);
      continue;
    }
    values[name] = value;
  }

  if (missing.length > 0) return { config: null, missing };

  const version = (process.env.META_GRAPH_API_VERSION ?? "").trim();

  return {
    missing: [],
    config: {
      appId: values.META_APP_ID,
      appSecret: values.META_APP_SECRET,
      igUserId: values.IG_BUSINESS_ACCOUNT_ID,
      pageAccessToken: values.META_PAGE_ACCESS_TOKEN,
      graphVersion: version || DEFAULT_GRAPH_VERSION,
    },
  };
}

/**
 * Same read, but throws a typed NOT_CONFIGURED error naming the missing
 * variables. The names are safe to surface: they are variable NAMES, never
 * values, and knowing which credential is unset is the whole content of the
 * error.
 */
export function requireInstagramConfig(): InstagramConfig {
  const { config, missing } = readInstagramConfig();
  if (!config) {
    throw new InstagramError(
      "NOT_CONFIGURED",
      `Instagram publishing is not configured — missing ${missing.join(", ")}`
    );
  }
  return config;
}

/**
 * App access token, the `{app-id}|{app-secret}` form Meta accepts in place of a
 * user token for app-level endpoints. GET /debug_token requires one, which is
 * the reason META_APP_ID and META_APP_SECRET are required rather than decorative.
 *
 * Treat the return value as a SECRET — it embeds the app secret verbatim and
 * grants app-level access. It must never be logged or put in a URL query string.
 */
export function appAccessToken(config: InstagramConfig): string {
  return `${config.appId}|${config.appSecret}`;
}
