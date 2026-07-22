import { describe, expect, it } from "vitest";
import { buildLocalArticleCitations, pdfFindQuery, pdfPageNumber } from "@/lib/pdf-citation";

describe("PDF citation navigation", () => {
  it("prefers an explicit page number and falls back to Chinese or English locators", () => {
    expect(pdfPageNumber({ pageNumber: 7, locator: "第 2 页" })).toBe(7);
    expect(pdfPageNumber({ locator: "第 12 页 · 方法" })).toBe(12);
    expect(pdfPageNumber({ locator: "page 9" })).toBe(9);
    expect(pdfPageNumber({ locator: "原文片段 3" })).toBeNull();
  });

  it("creates a bounded phrase query suitable for PDFFindController", () => {
    expect(pdfFindQuery("“GraphRAG 使用知识图谱增强检索。”")).toBe("GraphRAG 使用知识图谱增强检索。");
    expect(pdfFindQuery("Retrieval augmented generation combines parametric memory with a non parametric index and uses DPR to retrieve passages for knowledge intensive tasks."))
      .toBe("Retrieval augmented generation combines parametric memory with a non parametric index and");
  });

  it("keeps PDF page markers on local-mode citations", () => {
    const citations = buildLocalArticleCitations([
      "[第 1 页]",
      "第一页面的研究问题说明了检索增强生成的基本动机。",
      "[第 2 页]",
      "第二页面介绍了 DPR 检索器与生成器之间的连接方式。",
    ].join("\n"), "pdf", "paper.pdf");

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ locator: "第 1 页", pageNumber: 1, sourceType: "pdf", fileName: "paper.pdf" });
    expect(citations[1]).toMatchObject({ locator: "第 2 页", pageNumber: 2 });
  });

  it("does not manufacture PDF page locators for pasted text", () => {
    const [citation] = buildLocalArticleCitations("这是一段足够长的普通粘贴正文，用于验证非 PDF 来源的定位方式。", "text");
    expect(citation).toMatchObject({ locator: "原文片段 1", pageNumber: null, sourceType: "text" });
  });
});
