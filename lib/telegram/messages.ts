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

export const TAP_AGAIN = "Something went wrong on my side. Tap it again in a minute — it won't double up.";
