import { describe, expect, it } from "vitest";
import type { NodeLayout } from "@/types";
import {
  buildWhiteboardCardGeometry,
  previewWhiteboardPosition,
  WHITEBOARD_CARD_HEIGHT,
  WHITEBOARD_CARD_WIDTH,
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

  it("prefers persisted position, size, and group for the active map", () => {
    const geometry = buildWhiteboardCardGeometry(["node-a", "node-b"], [savedLayout], "map-a");
    expect(geometry.get("node-b")).toEqual({
      position: { x: 777, y: 456 },
      width: 360,
      height: 220,
      groupId: "group-a",
      persisted: true,
    });
  });

  it("ignores layouts from another map", () => {
    const geometry = buildWhiteboardCardGeometry(["node-b"], [savedLayout], "map-b");
    expect(geometry.get("node-b")).toMatchObject({
      position: previewWhiteboardPosition(0),
      persisted: false,
    });
  });
});
