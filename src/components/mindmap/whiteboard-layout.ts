import type { NodeLayout } from "@/types";

export const WHITEBOARD_CARD_WIDTH = 280;
export const WHITEBOARD_CARD_HEIGHT = 168;

export interface WhiteboardCardGeometry {
  position: { x: number; y: number };
  width: number;
  height: number;
  groupId: string | null;
  persisted: boolean;
}

export function previewWhiteboardPosition(index: number, columns = 3) {
  const safeColumns = Math.max(1, Math.trunc(columns));
  return {
    x: 80 + (index % safeColumns) * (WHITEBOARD_CARD_WIDTH + 64),
    y: 96 + Math.floor(index / safeColumns) * (WHITEBOARD_CARD_HEIGHT + 64),
  };
}

/**
 * Produces a stable, non-persistent preview for cards that have never been
 * moved. Persisted positions always win and are scoped to the active map.
 */
export function buildWhiteboardCardGeometry(
  nodeIds: string[],
  layouts: NodeLayout[],
  mapId: string,
  columns = 3,
) {
  const layoutByNodeId = new Map(
    layouts
      .filter((layout) => layout.mapId === mapId)
      .map((layout) => [layout.nodeId, layout]),
  );

  return new Map<string, WhiteboardCardGeometry>(nodeIds.map((nodeId, index) => {
    const layout = layoutByNodeId.get(nodeId);
    if (!layout) {
      return [nodeId, {
        position: previewWhiteboardPosition(index, columns),
        width: WHITEBOARD_CARD_WIDTH,
        height: WHITEBOARD_CARD_HEIGHT,
        groupId: null,
        persisted: false,
      }];
    }
    return [nodeId, {
      position: { x: layout.positionX, y: layout.positionY },
      width: layout.cardWidth,
      height: layout.cardHeight,
      groupId: layout.groupId,
      persisted: true,
    }];
  }));
}
