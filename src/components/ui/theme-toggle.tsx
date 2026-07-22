"use client";

import { useEffect, useState } from "react";
import {
  applyThemeToRoot,
  resolveInitialTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = resolveInitialTheme(
      document.documentElement.dataset.theme || localStorage.getItem(THEME_STORAGE_KEY),
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    applyThemeToRoot(document.documentElement, current);
    setTheme(current);
    setReady(true);
  }, []);

  const targetTheme: Theme = theme === "dark" ? "light" : "dark";
  const label = targetTheme === "light" ? "切换到亮色主题" : "切换到深色主题";

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme={theme}
      data-theme-ready={ready ? "true" : "false"}
      disabled={!ready}
      aria-label={label}
      title={label}
      onClick={() => {
        applyThemeToRoot(document.documentElement, targetTheme);
        localStorage.setItem(THEME_STORAGE_KEY, targetTheme);
        setTheme(targetTheme);
        window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: targetTheme } }));
      }}
      className={`flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-70 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
    >
      <span aria-hidden="true" className={compact ? "text-xs" : "text-sm"}>{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
