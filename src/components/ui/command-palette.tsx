"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { apiFetch } from "@/lib/client-api";
import {
  COMMAND_NAVIGATE_EVENT,
  COMMAND_PALETTE_OPEN_EVENT,
  flattenCommandGroups,
  mergeCommandResults,
  normalizeWorkspaceSearchResults,
  searchLoadedKnowledge,
  type CommandSearchResult,
} from "@/lib/command-search";
import { useLocale } from "@/components/i18n/locale-provider";

const LOCAL_GROUPS = [
  ["maps", "已加载知识库", "Loaded libraries", "▣"],
  ["nodes", "当前图谱节点", "Current graph nodes", "●"],
  ["entities", "当前实体", "Current entities", "◇"],
  ["chat", "最近 10 条对话", "Latest 10 chats", "↗"],
] as const;

export function CommandPalette() {
  const { locale } = useLocale();
  const english = locale === "en";
  const { maps, currentMapId, nodes, entityGraph, messages } = useMindGrowStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const [workspaceResults, setWorkspaceResults] = useState<CommandSearchResult[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => searchLoadedKnowledge({
    maps,
    currentMapId,
    nodes,
    entities: entityGraph.entities,
    messages,
  }, query), [currentMapId, entityGraph.entities, maps, messages, nodes, query]);
  const localResults = useMemo(() => flattenCommandGroups(groups), [groups]);
  const results = useMemo(() => mergeCommandResults(localResults, workspaceResults), [localResults, workspaceResults]);
  const visibleWorkspaceResults = useMemo(() => results.filter((result) => result.scope === "workspace"), [results]);

  useEffect(() => {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    if (!open || normalizedQuery.length < 2) {
      setWorkspaceResults([]);
      setWorkspaceStatus("idle");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setWorkspaceStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/knowledge?action=search&q=${encodeURIComponent(normalizedQuery)}&limit=24`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Workspace search failed (${response.status})`);
        const payload = await response.json();
        if (cancelled || controller.signal.aborted) return;
        setWorkspaceResults(normalizeWorkspaceSearchResults(payload));
        setWorkspaceStatus("ready");
      } catch (error) {
        if (cancelled || controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setWorkspaceResults([]);
        setWorkspaceStatus("error");
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/.test(window.navigator.platform) ? "⌘ K" : "Ctrl K");
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setActiveIndex(0);
        setOpen(true);
      }
    };
    const handleOpen = () => {
      setQuery("");
      setActiveIndex(0);
      setOpen(true);
    };
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handleOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const selectResult = (result: CommandSearchResult) => {
    setOpen(false);
    // Close the search dialog before opening the target surface. Dispatching
    // first can briefly leave two dialogs mounted, so the first Escape key is
    // consumed by the stale palette instead of the entity detail panel.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(COMMAND_NAVIGATE_EVENT, { detail: result }));
    }));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/55 px-3 pt-[12vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl" role="dialog" aria-modal="true" aria-label={english ? "Quick search" : "快速搜索"} data-testid="command-palette">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          <span aria-hidden="true" className="text-[var(--primary)]">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); selectResult(results[activeIndex]); }
            }}
            aria-label={english ? "Search the entire workspace" : "搜索整个工作区"}
            aria-controls="command-search-results"
            aria-activedescendant={results[activeIndex] ? `command-result-${results[activeIndex].id}` : undefined}
            placeholder={english ? "Search libraries, nodes, entities, citations, and recent chats…" : "搜索知识库、节点、实体、原文引用和最近对话…"}
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="rounded border border-[var(--border)] px-1.5 py-1 text-[9px] text-[var(--text-muted)]">Esc</kbd>
        </div>

        <div id="command-search-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-2" data-testid="command-search-results">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
              {workspaceStatus === "loading"
                ? (english ? "Searching the workspace…" : "正在搜索整个工作区…")
                : workspaceStatus === "error"
                  ? (english ? "Workspace search is temporarily unavailable" : "工作区搜索暂时不可用，请稍后重试")
                  : (english ? "No matching results" : "没有匹配结果")}
            </div>
          ) : LOCAL_GROUPS.map(([key, labelZh, labelEn, icon]) => {
            const section = groups[key];
            if (section.length === 0) return null;
            return (
              <div key={key} className="mb-2 last:mb-0" data-result-group={key}>
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{english ? labelEn : labelZh}</div>
                {section.map((result) => {
                  const index = results.findIndex((candidate) => candidate.id === result.id);
                  const active = index === activeIndex;
                  return (
                    <button
                      key={result.id}
                      id={`command-result-${result.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-result-kind={result.kind}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectResult(result)}
                      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ${active ? "bg-[var(--primary-subtle)]" : "hover:bg-[var(--bg-hover)]"}`}
                    >
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs ${active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}>{icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-[var(--foreground)]">{result.title}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{result.subtitle}</span>
                      </span>
                      {active && <span className="mt-1 text-[9px] text-[var(--primary)]">Enter</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {visibleWorkspaceResults.length > 0 && (
            <div className="mb-2 last:mb-0" data-result-group="workspace">
              <div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <span>{english ? "Entire workspace" : "整个工作区"}</span>
                <span className="font-normal normal-case tracking-normal">{english ? "Isolated to this account" : "已按当前账号隔离"}</span>
              </div>
              {visibleWorkspaceResults.map((result) => {
                const index = results.findIndex((candidate) => candidate.id === result.id);
                const active = index === activeIndex;
                const icon = result.kind === "map" ? "▣" : result.kind === "entity" ? "◇" : result.kind === "document" ? "▤" : "●";
                return (
                  <button
                    key={result.id}
                    id={`command-result-${result.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-result-kind={result.kind}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(result)}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ${active ? "bg-[var(--primary-subtle)]" : "hover:bg-[var(--bg-hover)]"}`}
                  >
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs ${active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}>{icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--foreground)]">{result.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{result.subtitle}</span>
                      {result.matchReason && <span className="mt-1 block truncate text-[9px] text-[var(--primary)]" data-testid="workspace-search-reason">{result.matchReason}</span>}
                    </span>
                    {active && <span className="mt-1 text-[9px] text-[var(--primary)]">Enter</span>}
                  </button>
                );
              })}
            </div>
          )}
          {workspaceStatus === "loading" && results.length > 0 && (
            <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]" data-testid="workspace-search-loading">{english ? "Adding workspace results…" : "正在补齐整个工作区…"}</div>
          )}
          {workspaceStatus === "error" && results.length > 0 && (
            <div className="px-3 py-2 text-[10px] text-amber-400">{english ? "Local results remain available; workspace search failed" : "本地结果仍可用，工作区搜索暂时失败"}</div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[9px] text-[var(--text-muted)]">
          <span>{english ? "Local results appear first, then workspace results" : "本地结果即时显示，随后补齐当前登录工作区"}</span>
          <span>{shortcut} {english ? "open · ↑↓ select" : "打开 · ↑↓ 选择"}</span>
        </footer>
      </section>
    </div>
  );
}
