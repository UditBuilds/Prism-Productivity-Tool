import { json } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { istDateString } from "@/lib/date";
import { ensureDailyPlan } from "@/lib/daily-plan/server";
import { activePlanItems } from "@/lib/daily-plan/view";
import { sendPushToUser } from "@/lib/push/send";
import { createTelegramApi } from "@/lib/telegram/client";
import {
  readNotifyChannel,
  readTelegramEnv,
  wantsTelegram,
  type NotifyChannel,
  type TelegramEnv,
} from "@/lib/telegram/env";
import { renderPlanMessage } from "@/lib/telegram/plan-message";

/** One Groq call per planner user (8s timeout) plus a push per device. */
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserOutcome {
  user_id: string;
  plan_id: string | null;
  created: boolean;
  /** Why no push went out, when none did. */
  skipped?: "already_notified" | "already_accepted" | "nothing_planned" | "error";
  push_sent?: number;
  push_failed?: number;
  /** The owner's Telegram plan message, when one was attempted. */
  telegram?: "sent" | "failed";
}

/** Where the owner's 11:00 notification goes. Read once per run. */
interface NotifyConfig {
  channel: NotifyChannel;
  /** null = the bot is not configured; everyone gets web push. */
  telegram: TelegramEnv | null;
}

/**
 * POST /api/cron/daily-plan — Supabase Cron, 05:30 UTC = 11:00 IST.
 *
 * For every user with at least one ACTIVE anchor (and nobody else — the
 * planner is opt-in by data, and other accounts on this project have push
 * devices): make sure today's plan exists, then push "Your plan for today is
 * ready", which opens /dashboard where the plan sits at the top.
 *
 * `?user_id=<uuid>` limits the run to one user. It exists so a manual test
 * can never build or push anyone else's plan; it needs the cron secret like
 * everything else here.
 *
 * NO DOUBLE PUSH. `notified_at` is CLAIMED with a conditional update before
 * the send, so a re-run, a manual trigger or two overlapping invocations
 * produce one notification at most. The trade is deliberate: if the function
 * dies between the claim and the send, that day's push is lost rather than
 * possibly sent twice. The plan itself still exists, and opening Prism shows it.
 *
 * The counts written after the send are what the push SERVICE accepted
 * (lib/push/send.ts), which is the database proof of delivery this route can
 * give. Whether iOS surfaced it is only visible on the phone.
 *
 * TELEGRAM, FOR THE OWNER ONLY. PLAN_NOTIFY_CHANNEL = webpush | telegram |
 * both (unset = both) decides where PRISM_OWNER_USER_ID's notification goes:
 * the plan itself as a Telegram message with Move / Drop / Looks good
 * buttons (lib/telegram/plan-message.ts), the web push, or both. It is sent
 * under the same notified_at claim, so a re-run sends neither twice. If the
 * flag says telegram and the Telegram send fails, the web push goes out
 * instead and the reason is logged — the morning is never silent because of
 * the bot. Every other user gets web push exactly as before, whatever the
 * flag says, and their outcome JSON is unchanged.
 */
export async function POST(request: Request) {
  // Secret first, before any DB call; a failure writes nothing (callers
  // control the rate). Don't add logging to this branch.
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return json({ data: null, error: "Unauthorized" }, 401);
  }

  const onlyUser = new URL(request.url).searchParams.get("user_id");
  if (onlyUser !== null && !UUID_RE.test(onlyUser)) {
    return json({ data: null, error: "Invalid user_id" }, 400);
  }

  // Service role: must read every planner user's anchors and tasks.
  // ensureDailyPlan filters every query on user_id itself.
  const supabase = createAdminClient();
  const planDate = istDateString();

  let anchorQuery = supabase
    .from("plan_anchors")
    .select("user_id")
    .eq("is_active", true);
  if (onlyUser) anchorQuery = anchorQuery.eq("user_id", onlyUser);
  const { data: anchorRows, error: anchorError } = await anchorQuery;
  if (anchorError) return json({ data: null, error: anchorError.message }, 500);

  const userIds = Array.from(new Set((anchorRows ?? []).map((r) => r.user_id)));
  const outcomes: UserOutcome[] = [];

  const planChannel = readNotifyChannel(process.env.PLAN_NOTIFY_CHANNEL);
  if (!planChannel.valid) {
    console.warn("[daily-plan cron] PLAN_NOTIFY_CHANNEL is not webpush|telegram|both; using both");
  }
  const notify: NotifyConfig = { channel: planChannel.channel, telegram: readTelegramEnv() };

  // Sequential: a handful of users, and parallel Groq calls would only race
  // each other for the same per-minute token budget.
  for (const userId of userIds) {
    try {
      outcomes.push(await planAndNotify(supabase, userId, planDate, notify));
    } catch (err) {
      // One user's failure must not cost the others their plan.
      console.error(`[daily-plan cron] user ${userId} failed`, err);
      outcomes.push({ user_id: userId, plan_id: null, created: false, skipped: "error" });
    }
  }

  return json<{ plan_date: string; users: UserOutcome[] }>({
    data: { plan_date: planDate, users: outcomes },
    error: null,
  });
}

