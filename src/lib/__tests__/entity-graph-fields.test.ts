import { describe, expect, it } from "vitest";
import {
  ENTITY_DESCRIPTION_MIN_LENGTH,
  LEGACY_ENTITY_DESCRIPTION,
  aiEntityGraphToEntityGraph,
  entityDescriptionForReadOnlyDetail,
  entityGraphToKnowledgeGraph,
  formalEntityGraph,
  graphEntityGroundingStatus,
  isGroundedGraphEntity,
} from "@/lib/entity-graph";
import type { AIEntityGraph, Citation, GraphEntity } from "@/types";

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

  it("preserves extraction diagnostics through the preview and formal graph", () => {
    const input = graphWithRelation();
    input.diagnostics = {
      profile: "article_core",
      candidateEntities: 12,
      nameFilteredEntities: 2,
      descriptionFilteredEntities: 1,
      acceptedEntities: 9,
      candidateRelations: 8,
      relationFiltered: 3,
      acceptedRelations: 5,
      extractionPath: "targeted_retry",
      status: "ready",
    };

    const graph = aiEntityGraphToEntityGraph(input, citations, "article:diagnostics");

    expect(graph.diagnostics).toEqual(input.diagnostics);
    expect(formalEntityGraph(graph).diagnostics).toEqual(input.diagnostics);
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
    const generatedAt = "2026-07-22T12:34:56.000Z";
    const graph = aiEntityGraphToEntityGraph(graphWithRelation(), citations, "article:test", generatedAt);
    const knowledge = entityGraphToKnowledgeGraph(graph);
    expect(knowledge.edges[0]).toMatchObject({
      relationLabel: "采用",
      relationId: graph.relations[0].id,
      relationStatus: "asserted",
      relationExplanation: "RAG uses DPR as the dense retrieval component.",
    });
    expect(knowledge.edges[0].relationLabel).not.toContain("证据");
    expect(knowledge.nodes.every((node) => node.createdAt === generatedAt && node.updatedAt === generatedAt)).toBe(true);
    expect(knowledge.edges[0].createdAt).toBe(generatedAt);
    expect(knowledge.nodes.some((node) => node.createdAt.startsWith("1970-"))).toBe(false);
  });

  it("requires a trimmed canonical name and an eight-character description", () => {
    const input = graphWithRelation();
    input.entities[0].name = "  RAG  ";
    input.entities[1].description = "1234567";

    const graph = aiEntityGraphToEntityGraph(input, citations, "article:filter");

    expect(ENTITY_DESCRIPTION_MIN_LENGTH).toBe(8);
    expect(graph.entities.map((entity) => entity.canonicalName)).toEqual(["RAG"]);
    expect(graph.relations).toEqual([]);
  });

  it("does not treat ordinary entity citations as description evidence", () => {
    const input = graphWithRelation();
    input.entities[0].descriptionEvidence = undefined;
    input.entities[0].citationIndexes = [1, 2];

    const graph = aiEntityGraphToEntityGraph(input, citations, "article:evidence");

    expect(graph.entities.map((entity) => entity.canonicalName)).toEqual(["DPR"]);
    expect(graph.relations).toEqual([]);
  });

  it("accepts the minimum description length with dedicated evidence", () => {
    const input = graphWithRelation();
    input.entities = [{
      tempId: "E1",
      name: "RAG",
      type: "model",
      description: "12345678",
      descriptionEvidence: [2],
      citationIndexes: [],
    }];
    input.relations = [];

    const graph = aiEntityGraphToEntityGraph(input, citations, "article:boundary");

    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0].citations).toEqual([]);
    expect(graph.entities[0].descriptionCitations.map((citation) => citation.index)).toEqual([2]);
    expect(graph.entities[0].groundingStatus).toBe("grounded");
  });

  it("keeps legacy records distinguishable for a future read-only detail view", () => {
    const legacyEntity: GraphEntity = {
      id: "legacy:E1",
      canonicalName: "Legacy entity",
      entityType: "concept",
      aliases: [],
      description: "",
      confidence: 0.6,
      citations: [citations[0]],
      descriptionCitations: [],
    };

    expect(isGroundedGraphEntity(legacyEntity)).toBe(false);
    expect(graphEntityGroundingStatus(legacyEntity)).toBe("legacy");
    expect(entityDescriptionForReadOnlyDetail(legacyEntity)).toBe(LEGACY_ENTITY_DESCRIPTION);
    expect(formalEntityGraph({ entities: [legacyEntity], relations: [] }).entities).toEqual([]);
    expect(legacyEntity.canonicalName).toBe("Legacy entity");
  });
});
