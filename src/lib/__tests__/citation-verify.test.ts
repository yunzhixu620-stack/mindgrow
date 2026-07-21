import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const {
  normalizeForExactMatch,
  isVerbatimQuote,
  verifiedIndexes,
  verifiedCitationPayload,
} = require("../../../fc-proxy/index.js").__citationInternal as {
  normalizeForExactMatch: (value: unknown) => string;
  isVerbatimQuote: (quote: unknown, chunkContent: unknown) => boolean;
  verifiedIndexes: (
    value: unknown,
    allowedIndexes: Set<number>,
    claim: string,
    citations: Array<Record<string, unknown>>,
    sourceChunks: Array<Record<string, unknown>>,
  ) => number[];
  verifiedCitationPayload: (
    citations: Array<Record<string, unknown>>,
    sourceChunks: Array<Record<string, unknown>>,
    expectedSourceType: string,
  ) => { citations: Array<Record<string, unknown>>; allowedIndexes: Set<number> };
};

describe("citation exact-match utilities", () => {
  it("accepts only a continuous source substring after deterministic normalization", () => {
    const source = "The “RAG” model\nretrieves evidence before answering.";
    expect(isVerbatimQuote('the "rag" model retrieves evidence', source)).toBe(true);
    expect(isVerbatimQuote("RAG", source)).toBe(false);
  });

  it("normalizes Unicode width, quote style, case, and whitespace", () => {
    expect(normalizeForExactMatch("  ＲＡＧ\u00a0‘Evidence’  ")).toBe('rag "evidence"');
    expect(isVerbatimQuote("ＲＡＧ ‘Evidence’", 'RAG "evidence" is grounded.')).toBe(true);
  });

  it("rejects a changed, omitted, reordered, or approximately similar word", () => {
    const source = "The model retrieves evidence before answering.";
    expect(isVerbatimQuote("The model retrieves evidence after answering.", source)).toBe(false);
    expect(isVerbatimQuote("The model retrieves before answering.", source)).toBe(false);
    expect(isVerbatimQuote("Evidence retrieves the model before answering.", source)).toBe(false);
    expect(isVerbatimQuote("The model retrieve evidence before answering.", source)).toBe(false);
  });

  it("does not erase punctuation to manufacture a match", () => {
    expect(isVerbatimQuote("risk is low", "risk is not low")).toBe(false);
    expect(isVerbatimQuote("A-B", "A B")).toBe(false);
  });

  it("keeps only allowed citations whose quote is verbatim and metadata is complete", () => {
    const citations = [{
      index: 1,
      quote: "DPR retrieves passages from Wikipedia.",
      locator: "page 3",
      sourceType: "pdf",
    }];
    const chunks = [{ index: 1, content: "RAG uses DPR. DPR retrieves passages from Wikipedia." }];
    expect(verifiedIndexes([1, 2], new Set([1]), "DPR retrieval", citations, chunks)).toEqual([1]);

    expect(verifiedIndexes([1], new Set([1]), "DPR retrieval", [
      { ...citations[0], quote: "DPR retrieves documents from Wikipedia." },
    ], chunks)).toEqual([]);
    expect(verifiedIndexes([1], new Set([1]), "DPR retrieval", [
      { ...citations[0], locator: "" },
    ], chunks)).toEqual([]);
    expect(verifiedIndexes([1], new Set([1]), "DPR retrieval", [
      { ...citations[0], sourceType: "" },
    ], chunks)).toEqual([]);
  });

  it("does not manufacture a verified citation when the model supplied none", () => {
    const citation = {
      index: 1,
      quote: "DPR retrieves passages from Wikipedia.",
      locator: "page 3",
      sourceType: "pdf",
    };
    expect(verifiedIndexes([], new Set([1]), "DPR retrieves passages", [citation], [
      { index: 1, content: citation.quote },
    ])).toEqual([]);
  });

  it("sanitizes the payload again at the persistence boundary", () => {
    const chunk = {
      index: 1,
      content: "DPR retrieves passages from Wikipedia.",
      sourceType: "pdf",
    };
    const citation = {
      index: 1,
      quote: "DPR retrieves passages from Wikipedia.",
      locator: "page 3",
      sourceType: "pdf",
    };
    const valid = verifiedCitationPayload([citation], [chunk], "pdf");
    expect(valid.citations).toHaveLength(1);
    expect(valid.allowedIndexes).toEqual(new Set([1]));

    expect(verifiedCitationPayload([
      { ...citation, quote: "DPR retrieves documents from Wikipedia." },
    ], [chunk], "pdf").citations).toEqual([]);
    expect(verifiedCitationPayload([
      { ...citation, sourceType: "url" },
    ], [chunk], "pdf").citations).toEqual([]);
    expect(verifiedCitationPayload([citation], [
      { ...chunk, sourceType: "text" },
    ], "pdf").citations).toEqual([]);
  });

  it("keeps all test exports in the single final CommonJS export", () => {
    const source = readFileSync(resolve(process.cwd(), "fc-proxy/index.js"), "utf8");
    expect(source.match(/^module\.exports\s*=\s*\{/gm)).toHaveLength(1);
    expect(source).not.toMatch(/module\.exports\.[A-Za-z_$]/);
  });
});