async function planAndNotify(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  planDate: string,
  notify: NotifyConfig
): Promise<UserOutcome> {
  const { view, plan, created } = await ensureDailyPlan(supabase, userId, planDate);
  if (!plan) return { user_id: userId, plan_id: null, created: false, skipped: "nothing_planned" };

  const base = { user_id: userId, plan_id: plan.id, created };
  if (plan.notified_at) return { ...base, skipped: "already_notified" };
  // Opened and accepted before 11:00 — "your plan is ready" would be noise.
  if (plan.accepted_at) return { ...base, skipped: "already_accepted" };

  const items = activePlanItems(view.items);
  if (items.length === 0) return { ...base, skipped: "nothing_planned" };

  // Claim the notification. Only the call that flips NULL → now sends.
  const { data: claimed, error: claimError } = await supabase
    .from("daily_plans")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", plan.id)
    .eq("user_id", userId)
    .is("notified_at", null)
    .select("id");
  if (claimError) throw new Error(`notify claim: ${claimError.message}`);
  if (!claimed || claimed.length === 0) return { ...base, skipped: "already_notified" };

  // The owner's Telegram message, when the flag asks for one.
  let telegram: "sent" | "failed" | undefined;
  let pushNeeded = true;
  const bot = notify.telegram;
  if (bot && bot.ownerUserId === userId && wantsTelegram(notify.channel)) {
    try {
      const { text, keyboard } = renderPlanMessage(view);
      await createTelegramApi(bot.botToken).sendMessage(bot.allowedChatId, text, keyboard);
      telegram = "sent";
    } catch (err) {
      telegram = "failed";
      console.error(
        `[daily-plan cron] Telegram plan message failed for plan ${plan.id}: ${
          err instanceof Error ? err.message : String(err)
        }${notify.channel === "telegram" ? " — sending the web push instead" : ""}`
      );
    }
    // "both" always pushes; "telegram" pushes only when Telegram failed.
    pushNeeded = notify.channel === "both" || telegram === "failed";
  } else if (notify.channel === "telegram" && !bot) {
    console.warn("[daily-plan cron] PLAN_NOTIFY_CHANNEL=telegram but the bot is not configured; sending web push");
  }
  if (!pushNeeded) return { ...base, telegram };

  const first = items[0].title;
  const body =
    items.length === 1
      ? `${first}. Tap to confirm.`
      : `${first} first, then ${items.length - 1} more. Tap to confirm.`;

  const { sent, failed } = await sendPushToUser(userId, {
    title: "Your plan for today is ready",
    body,
    url: "/dashboard",
  });

  // AWAITED: an un-awaited write can be dropped when the instance freezes
  // after the response is sent.
  const { error: countError } = await supabase
    .from("daily_plans")
    .update({ push_sent: sent, push_failed: failed })
    .eq("id", plan.id)
    .eq("user_id", userId);
  if (countError) {
    console.error(`[daily-plan cron] push counts not saved for ${plan.id}`, countError);
  }

  return {
    ...base,
    push_sent: sent,
    push_failed: failed,
    ...(telegram ? { telegram } : {}),
  };
}
