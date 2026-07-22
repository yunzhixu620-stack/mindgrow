"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { MODE_LIBRARY_CONFIG, isMapForMode } from "@/lib/mode-libraries";
import { useMindGrowStore, type AppMode } from "@/store/mindgrow-store";
import type { MindMap } from "@/types";

export function shortenBreadcrumbLabel(label: string, maxLength = 12) {
  const normalized = String(label || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function breadcrumbMapsForMode(maps: MindMap[], mode: AppMode) {
  return maps.filter((map) => isMapForMode(map, mode));
}

export function Breadcrumb({ compact = false }: { compact?: boolean }) {
  const { currentWorkspace } = useAuth();
  const {
    maps,
    currentMapId,
    currentMode,
    setCurrentMapId,
    saveChatHistory,
    loadChatHistory,
  } = useMindGrowStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleMaps = useMemo(() => breadcrumbMapsForMode(maps, currentMode), [currentMode, maps]);
  const currentMap = visibleMaps.find((map) => map.id === currentMapId) || maps.find((map) => map.id === currentMapId);
  const mapName = currentMap?.name || MODE_LIBRARY_CONFIG[currentMode].defaultName;
  const workspaceName = currentWorkspace?.name || "本地工作区";

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const switchMap = (mapId: string) => {
    setOpen(false);
    if (mapId === currentMapId) return;
    saveChatHistory();
    setCurrentMapId(mapId);
    loadChatHistory(mapId);
  };

  return (
    <div ref={containerRef} className={`relative min-w-0 ${compact ? "w-full" : "max-w-[360px]"}`} data-testid="product-breadcrumb">
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={`当前知识库：${mapName}，点击快速切换`}
          className="flex w-full min-w-0 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
        >
          <span aria-hidden="true">{MODE_LIBRARY_CONFIG[currentMode].emoji}</span>
          <span className="truncate">{shortenBreadcrumbLabel(mapName)}</span>
          <span className="text-[9px] text-[var(--text-muted)]" aria-hidden="true">⌄</span>
        </button>
      ) : (
        <nav aria-label="当前位置" className="flex min-w-0 items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <span className="max-w-[92px] truncate" title={workspaceName}>{workspaceName}</span>
          <span aria-hidden="true">›</span>
          <span className="shrink-0 text-[var(--text-tertiary)]">{MODE_LIBRARY_CONFIG[currentMode].label}</span>
          <span aria-hidden="true">›</span>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={`当前知识库：${mapName}，点击快速切换`}
            className="min-w-0 max-w-[150px] truncate rounded-md px-1.5 py-1 font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--foreground)]"
            title={mapName}
          >
            {mapName} <span className="text-[8px] text-[var(--text-muted)]" aria-hidden="true">⌄</span>
          </button>
        </nav>
      )}

      {open && (
        <div className={`absolute z-[180] mt-1 max-h-72 min-w-[230px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-2xl ${compact ? "left-1/2 top-full -translate-x-1/2" : "right-0 top-full"}`} role="menu" aria-label={`${MODE_LIBRARY_CONFIG[currentMode].label}知识库快速切换`} data-testid="breadcrumb-map-menu">
          <div className="px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{MODE_LIBRARY_CONFIG[currentMode].label} · {visibleMaps.length} 个知识库</div>
          {visibleMaps.length > 0 ? visibleMaps.map((map) => (
            <button
              key={map.id}
              type="button"
              role="menuitem"
              data-map-id={map.id}
              onClick={() => switchMap(map.id)}
              aria-current={map.id === currentMapId ? "page" : undefined}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${map.id === currentMapId ? "bg-[var(--primary-subtle)] font-semibold text-[var(--primary-hover)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
            >
              <span className="min-w-0 truncate">{map.name}</span>
              <span className="shrink-0 text-[9px] text-[var(--text-muted)]">{map.nodeCount} 节点</span>
            </button>
          )) : <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">当前板块还没有知识库</div>}
        </div>
      )}
    </div>
  );
}
