"use client";

import { useTheme } from "@/components/providers/ThemeProvider";

/**
 * Chart chrome for the Recharts panels — grid, axis line, hover band, cursor
 * line, and the gap colour that separates pie slices and rings the active dot.
 *
 * The values live once, as --chart-* variables in app/globals.css, with a
 * light and a dark definition (the dark ones are the old literals). Recharts
 * writes these into SVG presentation attributes, which cannot hold var(), so
 * they are resolved to rgb() strings here, on every render. Subscribing to the
 * theme re-renders the chart when the mode flips; ThemeProvider switches the
 * <html> class before it updates state, so the read sees the new values.
 *
 * Client-only: both panels load through next/dynamic with ssr:false.
 */
export function useChartColors() {
  useTheme();
  const style = getComputedStyle(document.documentElement);
  // "r g b" or "r g b / a" → the comma form, which every SVG parser accepts.
  const rgb = (name: string) => {
    const [channels, alpha] = style.getPropertyValue(name).split("/");
    const [r, g, b] = channels.trim().split(/\s+/);
    return alpha === undefined
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${alpha.trim()})`;
  };
  return {
    grid: rgb("--chart-grid"),
    axis: rgb("--chart-axis"),
    cursor: rgb("--chart-cursor"),
    cursorLine: rgb("--chart-cursor-line"),
    gap: rgb("--chart-gap"),
  };
}

/** Tooltip box and label. Plain CSS, so these can stay var() references. */
export const CHART_TOOLTIP_BACKGROUND = "rgb(var(--chart-tooltip))";
export const CHART_TOOLTIP_LABEL = "rgb(var(--chart-tooltip-label))";
