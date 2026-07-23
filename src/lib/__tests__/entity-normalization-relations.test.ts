import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const proxy = require("../../../fc-proxy/index.js") as {
  canonicalizeRawEntityGraph: (
    graph: { entities: unknown[]; relations: unknown[] },
    evidence: Array<{ quote: string }>,
  ) => {
    entities: Array<{ tempId: string; name: string; aliases: string[] }>;
    relations: Array<{ source: string; target: string }>;
  };
  relationEvidenceSupports: (
    type: string,
    rows: Array<{ quote: string }>,
    source: { name: string; aliases: string[] },
    target: { name: string; aliases: string[] },
  ) => boolean;
};

describe("entity aliases and first-class relations", () => {
  it("merges TC39 speaker codes and common GraphRAG aliases into canonical entities", () => {
    const normalized = proxy.canonicalizeRawEntityGraph({
      entities: [
        { tempId: "E1", name: "PFC", type: "person", aliases: [] },
        { tempId: "E2", name: "Peter Collins", type: "person", aliases: [] },
        { tempId: "E3", name: "RAG", type: "method", aliases: [] },
        { tempId: "E4", name: "Retrieval Augmented Generation", type: "method", aliases: [] },
        { tempId: "E5", name: "KG", type: "concept", aliases: [] },
      ],
      relations: [{ source: "E1", target: "E3", type: "supports" }],
    }, [{
      quote: "Peter Collins (PFC) supports Retrieval-Augmented Generation (RAG) with a Knowledge Graph (KG).",
    }]);

    expect(normalized.entities).toHaveLength(3);
    const person = normalized.entities.find((item) => item.name === "Peter Collins");
    expect(person?.aliases).toContain("PFC");
    const rag = normalized.entities.find((item) => item.name === "Retrieval-Augmented Generation");
    expect(rag?.aliases).toContain("RAG");
    const kg = normalized.entities.find((item) => item.name === "KG");
    expect(kg?.aliases).toContain("Knowledge Graph");
    expect(normalized.relations[0].source).toBe(person?.tempId);
    expect(normalized.relations[0].target).toBe(rag?.tempId);
  });

  it("requires source, target, predicate and direction in the same evidence sentence", () => {
    const committee = { name: "委员会", aliases: ["Committee"] };
    const proposal = { name: "提案", aliases: ["Proposal"] };
    expect(proxy.relationEvidenceSupports(
      "approves",
      [{ quote: "委员会批准提案进入下一阶段。" }],
      committee,
      proposal,
    )).toBe(true);
    expect(proxy.relationEvidenceSupports(
      "approves",
      [{ quote: "提案由委员会批准进入下一阶段。" }],
      committee,
      proposal,
    )).toBe(true);
    expect(proxy.relationEvidenceSupports(
      "approves",
      [{ quote: "委员会讨论了提案，但尚未形成决定。" }],
      committee,
      proposal,
    )).toBe(false);
    expect(proxy.relationEvidenceSupports(
      "approves",
      [{ quote: "委员会批准另一项工作；提案仍待讨论。" }],
      committee,
      proposal,
    )).toBe(false);
  });
});
