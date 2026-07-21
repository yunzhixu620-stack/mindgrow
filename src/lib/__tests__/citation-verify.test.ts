import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const {
  normalizeForExactMatch,
  isVerbatimQuote,
} = require("../../../fc-proxy/index.js").__citationInternal as {
  normalizeForExactMatch: (value: unknown) => string;
  isVerbatimQuote: (quote: unknown, chunkContent: unknown) => boolean;
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

  it("keeps all test exports in the single final CommonJS export", () => {
    const source = readFileSync(resolve(process.cwd(), "fc-proxy/index.js"), "utf8");
    expect(source.match(/^module\.exports\s*=\s*\{/gm)).toHaveLength(1);
    expect(source).not.toMatch(/module\.exports\.[A-Za-z_$]/);
  });
});
