import { describe, expect, it } from "vitest";
import {
  articleStageForError,
  createArticleSourceRequest,
  initialArticleStages,
  resetArticleStagesFrom,
  updateArticleStage,
} from "./article-pipeline";

const pdf = {
  name: "paper.pdf",
  pageCount: 12,
  truncated: false,
  tablePages: [4],
  imagePages: [6],
  scannedPages: [],
};

describe("article source mutual exclusion", () => {
  it("submits only the active URL source", () => {
    expect(createArticleSourceRequest({
      kind: "url",
      url: "https://example.com/paper",
      content: "stale text must not be sent",
      pdf,
    })).toEqual({
      sourceType: "url",
      url: "https://example.com/paper",
    });
  });

  it("removes stale URL and PDF metadata after switching to pasted text", () => {
    const request = createArticleSourceRequest({
      kind: "text",
      url: "https://example.com/stale",
      content: "这是切换到正文以后唯一允许提交的真实文章内容。".repeat(6),
      pdf,
    });

    expect(request).toEqual({
      sourceType: "text",
      content: "这是切换到正文以后唯一允许提交的真实文章内容。".repeat(6),
    });
    expect(request).not.toHaveProperty("url");
    expect(request).not.toHaveProperty("fileName");
    expect(request).not.toHaveProperty("mimeType");
    expect(request).not.toHaveProperty("extraction");
  });

  it("keeps PDF extraction metadata only for an active PDF", () => {
    const request = createArticleSourceRequest({
      kind: "pdf",
      url: "https://example.com/stale",
      content: "PDF 提取正文。".repeat(20),
      pdf,
    });
    expect(request).toMatchObject({
      sourceType: "pdf",
      fileName: "paper.pdf",
      mimeType: "application/pdf",
      extraction: { pageCount: 12 },
    });
    expect(request).not.toHaveProperty("url");
  });
});

describe("article recovery stages", () => {
  it("preserves completed stages and resets only the failed stage onward", () => {
    let stages = initialArticleStages();
    stages = updateArticleStage(stages, "read", "done");
    stages = updateArticleStage(stages, "extract", "done");
    stages = updateArticleStage(stages, "summary", "failed");
    const retry = resetArticleStagesFrom(stages, "summary");

    expect(retry.map((stage) => stage.status)).toEqual(["done", "done", "pending", "pending", "pending"]);
  });

  it("maps stable backend codes to the visible failed stage", () => {
    expect(articleStageForError("ARTICLE_FIRST_BYTE_TIMEOUT", "summary")).toBe("read");
    expect(articleStageForError("ARTICLE_CONTENT_TOO_SHORT", "summary")).toBe("extract");
    expect(articleStageForError("ARTICLE_CITATION_VERIFY_FAILED", "summary")).toBe("citations");
    expect(articleStageForError("ARTICLE_ENTITY_GRAPH_FAILED", "summary")).toBe("graph");
    expect(articleStageForError("ARTICLE_ANALYSIS_MODEL_FAILED", "read")).toBe("summary");
  });
});
