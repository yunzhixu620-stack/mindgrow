import { describe, expect, it } from "vitest";
import type { NodeLayout, WhiteboardGroup } from "@/types";
import {
  absoluteWhiteboardPosition,
  buildWhiteboardCardGeometry,
  findWhiteboardGroupForCard,
  isWhiteboardGroupNode,
  previewWhiteboardPosition,
  whiteboardDropGeometry,
  whiteboardGroupIdFromNodeId,
  whiteboardGroupNodeId,
  whiteboardDetailLevel,
  whiteboardPreviewColumns,
  WHITEBOARD_CARD_HEIGHT,
  WHITEBOARD_CARD_WIDTH,
  WHITEBOARD_LARGE_MAP_THRESHOLD,
} from "./whiteboard-layout";

const savedLayout: NodeLayout = {
  nodeId: "node-b",
  mapId: "map-a",
  positionX: 777,
  positionY: 456,
  zoomLevel: 1,
  groupId: "group-a",
  cardWidth: 360,
  cardHeight: 220,
  updatedAt: "2026-07-22T00:00:00.000Z",
};

const savedGroup: WhiteboardGroup = {
  id: "group-a",
  mapId: "map-a",
  name: "RAG 检索",
  color: "#22d3a7",
  positionX: 500,
  positionY: 300,
  width: 720,
  height: 480,
  collapsed: false,
  sortOrder: 1,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

describe("whiteboard card geometry", () => {
  it("uses a deterministic grid for unsaved cards", () => {
    expect(previewWhiteboardPosition(0)).toEqual({ x: 80, y: 96 });
    expect(previewWhiteboardPosition(3)).toEqual({
      x: 80,
      y: 96 + WHITEBOARD_CARD_HEIGHT + 64,
    });

    const first = buildWhiteboardCardGeometry(["node-a", "node-b"], [], "map-a");
    const second = buildWhiteboardCardGeometry(["node-a", "node-b"], [], "map-a");
    expect(second).toEqual(first);
    expect(first.get("node-a")).toMatchObject({
      width: WHITEBOARD_CARD_WIDTH,
      height: WHITEBOARD_CARD_HEIGHT,
      groupId: null,
      persisted: false,
    });
  });

  it("uses a compact viewport-shaped grid instead of a long fixed-column strip", () => {
    expect(whiteboardPreviewColumns(1)).toBe(1);
    expect(whiteboardPreviewColumns(6)).toBe(3);
    expect(whiteboardPreviewColumns(135)).toBe(12);

    const columns = whiteboardPreviewColumns(135);
    const rows = Math.ceil(135 / columns);
    const width = columns * WHITEBOARD_CARD_WIDTH + (columns - 1) * 64;
    const height = rows * WHITEBOARD_CARD_HEIGHT + (rows - 1) * 64;
    expect(rows).toBe(12);
    expect(width / height).toBeGreaterThan(1.4);
    expect(width / height).toBeLessThan(1.7);
  });

  it("uses a bounded portrait grid for large mobile whiteboards", () => {
    expect(whiteboardPreviewColumns(135, true)).toBe(6);
    expect(Math.ceil(135 / whiteboardPreviewColumns(135, true))).toBe(23);
  });

  it("prefers persisted position, size, and group for the active map", () => {
    const geometry = buildWhiteboardCardGeometry(["node-a", "node-b"], [savedLayout], "map-a", 3, [savedGroup]);
    expect(geometry.get("node-b")).toEqual({
      position: { x: 1277, y: 756 },
      width: 360,
      height: 220,
      groupId: "group-a",
      persisted: true,
    });
  });

  it("stores grouped cards relative to the group and ungrouped cards absolutely", () => {
    expect(findWhiteboardGroupForCard({ x: 620, y: 390 }, 280, 168, [savedGroup], "map-a")?.id).toBe("group-a");
    expect(whiteboardDropGeometry({ x: 620, y: 390 }, 280, 168, [savedGroup], "map-a")).toEqual({
      positionX: 120,
      positionY: 90,
      groupId: "group-a",
    });
    expect(whiteboardDropGeometry({ x: 40, y: 40 }, 280, 168, [savedGroup], "map-a")).toEqual({
      positionX: 40,
      positionY: 40,
      groupId: null,
    });
  });

  it("ignores collapsed and cross-map groups when assigning a card", () => {
    expect(findWhiteboardGroupForCard(
      { x: 620, y: 390 },
      280,
      168,
      [{ ...savedGroup, collapsed: true }, { ...savedGroup, id: "group-b", mapId: "map-b", collapsed: false }],
      "map-a",
    )).toBeNull();
  });

  it("converts relative coordinates back to absolute whiteboard positions", () => {
    expect(absoluteWhiteboardPosition(savedLayout, [savedGroup])).toEqual({ x: 1277, y: 756 });
    expect(absoluteWhiteboardPosition({ ...savedLayout, groupId: null }, [savedGroup])).toEqual({ x: 777, y: 456 });
  });

  it("uses collision-safe display-only ids for group nodes", () => {
    const nodeId = whiteboardGroupNodeId("group-a");
    expect(isWhiteboardGroupNode(nodeId)).toBe(true);
    expect(whiteboardGroupIdFromNodeId(nodeId)).toBe("group-a");
    expect(isWhiteboardGroupNode("node-a")).toBe(false);
  });

  it("ignores layouts from another map", () => {
    const geometry = buildWhiteboardCardGeometry(["node-b"], [savedLayout], "map-b");
    expect(geometry.get("node-b")).toMatchObject({
      position: previewWhiteboardPosition(0),
      persisted: false,
    });
  });

  it("progressively reveals large-card details without changing small boards", () => {
    expect(whiteboardDetailLevel(WHITEBOARD_LARGE_MAP_THRESHOLD - 1, 0.2)).toBe("full");
    expect(whiteboardDetailLevel(500, 0.6)).toBe("title");
    expect(whiteboardDetailLevel(500, 0.88)).toBe("summary");
    expect(whiteboardDetailLevel(500, 1.1)).toBe("full");
    expect(whiteboardDetailLevel(500, 0.88, true)).toBe("title");
    expect(whiteboardDetailLevel(500, 1, true)).toBe("summary");
  });

  it("builds 500 stable card geometries within the interaction budget", () => {
    const nodeIds = Array.from({ length: 500 }, (_, index) => `node-${index}`);
    const startedAt = performance.now();
    const geometry = buildWhiteboardCardGeometry(nodeIds, [], "map-a", 12);
    const duration = performance.now() - startedAt;
    expect(geometry.size).toBe(500);
    expect(geometry.get("node-499")?.position).toEqual(previewWhiteboardPosition(499, 12));
    expect(duration).toBeLessThan(250);
  });
});
