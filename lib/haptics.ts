/**
 * Subtle haptic tap on supporting mobile browsers (Android Chrome; iOS Safari
 * ignores navigator.vibrate). Safe to call anywhere — no-ops on desktop/SSR.
 */
export function hapticTap(pattern: number | number[] = 10): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw on vibrate without user activation — ignore.
  }
}
