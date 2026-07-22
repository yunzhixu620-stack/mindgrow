import { describe, expect, it } from "vitest";

const { __whiteboardInternal, __mapModeInternal } = require("../../../fc-proxy/index.js") as {
  __mapModeInternal: { convertMap: (row: Record<string, unknown>) => Record<string, unknown> };
  __whiteboardInternal: {
    boundedWhiteboardNumber: (value: unknown, fallback: number, min: number, max: number) => number | null;
    convertNodeLayout: (row: Record<string, unknown>) => Record<string, unknown>;
    convertWhiteboardGroup: (row: Record<string, unknown>) => Record<string, unknown>;
    normalizedNodeLayoutInput: (body: Record<string, unknown>, workspaceId: string, defaultMapId: string) => Record<string, unknown> | null;
    normalizedNodeLayoutBatchInput: (body: Record<string, unknown>, workspaceId: string, defaultMapId: string) => Record<string, unknown>[] | null;
    normalizedWhiteboardGroupInput: (body: Record<string, unknown>, workspaceId: string, defaultMapId: string, existing: Record<string, unknown> | null) => Record<string, unknown> | null;
  };
};

describe("S2.8.1 whiteboard persistence model", () => {
  it("keeps the product mode separate from the visual canvas view", () => {
    expect(__mapModeInternal.convertMap({ id: "map-a", mode: "article", canvas_view: "whiteboard" })).toMatchObject({
      mode: "article",
      canvasView: "whiteboard",
    });
    expect(__mapModeInternal.convertMap({ id: "map-old", mode: "knowledge" })).toMatchObject({ canvasView: "mindmap" });
  });

  it("normalizes a card layout without copying node content", () => {
    const layout = __whiteboardInternal.normalizedNodeLayoutInput({
      nodeId: "node-a",
      mapId: "map-a",
      positionX: 0,
      positionY: -240,
      zoomLevel: 1.25,
      groupId: "group-a",
      cardWidth: 320,
      cardHeight: 180,
    }, "workspace-a", "map-default");

    expect(layout).toMatchObject({
      node_id: "node-a",
      map_id: "map-a",
      workspace_id: "workspace-a",
      position_x: 0,
      position_y: -240,
      zoom_level: 1.25,
      group_id: "group-a",
      card_width: 320,
      card_height: 180,
    });
    expect(layout).not.toHaveProperty("content");
    expect(layout).not.toHaveProperty("citations");
  });

  it("rejects non-finite and out-of-range geometry", () => {
    expect(__whiteboardInternal.boundedWhiteboardNumber("bad", 0, -10, 10)).toBeNull();
    expect(__whiteboardInternal.normalizedNodeLayoutInput({ nodeId: "node-a", positionX: 100001 }, "workspace-a", "map-a")).toBeNull();
    expect(__whiteboardInternal.normalizedNodeLayoutInput({ nodeId: "node-a", cardWidth: 120 }, "workspace-a", "map-a")).toBeNull();
  });

  it("normalizes an atomic batch of layouts for one map", () => {
    const rows = __whiteboardInternal.normalizedNodeLayoutBatchInput({
      mapId: "map-a",
      layouts: [
        { nodeId: "node-a", positionX: 24, positionY: 32, groupId: null },
        { nodeId: "node-b", positionX: 80, positionY: 96, groupId: "group-a" },
      ],
    }, "workspace-a", "map-default");
    expect(rows).toHaveLength(2);
    expect(rows?.map((row) => row.map_id)).toEqual(["map-a", "map-a"]);
    expect(__whiteboardInternal.normalizedNodeLayoutBatchInput({
      mapId: "map-a",
      layouts: [{ nodeId: "node-a" }, { nodeId: "node-a" }],
    }, "workspace-a", "map-default")).toBeNull();
    expect(__whiteboardInternal.normalizedNodeLayoutBatchInput({ mapId: "map-a", layouts: [] }, "workspace-a", "map-default")).toBeNull();
  });

  it("creates and updates a bounded spatial group while preserving identity", () => {
    const created = __whiteboardInternal.normalizedWhiteboardGroupInput({
      id: "wbg_client_group_a",
      mapId: "map-a",
      name: "检索方法",
      color: "#38bdf8",
      positionX: 120,
      positionY: 80,
      width: 900,
      height: 560,
    }, "workspace-a", "map-default", null);
    expect(created).toMatchObject({
      id: "wbg_client_group_a",
      workspace_id: "workspace-a",
      map_id: "map-a",
      name: "检索方法",
      color: "#38bdf8",
      position_x: 120,
      position_y: 80,
      width: 900,
      height: 560,
      collapsed: false,
    });

    const updated = __whiteboardInternal.normalizedWhiteboardGroupInput({ mapId: "map-a", width: 980, collapsed: true }, "workspace-a", "map-default", created);
    expect(updated).toMatchObject({
      id: created?.id,
      created_at: created?.created_at,
      map_id: "map-a",
      name: "检索方法",
      width: 980,
      collapsed: true,
    });
  });

  it("rejects empty group names and unsafe geometry", () => {
    expect(__whiteboardInternal.normalizedWhiteboardGroupInput({ name: "" }, "workspace-a", "map-a", null)).toBeNull();
    expect(__whiteboardInternal.normalizedWhiteboardGroupInput({ name: "A", width: 120 }, "workspace-a", "map-a", null)).toBeNull();
    expect(__whiteboardInternal.normalizedWhiteboardGroupInput({ name: "A", color: "red" }, "workspace-a", "map-a", null)).toBeNull();
    expect(__whiteboardInternal.normalizedWhiteboardGroupInput({ name: "A", collapsed: "false" }, "workspace-a", "map-a", null)).toBeNull();
    expect(__whiteboardInternal.normalizedWhiteboardGroupInput({ id: "unsafe", name: "A" }, "workspace-a", "map-a", null)).toBeNull();
  });

  it("converts storage rows to the stable frontend contract", () => {
    expect(__whiteboardInternal.convertNodeLayout({
      node_id: "node-a", map_id: "map-a", position_x: 12, position_y: 34, zoom_level: 1,
      group_id: null, card_width: 280, card_height: 168, updated_at: "2026-07-22T00:00:00.000Z",
    })).toEqual({
      nodeId: "node-a", mapId: "map-a", positionX: 12, positionY: 34, zoomLevel: 1,
      groupId: null, cardWidth: 280, cardHeight: 168, updatedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(__whiteboardInternal.convertWhiteboardGroup({
      id: "group-a", map_id: "map-a", name: "方法", color: "#22d3a7", position_x: 0, position_y: 0,
      width: 720, height: 480, collapsed: false, sort_order: 2, created_at: "c", updated_at: "u",
    })).toMatchObject({ id: "group-a", mapId: "map-a", name: "方法", sortOrder: 2, createdAt: "c", updatedAt: "u" });
  });
});
