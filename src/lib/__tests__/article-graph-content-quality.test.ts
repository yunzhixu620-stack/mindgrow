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
  selectArticleAnalysisCitations: (
    citations: Array<{ index: number; locator: string; content: string }>,
    maxItems?: number,
    maxCharacters?: number,
  ) => Array<{ index: number; locator: string; content: string }>;
  recoveredChineseArticleResponse: (
    body: Record<string, unknown>,
    context: Record<string, unknown>,
    warningCode: string,
  ) => {
    data: {
      summaryCitationIndexes: number[];
      mindMap: {
        rootCitationIndexes: number[];
        children: Array<{ citationIndexes: number[] }>;
      };
    };
  };
  repairArticleMindMapRoot: (
    mindMap: Record<string, unknown>,
    articleTitle: string,
    articleSummary: string,
    allowedIndexes: Set<number>,
  ) => {
    root: string;
    rootDesc: string;
    rootCitationIndexes: number[];
    children: Array<{ topic: string; desc: string; citationIndexes: number[] }>;
  };
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
  deterministicArticleMindMap: (
    title: string,
    content: string,
    citations: Array<{ index: number; quote: string; content: string }>,
    allowedIndexes: Set<number>,
  ) => {
    root: string;
    children: Array<{
      topic: string;
      desc: string;
      citationIndexes: number[];
      items: string[];
      itemCitationIndexes: number[][];
    }>;
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
      "Knowledge Graph Retrieval-Augmented Recommender Systems for Large-Scale Personalized Recommendation with External Evidence",
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
          desc: "进行了大量实验验证 K-RagRec 的有效性。",
          items: [
            "标题：Knowledge Graph Retrieval-Augmented Recommender Systems",
            "来源：https://arxiv.org/abs/2501.00001",
            "发布日期：2025/01/04",
            "摘要：Recommender systems have become increasingly complex.",
            "Knowledge Graph Retrieval-Augmented Recommender Systems for Large-Scale Personalized Recommendation with External Evidence",
            "本文使用 MovieLens-1M 数据集，将 K-RagRec 与传统 RAG 和协同过滤基线进行比较。",
            "实验采用 Recall@20 和 NDCG@20 评估推荐效果，并报告消融实验。",
          ],
          itemCitationIndexes: [[1], [1], [1], [1], [1], [1], [1]],
        },
        { topic: "局限与启示", desc: "", items: [], itemCitationIndexes: [] },
      ],
    }, source, [citation], new Set([1]), { appendFacts: false });

    expect(result.mindMap.children.map((child) => child.topic)).toEqual(["数据与实验"]);
    expect(result.mindMap.children[0].items).toEqual([
      "数据：本文使用 MovieLens-1M 数据集，将 K-RagRec 与传统 RAG 和协同过滤基线进行比较。",
      "消融设计：实验采用 Recall@20 和 NDCG@20 评估推荐效果，并报告消融实验。",
    ]);
    expect(result.mindMap.children[0].desc).toContain("MovieLens-1M");
    expect(result.mindMap.children[0].desc).not.toContain("大量实验");
    expect(proxy.sourceCriticalFacts(source, 20).join(" ")).not.toMatch(/标题|arxiv|发布日期|摘要/);
  });

  it("always gives a grounded semantic branch at least one explanatory child", () => {
    const source = "实验在 WebQSP 数据集上进行，并用 Hits@1 指标与 GraphRAG 基线比较。";
    const result = proxy.ensureMindMapSourceCoverage({
      root: "GraphContainer",
      rootDesc: "用于比较图检索增强生成方法。",
      children: [{
        topic: "数据与实验",
        desc: source,
        citationIndexes: [1],
        items: [],
        itemCitationIndexes: [],
      }],
    }, source, [{ index: 1, quote: source, content: source }], new Set([1]), { appendFacts: false });

    const experiment = result.mindMap.children[0];
    expect(experiment.items).toHaveLength(2);
    expect(experiment.items[0]).toMatch(/^数据：/);
    expect(experiment.items[1]).toMatch(/^(对比方法|评估指标)：/);
    expect(experiment.itemCitationIndexes).toEqual([[1], [1]]);
  });

  it("replaces generic branches with semantic topics, merges duplicates, and drops unclassifiable placeholders", () => {
    const source = [
      "本文提出 RECAP 框架，通过可解码性监督训练验证器。",
      "实验在 Sandbox 数据集上进行，并与 Probe 基线比较。",
      "实验采用 F1 和 Recall@5 评估模型的验证能力。",
      "结果显示 RECAP 的 F1 提升了 8.2%。",
    ].join("\n");
    const result = proxy.ensureMindMapSourceCoverage({
      root: "RECAP",
      rootDesc: "以可解码性监督训练验证器。",
      children: [
        {
          topic: "方法/架构",
          desc: "本文提出 RECAP 框架，通过可解码性监督训练验证器。",
          items: [],
          itemCitationIndexes: [],
        },
        {
          topic: "要点 1",
          desc: "实验在 Sandbox 数据集上进行，并与 Probe 基线比较。",
          items: [],
          itemCitationIndexes: [],
        },
        {
          topic: "要点 2",
          desc: "实验采用 F1 和 Recall@5 评估模型的验证能力。",
          items: [],
          itemCitationIndexes: [],
        },
        {
          topic: "要点 3",
          desc: "论文介绍了相关内容。",
          items: [],
          itemCitationIndexes: [],
        },
        {
          topic: "要点 4",
          desc: "结果显示 RECAP 的 F1 提升了 8.2%。",
          items: [],
          itemCitationIndexes: [],
        },
      ],
    }, source, [], new Set(), { appendFacts: false });

    expect(result.mindMap.children.map((child) => child.topic)).toEqual([
      "方法/架构",
      "数据与实验",
      "结果",
    ]);
    const experiment = result.mindMap.children.find((child) => child.topic === "数据与实验");
    expect(experiment?.desc).toContain("Sandbox");
    expect(experiment?.items).toEqual([
      "数据：实验在 Sandbox 数据集上进行",
      "对比方法：与 Probe 基线比较。",
      "评估指标：实验采用 F1 和 Recall@5 评估模型的验证能力。",
    ]);
    expect(JSON.stringify(result.mindMap)).not.toMatch(/要点|论文介绍了相关内容/);
  });

  it("samples long papers across sections while keeping the analysis prompt bounded", () => {
    const citations = Array.from({ length: 160 }, (_, offset) => {
      const index = offset + 1;
      let content = `正文证据 ${index}：这是论文第 ${index} 个可定位证据块，包含用于覆盖测试的详细内容。`;
      if (index === 21) content += " Research objective and central problem.";
      if (index === 49) content += " The proposed method uses a hierarchical architecture.";
      if (index === 88) content += " Experiments use the CUSUM benchmark and Recall metric.";
      if (index === 121) content += " Results significantly outperform the baseline.";
      if (index === 149) content += " Limitations and future work are discussed here.";
      return { index, locator: `网页正文第 ${index} 句`, content: content.repeat(5) };
    });

    const selected = proxy.selectArticleAnalysisCitations(citations, 64, 24000);
    const indexes = selected.map((item) => item.index);
    const promptCharacters = selected.reduce(
      (total, item) => total + item.content.length + item.locator.length + 24,
      0,
    );

    expect(selected.length).toBeLessThanOrEqual(64);
    expect(promptCharacters).toBeLessThanOrEqual(24000);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(indexes).toEqual(expect.arrayContaining([1, 21, 49, 88, 121, 149, 160]));
    expect(indexes.some((index) => index >= 35 && index <= 45)).toBe(true);
    expect(indexes.some((index) => index >= 75 && index <= 85)).toBe(true);
    expect(indexes.some((index) => index >= 115 && index <= 125)).toBe(true);
  });

  it("never uses title or ORCID metadata as evidence in the model recovery path", () => {
    const citations = [
      {
        index: 1,
        locator: "网页正文第 1 句",
        quote: "CUSUM-Shaped Inference for Reliable Sequential Decisions in Large Language Models",
        content: "CUSUM-Shaped Inference for Reliable Sequential Decisions in Large Language Models",
      },
      {
        index: 2,
        locator: "网页正文第 2 句",
        quote: "ORCID: https://orcid.org/0000-0000-0000-0000",
        content: "ORCID: https://orcid.org/0000-0000-0000-0000",
      },
      {
        index: 3,
        locator: "网页正文第 18 句",
        quote: "The proposed method applies a CUSUM-shaped controller to sequential model decisions.",
        content: "The proposed method applies a CUSUM-shaped controller to sequential model decisions.",
      },
      {
        index: 4,
        locator: "网页正文第 91 句",
        quote: "Experiments show improved detection accuracy over the fixed-threshold baseline.",
        content: "Experiments show improved detection accuracy over the fixed-threshold baseline.",
      },
    ];
    const content = citations.map((item) => item.content).join("\n").repeat(8);
    const recovered = proxy.recoveredChineseArticleResponse(
      { sourceType: "url" },
      {
        content,
        sourceType: "url",
        sourceUrl: "https://arxiv.org/abs/2607.20129",
        citations,
        documentChunks: [],
      },
      "ARTICLE_ANALYSIS_MODEL_RECOVERED",
    );

    const usedIndexes = [
      ...recovered.data.summaryCitationIndexes,
      ...recovered.data.mindMap.rootCitationIndexes,
      ...recovered.data.mindMap.children.flatMap((child) => child.citationIndexes),
    ];
    expect(usedIndexes).not.toContain(1);
    expect(usedIndexes).not.toContain(2);
    expect(usedIndexes).toContain(3);
  });

  it("turns a structural root label into a branch and restores the paper title", () => {
    const repaired = proxy.repairArticleMindMapRoot({
      root: "研究问题",
      rootDesc: "论文研究程序化记忆如何支持长时推理。",
      rootCitationIndexes: [4],
      children: [
        {
          topic: "方法/架构",
          desc: "PRO-LONG 保留结构化交互日志并按需检索历史。",
          citationIndexes: [5],
          items: [],
          itemCitationIndexes: [],
        },
      ],
    }, "PRO-LONG：程序化记忆支持长时推理", "本文提出 PRO-LONG 以支持长时推理。", new Set([4, 5]));

    expect(repaired.root).toBe("PRO-LONG：程序化记忆支持长时推理");
    expect(repaired.rootDesc).toBe("本文提出 PRO-LONG 以支持长时推理。");
    expect(repaired.children.map((child) => child.topic)).toEqual(["研究问题", "方法/架构"]);
    expect(repaired.children[0]).toMatchObject({
      desc: "论文研究程序化记忆如何支持长时推理。",
      citationIndexes: [4],
    });
  });

  it("replaces an affiliation-like root without preserving it as a child node", () => {
    const repaired = proxy.repairArticleMindMapRoot({
      root: "1 1 institutetext: Computational Intelligence Team, Department of Informatics Engineering, University",
      rootDesc: "作者机构信息不应成为论文主题。",
      rootCitationIndexes: [1],
      children: [
        {
          topic: "数据与实验",
          desc: "实验在三个公开数据集上进行。",
          citationIndexes: [2],
          items: ["数据：使用三个公开知识图谱数据集。"],
          itemCitationIndexes: [[2]],
        },
      ],
    }, "CLARK：知识图谱自适应推理框架", "CLARK 统一知识图谱、符号规则与概率推理。", new Set([1, 2]));

    expect(repaired.root).toBe("CLARK：知识图谱自适应推理框架");
    expect(repaired.children.map((child) => child.topic)).toEqual(["数据与实验"]);
    expect(JSON.stringify(repaired)).not.toMatch(/institutetext|University/);
  });

  it("keeps Chinese entity explanations grounded by dedicated English evidence", () => {
    const quote = "SoftReason uses the KVQA benchmark to evaluate multi-hop reasoning under the entity-linking protocol.";
    const evidence = [{
      index: 1,
      quote,
      content: quote,
      locator: "web sentence 1",
      sourceType: "url",
    }];
    const graph = proxy.normalizedEntityGraph({
      entities: [
        {
          tempId: "E1",
          name: "SoftReason",
          type: "model",
          aliases: [],
          description: "SoftReason 是一种面向多跳任务的全可微神经软符号演绎推理模型。",
          descriptionEvidence: [1],
          citationIndexes: [1],
          confidence: 0.95,
        },
        {
          tempId: "E2",
          name: "KVQA",
          type: "dataset",
          aliases: [],
          description: "KVQA 是用于评估实体链接协议下多跳知识问答能力的公开基准数据集。",
          descriptionEvidence: [1],
          citationIndexes: [1],
          confidence: 0.93,
        },
      ],
      relations: [{
        source: "E1",
        target: "E2",
        type: "uses",
        shortLabel: "使用",
        explanation: "SoftReason 使用 KVQA 基准评估实体链接协议下的多跳推理能力。",
        status: "asserted",
        citationIndexes: [1],
        confidence: 0.92,
      }],
    }, new Set([1]), evidence, { profile: "article_core" });

    expect(graph.entities.map((entity) => entity.name)).toEqual(["SoftReason", "KVQA"]);
    expect(graph.relations).toHaveLength(1);
    expect(graph.diagnostics).toMatchObject({
      crossLanguageGroundedEntities: 2,
      descriptionFilteredEntities: 0,
      acceptedEntities: 2,
      acceptedRelations: 1,
    });
  });

  it("builds an evidence-backed semantic outline when the article model is unavailable", () => {
    const facts = [
      "研究目标是减少长文档问答中的语义误召回。",
      "本文提出 EvidenceGraph-RAG，使用实体路径重排并通过证据门控生成答案。",
      "实验使用 HotpotQA、Qasper 和 300 条中文技术问题，基线包括 BM25 与 GraphRAG。",
      "评价指标包括 Recall@10、引用准确率和平均响应延迟，每组实验重复三次。",
      "结果显示 Recall@10 从 71.2% 提升到 82.6%，引用准确率提升到 88.1%。",
      "局限是跨语言缩写会拆分同一实体，两跳路径无法覆盖长链推理。",
      "标题：A Very Long English Paper Title",
      "发布日期：2026/07/23",
      "来源：https://example.com/paper",
    ];
    const citations = facts.map((quote, index) => ({
      index: index + 1,
      quote,
      content: quote,
    }));
    const graph = proxy.deterministicArticleMindMap(
      "EvidenceGraph-RAG",
      facts.join("\n"),
      citations,
      new Set(citations.map((item) => item.index)),
    );

    expect(graph.children.map((child) => child.topic)).toEqual([
      "研究问题",
      "方法/架构",
      "数据与实验",
      "结果",
      "局限与启示",
    ]);
    const experiment = graph.children.find((child) => child.topic === "数据与实验");
    expect(`${experiment?.desc} ${experiment?.items.join(" ")}`).toMatch(/HotpotQA|Qasper|Recall@10|重复三次/);
    expect(JSON.stringify(graph)).not.toMatch(/Very Long English Paper Title|发布日期|example\.com/);
    expect(graph.children.every((child) => child.citationIndexes.length > 0)).toBe(true);
  });
});
