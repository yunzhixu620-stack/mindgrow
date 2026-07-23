import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const proxy = require("../../../fc-proxy/index.js") as {
  normalizedEntityGraph: (
    value: { entities: unknown[]; relations: unknown[] },
    allowedIndexes: Set<number>,
    citations: Array<{ index: number; quote: string; content: string; locator: string; sourceType: string }>,
    options?: { profile?: string },
  ) => {
    entities: Array<{ tempId: string; name: string }>;
    relations: Array<{ source: string; target: string }>;
    diagnostics: {
      candidateEntities: number;
      nameFilteredEntities: number;
      budgetFilteredEntities: number;
      acceptedEntities: number;
      candidateRelations: number;
      relationFiltered: number;
      acceptedRelations: number;
      status: string;
    };
  };
  sourceCriticalFacts: (value: string, limit: number) => string[];
  ensureMindMapSourceCoverage: (
    mindMap: Record<string, unknown>,
    sourceText: string,
    citations: Array<{ index: number; quote: string; content: string }>,
    allowedIndexes: Set<number>,
    options: { appendFacts: boolean },
  ) => {
    mindMap: {
      children: Array<{ topic: string; desc: string; items: string[] }>;
    };
  };
};

describe("article core graph and semantic outline quality", () => {
  it("keeps the paper graph within the core budget and rejects headings or fragments", () => {
    const citations = Array.from({ length: 24 }, (_, index) => {
      const current = `Model${index + 1}`;
      const next = `Model${(index + 1) % 22 + 1}`;
      const quote = index < 22
        ? `${current} 是论文中负责稠密检索与证据排序的核心模型，并使用 ${next} 完成候选段落编码。`
        : index === 22
          ? "研究问题 是论文结构中的章节标题，不是参与方法关系的核心概念。"
          : "And this is a sentence fragment rather than a named paper concept.";
      return { index: index + 1, quote, content: quote, locator: `page ${index + 1}`, sourceType: "text" };
    });
    const entities = [
      ...Array.from({ length: 22 }, (_, index) => ({
        tempId: `E${index + 1}`,
        name: `Model${index + 1}`,
        type: "model",
        aliases: [],
        description: citations[index].quote,
        descriptionEvidence: [index + 1],
        citationIndexes: [index + 1],
        confidence: 0.9,
      })),
      {
        tempId: "E23",
        name: "研究问题",
        type: "concept",
        aliases: [],
        description: citations[22].quote,
        descriptionEvidence: [23],
        citationIndexes: [23],
        confidence: 0.9,
      },
      {
        tempId: "E24",
        name: "And this",
        type: "concept",
        aliases: [],
        description: citations[23].quote,
        descriptionEvidence: [24],
        citationIndexes: [24],
        confidence: 0.9,
      },
    ];
    const relations = Array.from({ length: 18 }, (_, index) => ({
      source: `E${index + 1}`,
      target: `E${index + 2}`,
      type: "uses",
      shortLabel: "使用",
      explanation: `Model${index + 1} 使用 Model${index + 2} 完成候选段落编码。`,
      status: "asserted",
      citationIndexes: [index + 1],
      confidence: 0.9,
    }));

    const graph = proxy.normalizedEntityGraph(
      { entities, relations },
      new Set(citations.map((citation) => citation.index)),
      citations,
      { profile: "article_core" },
    );

    expect(graph.entities).toHaveLength(20);
    expect(graph.relations).toHaveLength(15);
    expect(graph.entities.map((entity) => entity.name)).not.toContain("研究问题");
    expect(graph.entities.map((entity) => entity.name)).not.toContain("And this");
    expect(graph.diagnostics).toMatchObject({
      candidateEntities: 24,
      nameFilteredEntities: 2,
      budgetFilteredEntities: 2,
      acceptedEntities: 20,
      candidateRelations: 18,
      relationFiltered: 3,
      acceptedRelations: 15,
      status: "ready",
    });
  });

  it("keeps metadata out of data/experiment branches and drops empty semantic headings", () => {
    const source = [
      "标题：Knowledge Graph Retrieval-Augmented Recommender Systems",
      "来源：https://arxiv.org/abs/2501.00001",
      "发布日期：2025/01/04",
      "摘要：Recommender systems have become increasingly complex.",
      "本文使用 MovieLens-1M 数据集，将 K-RagRec 与传统 RAG 和协同过滤基线进行比较。",
      "实验采用 Recall@20 和 NDCG@20 评估推荐效果，并报告消融实验。",
    ].join("\n");
    const citation = { index: 1, quote: source, content: source };
    const result = proxy.ensureMindMapSourceCoverage({
      root: "K-RagRec",
      rootDesc: "本文研究知识图谱增强推荐。",
      children: [
        {
          topic: "数据与实验",
          desc: "本文使用 MovieLens-1M 数据集，将 K-RagRec 与传统 RAG 和协同过滤基线进行比较。",
          items: [
            "标题：Knowledge Graph Retrieval-Augmented Recommender Systems",
            "来源：https://arxiv.org/abs/2501.00001",
            "发布日期：2025/01/04",
            "摘要：Recommender systems have become increasingly complex.",
            "实验采用 Recall@20 和 NDCG@20 评估推荐效果，并报告消融实验。",
          ],
          itemCitationIndexes: [[1], [1], [1], [1], [1]],
        },
        { topic: "局限与启示", desc: "", items: [], itemCitationIndexes: [] },
      ],
    }, source, [citation], new Set([1]), { appendFacts: false });

    expect(result.mindMap.children.map((child) => child.topic)).toEqual(["数据与实验"]);
    expect(result.mindMap.children[0].items).toEqual([
      "实验采用 Recall@20 和 NDCG@20 评估推荐效果，并报告消融实验。",
    ]);
    expect(proxy.sourceCriticalFacts(source, 20).join(" ")).not.toMatch(/标题|arxiv|发布日期|摘要/);
  });
});
