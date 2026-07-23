import { describe, expect, it } from "vitest";

const {
  hasDirectAnswerEvidence,
  preModelAnswerDecision,
  noEvidenceAnswer,
} = require("../../../fc-proxy/index.js") as {
  hasDirectAnswerEvidence: (evidence: unknown[]) => boolean;
  preModelAnswerDecision: (
    evidence: unknown[],
    intent: Record<string, unknown>,
    articleRequest?: { task: string },
  ) => ReturnType<typeof noEvidenceAnswer> | null;
  noEvidenceAnswer: (
    intent: Record<string, unknown>,
    evidence: unknown[],
    missingInformation?: string[],
  ) => {
    status: number;
    data: {
      reply: string;
      sources: unknown[];
      abstained: boolean;
      refusalReason: string;
      grounded: boolean;
      retrievalTrace: unknown;
    };
  };
};

describe("hard abstention without direct evidence", () => {
  it("rejects concept-neighborhood rows when candidate evidence blocks are zero", () => {
    const evidence = [
      {
        id: "concept-1",
        sourceKind: "concept_node",
        content: "GraphRAG",
        citations: [{ quote: "unverified concept label" }],
      },
    ] as unknown[] & { trace?: Record<string, unknown> };
    evidence.trace = {
      candidateChunks: 0,
      seedNodes: 5,
      expandedNodes: 16,
    };

    expect(hasDirectAnswerEvidence(evidence)).toBe(false);
    const response = noEvidenceAnswer({ type: "question" }, evidence);
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      reply: "当前知识库没有相关证据，无法回答此问题。",
      sources: [],
      grounded: true,
      abstained: true,
      refusalReason: "NO_EVIDENCE",
      retrievalTrace: evidence.trace,
    });
  });

  it("accepts document and entity evidence only when the retrieval trace has candidates", () => {
    const evidence = [
      {
        id: "chunk-1",
        sourceKind: "document_chunk",
        content: "DPR uses two encoders.",
      },
    ] as unknown[] & { trace?: Record<string, unknown> };
    evidence.trace = { candidateChunks: 1 };

    expect(hasDirectAnswerEvidence(evidence)).toBe(true);
    expect(preModelAnswerDecision(evidence, { type: "question" })).toBeNull();
  });

  it("returns before a model callback when no direct evidence survives", () => {
    const evidence = [] as unknown[] & { trace?: Record<string, unknown> };
    evidence.trace = { candidateChunks: 0, entityEvidence: 0 };
    let modelCalls = 0;

    const decision = preModelAnswerDecision(evidence, { type: "question" });
    if (!decision) modelCalls += 1;

    expect(modelCalls).toBe(0);
    expect(decision?.data).toMatchObject({
      reply: "当前知识库没有相关证据，无法回答此问题。",
      sources: [],
      refusalReason: "NO_EVIDENCE",
    });
  });
});
