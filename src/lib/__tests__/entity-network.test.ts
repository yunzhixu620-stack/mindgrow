import { describe, expect, it } from "vitest";
import {
  searchEntityNetwork,
  selectEntityNetwork,
  selectStrongEntityRelations,
} from "@/lib/entity-network";
import type { Citation, EntityGraph, GraphEntity, GraphRelation } from "@/types";

const citation = (index: number): Citation => ({
  index,
  quote: `原文证据 ${index}`,
  locator: `第 ${index} 段`,
});

const entity = (
  id: string,
  canonicalName: string,
  entityType = "concept",
  aliases: string[] = [],
  description = `${canonicalName} 是用于实体图验收的原文概念说明。`,
): GraphEntity => ({
  id,
  canonicalName,
  entityType,
  aliases,
  description,
  confidence: 0.9,
  citations: [citation(1)],
  descriptionCitations: [citation(1)],
});

const relation = (
  id: string,
  sourceId: string,
  targetId: string,
  confidence = 0.9,
  withEvidence = true,
): GraphRelation => ({
  id,
  sourceId,
  targetId,
  relationType: "uses",
  shortLabel: "使用",
  label: "使用",
  explanation: `${sourceId} 使用 ${targetId}`,
  status: "asserted",
  confidence,
  citations: withEvidence ? [citation(1)] : [],
});

const graph: EntityGraph = {
  entities: [
    entity("rag", "RAG", "method", ["检索增强生成"], "RAG 使用检索证据增强模型回答。"),
    entity("bm25", "BM25", "method", [], "BM25 是一种稀疏文本检索方法。"),
    entity("recall", "Recall@5", "metric", ["召回率"], "Recall@5 衡量前五个结果中的召回表现。"),
    entity("isolated", "孤立术语", "concept", [], "孤立术语只有定义证据但没有强关系。"),
  ],
  relations: [
    relation("r1", "rag", "bm25", 0.91),
    relation("r2", "rag", "recall", 0.79),
    relation("weak", "bm25", "recall", 0.67),
    relation("unsupported", "bm25", "isolated", 0.95, false),
  ],
};

describe("S2.7 entity network selection", () => {
  it("keeps only cited high-confidence relations and applies the degree cap", () => {
    const crowdedRelations = [
      relation("a", "rag", "bm25", 0.99),
      relation("b", "rag", "recall", 0.98),
      relation("c", "rag", "isolated", 0.97),
      relation("d", "rag", "other", 0.96),
      relation("weak", "bm25", "recall", 0.67),
      relation("unsupported", "bm25", "isolated", 0.99, false),
    ];

    expect(selectStrongEntityRelations(crowdedRelations).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("hides isolated entities in the default strong-relation view", () => {
    const selected = selectEntityNetwork(graph, { mode: "global" });

    expect(selected.relations.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(selected.entities.map((item) => item.id)).toEqual(["rag", "bm25", "recall"]);
  });

  it("lets the user reveal isolated grounded entities without adding weak edges", () => {
    const selected = selectEntityNetwork(graph, { mode: "global", showIsolated: true });

    expect(selected.entities.map((item) => item.id)).toContain("isolated");
    expect(selected.relations.map((item) => item.id)).not.toContain("weak");
    expect(selected.relations.map((item) => item.id)).not.toContain("unsupported");
  });

  it("keeps the selected entity and only its one-hop neighborhood", () => {
    const selected = selectEntityNetwork(graph, { mode: "local", selectedEntityId: "bm25" });

    expect(selected.entities.map((item) => item.id).sort()).toEqual(["bm25", "rag", "recall"].sort());
    expect(selected.relations.map((item) => item.id).sort()).toEqual(["r1", "weak"].sort());
  });

  it("filters the network by entity type while preserving a selected local root", () => {
    const global = selectEntityNetwork(graph, { mode: "global", entityTypes: ["method"] });
    expect(global.entities.map((item) => item.id).sort()).toEqual(["bm25", "rag"]);
    expect(global.relations.map((item) => item.id)).toEqual(["r1"]);

    const local = selectEntityNetwork(graph, {
      mode: "local",
      selectedEntityId: "recall",
      entityTypes: ["method"],
    });
    expect(local.entities.map((item) => item.id).sort()).toEqual(["bm25", "rag", "recall"].sort());
  });
});

describe("S2.7 entity network search", () => {
  it("matches canonical names, aliases and descriptions across hidden entities", () => {
    expect(searchEntityNetwork(graph.entities, "检索增强")[0]?.id).toBe("rag");
    expect(searchEntityNetwork(graph.entities, "稀疏文本")[0]?.id).toBe("bm25");
    expect(searchEntityNetwork(graph.entities, "孤立术语")[0]?.id).toBe("isolated");
  });

  it("returns no suggestions for an empty query and caps visible results", () => {
    expect(searchEntityNetwork(graph.entities, "")).toEqual([]);
    expect(searchEntityNetwork(Array.from({ length: 20 }, (_, index) => entity(`e${index}`, `实体 ${index}`)), "实体", 8)).toHaveLength(8);
  });

  it("searches a 500-entity graph within the local 30ms target", () => {
    const entities = Array.from({ length: 500 }, (_, index) => entity(
      `e${index}`,
      `实体 ${index}`,
      "concept",
      index === 499 ? ["unique-alias"] : [],
    ));
    const startedAt = performance.now();
    const results = searchEntityNetwork(entities, "unique-alias");
    const elapsed = performance.now() - startedAt;

    expect(results[0]?.id).toBe("e499");
    expect(elapsed).toBeLessThan(30);
  });
});
