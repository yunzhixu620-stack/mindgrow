import type { CacheReadToken, GraphSnapshot, TenantScope } from "@/lib/tenant-cache";
import { tenantScopeKey } from "@/lib/tenant-cache";
import type { AppMode, HydrateGraphResult } from "@/store/mindgrow-store";
import { useMindGrowStore } from "@/store/mindgrow-store";

export interface PageGraphRequest {
  requestId: number;
  scope: TenantScope;
  mapId: string;
  mode: AppMode;
  baseHydrationEpoch: number;
  cacheReadToken: CacheReadToken;
}

export interface ActivePageGraphTarget {
  requestId: number;
  scopeKey: string | null;
  mapId: string;
  mode: AppMode;
}

export type PageGraphCommitResult = HydrateGraphResult | "rejected-stale-view";

export function commitPageGraphResponse(
  request: PageGraphRequest,
  active: ActivePageGraphTarget,
  snapshot: GraphSnapshot,
): PageGraphCommitResult {
  if (
    request.requestId !== active.requestId
    || tenantScopeKey(request.scope) !== active.scopeKey
    || request.mapId !== active.mapId
    || request.mode !== active.mode
  ) {
    return "rejected-stale-view";
  }
  return useMindGrowStore.getState().hydrateGraphFromServer(
    request.mapId,
    snapshot,
    request.baseHydrationEpoch,
    request.scope,
    request.cacheReadToken,
  );
}

export function graphSnapshotFromResponse(data: {
  nodes?: GraphSnapshot["nodes"];
  edges?: GraphSnapshot["edges"];
  entityGraph?: GraphSnapshot["entityGraph"];
}): GraphSnapshot {
  return {
    nodes: data.nodes || [],
    edges: data.edges || [],
    entityGraph: data.entityGraph || { entities: [], relations: [] },
  };
}
