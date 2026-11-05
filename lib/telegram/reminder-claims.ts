import type { SupabaseClient } from "@supabase/supabase-js";

import { clip } from "@/lib/telegram/format";
import type { Database } from "@/types/database";

/**
 * At most one Telegram message per reminder, however the every-minute cron
 * (app/api/push/due/route.ts) overlaps or dies.
 *
 * The cron selects due reminders, sends, then marks them sent — with nothing
 * in between to stop two overlapping runs doing the same. For the OWNER's
 * Telegram reminders this table closes that gap:
 *
 *   1. CLAIM before any send: insert (reminder_id) ON CONFLICT DO NOTHING.
 *      Only the run whose insert lands holds the reminder; the other skips
 *      it entirely, on every channel.
 *   2. RECORD telegram_message_id the moment Telegram accepts the message.
 *   3. A run that crashed leaves its claim behind. After CLAIM_TAKEOVER_MS a
 *      later run may take it over (compare-and-swap on claimed_at, so two
 *      takers cannot both win). If the claim already has a
 *      telegram_message_id, Telegram was delivered: the taker marks the
 *      reminder delivered and sends NOTHING.
 *   4. A run that delivered nothing RELEASES its claim, so the next minute
 *      retries exactly as the cron always has.
 *
 * Every call filters on the reminder's user_id as well as its id: this runs
 * under the service role.
 */

type Db = SupabaseClient<Database>;

/** A claim older than this is presumed abandoned by a crashed run. */
export const CLAIM_TAKEOVER_MS = 5 * 60 * 1000;

export type ClaimResult =
  /** This run holds the reminder. `telegramMessageId` set = already delivered. */
  | { kind: "held"; claimId: string; telegramMessageId: number | null }
  /** Another run holds a fresh claim: leave this reminder alone. */
  | { kind: "busy" }
  /** The claims table could not be used. The caller falls back to web push. */
  | { kind: "unavailable"; reason: string };

export async function claimReminder(
  db: Db,
  reminder: { id: string; user_id: string },
  nowMs: number
): Promise<ClaimResult> {
  const nowIso = new Date(nowMs).toISOString();

  const { data: inserted, error } = await db
    .from("reminder_send_claims")
    .upsert(
      { user_id: reminder.user_id, reminder_id: reminder.id, claimed_at: nowIso },
      { onConflict: "reminder_id", ignoreDuplicates: true }
    )
    .select("id, telegram_message_id");
  if (error) return { kind: "unavailable", reason: `claim insert: ${error.message}` };
  if (inserted && inserted.length > 0) {
    return { kind: "held", claimId: inserted[0].id, telegramMessageId: null };
  }

  const { data: existing, error: readError } = await db
    .from("reminder_send_claims")
    .select("id, claimed_at, telegram_message_id")
    .eq("reminder_id", reminder.id)
    .eq("user_id", reminder.user_id)
    .maybeSingle();
  if (readError) return { kind: "unavailable", reason: `claim read: ${readError.message}` };
  // Released between our insert and this read: the next tick picks it up.
  if (!existing) return { kind: "busy" };
  if (nowMs - Date.parse(existing.claimed_at) < CLAIM_TAKEOVER_MS) return { kind: "busy" };

  // Stale: take it over, but only if nobody else just did.
  const { data: taken, error: takeError } = await db
    .from("reminder_send_claims")
    .update({ claimed_at: nowIso })
    .eq("id", existing.id)
    .eq("user_id", reminder.user_id)
    .eq("claimed_at", existing.claimed_at)
    .select("id, telegram_message_id");
  if (takeError) return { kind: "unavailable", reason: `claim takeover: ${takeError.message}` };
  if (!taken || taken.length === 0) return { kind: "busy" };
  return { kind: "held", claimId: taken[0].id, telegramMessageId: taken[0].telegram_message_id };
}

/** Telegram accepted the message: from now on, no run may send it again. */
export async function recordTelegramDelivery(
  db: Db,
  claimId: string,
  userId: string,
  telegramMessageId: number
): Promise<void> {
  const { error } = await db
    .from("reminder_send_claims")
    .update({ telegram_message_id: telegramMessageId })
    .eq("id", claimId)
    .eq("user_id", userId);
  if (error) {
    console.error(`[push-due] Telegram delivery not recorded on claim ${claimId}: ${error.message}`);
  }
}

/** Nothing was delivered: let the next tick try again, as it always has. */
export async function releaseClaim(db: Db, claimId: string, userId: string): Promise<void> {
  const { error } = await db
    .from("reminder_send_claims")
    .delete()
    .eq("id", claimId)
    .eq("user_id", userId);
  if (error) {
    // Not lost: CLAIM_TAKEOVER_MS from now a run takes the claim over.
    console.error(`[push-due] claim ${claimId} not released: ${error.message}`);
  }
}

/** The reminder as a Telegram message. */
export function renderReminderMessage(title: string, body: string | null): string {
  const lines = [`🔔 <b>${clip(title, 200)}</b>`];
  if (body && body.trim()) lines.push(clip(body, 1000));
  return lines.join("\n");
}
