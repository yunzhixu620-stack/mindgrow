import type { KnowledgeEdge, KnowledgeNode } from "@/types";

export const DISPLAY_OVERVIEW_PREFIX = "__mindgrow_overview__";
export const MAX_UNGROUPED_ROOTS = 5;

export function isDisplayOverviewNode(nodeId: string) {
  return nodeId.startsWith(DISPLAY_OVERVIEW_PREFIX);
}

/**
 * Expand exactly one level. Children that also have children remain collapsed,
 * so a large map never mounts every descendant after a single click.
 */
export function progressiveCollapseState(
  nodeId: string,
  current: Set<string>,
  edges: KnowledgeEdge[],
) {
  const next = new Set(current);
  if (!next.has(nodeId)) {
    next.add(nodeId);
    return next;
  }

  next.delete(nodeId);
  const parents = new Set(
    edges.filter((edge) => edge.relation === "contains").map((edge) => edge.sourceId),
  );
  for (const edge of edges) {
    if (edge.relation !== "contains" || edge.sourceId !== nodeId) continue;
    if (parents.has(edge.targetId)) next.add(edge.targetId);
  }
  return next;
}

/**
 * Group many independent source roots below a display-only overview. Stored
 * nodes and edges remain unchanged and therefore stay available to retrieval.
 */
export function buildDisplayHierarchy(
  dbNodes: KnowledgeNode[],
  dbEdges: KnowledgeEdge[],
  mapId: string | null,
  overviewLabel: string,
) {
  const childIds = new Set(
    dbEdges.filter((edge) => edge.relation === "contains").map((edge) => edge.targetId),
  );
  const roots = dbNodes.filter((node) => !childIds.has(node.id));
  if (roots.length <= MAX_UNGROUPED_ROOTS) {
    return { nodes: dbNodes, edges: dbEdges, syntheticNodeCount: 0 };
  }

  const overviewId = `${DISPLAY_OVERVIEW_PREFIX}:${mapId || "current"}`;
  const timestamps = roots.map((node) => node.createdAt).filter(Boolean).sort();
  const createdAt = timestamps[0] || "1970-01-01T00:00:00.000Z";
  const updatedTimestamps = roots.map((node) => node.updatedAt).filter(Boolean).sort();
  const updatedAt = updatedTimestamps[updatedTimestamps.length - 1] || createdAt;
  const overviewNode: KnowledgeNode = {
    id: overviewId,
    content: overviewLabel,
    desc: `统一收纳 ${roots.length} 个一级主题，仅调整画布展示层级；原节点层级与内容保持不变。`,
    type: "topic",
    status: "active",
    source: "template",
    confidence: 1,
    createdAt,
    updatedAt,
  };
  const overviewEdges: KnowledgeEdge[] = roots.map((root, index) => ({
    id: `${overviewId}:edge:${index}`,
    sourceId: overviewId,
    targetId: root.id,
    relation: "contains",
    weight: 1,
    createdAt,
  }));

  return {
    nodes: [overviewNode, ...dbNodes],
    edges: [...overviewEdges, ...dbEdges],
    syntheticNodeCount: 1,
  };
}

export function getOutlineCollapsedNodes(dbNodes: KnowledgeNode[], dbEdges: KnowledgeEdge[]) {
  const childrenOf = new Map<string, string[]>();
  const childSet = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation !== "contains") continue;
    childSet.add(edge.targetId);
    const children = childrenOf.get(edge.sourceId) || [];
    children.push(edge.targetId);
    childrenOf.set(edge.sourceId, children);
  }
  const roots = dbNodes.filter((node) => !childSet.has(node.id));
  const collapsed = new Set<string>();

  const displayOverview = roots.find((node) => isDisplayOverviewNode(node.id));
  if (displayOverview) {
    collapsed.add(displayOverview.id);
    return collapsed;
  }

  const firstLevelByRoot = new Map<string, string[]>();
  let outlineVisibleCount = roots.length;
  for (const root of roots) {
    const firstLevel = childrenOf.get(root.id) || [];
    firstLevelByRoot.set(root.id, firstLevel);
    outlineVisibleCount += firstLevel.length;
    for (const child of firstLevel) {
      if ((childrenOf.get(child) || []).length) collapsed.add(child);
    }
  }

  const maximumOutlineNodes = 12;
  if (roots.length > 1 && outlineVisibleCount > maximumOutlineNodes) {
    const oldestRoots = [...roots].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const root of oldestRoots) {
      if (outlineVisibleCount <= maximumOutlineNodes) break;
      const firstLevel = firstLevelByRoot.get(root.id) || [];
      if (!firstLevel.length) continue;
      collapsed.add(root.id);
      outlineVisibleCount -= firstLevel.length;
    }
  }
  return collapsed;
}

export function visibleHierarchyNodeIds(
  dbNodes: KnowledgeNode[],
  dbEdges: KnowledgeEdge[],
  collapsed: Set<string>,
) {
  const nodeIds = new Set(dbNodes.map((node) => node.id));
  const childrenOf = new Map<string, string[]>();
  const childSet = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation !== "contains" || !nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
    childSet.add(edge.targetId);
    const children = childrenOf.get(edge.sourceId) || [];
    children.push(edge.targetId);
    childrenOf.set(edge.sourceId, children);
  }

  const visible = new Set<string>();
  const collect = (nodeId: string) => {
    if (visible.has(nodeId)) return;
    visible.add(nodeId);
    if (collapsed.has(nodeId)) return;
    for (const childId of childrenOf.get(nodeId) || []) collect(childId);
  };
  dbNodes.filter((node) => !childSet.has(node.id)).forEach((root) => collect(root.id));
  return visible;
}
