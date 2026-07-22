import type { NodeLayout, WhiteboardGroup } from "@/types";

export const WHITEBOARD_CARD_WIDTH = 280;
export const WHITEBOARD_CARD_HEIGHT = 168;
export const WHITEBOARD_GROUP_COLLAPSED_HEIGHT = 76;
export const WHITEBOARD_GROUP_NODE_PREFIX = "__mindgrow_whiteboard_group__";
export const WHITEBOARD_LARGE_MAP_THRESHOLD = 80;

export type WhiteboardDetailLevel = "title" | "summary" | "full";

export interface WhiteboardCardGeometry {
  position: { x: number; y: number };
  width: number;
  height: number;
  groupId: string | null;
  persisted: boolean;
}

export interface WhiteboardDropGeometry {
  positionX: number;
  positionY: number;
  groupId: string | null;
}

/**
 * Large whiteboards disclose content as the user zooms in. The underlying
 * card content and citations are never rewritten or discarded; this only
 * controls how much of each card is painted at the current zoom level.
 */
export function whiteboardDetailLevel(
  cardCount: number,
  zoom: number,
  isMobile = false,
): WhiteboardDetailLevel {
  if (cardCount < WHITEBOARD_LARGE_MAP_THRESHOLD) return "full";
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;
  if (safeZoom < (isMobile ? 0.9 : 0.78)) return "title";
  if (safeZoom < (isMobile ? 1.18 : 1.05)) return "summary";
  return "full";
}

export function whiteboardGroupNodeId(groupId: string) {
  return `${WHITEBOARD_GROUP_NODE_PREFIX}${groupId}`;
}

export function whiteboardGroupIdFromNodeId(nodeId: string) {
  return nodeId.startsWith(WHITEBOARD_GROUP_NODE_PREFIX)
    ? nodeId.slice(WHITEBOARD_GROUP_NODE_PREFIX.length)
    : null;
}

export function isWhiteboardGroupNode(nodeId: string) {
  return whiteboardGroupIdFromNodeId(nodeId) !== null;
}

export function whiteboardGroupHeight(group: WhiteboardGroup) {
  return group.collapsed ? WHITEBOARD_GROUP_COLLAPSED_HEIGHT : group.height;
}

export function findWhiteboardGroupForCard(
  position: { x: number; y: number },
  width: number,
  height: number,
  groups: WhiteboardGroup[],
  mapId: string,
) {
  const centerX = position.x + width / 2;
  const centerY = position.y + height / 2;
  return groups
    .filter((group) => group.mapId === mapId && !group.collapsed)
    .filter((group) => (
      centerX >= group.positionX
      && centerX <= group.positionX + group.width
      && centerY >= group.positionY
      && centerY <= group.positionY + group.height
    ))
    .sort((left, right) => right.sortOrder - left.sortOrder || right.updatedAt.localeCompare(left.updatedAt))[0] || null;
}

/**
 * Ungrouped cards persist absolute whiteboard coordinates. Grouped cards use
 * coordinates relative to their group, so moving a group only needs one
 * durable write and never rewrites the knowledge graph.
 */
export function whiteboardDropGeometry(
  position: { x: number; y: number },
  width: number,
  height: number,
  groups: WhiteboardGroup[],
  mapId: string,
): WhiteboardDropGeometry {
  const group = findWhiteboardGroupForCard(position, width, height, groups, mapId);
  if (!group) return { positionX: position.x, positionY: position.y, groupId: null };
  return {
    positionX: position.x - group.positionX,
    positionY: position.y - group.positionY,
    groupId: group.id,
  };
}

export function absoluteWhiteboardPosition(layout: NodeLayout, groups: WhiteboardGroup[]) {
  if (!layout.groupId) return { x: layout.positionX, y: layout.positionY };
  const group = groups.find((candidate) => candidate.mapId === layout.mapId && candidate.id === layout.groupId);
  if (!group) return { x: layout.positionX, y: layout.positionY };
  return {
    x: group.positionX + layout.positionX,
    y: group.positionY + layout.positionY,
  };
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
  groups: WhiteboardGroup[] = [],
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
      position: absoluteWhiteboardPosition(layout, groups),
      width: layout.cardWidth,
      height: layout.cardHeight,
      groupId: layout.groupId,
      persisted: true,
    }];
  }));
}
