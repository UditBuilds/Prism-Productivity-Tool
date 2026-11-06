import { istDateString, istTimeValue } from "@/lib/date";
import {
  NOTHING_TO_SAVE,
  isActionable,
  renderCaptureMessage,
  resolveCapture,
} from "@/lib/telegram/capture";
import { MAX_CAPTURE_INPUT_CHARS } from "@/lib/telegram/capture-schema";
import {
  cancelCapture,
  captureExists,
  insertPendingCapture,
  loadCaptureContext,
  saveCapture,
  setReplyMessageId,
} from "@/lib/telegram/capture-store";
import { captureCallbackData } from "@/lib/telegram/callback-data";
import type { CallbackContext, CallbackHandler } from "@/lib/telegram/callbacks";
import type { BotDeps } from "@/lib/telegram/deps";
import {
  AI_BUSY,
  CANCELLED_REDRAW_FAILED,
  CAPTURE_GONE,
  COULDNT_CANCEL,
  COULDNT_READ,
  EXPIRED_REDRAW_FAILED,
  REDRAW_FAILED,
  TOO_LONG,
} from "@/lib/telegram/messages";
import { tellChat } from "@/lib/telegram/tell-chat";
import type { TgMessage } from "@/lib/telegram/types";

/**
 * Quick capture: any plain text message.
 *
 *   read it (AI) → show what it understood, numbered → [Save] [Cancel]
 *
 * NOTHING is written to tasks or reminders before Save. What it understood is
 * kept in telegram_captures; the buttons carry only that row's id (Telegram
 * allows 64 bytes of button data).
 */
export async function handleCaptureMessage(
  msg: TgMessage,
  text: string,
  deps: BotDeps
): Promise<void> {
  const owner = deps.env.ownerUserId;
  const chatId = msg.chat.id;
  const reply = async (body: string) => {
    await deps.telegram.sendMessage(chatId, body);
  };

  // A redelivered update (Telegram retries until it gets a 200) is read once.
  if (await captureExists(deps.db, owner, chatId, msg.message_id)) return;

  if (text.length > MAX_CAPTURE_INPUT_CHARS) return reply(TOO_LONG);
  if (!deps.ai.allow(owner)) return reply(AI_BUSY);

  const nowMs = deps.now();
  const context = await loadCaptureContext(deps.db, owner, nowMs);

  let items;
  try {
    items = await deps.ai.parseCapture(text, {
      today: istDateString(nowMs),
      weekday: new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
      }).format(new Date(nowMs)),
      clock: istTimeValue(new Date(nowMs).toISOString()),
      tasks: context.promptTasks,
      anchors: context.promptAnchors,
    });
  } catch (err) {
    console.error(
      `[telegram] capture not read: ${err instanceof Error ? err.message : String(err)}`
    );
    return reply(COULDNT_READ);
  }

  const ops = resolveCapture(items, {
    nowMs,
    tasks: context.tasks,
    anchors: context.anchors,
    newId: deps.newId,
  });

  if (ops.length === 0) return reply(NOTHING_TO_SAVE);
  if (!ops.some(isActionable)) return reply(renderCaptureMessage(ops, "nothing", nowMs));

  const captureId = deps.newId();
  const inserted = await insertPendingCapture(deps.db, {
    id: captureId,
    ownerId: owner,
    chatId,
    sourceMessageId: msg.message_id,
    rawText: text,
    ops,
  });
  // A concurrent redelivery stored it first and sends its own confirmation.
  if (!inserted) return;

  const sent = await deps.telegram.sendMessage(
    chatId,
    renderCaptureMessage(ops, "pending", nowMs),
    [
      [
        { text: "Save", callback_data: captureCallbackData("s", captureId) },
        { text: "Cancel", callback_data: captureCallbackData("x", captureId) },
      ],
    ]
  );
  await setReplyMessageId(deps.db, owner, captureId, sent.message_id);
}

/**
 * [Save] / [Cancel] — namespace "c". The tap is answered with no text before
 * this runs, because what happened is only known afterwards. The redrawn
 * message says it; anything a redraw cannot say goes to the chat.
 *
 * A failed Save throws, and the router reports it as COULDNT_SAVE. Nothing here
 * changes what Save or Cancel do (lib/telegram/capture-store.ts).
 */
async function runCaptureCallback(
  { action, id, query }: CallbackContext,
  deps: BotDeps
): Promise<void> {
  const owner = deps.env.ownerUserId;
  const nowMs = deps.now();

  /** `ifItFails` must be true of the rows, since only the message wasn't updated. */
  const redraw = async (text: string, ifItFails: string) => {
    if (!query.message) return;
    try {
      await deps.telegram.editMessageText(query.message.chat.id, query.message.message_id, text, null);
    } catch (err) {
      console.error(
        `[telegram] capture message redraw failed: ${err instanceof Error ? err.message : String(err)}`
      );
      await tellChat(query, ifItFails, deps);
    }
  };

  if (action === "s") {
    const out = await saveCapture(deps.db, owner, id, nowMs);
    if (out.kind === "not_found") return tellChat(query, CAPTURE_GONE, deps);
    if (out.kind === "expired") {
      return redraw(renderCaptureMessage(out.ops, "expired", nowMs), EXPIRED_REDRAW_FAILED);
    }
    if (out.kind === "already") {
      return out.status === "cancelled"
        ? redraw(renderCaptureMessage(out.ops, "cancelled", nowMs), CANCELLED_REDRAW_FAILED)
        : redraw(renderCaptureMessage(out.ops, "saved", nowMs), REDRAW_FAILED);
    }
    return redraw(renderCaptureMessage(out.ops, "saved", nowMs, out.notes), REDRAW_FAILED);
  }

  // Cancel: "action" can only be "s" or "x", because of the acks below.
  let out;
  try {
    out = await cancelCapture(deps.db, owner, id, nowMs);
  } catch (err) {
    console.error(`[telegram] cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    return tellChat(query, COULDNT_CANCEL, deps);
  }
  if (out.kind === "not_found") return tellChat(query, CAPTURE_GONE, deps);
  if (out.kind === "already" && out.status === "saved") {
    return redraw(renderCaptureMessage(out.ops, "saved", nowMs), REDRAW_FAILED);
  }
  return redraw(renderCaptureMessage(out.ops, "cancelled", nowMs), CANCELLED_REDRAW_FAILED);
}

export const captureCallback: CallbackHandler = {
  acks: { s: null, x: null },
  run: runCaptureCallback,
};
