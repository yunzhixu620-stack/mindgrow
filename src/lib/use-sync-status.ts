"use client";

import { useEffect, useMemo, useState } from "react";
import { retainNetworkStatusListener } from "@/lib/client-api";
import { tenantCache, type LocalOverlayToken } from "@/lib/tenant-cache";
import { useMindGrowStore, type WriteErrorState } from "@/store/mindgrow-store";

export type SyncState = "idle" | "syncing" | "dirty" | "offline" | "error";
export const RECENT_WRITE_ERROR_MS = 5_000;

export interface SyncStatusInput {
  networkOnline: boolean;
  pendingWrites: number;
  lastSuccessAt: number | null;
  lastError: WriteErrorState | null;
  dirty: boolean;
}

export interface SyncStatus {
  state: SyncState;
  lastSuccessAt: number | null;
  error: string | null;
}

export function deriveSyncStatus(input: SyncStatusInput, now = Date.now()): SyncStatus {
  let state: SyncState = "idle";
  if (!input.networkOnline) state = "offline";
  else if (input.pendingWrites > 0) state = "syncing";
  else if (input.lastError && now - input.lastError.at < RECENT_WRITE_ERROR_MS) state = "error";
  else if (input.dirty) state = "dirty";
  return {
    state,
    lastSuccessAt: input.lastSuccessAt,
    error: state === "error" ? input.lastError?.message || "写入失败" : null,
  };
}

function overlayIsDirty(token: LocalOverlayToken | undefined): boolean {
  return Boolean(token && tenantCache.isLocalOverlayCurrent(token));
}

export function useSyncStatus(mapId: string): SyncStatus {
  const networkOnline = useMindGrowStore((state) => state.networkOnline);
  const pendingWrites = useMindGrowStore((state) => state.pendingWritesByMap[mapId] ?? 0);
  const lastSuccessAt = useMindGrowStore((state) => state.lastWriteSucceededAtByMap[mapId] ?? null);
  const lastError = useMindGrowStore((state) => state.lastWriteErrorByMap[mapId] ?? null);
  const overlayToken = useMindGrowStore((state) => state.localOverlayTokenByMap[mapId]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => retainNetworkStatusListener(), []);
  useEffect(() => {
    if (!lastError) return;
    const remaining = RECENT_WRITE_ERROR_MS - (Date.now() - lastError.at);
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 10);
    return () => window.clearTimeout(timer);
  }, [lastError]);

  return useMemo(() => deriveSyncStatus({
    networkOnline,
    pendingWrites,
    lastSuccessAt,
    lastError,
    dirty: overlayIsDirty(overlayToken),
  }, now), [lastError, lastSuccessAt, networkOnline, now, overlayToken, pendingWrites]);
}
