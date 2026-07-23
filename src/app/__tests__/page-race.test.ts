import { beforeEach, describe, expect, it } from "vitest";
import { commitPageGraphResponse, type PageGraphRequest } from "@/app/page-loader";
import { tenantCache, tenantScopeKey, type GraphSnapshot, type TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore } from "@/store/mindgrow-store";

const scopeA: TenantScope = { userId: "user-a", workspaceId: "workspace-a" };
const scopeB: TenantScope = { userId: "user-a", workspaceId: "workspace-b" };
const createdAt = "2026-07-21T00:00:00.000Z";

function graph(label: string): GraphSnapshot {
  return {
    nodes: [{
      id: `node-${label}`,
      content: label,
      type: "topic",
      status: "active",
      source: "manual",
      confidence: 1,
      createdAt,
      updatedAt: createdAt,
    }],
    edges: [],
    entityGraph: { entities: [], relations: [] },
    layouts: [],
    whiteboardGroups: [],
  };
}

function request(requestId: number, scope: TenantScope, mapId: string): PageGraphRequest {
  return {
    requestId,
    scope,
    mapId,
    mode: "knowledge",
    baseHydrationEpoch: useMindGrowStore.getState().getHydrationEpoch(mapId),
    cacheReadToken: tenantCache.beginMapRead(scope, mapId),
  };
}

beforeEach(() => {
  useMindGrowStore.getState().resetTenantContext();
  tenantCache.clearAllTenantCache(scopeA);
  tenantCache.clearAllTenantCache(scopeB);
});

describe("page graph response races", () => {
  it("restores the mode captured when a new meeting library dialog opened", () => {
    useMindGrowStore.getState().setCurrentMode("meeting");
    const capturedCreateMode = useMindGrowStore.getState().currentMode;

    // A late tenant bootstrap used to reset the product board while the
    // create dialog remained open.
    useMindGrowStore.getState().resetTenantContext();
    expect(useMindGrowStore.getState().currentMode).toBe("knowledge");

    useMindGrowStore.getState().setCurrentMode(capturedCreateMode);
    useMindGrowStore.getState().setCurrentMapId("new-meeting-map");
    expect(useMindGrowStore.getState()).toMatchObject({
      currentMode: "meeting",
      currentMapId: "new-meeting-map",
    });
  });

  it("keeps only the second map when its response wins before the first request", () => {
    const first = request(1, scopeA, "map-a");
    const second = request(2, scopeA, "map-b");
    useMindGrowStore.getState().setCurrentMapId("map-b");
    const active = {
      requestId: 2,
      scopeKey: tenantScopeKey(scopeA),
      mapId: "map-b",
      mode: "knowledge" as const,
    };

    expect(commitPageGraphResponse(second, active, graph("second"))).toBe("applied");
    expect(commitPageGraphResponse(first, active, graph("late-first"))).toBe("rejected-stale-view");
    expect(useMindGrowStore.getState().nodes[0].content).toBe("second");
    expect(tenantCache.getMapGraph(scopeA, "map-b")?.snapshot.nodes[0].content).toBe("second");
    expect(tenantCache.getMapGraph(scopeA, "map-a")).toBeUndefined();
  });

  it("stores revalidation as server data while preserving a local overlay in Store", () => {
    useMindGrowStore.getState().setCurrentMapId("map-a");
    const revalidation = request(1, scopeA, "map-a");
    useMindGrowStore.getState().mutateGraphLocally("map-a", scopeA, (draft) => {
      draft.nodes = graph("local-edit").nodes;
    });

    const result = commitPageGraphResponse(revalidation, {
      requestId: 1,
      scopeKey: tenantScopeKey(scopeA),
      mapId: "map-a",
      mode: "knowledge",
    }, graph("server-new"));

    expect(result).toBe("rejected-local-dirty");
    expect(useMindGrowStore.getState().nodes[0].content).toBe("local-edit");
    expect(tenantCache.getCachedMapGraph(scopeA, "map-a")?.serverSnapshot?.nodes[0].content).toBe("server-new");
    expect(tenantCache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("local-edit");
  });

  it("rejects a late response after the active workspace changes", () => {
    useMindGrowStore.getState().setCurrentMapId("map-a");
    const oldWorkspaceRequest = request(1, scopeA, "map-a");

    expect(commitPageGraphResponse(oldWorkspaceRequest, {
      requestId: 1,
      scopeKey: tenantScopeKey(scopeB),
      mapId: "map-a",
      mode: "knowledge",
    }, graph("old-workspace"))).toBe("rejected-stale-view");
    expect(useMindGrowStore.getState().nodes).toEqual([]);
    expect(tenantCache.getMapGraph(scopeA, "map-a")).toBeUndefined();
    expect(tenantCache.getMapGraph(scopeB, "map-a")).toBeUndefined();
  });
});
