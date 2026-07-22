"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import {
  COMMAND_NAVIGATE_EVENT,
  COMMAND_PALETTE_OPEN_EVENT,
  flattenCommandGroups,
  searchLoadedKnowledge,
  type CommandSearchResult,
} from "@/lib/command-search";

const GROUPS = [
  ["maps", "已加载知识库", "▣"],
  ["nodes", "当前图谱节点", "●"],
  ["entities", "当前实体", "◇"],
  ["chat", "最近 10 条对话", "↗"],
] as const;

export function CommandPalette() {
  const { maps, currentMapId, nodes, entityGraph, messages } = useMindGrowStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => searchLoadedKnowledge({
    maps,
    currentMapId,
    nodes,
    entities: entityGraph.entities,
    messages,
  }, query), [currentMapId, entityGraph.entities, maps, messages, nodes, query]);
  const results = useMemo(() => flattenCommandGroups(groups), [groups]);

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
    window.dispatchEvent(new CustomEvent(COMMAND_NAVIGATE_EVENT, { detail: result }));
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/55 px-3 pt-[12vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl" role="dialog" aria-modal="true" aria-label="快速搜索" data-testid="command-palette">
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
            aria-label="搜索已加载内容"
            aria-controls="command-search-results"
            aria-activedescendant={results[activeIndex] ? `command-result-${results[activeIndex].id}` : undefined}
            placeholder="搜索知识库、当前图谱和最近对话…"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="rounded border border-[var(--border)] px-1.5 py-1 text-[9px] text-[var(--text-muted)]">Esc</kbd>
        </div>

        <div id="command-search-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-2" data-testid="command-search-results">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">当前已加载内容中没有匹配结果</div>
          ) : GROUPS.map(([key, label, icon]) => {
            const section = groups[key];
            if (section.length === 0) return null;
            return (
              <div key={key} className="mb-2 last:mb-0" data-result-group={key}>
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
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
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs ${active ? "bg-[var(--primary)] text-black" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}>{icon}</span>
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
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[9px] text-[var(--text-muted)]">
          <span>仅搜索已加载知识库、当前图谱与最近 10 条对话</span>
          <span>{shortcut} 打开 · ↑↓ 选择</span>
        </footer>
      </section>
    </div>
  );
}
