"use client";

import { MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";
import type { AppMode } from "@/store/mindgrow-store";

export const MOBILE_NAV_MODES: AppMode[] = ["knowledge", "article", "meeting"];

export function MobileBottomNav({
  currentMode,
  onModeChange,
  onCreate,
}: {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onCreate: () => void;
}) {
  return (
    <nav
      className="relative z-[150] shrink-0 border-t border-[var(--border)] bg-[var(--card)]/95 shadow-[0_-12px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="移动端产品导航"
      data-testid="mobile-bottom-nav"
    >
      <div className="grid min-h-16 grid-cols-3">
        {MOBILE_NAV_MODES.map((mode, index) => {
          const config = MODE_LIBRARY_CONFIG[mode];
          const active = currentMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              aria-label={`切换到${config.label}`}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${index === 1 ? "pt-7" : "pt-1"} ${active ? "text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--foreground)]"}`}
            >
              {index !== 1 && <span className="text-lg leading-none" aria-hidden="true">{config.emoji}</span>}
              <span>{config.shortLabel}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onCreate}
        aria-label={`在${MODE_LIBRARY_CONFIG[currentMode].label}中新建知识库`}
        data-testid="mobile-create-library"
        className="absolute left-1/2 top-0 flex h-14 w-14 -translate-x-1/2 -translate-y-1/3 flex-col items-center justify-center rounded-full border-4 border-[var(--card)] bg-[var(--primary)] text-black shadow-[0_8px_24px_rgba(34,211,167,0.3)] transition-transform hover:scale-105 active:scale-95"
      >
        <span className="text-xl font-light leading-4" aria-hidden="true">＋</span>
        <span className="mt-0.5 text-[8px] font-bold">新建</span>
      </button>
    </nav>
  );
}
