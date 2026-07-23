import { describe, expect, it } from "vitest";
import type { KnowledgeEdge, KnowledgeNode } from "@/types";
import {
  buildDisplayHierarchy,
  getOutlineCollapsedNodes,
  progressiveCollapseState,
  visibleHierarchyNodeIds,
} from "./progressive-outline";

function largeMeetingGraph() {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const timestamp = "2026-07-23T00:00:00.000Z";

  for (let rootIndex = 0; rootIndex < 16; rootIndex += 1) {
    const rootId = `meeting-root-${rootIndex + 1}`;
    nodes.push({
      id: rootId,
      content: `会议主题 ${rootIndex + 1}`,
      desc: "",
      type: "topic",
      status: "active",
      source: "meeting",
      confidence: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (let childIndex = 0; childIndex < 20; childIndex += 1) {
      const childId = `${rootId}-item-${childIndex + 1}`;
      nodes.push({
        id: childId,
        content: `会议要点 ${rootIndex + 1}-${childIndex + 1}`,
        desc: "",
        type: "detail",
        status: "active",
        source: "meeting",
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      edges.push({
        id: `edge-${rootId}-${childIndex + 1}`,
        sourceId: rootId,
        targetId: childId,
        relation: "contains",
        weight: 1,
        createdAt: timestamp,
      });
    }
  }
  return { nodes, edges };
}

describe("large map progressive outline", () => {
  it("keeps all 336 stored nodes but mounts one overview card initially", () => {
    const source = largeMeetingGraph();
    expect(source.nodes).toHaveLength(336);

    const hierarchy = buildDisplayHierarchy(source.nodes, source.edges, "meeting-map", "会议知识总览");
    const collapsed = getOutlineCollapsedNodes(hierarchy.nodes, hierarchy.edges);
    const visible = visibleHierarchyNodeIds(hierarchy.nodes, hierarchy.edges, collapsed);

    expect(hierarchy.syntheticNodeCount).toBe(1);
    expect(hierarchy.nodes).toHaveLength(337);
    expect(hierarchy.nodes.filter((node) => !node.id.startsWith("__mindgrow_overview__"))).toEqual(source.nodes);
    expect(visible.size).toBe(1);
  });

  it("reveals only the next level on the first expansion", () => {
    const source = largeMeetingGraph();
    const hierarchy = buildDisplayHierarchy(source.nodes, source.edges, "meeting-map", "会议知识总览");
    const initial = getOutlineCollapsedNodes(hierarchy.nodes, hierarchy.edges);
    const overviewId = Array.from(initial)[0];

    const expanded = progressiveCollapseState(overviewId, initial, hierarchy.edges);
    const visible = visibleHierarchyNodeIds(hierarchy.nodes, hierarchy.edges, expanded);

    expect(visible.size).toBe(17);
    expect(visible.size).toBeLessThan(hierarchy.nodes.length);
    expect(Array.from(expanded).filter((id) => id.startsWith("meeting-root-"))).toHaveLength(16);
  });

  it("does not add a display-only parent to a small single tree", () => {
    const source = largeMeetingGraph();
    const oneTreeNodes = source.nodes.slice(0, 21);
    const oneTreeIds = new Set(oneTreeNodes.map((node) => node.id));
    const oneTreeEdges = source.edges.filter((edge) => oneTreeIds.has(edge.sourceId) && oneTreeIds.has(edge.targetId));
    const hierarchy = buildDisplayHierarchy(oneTreeNodes, oneTreeEdges, "small-map", "总览");

    expect(hierarchy.syntheticNodeCount).toBe(0);
    expect(hierarchy.nodes).toEqual(oneTreeNodes);
  });
});
