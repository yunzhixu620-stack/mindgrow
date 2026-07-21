import { beforeEach, describe, expect, it } from "vitest";
import { tenantCache, type GraphSnapshot, type TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore } from "@/store/mindgrow-store";

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

function selectMap(mapId = "map-a") {
  useMindGrowStore.getState().setCurrentMapId(mapId);
}

beforeEach(() => {
  useMindGrowStore.getState().resetTenantContext();
  tenantCache.clearAllTenantCache(scopeA);
  tenantCache.clearAllTenantCache(scopeB);
});

describe("MindGrow Store graph channels", () => {
  it("hydrates an active map from a matching server request and protects the cached copy", () => {
    selectMap();
    const store = useMindGrowStore.getState();
    const token = tenantCache.beginMapRead(scopeA, "map-a");
    const payload = graph("server-v1");

    expect(store.hydrateGraphFromServer("map-a", payload, store.getHydrationEpoch("map-a"), scopeA, token)).toBe("applied");
    expect(useMindGrowStore.getState().nodes[0].content).toBe("server-v1");
    expect(useMindGrowStore.getState().getHydrationEpoch("map-a")).toBe(1);
    expect(tenantCache.getMapGraph(scopeA, "map-a")?.source).toBe("server");

    payload.nodes[0].content = "mutated-outside";
    expect(useMindGrowStore.getState().nodes[0].content).toBe("server-v1");
  });

  it("rejects a response with an old hydration epoch before it can change Store or cache", () => {
    selectMap();
    const firstToken = tenantCache.beginMapRead(scopeA, "map-a");
    const staleToken = tenantCache.beginMapRead(scopeA, "map-a");
    const baseEpoch = useMindGrowStore.getState().getHydrationEpoch("map-a");

    expect(useMindGrowStore.getState().hydrateGraphFromServer("map-a", graph("winner"), baseEpoch, scopeA, firstToken)).toBe("applied");
    expect(useMindGrowStore.getState().hydrateGraphFromServer("map-a", graph("stale"), baseEpoch, scopeA, staleToken)).toBe("rejected-stale-request");
    expect(useMindGrowStore.getState().nodes[0].content).toBe("winner");
    expect(tenantCache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("winner");
  });

  it("writes local Immer edits to the overlay without mutating prior Store arrays", () => {
    selectMap();
    useMindGrowStore.getState().hydrateGraphFromServer(
      "map-a",
      graph("server"),
      0,
      scopeA,
      tenantCache.beginMapRead(scopeA, "map-a"),
    );
    const beforeNodes = useMindGrowStore.getState().nodes;
    const beforeNode = beforeNodes[0];

    const localToken = useMindGrowStore.getState().mutateGraphLocally("map-a", scopeA, (draft) => {
      draft.nodes[0].content = "local-edit";
      draft.nodes.push({ ...draft.nodes[0], id: "node-added", content: "added" });
    });

    expect(localToken).not.toBeNull();
    expect(useMindGrowStore.getState().getLocalEditVersion("map-a")).toBe(1);
    expect(useMindGrowStore.getState().nodes).not.toBe(beforeNodes);
    expect(beforeNode.content).toBe("server");
    expect(useMindGrowStore.getState().nodes.map((node) => node.content)).toEqual(["local-edit", "added"]);
    expect(tenantCache.getMapGraph(scopeA, "map-a")).toMatchObject({ source: "local" });
    expect(tenantCache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("local-edit");
  });

  it("records a newer server snapshot but keeps a local overlay visible", () => {
    selectMap();
    const requestToken = tenantCache.beginMapRead(scopeA, "map-a");
    useMindGrowStore.getState().mutateGraphLocally("map-a", scopeA, (draft) => {
      draft.nodes = graph("local").nodes;
    });

    const result = useMindGrowStore.getState().hydrateGraphFromServer("map-a", graph("server"), 0, scopeA, requestToken);

    expect(result).toBe("rejected-local-dirty");
    expect(useMindGrowStore.getState().nodes[0].content).toBe("local");
    expect(useMindGrowStore.getState().getHydrationEpoch("map-a")).toBe(1);
    expect(tenantCache.getCachedMapGraph(scopeA, "map-a")?.serverSnapshot?.nodes[0].content).toBe("server");
    expect(tenantCache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("local");
  });

  it("does not let an older write confirmation clear edits made while it was pending", () => {
    selectMap();
    const firstWrite = useMindGrowStore.getState().mutateGraphLocally("map-a", scopeA, (draft) => {
      draft.nodes = graph("edit-1").nodes;
    });
    const secondWrite = useMindGrowStore.getState().mutateGraphLocally("map-a", scopeA, (draft) => {
      draft.nodes[0].content = "edit-2";
    });

    expect(firstWrite).not.toBeNull();
    expect(secondWrite).not.toBeNull();
    expect(tenantCache.confirmLocalOverlay(firstWrite!)).toBe(false);
    expect(useMindGrowStore.getState().nodes[0].content).toBe("edit-2");
    expect(useMindGrowStore.getState().getLocalEditVersion("map-a")).toBe(2);
    expect(tenantCache.getMapGraph(scopeA, "map-a")?.snapshot.nodes[0].content).toBe("edit-2");
  });

  it("uses overlay existence as dirty authority instead of comparing causal counters", () => {
    selectMap();
    const localToken = useMindGrowStore.getState().mutateGraphLocally("map-a", scopeA, (draft) => {
      draft.nodes = graph("local").nodes;
    });
    expect(localToken).not.toBeNull();
    expect(tenantCache.discardLocalOverlay(localToken!)).toBe(true);
    expect(useMindGrowStore.getState().getLocalEditVersion("map-a")).toBe(1);

    const result = useMindGrowStore.getState().hydrateGraphFromServer(
      "map-a",
      graph("server-after-discard"),
      0,
      scopeA,
      tenantCache.beginMapRead(scopeA, "map-a"),
    );

    expect(result).toBe("applied");
    expect(useMindGrowStore.getState().nodes[0].content).toBe("server-after-discard");
    expect(useMindGrowStore.getState().getLocalEditVersion("map-a")).toBe(1);
  });

  it("ignores local mutation requests for a map that is no longer active", () => {
    selectMap("map-active");
    const before = useMindGrowStore.getState();

    expect(before.mutateGraphLocally("map-stale", scopeA, (draft) => {
      draft.nodes = graph("must-not-apply").nodes;
    })).toBeNull();
    expect(useMindGrowStore.getState().nodes).toEqual([]);
    expect(useMindGrowStore.getState().getLocalEditVersion("map-stale")).toBe(0);
    expect(tenantCache.getMapGraph(scopeA, "map-stale")).toBeUndefined();
  });

  it("rejects a cache read token issued for another map", () => {
    selectMap("map-a");
    const wrongMapToken = tenantCache.beginMapRead(scopeA, "map-b");

    expect(useMindGrowStore.getState().hydrateGraphFromServer("map-a", graph("wrong-map"), 0, scopeA, wrongMapToken))
      .toBe("rejected-stale-request");
    expect(useMindGrowStore.getState().nodes).toEqual([]);
    expect(tenantCache.getMapGraph(scopeA, "map-a")).toBeUndefined();
    expect(tenantCache.getMapGraph(scopeA, "map-b")).toBeUndefined();
  });
});

describe("MindGrow Store tenant reset", () => {
  it("clears every tenant-owned field idempotently while preserving UI preferences", () => {
    useMindGrowStore.setState({
      currentMapId: "map-a",
      maps: [{
        id: "map-a", name: "Tenant map", description: "", color: "#14b8a6", isDefault: false,
        categoryId: "category-a", nodeCount: 1, createdAt, updatedAt: createdAt,
      }],
      categories: [{ id: "category-a", name: "Tenant", icon: "T", color: "#14b8a6", sortOrder: 1, createdAt }],
      ...graph("tenant"),
      history: [{ nodes: graph("history").nodes, edges: [], timestamp: 1 }],
      historyIndex: 0,
      messages: [{ id: "message-a", role: "user", content: "tenant message", timestamp: createdAt }],
      chatHistory: { "map-a": [{ id: "message-b", role: "assistant", content: "history", timestamp: createdAt }] },
      messageMapId: "map-a",
      isProcessing: true,
      pendingSuggestion: { type: "placement", content: "suggestion" },
      pendingMindMap: { root: "root", children: [] },
      pendingPlacement: { targetTopic: "topic", confidence: 0.8, reason: "reason" },
      searchQuery: "query",
      searchResults: ["node-tenant"],
      editingNodeId: "node-tenant",
      contextMenu: { nodeId: "node-tenant", x: 10, y: 20 },
      highlightedNodeId: "node-tenant",
      collapsedNodes: new Set(["node-tenant"]),
      hydrationEpochByMap: { "map-a": 4 },
      localEditVersionByMap: { "map-a": 7 },
      localOverlayTokenByMap: { "map-a": { key: "tenant:user-a:workspace-a:map:map-a", tenantKey: "tenant:user-a:workspace-a", revision: 7, baseEpoch: 4 } },
      pendingWritesByMap: { "map-a": 1 },
      activeWriteRequests: {
        write_reset: { requestId: "write_reset", mapId: "map-a", scope: scopeA, localEditVersionAtStart: 7 },
      },
      lastWriteSucceededAtByMap: { "map-a": 10 },
      lastWriteErrorByMap: { "map-a": { message: "failed", at: 11 } },
      currentMode: "article",
      sidebarOpen: false,
      layoutDirection: "horizontal",
      showHelp: true,
    });

    useMindGrowStore.getState().resetTenantContext();
    const reset = useMindGrowStore.getState();
    expect({
      currentMapId: reset.currentMapId,
      maps: reset.maps,
      categories: reset.categories,
      nodes: reset.nodes,
      edges: reset.edges,
      entityGraph: reset.entityGraph,
      history: reset.history,
      historyIndex: reset.historyIndex,
      messages: reset.messages,
      chatHistory: reset.chatHistory,
      messageMapId: reset.messageMapId,
      isProcessing: reset.isProcessing,
      pendingSuggestion: reset.pendingSuggestion,
      pendingMindMap: reset.pendingMindMap,
      pendingPlacement: reset.pendingPlacement,
      searchQuery: reset.searchQuery,
      searchResults: reset.searchResults,
      editingNodeId: reset.editingNodeId,
      contextMenu: reset.contextMenu,
      highlightedNodeId: reset.highlightedNodeId,
      collapsedNodes: reset.collapsedNodes,
      hydrationEpochByMap: reset.hydrationEpochByMap,
      localEditVersionByMap: reset.localEditVersionByMap,
      localOverlayTokenByMap: reset.localOverlayTokenByMap,
      pendingWritesByMap: reset.pendingWritesByMap,
      activeWriteRequests: reset.activeWriteRequests,
      lastWriteSucceededAtByMap: reset.lastWriteSucceededAtByMap,
      lastWriteErrorByMap: reset.lastWriteErrorByMap,
      currentMode: reset.currentMode,
    }).toEqual({
      currentMapId: "map_default",
      maps: [],
      categories: [],
      nodes: [],
      edges: [],
      entityGraph: { entities: [], relations: [] },
      history: [],
      historyIndex: -1,
      messages: [],
      chatHistory: {},
      messageMapId: null,
      isProcessing: false,
      pendingSuggestion: null,
      pendingMindMap: null,
      pendingPlacement: null,
      searchQuery: "",
      searchResults: [],
      editingNodeId: null,
      contextMenu: null,
      highlightedNodeId: null,
      collapsedNodes: new Set(),
      hydrationEpochByMap: {},
      localEditVersionByMap: {},
      localOverlayTokenByMap: {},
      pendingWritesByMap: {},
      activeWriteRequests: {},
      lastWriteSucceededAtByMap: {},
      lastWriteErrorByMap: {},
      currentMode: "knowledge",
    });
    expect({ sidebarOpen: reset.sidebarOpen, layoutDirection: reset.layoutDirection, showHelp: reset.showHelp })
      .toEqual({ sidebarOpen: false, layoutDirection: "horizontal", showHelp: true });

    expect(() => useMindGrowStore.getState().resetTenantContext()).not.toThrow();
    expect(useMindGrowStore.getState().currentMapId).toBe("map_default");
    expect(useMindGrowStore.getState().hydrationEpochByMap).toEqual({});
  });
});
