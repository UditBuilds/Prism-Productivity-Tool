import { del, get, keys, set } from "idb-keyval";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

/**
 * Snapshots are keyed PER USER so a shared browser can never restore one
 * account's data into another's session. The pre-scoping release used the
 * bare prefix as a single shared key — clearPersistedCaches() and the
 * legacy sweep below remove it.
 */
const IDB_KEY_PREFIX = "prism-query-cache";

function idbKeyForUser(userId: string): string {
  return `${IDB_KEY_PREFIX}:${userId}`;
}

/**
 * Only these caches are written to IndexedDB for offline reloads. Everything
 * else (calendar, reminders, countdowns, mood, focus sessions, analytics,
 * push subscriptions) is time-sensitive or server-computed and stays
 * network-only on purpose.
 */
export const PERSISTED_QUERY_KEYS: ReadonlySet<string> = new Set([
  "tasks",
  "notes",
  "plans",
  "srs-cards",
  "focus-categories",
]);

/**
 * IndexedDB-backed persister (async, and a far larger quota than
 * localStorage), scoped to one user's snapshot. All operations swallow
 * failures — private-mode or quota errors must degrade to "no persistence",
 * never break the app.
 */
export function createIDBPersister(userId: string): Persister {
  const idbKey = idbKeyForUser(userId);
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set(idbKey, client);
      } catch {
        // Ignore — persistence is best-effort.
      }
    },
    restoreClient: async () => {
      try {
        return await get<PersistedClient>(idbKey);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del(idbKey);
      } catch {
        // Ignore.
      }
    },
  };
}

/**
 * Delete EVERY persisted snapshot (all users' keys plus the legacy shared
 * key). Called on logout: once nobody is signed in on this browser, no
 * account's data may remain readable in IndexedDB.
 */
export async function clearPersistedCaches(): Promise<void> {
  try {
    const allKeys = await keys();
    const ours = allKeys.filter(
      (k) => typeof k === "string" && k.startsWith(IDB_KEY_PREFIX)
    );
    await Promise.all(ours.map((k) => del(k)));
  } catch {
    // Ignore — worst case the per-user keying still prevents cross-user reads.
  }
}

/**
 * One-time migration: drop the legacy SHARED snapshot key from before
 * per-user scoping. It carries no owner marker, so it must never be
 * restored for anyone.
 */
export async function dropLegacySharedCache(): Promise<void> {
  try {
    await del(IDB_KEY_PREFIX);
  } catch {
    // Ignore.
  }
}
