/**
 * Text helpers for bot messages, which are sent with parse_mode "HTML".
 * Every piece of user text (a task title, a plan reason) goes through
 * escapeHtml before it is placed in a message — an unescaped "<" makes
 * Telegram reject the whole message.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Shorten to `max` characters with an ellipsis, then escape. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return escapeHtml(t.length > max ? `${t.slice(0, max - 1)}…` : t);
}
