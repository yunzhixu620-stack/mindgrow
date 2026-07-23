import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyThemeToRoot,
  resolveInitialTheme,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) || [];
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left: string, right: string) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("U8 theme foundation", () => {
  it("prefers a valid saved choice and otherwise follows the operating system", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme("invalid", false)).toBe("light");
  });

  it("applies the theme to class, data attribute, and native color scheme", () => {
    const classes = new Set<string>();
    const root = {
      dataset: {} as DOMStringMap,
      classList: { toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name) },
      style: {} as CSSStyleDeclaration,
    } as unknown as HTMLElement;

    applyThemeToRoot(root, "dark");
    expect(root.dataset.theme).toBe("dark");
    expect(classes.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");

    applyThemeToRoot(root, "light");
    expect(classes.has("dark")).toBe(false);
  });

  it("boots before React from saved or system preference without user interpolation", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("document.documentElement");
  });

  it("keeps core dark and light text pairs above WCAG AA", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const root = css.match(/:root\s*{([\s\S]*?)}\s*\n\s*:root\[data-theme="light"\]/)?.[1] || "";
    const light = css.match(/:root\[data-theme="light"\]\s*{([\s\S]*?)}\s*\n\s*\/\* ===== Base Styles/)?.[1] || "";
    const color = (scope: string, name: string) => scope.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] || "";

    for (const [scope, background] of [[root, "bg-surface"], [light, "bg-surface"]]) {
      for (const foreground of ["text-primary", "text-secondary", "text-tertiary", "text-muted"]) {
        expect(contrastRatio(color(scope, foreground), color(scope, background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(color(scope, "primary-foreground"), color(scope, "primary")), "primary action text").toBeGreaterThanOrEqual(4.5);
    }

    expect(contrastRatio(color(light, "status-growth-text"), color(light, "status-growth-bg")), "light growth status").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color(light, "status-attention-text"), color(light, "status-attention-bg")), "light organizer reminder").toBeGreaterThanOrEqual(4.5);
  });

  it("uses theme-aware semantic colors for status pills", () => {
    const sidebar = fs.readFileSync(path.join(process.cwd(), "src/components/layout/sidebar.tsx"), "utf8");
    const mindMap = fs.readFileSync(path.join(process.cwd(), "src/components/mindmap/mind-map-panel.tsx"), "utf8");

    expect(sidebar).toContain("var(--status-attention-text)");
    expect(mindMap).toContain("var(--status-growth-text)");
  });
});
