/**
 * Every fixed sentence the bot says. Inviting, never "you must" or "you
 * should", never guilt ("you haven't…", "overdue!"), and honest when
 * something failed: it says nothing was saved when nothing was.
 */

export const HELP_TEXT = [
  "Hi — I'm Prism's bot.",
  "",
  "Send me anything you'd like to remember, like “call mom tomorrow at 6” or “dinner at 8”. I'll show you what I understood, and nothing is saved until you tap Save.",
  "",
  "Each morning at 11 I'll send today's plan here, ready when you are.",
].join("\n");

export const TEXT_ONLY = "I can read text messages for now. Type it out and I'll take it from there.";

export const TOO_LONG =
  "That's a long one — I read up to 2,000 characters at a time. Could you send it in shorter pieces?";

export const AI_BUSY =
  "I've had a lot to read just now. Give me a minute and send it again — nothing was saved.";

export const COULDNT_READ =
  "I couldn't read that one just now, so nothing was saved. Try sending it again in a minute.";

export const SOMETHING_WRONG =
  "Something went wrong on my side, so that may not have gone through. Try again in a minute.";

export const BUTTON_EXPIRED = "That button has expired.";

/**
 * A button's toast goes out before its work runs (lib/telegram/callbacks.ts),
 * so anything that goes wrong afterwards is said in the chat instead. Each one
 * says only what is true of the rows: a redraw that failed after a good save
 * must not read as a failed save.
 */
export const COULDNT_SAVE = "Couldn't save that — try again.";
export const COULDNT_CANCEL = "Couldn't cancel that — try again.";
export const REDRAW_FAILED = "Saved, but I couldn't update this message.";
export const CANCELLED_REDRAW_FAILED = "Cancelled, but I couldn't update this message.";
export const EXPIRED_REDRAW_FAILED =
  "That one is more than a day old, so I didn't save it. Send it again and I'll read it fresh.";
export const PLAN_GONE = "That plan isn't there any more.";
export const ITEM_GONE = "That item isn't on a plan any more.";
export const CAPTURE_GONE = "That one isn't there any more.";
