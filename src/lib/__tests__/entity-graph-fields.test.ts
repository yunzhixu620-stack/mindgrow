import { describe, expect, it } from "vitest";
import { aiEntityGraphToEntityGraph, entityGraphToKnowledgeGraph } from "@/lib/entity-graph";
import type { AIEntityGraph, Citation } from "@/types";

const citations: Citation[] = [
  { index: 1, quote: "RAG appears in the source.", locator: "page 1", sourceType: "pdf" },
  { index: 2, quote: "RAG combines retrieval and generation.", locator: "page 1", sourceType: "pdf" },
  { index: 3, quote: "RAG uses DPR as its dense retriever.", locator: "page 2", sourceType: "pdf" },
];

function graphWithRelation(overrides: Partial<AIEntityGraph["relations"][number]> = {}): AIEntityGraph {
  return {
    entities: [
      {
        tempId: "E1",
        name: "RAG",
        type: "model",
        description: "RAG combines retrieval and generation.",
        descriptionEvidence: [2],
        citationIndexes: [1, 2],
      },
      {
        tempId: "E2",
        name: "DPR",
        type: "method",
        description: "DPR supplies passages to the RAG generator.",
        descriptionEvidence: [3],
        citationIndexes: [3],
      },
    ],
    relations: [{
      source: "E1",
      target: "E2",
      type: "uses",
      shortLabel: "采用",
      label: "legacy relation label",
      explanation: "RAG uses DPR as the dense retrieval component.",
      citationIndexes: [3],
      ...overrides,
    }],
  };
}

describe("entity graph field propagation", () => {
  it("keeps dedicated description citations separate from entity citations", () => {
    const graph = aiEntityGraphToEntityGraph(graphWithRelation(), citations, "article:test");
    expect(graph.entities[0].citations.map((item) => item.index)).toEqual([1, 2]);
    expect(graph.entities[0].descriptionCitations.map((item) => item.index)).toEqual([2]);
  });

  it("uses shortLabel before legacy label and preserves the explanation", () => {
    const graph = aiEntityGraphToEntityGraph(graphWithRelation(), citations, "article:test");
    expect(graph.relations[0]).toMatchObject({
      shortLabel: "采用",
      label: "采用",
      explanation: "RAG uses DPR as the dense retrieval component.",
    });
  });

  it("falls back from legacy label to the relation type mapping", () => {
    const legacy = aiEntityGraphToEntityGraph(
      graphWithRelation({ shortLabel: undefined, label: "旧标签" }), citations, "article:legacy",
    );
    expect(legacy.relations[0].label).toBe("旧标签");

    const mapped = aiEntityGraphToEntityGraph(
      graphWithRelation({ shortLabel: undefined, label: undefined }), citations, "article:mapped",
    );
    expect(mapped.relations[0].label).toBe("使用");
  });

  it("provides relation metadata without parsing the rendered edge label", () => {
    const graph = aiEntityGraphToEntityGraph(graphWithRelation(), citations, "article:test");
    const knowledge = entityGraphToKnowledgeGraph(graph);
    expect(knowledge.edges[0]).toMatchObject({
      relationId: graph.relations[0].id,
      relationStatus: "asserted",
      relationExplanation: "RAG uses DPR as the dense retrieval component.",
    });
  });
});
