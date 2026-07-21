import { beforeEach, describe, expect, it } from "vitest";
import { resetTenantData, resolveAuthTransition } from "@/components/auth/auth-tenant-reset";
import { tenantCache, type GraphSnapshot, type TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore } from "@/store/mindgrow-store";

const scopeA1: TenantScope = { userId: "user-a", workspaceId: "workspace-1" };
const scopeA2: TenantScope = { userId: "user-a", workspaceId: "workspace-2" };
const scopeB1: TenantScope = { userId: "user-b", workspaceId: "workspace-1" };
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
  };
}

function seedCache(scope: TenantScope, mapId: string, label: string) {
  tenantCache.commitServerSnapshot(tenantCache.beginMapRead(scope, mapId), graph(label));
}

beforeEach(() => {
  useMindGrowStore.getState().resetTenantContext();
  tenantCache.clearAllTenantCache(scopeA1);
  tenantCache.clearAllTenantCache(scopeA2);
  tenantCache.clearAllTenantCache(scopeB1);
});

describe("auth transition reset decisions", () => {
  it("uses nextSession.user.id to detect an account switch", () => {
    expect(resolveAuthTransition("SIGNED_IN", "user-a", { user: { id: "user-b" } })).toEqual({
      nextUserId: "user-b",
      shouldReset: true,
    });
  });

  it("keeps a refreshed session for the same user without resetting", () => {
    expect(resolveAuthTransition("TOKEN_REFRESHED", "user-a", { user: { id: "user-a" } })).toEqual({
      nextUserId: "user-a",
      shouldReset: false,
    });
  });

  it("routes sign-out and a missing refreshed session through reset", () => {
    expect(resolveAuthTransition("SIGNED_OUT", "user-a", null)).toEqual({ nextUserId: null, shouldReset: true });
    expect(resolveAuthTransition("TOKEN_REFRESHED", "user-a", null)).toEqual({ nextUserId: null, shouldReset: true });
  });
});

describe("auth tenant data reset", () => {
  it("clears every known workspace for the previous user before another user loads", () => {
    seedCache(scopeA1, "map-a1", "a1");
    seedCache(scopeA2, "map-a2", "a2");
    seedCache(scopeB1, "map-b1", "b1");
    useMindGrowStore.setState({
      currentMapId: "map-a1",
      nodes: graph("visible-a").nodes,
      messages: [{ id: "message-a", role: "user", content: "private", timestamp: createdAt }],
      searchQuery: "private query",
      collapsedNodes: new Set(["node-visible-a"]),
      hydrationEpochByMap: { "map-a1": 3 },
      localEditVersionByMap: { "map-a1": 2 },
    });

    resetTenantData("user-a", ["workspace-1", "workspace-2", "workspace-1", ""]);

    expect(tenantCache.getMapGraph(scopeA1, "map-a1")).toBeUndefined();
    expect(tenantCache.getMapGraph(scopeA2, "map-a2")).toBeUndefined();
    expect(tenantCache.getMapGraph(scopeB1, "map-b1")?.snapshot.nodes[0].content).toBe("b1");
    expect(useMindGrowStore.getState()).toMatchObject({
      currentMapId: "map_default",
      nodes: [],
      messages: [],
      searchQuery: "",
      hydrationEpochByMap: {},
      localEditVersionByMap: {},
    });
    expect(useMindGrowStore.getState().collapsedNodes).toEqual(new Set());
  });

  it("is safe and produces the same cleared state when called repeatedly", () => {
    seedCache(scopeA1, "map-a1", "a1");
    useMindGrowStore.setState({ currentMapId: "map-a1", nodes: graph("visible-a").nodes });

    expect(() => resetTenantData("user-a", ["workspace-1"])).not.toThrow();
    expect(() => resetTenantData("user-a", ["workspace-1"])).not.toThrow();

    expect(tenantCache.getMapGraph(scopeA1, "map-a1")).toBeUndefined();
    expect(useMindGrowStore.getState().currentMapId).toBe("map_default");
    expect(useMindGrowStore.getState().nodes).toEqual([]);
  });
});
