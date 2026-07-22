"use client";

import React from "react";
import { useSyncStatus, type SyncStatus, type SyncState } from "@/lib/use-sync-status";
import { useMindGrowStore } from "@/store/mindgrow-store";

interface SyncIndicatorViewModel {
  label: string;
  title: string;
  toneClass: string;
  dotClass: string;
}

const STATE_VIEW: Record<SyncState, Omit<SyncIndicatorViewModel, "title">> = {
  idle: {
    label: "已同步",
    toneClass: "border-emerald-400/20 bg-emerald-400/5 text-emerald-300",
    dotClass: "bg-emerald-400",
  },
  syncing: {
    label: "同步中…",
    toneClass: "border-amber-300/20 bg-amber-300/5 text-amber-200",
    dotClass: "bg-amber-300 animate-pulse",
  },
  dirty: {
    label: "有未提交改动",
    toneClass: "border-amber-300/20 bg-amber-300/5 text-amber-200",
    dotClass: "border border-dashed border-amber-300 bg-transparent",
  },
  offline: {
    label: "离线，改动仅在本地",
    toneClass: "border-red-400/20 bg-red-400/5 text-red-300",
    dotClass: "bg-red-400",
  },
  error: {
    label: "同步失败",
    toneClass: "border-red-400/20 bg-red-400/5 text-red-300",
    dotClass: "bg-red-400",
  },
};

export function formatSyncTime(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function syncIndicatorViewModel(status: SyncStatus): SyncIndicatorViewModel {
  const base = STATE_VIEW[status.state];
  const time = formatSyncTime(status.lastSuccessAt);
  const lastSync = time ? `上次同步 ${time}` : "尚无写入记录";
  const title = status.state === "offline"
    ? `当前网络不可达；改动会保留在本地。${lastSync}`
    : status.state === "error"
      ? `${status.error || "写入失败"}。${lastSync}`
      : status.state === "dirty"
        ? `本地改动尚未得到服务端确认。${lastSync}`
        : status.state === "syncing"
          ? `正在保存当前知识库。${lastSync}`
          : lastSync;
  return { ...base, title };
}

export function SyncIndicatorView({ status, mapId, compact = false }: { status: SyncStatus; mapId: string; compact?: boolean }) {
  const view = syncIndicatorViewModel(status);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={view.label}
      title={view.title}
      data-testid="sync-indicator"
      data-sync-state={status.state}
      data-sync-map-id={mapId}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10px] font-medium ${view.toneClass}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${view.dotClass}`} aria-hidden="true" />
      {compact ? <span className="sr-only">{view.label}</span> : <span className="hidden whitespace-nowrap lg:inline">{view.label}</span>}
    </div>
  );
}

export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const status = useSyncStatus(currentMapId);
  return <SyncIndicatorView status={status} mapId={currentMapId} compact={compact} />;
}
