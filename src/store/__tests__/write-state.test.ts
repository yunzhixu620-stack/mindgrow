import { beforeEach, describe, expect, it } from "vitest";
import { sanitizeWriteErrorMessage } from "@/lib/client-api";
import { tenantCache, type GraphSnapshot, type TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore } from "@/store/mindgrow-store";

const scope: TenantScope = { userId: "user-a", workspaceId: "workspace-a" };
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

function mutate(mapId: string, label: string) {
  useMindGrowStore.getState().setCurrentMapId(mapId);
  return useMindGrowStore.getState().mutateGraphLocally(mapId, scope, (draft) => {
    draft.nodes = graph(label).nodes;
  });
}

beforeEach(() => {
  useMindGrowStore.getState().resetTenantContext();
  tenantCache.clearAllTenantCache(scope);
});

describe("map-scoped write lifecycle", () => {
  it("confirms exactly the local overlay version sent by a successful write", () => {
    expect(mutate("map-a", "edit-1")).not.toBeNull();
    const write = useMindGrowStore.getState().beginWrite("map-a", scope);

    expect(write.localEditVersionAtStart).toBe(1);
    expect(useMindGrowStore.getState().pendingWritesByMap["map-a"]).toBe(1);
    expect(useMindGrowStore.getState().endWrite(write, { ok: true })).toBe("confirmed");

    const state = useMindGrowStore.getState();
    expect(state.pendingWritesByMap["map-a"]).toBeUndefined();
    expect(state.lastWriteSucceededAtByMap["map-a"]).toEqual(expect.any(Number));
    expect(state.isMapDirty("map-a")).toBe(false);
    expect(tenantCache.getMapGraph(scope, "map-a")).toMatchObject({ source: "server" });
    expect(tenantCache.getMapGraph(scope, "map-a")?.snapshot.nodes[0].content).toBe("edit-1");
  });

  it("preserves a newer edit when an older write succeeds", () => {
    mutate("map-a", "edit-1");
    const write = useMindGrowStore.getState().beginWrite("map-a", scope);
    mutate("map-a", "edit-2");

    expect(useMindGrowStore.getState().endWrite(write, { ok: true })).toBe("preserved-local");
    expect(useMindGrowStore.getState().isMapDirty("map-a")).toBe(true);
    expect(tenantCache.getMapGraph(scope, "map-a")?.snapshot.nodes[0].content).toBe("edit-2");
  });

  it("keeps failures, success timestamps, and pending counts isolated by map", () => {
    const writeA = useMindGrowStore.getState().beginWrite("map-a", scope);
    const writeB = useMindGrowStore.getState().beginWrite("map-b", scope);

    expect(useMindGrowStore.getState().endWrite(writeA, { ok: false, code: "HTTP_500", message: "safe error" })).toBe("failed");
    let state = useMindGrowStore.getState();
    expect(state.lastWriteErrorByMap["map-a"]).toMatchObject({ code: "HTTP_500", message: "safe error" });
    expect(state.lastWriteErrorByMap["map-b"]).toBeUndefined();
    expect(state.pendingWritesByMap["map-b"]).toBe(1);

    expect(state.endWrite(writeB, { ok: true })).toBe("confirmed");
    state = useMindGrowStore.getState();
    expect(state.lastWriteSucceededAtByMap["map-b"]).toEqual(expect.any(Number));
    expect(state.lastWriteErrorByMap["map-a"]).toBeDefined();
  });

  it("treats abort as cancellation and keeps the local overlay without an error", () => {
    mutate("map-a", "offline-edit");
    const write = useMindGrowStore.getState().beginWrite("map-a", scope);

    expect(useMindGrowStore.getState().endWrite(write, { ok: false, cancelled: true })).toBe("cancelled");
    expect(useMindGrowStore.getState().lastWriteErrorByMap["map-a"]).toBeUndefined();
    expect(useMindGrowStore.getState().isMapDirty("map-a")).toBe(true);
  });

  it("ignores a completion from before the tenant reset", () => {
    const write = useMindGrowStore.getState().beginWrite("map-a", scope);
    useMindGrowStore.getState().resetTenantContext();

    expect(useMindGrowStore.getState().endWrite(write, { ok: false, message: "late" })).toBe("ignored-stale-write");
    expect(useMindGrowStore.getState().pendingWritesByMap).toEqual({});
    expect(useMindGrowStore.getState().lastWriteErrorByMap).toEqual({});
  });
});

describe("write error redaction", () => {
  it("removes authorization and token material before storing UI errors", () => {
    const sanitized = sanitizeWriteErrorMessage("Authorization: Bearer eyJheader.eyJpayload.signature token=super-secret-value");
    expect(sanitized).not.toContain("super-secret-value");
    expect(sanitized).not.toContain("eyJpayload");
    expect(sanitized).toContain("[redacted]");
  });
});
