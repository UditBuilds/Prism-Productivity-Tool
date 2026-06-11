"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

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

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "violet",
  setTheme: () => undefined,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("violet");

  // Sync state with whatever the pre-hydration <head> script already applied.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const valid = THEMES.find((t) => t.id === stored)?.id ?? "violet";
    setThemeState(valid);
    applyThemeClass(valid);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    localStorage.setItem(STORAGE_KEY, id);
    applyThemeClass(id);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
