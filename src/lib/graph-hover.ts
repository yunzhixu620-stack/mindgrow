export const GRAPH_DIMMED_OPACITY = 0.25;

export interface GraphConnection {
  source: string;
  target: string;
}

export function oneHopNodeIds(focusedNodeId: string | null, connections: GraphConnection[]) {
  if (!focusedNodeId) return null;
  const neighbors = new Set<string>([focusedNodeId]);
  for (const connection of connections) {
    if (connection.source === focusedNodeId) neighbors.add(connection.target);
    if (connection.target === focusedNodeId) neighbors.add(connection.source);
  }
  return neighbors;
}

function focusOpacity(active: boolean, progress = 1) {
  const bounded = Math.min(1, Math.max(0, progress));
  return active ? 1 : 1 - (1 - GRAPH_DIMMED_OPACITY) * bounded;
}

export function graphNodeFocusOpacity(nodeId: string, neighbors: Set<string> | null, progress = 1) {
  return neighbors ? focusOpacity(neighbors.has(nodeId), progress) : 1;
}

export function graphEdgeFocusOpacity(connection: GraphConnection, focusedNodeId: string | null, progress = 1) {
  if (!focusedNodeId) return 1;
  return focusOpacity(connection.source === focusedNodeId || connection.target === focusedNodeId, progress);
}
