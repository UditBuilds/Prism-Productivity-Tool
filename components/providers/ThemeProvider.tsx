"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  COLOR_MODE_KEY,
  DEFAULT_COLOR_MODE,
  SYSTEM_LIGHT_QUERY,
  THEME_COLOR,
  parseColorMode,
  resolveColorMode,
  type ColorMode,
  type ResolvedColorMode,
} from "@/lib/color-mode";

export const THEMES = [
  { id: "violet", hex: "#7C3AED", label: "Violet" },
  { id: "blue", hex: "#3B82F6", label: "Blue" },
  { id: "emerald", hex: "#10B981", label: "Emerald" },
  { id: "amber", hex: "#F59E0B", label: "Amber" },
  { id: "rose", hex: "#F43F5E", label: "Rose" },
  { id: "cyan", hex: "#06B6D4", label: "Cyan" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "prism-theme";
const THEME_CLASSES = THEMES.map((t) => `theme-${t.id}`);

function applyThemeClass(id: ThemeId) {
  const el = document.documentElement;
  el.classList.remove(...THEME_CLASSES);
  el.classList.add(`theme-${id}`);
}

/**
 * Paint a mode: the `dark` class on <html> plus the theme-color meta. A no-op
 * when the page already shows that mode — the normal case on mount, because
 * the pre-paint script in app/layout.tsx got there first.
 */
function applyColorMode(mode: ResolvedColorMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.getAttribute("content") !== THEME_COLOR[mode]) {
    meta.setAttribute("content", THEME_COLOR[mode]);
  }
}

function systemPrefersLight() {
  return window.matchMedia(SYSTEM_LIGHT_QUERY).matches;
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  /** The choice made in Settings → Appearance. */
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
  /** What is painted right now: `system` resolved against the OS. */
  resolvedColorMode: ResolvedColorMode;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "violet",
  setTheme: () => undefined,
  colorMode: DEFAULT_COLOR_MODE,
  setColorMode: () => undefined,
  resolvedColorMode: resolveColorMode(DEFAULT_COLOR_MODE, false),
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("violet");
  // Server render and hydration both start at the default, which is what the
  // server painted. The effect below catches up with the stored choice; the
  // <html> class is already right by then, so catching up repaints nothing.
  const [colorMode, setColorModeState] =
    useState<ColorMode>(DEFAULT_COLOR_MODE);
  const [resolvedColorMode, setResolvedColorMode] = useState<ResolvedColorMode>(
    () => resolveColorMode(DEFAULT_COLOR_MODE, false)
  );

  // Sync state with whatever the pre-hydration <head> script already applied.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const valid = THEMES.find((t) => t.id === stored)?.id ?? "violet";
    setThemeState(valid);
    applyThemeClass(valid);
  }, []);

  useEffect(() => {
    let stored: ColorMode = DEFAULT_COLOR_MODE;
    try {
      stored = parseColorMode(localStorage.getItem(COLOR_MODE_KEY));
    } catch {
      // Storage blocked: the pre-paint script fell back to the default too.
    }
    const resolved = resolveColorMode(stored, systemPrefersLight());
    applyColorMode(resolved);
    setColorModeState(stored);
    setResolvedColorMode(resolved);
  }, []);

  // In System, follow the OS while the app is open. Class first, then state:
  // the charts read their colours from the CSS variables while re-rendering.
  useEffect(() => {
    if (colorMode !== "system") return;
    const query = window.matchMedia(SYSTEM_LIGHT_QUERY);
    const onChange = () => {
      const resolved = resolveColorMode("system", query.matches);
      applyColorMode(resolved);
      setResolvedColorMode(resolved);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [colorMode]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    localStorage.setItem(STORAGE_KEY, id);
    applyThemeClass(id);
  }, []);

  // Only an explicit tap stores a mode — the default is never written down.
  const setColorMode = useCallback((mode: ColorMode) => {
    const resolved = resolveColorMode(mode, systemPrefersLight());
    applyColorMode(resolved);
    try {
      localStorage.setItem(COLOR_MODE_KEY, mode);
    } catch {
      // Applies for this visit; it just won't survive a reload.
    }
    setColorModeState(mode);
    setResolvedColorMode(resolved);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, colorMode, setColorMode, resolvedColorMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
