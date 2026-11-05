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
import type { CallbackContext } from "@/lib/telegram/callbacks";
import type { BotDeps } from "@/lib/telegram/deps";
import { AI_BUSY, BUTTON_EXPIRED, COULDNT_READ, TOO_LONG } from "@/lib/telegram/messages";
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

/** [Save] / [Cancel] — namespace "c". Returns the toast text. */
export async function handleCaptureCallback(
  { action, id, query }: CallbackContext,
  deps: BotDeps
): Promise<string> {
  const owner = deps.env.ownerUserId;
  const nowMs = deps.now();

  const redraw = async (text: string) => {
    if (!query.message) return;
    try {
      await deps.telegram.editMessageText(query.message.chat.id, query.message.message_id, text, null);
    } catch (err) {
      // What was saved stays saved; only the message wasn't updated.
      console.error(
        `[telegram] capture message redraw failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  if (action === "s") {
    const out = await saveCapture(deps.db, owner, id, nowMs);
    if (out.kind === "not_found") return "That one isn't there any more.";
    if (out.kind === "expired") {
      await redraw(renderCaptureMessage(out.ops, "expired", nowMs));
      return "Too old to save";
    }
    if (out.kind === "already") {
      if (out.status === "cancelled") {
        await redraw(renderCaptureMessage(out.ops, "cancelled", nowMs));
        return "That one was cancelled — send it again to save it.";
      }
      await redraw(renderCaptureMessage(out.ops, "saved", nowMs));
      return "Already saved";
    }
    await redraw(renderCaptureMessage(out.ops, "saved", nowMs, out.notes));
    return "Saved";
  }

  if (action === "x") {
    const out = await cancelCapture(deps.db, owner, id, nowMs);
    if (out.kind === "not_found") return "That one isn't there any more.";
    if (out.kind === "already") {
      await redraw(renderCaptureMessage(out.ops, out.status === "saved" ? "saved" : "cancelled", nowMs));
      return out.status === "saved" ? "Already saved — change it in Prism if you need to." : "Already cancelled";
    }
    await redraw(renderCaptureMessage(out.ops, "cancelled", nowMs));
    return "Cancelled";
  }

  return BUTTON_EXPIRED;
}
