/**
 * Pure helpers behind the note Copy / Share / Export-PDF actions.
 *
 * Kept free of React and of any browser API so they can be exercised by
 * `scripts/test-note-export.mjs` under plain node — the capability detection
 * and the actual clipboard/share/download calls live in the component.
 */

/**
 * The text form of a note: its raw markdown SOURCE, not a stripped plain-text
 * rendering. Pasting into anything markdown-aware (another Prism note, a
 * GitHub comment, Obsidian) then keeps the formatting; pasting into Messages
 * costs only a few visible `#` and `*` characters.
 *
 * An untitled note (a Spark's body IS the note) omits the heading line rather
 * than emitting a bare `# ` — otherwise every untitled note would paste with a
 * dangling empty heading.
 */
export function noteToMarkdown(title: string, content: string): string {
  const t = title.trim();
  const body = content.trim();
  if (!t) return body;
  if (!body) return `# ${t}`;
  return `# ${t}\n\n${body}`;
}

/**
 * Drop C0 controls and DEL. Written as a codepoint filter rather than a
 * control-character regex class so the source file itself stays free of the
 * bytes it is removing.
 */
function stripControlChars(s: string): string {
  return Array.from(s)
    .filter((ch) => {
      const cp = ch.charCodeAt(0);
      return cp > 31 && cp !== 127;
    })
    .join("");
}

/**
 * Turn a note title into a safe download filename stem.
 *
 * Strips the characters Windows, macOS and Linux disagree about (`\ / : * ? "
 * < > |`), collapses runs of whitespace, and trims to 60 characters so long
 * YouTube-derived titles (real ones here run past 70 chars) don't produce an
 * unwieldy filename. Control characters are removed outright.
 *
 * Returns `null` when nothing usable survives, so the caller can fall back to
 * a timestamp instead of writing a file called `.pdf`.
 */
export function sanitizeFilenameStem(title: string): string | null {
  const cleaned = stripControlChars(title)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim()
    // Trailing dots and spaces are legal in the string but not in a Windows
    // filename, and a leading dot would make it a hidden file on unix.
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  return cleaned.length > 0 ? cleaned : null;
}

/** `2026-09-02-1435` — the timestamp fallback for an untitled note. */
export function timestampStem(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`
  );
}

/** Full download filename for a note's PDF, including the extension. */
export function pdfFilename(title: string, now?: Date): string {
  return `${sanitizeFilenameStem(title) ?? timestampStem(now)}.pdf`;
}
