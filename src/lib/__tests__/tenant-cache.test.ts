import { describe, expect, it } from "vitest";
import {
  TenantCache,
  tenantMapKey,
  tenantScopeKey,
  type GraphSnapshot,
  type LocalOverlayToken,
  type TenantCacheEvent,
  type TenantScope,
  type UniverseSnapshot,
} from "@/lib/tenant-cache";

const scopeA: TenantScope = { userId: "user-a", workspaceId: "workspace-a" };
const scopeB: TenantScope = { userId: "user-b", workspaceId: "workspace-a" };
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

function universe(label: string): UniverseSnapshot {
  return {
    libraries: [{
      map: {
        id: `map-${label}`,
        name: label,
        description: "",
        mode: "knowledge",
        color: "#14b8a6",
        isDefault: false,
        categoryId: null,
        nodeCount: 1,
        createdAt,
        updatedAt: createdAt,
      },
      ...graph(label),
    }],
  };
}

describe("tenant cache keys", () => {
  it("includes user, workspace, and map without delimiter collisions", () => {
    expect(tenantScopeKey(scopeA)).not.toBe(tenantScopeKey(scopeB));
    expect(tenantMapKey(scopeA, "map-a")).not.toBe(tenantMapKey(scopeA, "map-b"));
    expect(tenantMapKey({ userId: "a:b", workspaceId: "c" }, "map"))
      .not.toBe(tenantMapKey({ userId: "a", workspaceId: "b:c" }, "map"));
    expect(() => tenantMapKey({ userId: "", workspaceId: "workspace" }, "map")).toThrow("userId is required");
  });
});

