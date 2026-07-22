import { describe, expect, it } from "vitest";
import { buildUniverseData, pointToSegmentDistance } from "@/components/universe/universe-view";
import type { LibraryGraph } from "@/components/universe/universe-loader";

const createdAt = "2026-07-22T00:00:00.000Z";

function library(): LibraryGraph {
  return {
    map: {
      id: "map-article",
      name: "论文库",
      description: "论文阅读",
      mode: "article",
      color: "#a78bfa",
      isDefault: false,
      categoryId: null,
      nodeCount: 1,
      createdAt,
      updatedAt: createdAt,
    },
    nodes: [{
      id: "node-1",
      content: "检索增强生成",
      type: "topic",
      status: "active",
      source: "article",
      confidence: 1,
      createdAt,
      updatedAt: createdAt,
    }],
    edges: [],
    entityGraph: {
      entities: [
        {
          id: "entity-a",
          canonicalName: "GraphRAG",
          entityType: "method",
          aliases: [],
          description: "一种结合知识图谱的检索增强生成方法。",
          confidence: 0.9,
          citations: [],
          descriptionCitations: [{ index: 1, quote: "GraphRAG uses a graph for retrieval.", locator: "Section 2" }],
        },
        {
          id: "entity-b",
          canonicalName: "知识图谱",
          entityType: "concept",
          aliases: [],
          description: "以实体和关系组织知识的图结构。",
          confidence: 0.9,
          citations: [],
          descriptionCitations: [{ index: 2, quote: "A knowledge graph organizes entities and relations.", locator: "Section 2" }],
        },
      ],
      relations: [{
        id: "relation-a",
        sourceId: "entity-a",
        targetId: "entity-b",
        relationType: "uses",
        shortLabel: "使用",
        label: "使用",
        explanation: "GraphRAG 使用知识图谱组织检索证据。",
        status: "asserted",
        confidence: 0.9,
        citations: [{ index: 3, quote: "GraphRAG uses the knowledge graph.", locator: "Section 3" }],
      }],
    },
  };
}

describe("knowledge universe graph metadata", () => {
  it("keeps stable reference kinds and ids for libraries, knowledge nodes and entities", () => {
    const result = buildUniverseData([library()]);

    expect(result.nodes.find((node) => node.refKind === "library")).toMatchObject({ refId: "map-article", mapId: "map-article" });
    expect(result.nodes.find((node) => node.refKind === "knowledge-node")).toMatchObject({ refId: "node-1", mapId: "map-article" });
    expect(result.nodes.find((node) => node.refKind === "entity" && node.refId === "entity-a")).toBeTruthy();
  });

  it("preserves relation ids, explanations and citations on canvas links", () => {
    const result = buildUniverseData([library()]);
    const relation = result.links.find((link) => link.relationId === "relation-a");

    expect(relation).toMatchObject({ label: "使用", explanation: "GraphRAG 使用知识图谱组织检索证据。" });
    expect(relation?.citations?.[0].quote).toBe("GraphRAG uses the knowledge graph.");
  });

  it("uses real point-to-segment distance for link hover hit testing", () => {
    expect(pointToSegmentDistance(5, 2, 0, 0, 10, 0)).toBeCloseTo(2);
    expect(pointToSegmentDistance(14, 0, 0, 0, 10, 0)).toBeCloseTo(4);
    expect(pointToSegmentDistance(5, 8, 0, 0, 10, 0)).toBeGreaterThan(7);
  });
});
