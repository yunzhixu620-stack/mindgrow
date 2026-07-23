import { describe, expect, it } from "vitest";

const {
  htmlToReadableText,
  normalizeArticleSourceInput,
  buildAudioEvidenceClaims,
  groundedAudioSegments,
  fallbackAudioSegments,
  fitAudioSegments,
} = require("../../../fc-proxy/index.js") as {
  htmlToReadableText: (html: string) => string;
  normalizeArticleSourceInput: (body: Record<string, unknown>) => {
    content: string;
    url: string;
    sourceType: "url" | "pdf" | "text";
    fileName: string;
    mimeType: string;
  };
  buildAudioEvidenceClaims: (body: Record<string, unknown>, citations: Array<{ index: number }>) => Array<{
    id: string;
    text: string;
    citationIndexes: number[];
  }>;
  groundedAudioSegments: (value: unknown[], claims: Array<{ id: string; text: string; citationIndexes: number[] }>) => Array<{
    speaker: "主持人" | "分析师";
    text: string;
    claimIds: string[];
    citationIndexes: number[];
  }>;
  fallbackAudioSegments: (claims: Array<{ id: string; text: string; citationIndexes: number[] }>) => Array<{
    speaker: "主持人" | "分析师";
    text: string;
    claimIds: string[];
    citationIndexes: number[];
  }>;
  fitAudioSegments: <T extends { speaker: string; text: string }>(value: T[], maximumCharacters: number) => T[];
};

describe("article multi-source contract", () => {
  it("accepts exactly one declared source", () => {
    expect(normalizeArticleSourceInput({ url: "https://example.com/paper", sourceType: "url" })).toMatchObject({
      url: "https://example.com/paper",
      content: "",
      sourceType: "url",
    });
    expect(normalizeArticleSourceInput({ content: "正文".repeat(30) })).toMatchObject({ sourceType: "text" });
    expect(normalizeArticleSourceInput({
      content: "[第 1 页]\n论文正文".repeat(20),
      sourceType: "pdf",
      fileName: "paper.pdf",
      mimeType: "application/pdf",
    })).toMatchObject({ sourceType: "pdf", fileName: "paper.pdf" });
  });

  it("rejects ambiguous or falsely labelled sources", () => {
    expect(() => normalizeArticleSourceInput({
      url: "https://example.com/paper",
      content: "不能同时提交的正文",
    })).toThrow(expect.objectContaining({ publicCode: "ARTICLE_SOURCE_AMBIGUOUS" }));
    expect(() => normalizeArticleSourceInput({ content: "正文", sourceType: "url" }))
      .toThrow(expect.objectContaining({ publicCode: "ARTICLE_SOURCE_TYPE_MISMATCH" }));
    expect(() => normalizeArticleSourceInput({ content: "提取文字", sourceType: "pdf" }))
      .toThrow(expect.objectContaining({ publicCode: "PDF_METADATA_REQUIRED" }));
  });

  it("prefers article content and strips navigation noise", () => {
    const text = htmlToReadableText(`
      <header>登录 注册 帮助中心</header>
      <main><article><h1>GraphRAG 研究</h1><p>${"GraphRAG 通过实体与关系改善多跳检索。".repeat(8)}</p></article></main>
      <footer>隐私政策 联系方式</footer>
    `);
    expect(text).toContain("GraphRAG 研究");
    expect(text).toContain("改善多跳检索");
    expect(text).not.toContain("登录 注册");
    expect(text).not.toContain("隐私政策");
  });
});

describe("grounded audio overview", () => {
  const citations = [{ index: 1 }, { index: 2 }, { index: 3 }];
  const body = {
    summary: "文章提出图谱增强检索。",
    summaryCitationIndexes: [1],
    keyPoints: [
      { text: "实体链接用于定位入口。", citationIndexes: [2] },
      { text: "这条没有证据。", citationIndexes: [] },
    ],
    arguments: [{ claim: "关系路径用于重排", evidence: "实验提升召回", citationIndexes: [3] }],
  };

  it("keeps only claims carrying allowed article evidence", () => {
    expect(buildAudioEvidenceClaims(body, citations)).toEqual([
      { id: "S1", text: "文章提出图谱增强检索。", citationIndexes: [1] },
      { id: "K1", text: "实体链接用于定位入口。", citationIndexes: [2] },
      { id: "A1", text: "关系路径用于重排；依据：实验提升召回", citationIndexes: [3] },
    ]);
  });

  it("derives citations from claim IDs instead of trusting model-supplied indexes", () => {
    const claims = buildAudioEvidenceClaims(body, citations);
    const segments = groundedAudioSegments([
      { speaker: "主持人", text: "先解释检索入口。", claimIds: ["K1"], citationIndexes: [99] },
      { speaker: "分析师", text: "再看路径重排。", claimIds: ["A1", "missing"], citationIndexes: [1] },
      { speaker: "主持人", text: "没有证据的发挥。", claimIds: [], citationIndexes: [1] },
      { speaker: "分析师", text: "公司收入将在明年翻倍。", claimIds: ["K1"], citationIndexes: [2] },
    ], claims);
    expect(segments).toHaveLength(2);
    expect(segments[0].citationIndexes).toEqual([2]);
    expect(segments[1].citationIndexes).toEqual([3]);
  });

  it("always provides at least two cited fallback turns and keeps the TTS script bounded", () => {
    const oneClaim = [{ id: "S1", text: "有证据的核心结论。".repeat(80), citationIndexes: [1] }];
    const fallback = fallbackAudioSegments(oneClaim);
    expect(fallback).toHaveLength(2);
    expect(fallback.every((item) => item.citationIndexes.length > 0)).toBe(true);
    const fitted = fitAudioSegments(fallback, 1000);
    const script = fitted.map((item) => `${item.speaker}：${item.text}`).join("\n");
    expect(fitted).toHaveLength(2);
    expect(script.length).toBeLessThanOrEqual(1000);
  });
});