describe("tenant map graph cache", () => {
  it("rejects a stale server response after the matching epoch has advanced", () => {
    const cache = new TenantCache();
    const stale = cache.beginMapRead(scopeA, "map-a");
    const firstWinner = cache.beginMapRead(scopeA, "map-a");

    expect(cache.commitServerSnapshot(firstWinner, graph("server-v1"), 10)).toBe(true);
    expect(cache.commitServerSnapshot(stale, graph("stale"), 11)).toBe(false);

    const fresh = cache.beginMapRead(scopeA, "map-a");
    expect(fresh.baseEpoch).toBe(1);
    expect(cache.commitServerSnapshot(fresh, graph("server-v2"), 12)).toBe(true);
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("server-v2");
  });

  it("keeps a local overlay visible while a revalidation updates only the server snapshot", () => {
    const cache = new TenantCache();
    expect(cache.commitServerSnapshot(cache.beginMapRead(scopeA, "map-a"), graph("server-v1"), 10)).toBe(true);
    const revalidation = cache.beginMapRead(scopeA, "map-a");
    const local = cache.setLocalOverlay(scopeA, "map-a", graph("local-edit"), 11);

    expect(cache.commitServerSnapshot(revalidation, graph("server-v2"), 12)).toBe(true);
    expect(cache.getMapGraph(scopeA, "map-a")).toMatchObject({ source: "local", localRevision: local.revision });
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("local-edit");
    expect(cache.getCachedMapGraph(scopeA, "map-a")?.serverSnapshot?.nodes[0].content).toBe("server-v2");
    expect(cache.getCachedMapGraph(scopeA, "map-a")?.localBaseEpoch).toBe(1);
  });

  it("does not let an older write confirmation clear edits made while the write was pending", () => {
    const cache = new TenantCache();
    cache.commitServerSnapshot(cache.beginMapRead(scopeA, "map-a"), graph("server"));
    const firstWrite = cache.setLocalOverlay(scopeA, "map-a", graph("edit-1"));
    const secondWrite = cache.setLocalOverlay(scopeA, "map-a", graph("edit-2"));

    expect(cache.confirmLocalOverlay(firstWrite)).toBe(false);
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("edit-2");
    expect(cache.confirmLocalOverlay(secondWrite)).toBe(true);
    expect(cache.getMapGraph(scopeA, "map-a")).toMatchObject({ source: "server" });
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("edit-2");
    expect(cache.getCachedMapGraph(scopeA, "map-a")?.localOverlay).toBeUndefined();
  });

  it("clears a local overlay only for a matching explicit discard token", () => {
    const cache = new TenantCache();
    cache.commitServerSnapshot(cache.beginMapRead(scopeA, "map-a"), graph("server"));
    const token = cache.setLocalOverlay(scopeA, "map-a", graph("draft"));
    const wrongToken: LocalOverlayToken = { ...token, revision: token.revision + 1 };
    const wrongBase: LocalOverlayToken = { ...token, baseEpoch: token.baseEpoch + 1 };

    expect(cache.discardLocalOverlay(wrongToken)).toBe(false);
    expect(cache.discardLocalOverlay(wrongBase)).toBe(false);
    expect(cache.getMapGraph(scopeA, "map-a")?.source).toBe("local");
    expect(cache.discardLocalOverlay(token)).toBe(true);
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("server");
    expect(cache.discardLocalOverlay(token)).toBe(false);
  });

  it("keeps pending local data separate from the server snapshot and protects cached copies", () => {
    const cache = new TenantCache();
    const draft = graph("draft");
    const token = cache.setLocalOverlay(scopeA, "map-a", draft);
    draft.nodes[0].content = "mutated-outside";

    expect(cache.getCachedMapGraph(scopeA, "map-a")?.serverSnapshot).toBeUndefined();
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("draft");
    expect(cache.confirmLocalOverlay(token, graph("confirmed"))).toBe(true);
    expect(cache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("confirmed");
  });

  it("invalidates an in-flight read when a map is explicitly cleared", () => {
    const cache = new TenantCache();
    const inFlight = cache.beginMapRead(scopeA, "map-a");
    expect(cache.clearMap(scopeA, "map-a")).toBe(false);
    expect(cache.commitServerSnapshot(inFlight, graph("resurrected"))).toBe(false);
    expect(cache.getMapGraph(scopeA, "map-a")).toBeUndefined();
  });
});

describe("tenant universe cache and cleanup", () => {
  it("partitions universe and map snapshots by both user and workspace", () => {
    const cache = new TenantCache();
    cache.commitServerSnapshot(cache.beginMapRead(scopeA, "shared-map"), graph("user-a"));
    cache.commitServerSnapshot(cache.beginMapRead(scopeB, "shared-map"), graph("user-b"));
    cache.commitUniverseSnapshot(cache.beginUniverseRead(scopeA), universe("universe-a"), 10);
    cache.commitUniverseSnapshot(cache.beginUniverseRead(scopeB), universe("universe-b"), 11);

    expect(cache.getMapGraph(scopeA, "shared-map")?.snapshot.nodes[0].content).toBe("user-a");
    expect(cache.getMapGraph(scopeB, "shared-map")?.snapshot.nodes[0].content).toBe("user-b");
    expect(cache.getUniverseSnapshot(scopeA)?.snapshot.libraries[0].map.name).toBe("universe-a");
    expect(cache.getUniverseSnapshot(scopeB)?.snapshot.libraries[0].map.name).toBe("universe-b");
  });

  it("clears one tenant idempotently, notifies subscribers, and invalidates old tokens", () => {
    const cache = new TenantCache();
    const events: TenantCacheEvent[] = [];
    const unsubscribe = cache.subscribe((event) => events.push(event));
    cache.commitServerSnapshot(cache.beginMapRead(scopeA, "map-a"), graph("a"));
    cache.commitServerSnapshot(cache.beginMapRead(scopeB, "map-a"), graph("b"));
    cache.commitUniverseSnapshot(cache.beginUniverseRead(scopeA), universe("a"));
    const inFlight = cache.beginMapRead(scopeA, "map-late");

    expect(cache.clearAllTenantCache(scopeA)).toBe(true);
    expect(cache.clearAllTenantCache(scopeA)).toBe(false);
    expect(cache.getMapGraph(scopeA, "map-a")).toBeUndefined();
    expect(cache.getUniverseSnapshot(scopeA)).toBeUndefined();
    expect(cache.getMapGraph(scopeB, "map-a")?.snapshot.nodes[0].content).toBe("b");
    expect(cache.commitServerSnapshot(inFlight, graph("late"))).toBe(false);
    expect(events.filter((event) => event.type === "tenant-cleared").map((event) => event.changed)).toEqual([true, false]);

    unsubscribe();
    cache.clearAllTenantCache(scopeB);
    expect(events.filter((event) => event.type === "tenant-cleared")).toHaveLength(2);
  });
});
