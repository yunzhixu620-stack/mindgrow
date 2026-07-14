"use client";

import { useState, useEffect } from "react";
import { useMindGrowStore, type AppMode } from "@/store/mindgrow-store";
import Link from "next/link";
import { WorkspaceMenu } from "@/components/auth/workspace-menu";
import { MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";

const MODES: { key: AppMode; label: string; emoji: string; tooltip: string }[] = [
  { key: "meeting", label: "会议助手", emoji: "🎯", tooltip: "整理会议记录，提取决议和行动项" },
  { key: "knowledge", label: "知识碎片", emoji: "💡", tooltip: "整合零散知识点，构建知识体系" },
  { key: "article", label: "文章解析", emoji: "📄", tooltip: "解析文章内容，提炼核心观点" },
];

const GUIDE_HREF = process.env.NODE_ENV === "production" ? "/mindgrow/guide/" : "/guide/";

export function Header() {
  const { currentMode, setCurrentMode, layoutDirection, setLayoutDirection, nodes } = useMindGrowStore();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <header
      className="flex items-center justify-between px-4 border-b shrink-0 z-[100]"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
        height: 48,
        paddingTop: "max(env(safe-area-inset-top), 0px)",
        minHeight: "calc(48px + max(env(safe-area-inset-top), 0px))",
      }}
    >
      {/* Left: Logo + Mode Tabs */}
      <div className="flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 no-underline group">
          <div
            className="w-5 h-5 rounded-[5px] flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--primary), #06b6d4)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span
            className="text-sm font-semibold tracking-tight select-none"
            style={{ color: "var(--text-primary)" }}
          >
            MindGrow
          </span>
        </Link>

        {/* Mode Tabs - desktop only */}
        {!isMobile && (
          <div
            className="flex gap-0.5 rounded-[var(--radius-md)] p-0.5"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {MODES.map((mode) => (
              <button
                key={mode.key}
                onClick={() => setCurrentMode(mode.key)}
                title={mode.tooltip}
                className="relative flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium border-none bg-transparent cursor-pointer whitespace-nowrap group"
                style={{
                  color: currentMode === mode.key ? "#fff" : "var(--text-tertiary)",
                  background: currentMode === mode.key ? "var(--primary)" : "transparent",
                  boxShadow: currentMode === mode.key ? "0 1px 3px rgba(34,211,167,0.3)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (currentMode !== mode.key) {
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentMode !== mode.key) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)";
                  }
                }}
              >
                <span style={{ fontSize: 10, opacity: 0.7 }}>{mode.emoji}</span>
                {mode.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <WorkspaceMenu />
        {/* Layout direction only belongs to the knowledge-map workspace. */}
        {!isMobile && currentMode === "knowledge" && (
          <button
            onClick={() => setLayoutDirection(layoutDirection === "vertical" ? "horizontal" : "vertical")}
            className="w-8 h-8 rounded-[var(--radius-sm)] border-none bg-transparent flex items-center justify-center cursor-pointer"
            style={{ color: "var(--text-tertiary)" }}
            title={layoutDirection === "vertical" ? "切换为横向布局" : "切换为纵向布局"}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)";
            }}
          >
            {layoutDirection === "vertical" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
              </svg>
            )}
          </button>
        )}

        {/* Active workspace count */}
        <div
          className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
          style={{
            background: "var(--primary-subtle)",
            border: "1px solid var(--primary-border)",
            color: "var(--primary-hover)",
          }}
        >
          {currentMode === "knowledge" ? `${nodes.length} 节点` : `${MODE_LIBRARY_CONFIG[currentMode].shortLabel}库 · ${nodes.length}`}
        </div>

        {!isMobile && currentMode === "knowledge" && (
          <div
            className="mx-1"
            style={{ width: 1, height: 20, background: "var(--border-default)" }}
          />
        )}

        <a
          href={GUIDE_HREF}
          data-testid="guide-link"
          className="flex items-center gap-1 px-2 py-1.5 rounded-[var(--radius-sm)] text-xs no-underline hover:bg-[var(--bg-hover)]"
          style={{ color: "var(--text-tertiary)" }}
        >
          使用指南
        </a>

        {/* Universe link */}
        <Link
          href="/universe"
          className="flex items-center gap-1 px-2 py-1.5 rounded-[var(--radius-sm)] text-xs no-underline"
          style={{
            background: "transparent",
            color: "var(--text-tertiary)",
            border: "none",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)";
          }}
        >
          {!isMobile && "🌌 "}知识宇宙
        </Link>
      </div>
    </header>
  );
}
