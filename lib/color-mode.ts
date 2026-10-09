/**
 * Light / dark mode — the rules in one place.
 *
 * Two readers, one definition: the pre-paint script in app/layout.tsx (runs
 * before React exists, so the first frame is already the right mode) and
 * ThemeProvider (keeps it in sync afterwards). Both import from here, so they
 * cannot disagree about what a stored value means.
 *
 * The mode is the `dark` class on <html>. Tokens live in app/globals.css:
 * light under `:root`, dark under `.dark`.
 */

export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export type ResolvedColorMode = "light" | "dark";

/**
 * localStorage key. Written ONLY by an explicit choice in Settings →
 * Appearance — never to record the default — so a later change of
 * DEFAULT_COLOR_MODE reaches everyone who never chose.
 */
export const COLOR_MODE_KEY = "prism-color-mode";

/** Dark until the main screens are migrated to DESIGN.md. Light and System are opt-in. */
export const DEFAULT_COLOR_MODE: ColorMode = "dark";

/** Media query that decides `system`. */
export const SYSTEM_LIGHT_QUERY = "(prefers-color-scheme: light)";

/** <meta name="theme-color"> per painted mode — each mode's --background. */
export const THEME_COLOR: Record<ResolvedColorMode, string> = {
  light: "#FFFFFF",
  dark: "#0F1012",
};

/** A stored value, or the default for anything missing or unrecognised. */
export function parseColorMode(value: string | null): ColorMode {
  return COLOR_MODES.find((m) => m === value) ?? DEFAULT_COLOR_MODE;
}

/** The mode to paint: `system` follows the OS, the other two are literal. */
export function resolveColorMode(
  mode: ColorMode,
  systemPrefersLight: boolean
): ResolvedColorMode {
  if (mode === "system") return systemPrefersLight ? "light" : "dark";
  return mode;
}

/**
 * The colour-mode half of the pre-paint script, as an inline-script string.
 * The server always renders `dark` (the default), so this only ever has to
 * take the class away — and repoint theme-color with it — when the stored
 * choice resolves to light. Any failure (storage blocked, no matchMedia)
 * leaves the server's dark frame in place.
 */
export function colorModeScript(): string {
  const modes = JSON.stringify(COLOR_MODES);
  return [
    `var m=localStorage.getItem(${JSON.stringify(COLOR_MODE_KEY)});`,
    `if(${modes}.indexOf(m)<0)m=${JSON.stringify(DEFAULT_COLOR_MODE)};`,
    `if(m==="light"||(m==="system"&&matchMedia(${JSON.stringify(SYSTEM_LIGHT_QUERY)}).matches)){`,
    `document.documentElement.classList.remove("dark");`,
    `var c=document.querySelector('meta[name="theme-color"]');`,
    `if(c)c.setAttribute("content",${JSON.stringify(THEME_COLOR.light)})`,
    `}`,
  ].join("");
}
