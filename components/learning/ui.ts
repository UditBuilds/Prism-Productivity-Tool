/**
 * Class strings for the learning screens, from DESIGN.md (Type, Space and
 * shape, Components, Motion). Named once so every screen uses the same pill,
 * the same round button and the same press.
 */

/** Buttons press to 0.98. Only transform animates; reduced motion gets none. */
export const PRESS =
  "transition-transform duration-200 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";

export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Round button 44. */
export const ROUND_BUTTON = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground hover:bg-border ${PRESS} ${FOCUS}`;

/** Primary button: accent pill, full width. Text on accent is white in both modes. */
export const PRIMARY_PILL = `inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 ${PRESS} ${FOCUS}`;

/** Secondary button: outlined pill. */
export const SECONDARY_PILL = `inline-flex h-11 items-center justify-center gap-2 rounded-full border border-input px-4 text-[14px] font-semibold text-foreground hover:bg-surface-raised disabled:opacity-60 ${PRESS} ${FOCUS}`;

/** A small outlined pill for actions inside a row. Still a 44 tap target. */
export const ROW_PILL = `inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-input px-3.5 text-[13px] font-semibold text-foreground hover:bg-surface-raised ${PRESS} ${FOCUS}`;

export const EYEBROW = "text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-muted-foreground";
export const BLOCK_NAME = "text-[15px] font-bold leading-5 text-foreground";
export const META = "text-[13px] leading-[18px] text-muted-foreground";
export const TITLE = "text-balance text-[24px] font-bold leading-7 tracking-[-0.02em] text-foreground";
export const DISPLAY = "text-balance text-[28px] font-bold leading-8 tracking-[-0.02em] text-foreground";

/** Round icon 36 on accent-tint. Accent as text in dark is accent-soft (DESIGN.md). */
export const ICON_CIRCLE = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-soft";

/** Screens enter with a 200ms ease-out slide and fade. */
export const SCREEN_IN = "animate-screen-in motion-reduce:animate-none";
