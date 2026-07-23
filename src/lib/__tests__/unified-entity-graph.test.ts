import { describe, expect, it } from "vitest";
import { groupWorkspaceEntities } from "@/lib/unified-entity-graph";
import type { GraphEntity, MapMode } from "@/types";

function entity(id: string, name: string, type: string, aliases: string[] = []): GraphEntity {
  return {
    id,
    canonicalName: name,
    entityType: type,
    aliases,
    description: `${name} 在当前来源中的可核验定义。`,
    confidence: 0.9,
    citations: [{ index: 1, quote: `${name} appears here.` }],
    descriptionCitations: [{ index: 1, quote: `${name} appears here.` }],
  };
}

function library(id: string, mode: MapMode, entities: GraphEntity[]) {
  return { map: { id, name: `${mode}-${id}`, mode }, entityGraph: { entities } };
}

describe("workspace-wide entity projection", () => {
  it("unifies exact and reliable alias identities across all three product boards", () => {
    const groups = groupWorkspaceEntities([
      library("fragment", "knowledge", [entity("e1", "GraphRAG", "method", ["图谱检索增强生成"])]),
      library("article", "article", [entity("e2", "图谱检索增强生成", "method", ["GraphRAG"])]),
      library("meeting", "meeting", [entity("e3", "GraphRAG", "method")]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sourceMapIds).toEqual(["article", "fragment", "meeting"]);
    expect(groups[0].sourceModes).toEqual(["article", "knowledge", "meeting"]);
    expect(groups[0].occurrences.map((item) => item.entity.id).sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("does not merge homonyms with different entity types", () => {
    const groups = groupWorkspaceEntities([
      library("one", "article", [entity("company", "Apple", "organization")]),
      library("two", "knowledge", [entity("concept", "Apple", "concept")]),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.entityType).sort()).toEqual(["concept", "organization"]);
  });

  it("ignores unsafe one- or two-character aliases while keeping deterministic ids", () => {
    const input = [
      library("one", "article", [entity("one", "Alpha model", "model", ["AI"])]),
      library("two", "meeting", [entity("two", "Independent model", "model", ["AI"])]),
    ];

    const first = groupWorkspaceEntities(input);
    const second = groupWorkspaceEntities(input.slice().reverse());
    expect(first).toHaveLength(2);
    expect(first.map((group) => group.id).sort()).toEqual(second.map((group) => group.id).sort());
  });
});
