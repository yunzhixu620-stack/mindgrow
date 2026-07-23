import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const proxy = require("../../../fc-proxy/index.js") as {
  normalizeDocumentLayout: (value: string) => string;
  buildSentenceCitations: (
    content: string,
    sourceType: string,
    fileName: string,
    maximum?: number,
  ) => Array<{
    index: number;
    quote: string;
    locator: string;
    sentenceIndex: number;
    charStart: number;
    charEnd: number;
    pageNumber: number | null;
  }>;
  requestedKnowledgeNodeBudget: (input: string, hasUrl: boolean) => {
    kind: string;
    minimum: number;
    maximum: number;
  };
  shouldTreatAsQuestionIntent: (input: string, requestedIntent?: string) => boolean;
  classifyInput: (input: string) => string;
  mindMapNodeCount: (mindMap: unknown) => number;
  isSingleKnowledgeTerm: (input: string) => boolean;
  ensureShortTermFiveDirections: (
    mindMap: {
      root: string;
      children: Array<{ topic: string; desc?: string; items?: string[] }>;
      relatedTopics?: string[];
    },
    input: string,
  ) => {
    root: string;
    children: Array<{ topic: string; desc?: string; items?: string[] }>;
  };
  normalizeKnowledgeMindMapDisplay: (
    mindMap: {
      root: string;
      rootDesc?: string;
      children: Array<{ topic: string; desc?: string; items?: string[]; itemCitationIndexes?: number[][] }>;
    },
  ) => {
    root: string;
    rootDesc: string;
    children: Array<{ topic: string; desc: string; items: string[]; itemCitationIndexes: number[][] }>;
  };
  readableSourceFact: (value: string) => string;
  ensureKnowledgeNodeMinimum: (
    mindMap: unknown,
    sourceText: string,
    budget: { kind: string; minimum: number; maximum: number },
  ) => unknown;
  ensureMindMapSourceCoverage: (
    mindMap: unknown,
    sourceText: string,
    citations: unknown[],
    allowedIndexes: null,
    options?: {
      maxAppendedFacts?: number;
      maximumFactLength?: number;
      rejectMarkdownFacts?: boolean;
    },
  ) => {
    mindMap: { children: Array<{ topic: string; items: string[] }> };
    audit: { appendedFacts: number; uncoveredFacts: number };
  };
  applyKnowledgeNodeBudget: (mindMap: unknown, budget: { kind: string; minimum: number; maximum: number }) => {
    mindMap: unknown;
    audit: { actual: number; proposed: number; overflowCompressed: number };
  };
  canonicalizeSupplementMindMap: (
    mindMap: unknown,
    storedNodes: unknown[],
  ) => {
    mindMap: { root: string; children: Array<{ topic: string; items: string[] }> };
    plan: { predictedReuseRate: number; warning: string };
  };
  handleMeetingTool: (body: Record<string, unknown>) => Promise<{
    status: number;
    data: {
      title: string;
      summary: string;
      decisions: unknown[];
      actionItems: Array<{ task: string; owner?: string; due?: string; citationIndexes?: number[] }>;
      openQuestions: Array<{ text: string; citationIndexes?: number[] }>;
      actionItemStatus: string;
      citations: Array<{ quote: string; charStart: number; charEnd: number }>;
    };
  }>;
};

function oversizedMap() {
  return {
    root: "知识管理",
    rootDesc: "根节点",
    children: Array.from({ length: 6 }, (_, branch) => ({
      topic: `分支 ${branch + 1}`,
      desc: "描述",
      items: Array.from({ length: 8 }, (_, item) => `要点 ${branch + 1}-${item + 1}`),
    })),
  };
}

describe("knowledge quality contracts", () => {
  it("expands a single knowledge term into exactly five first-level directions", () => {
    expect(proxy.isSingleKnowledgeTerm("GraphRAG")).toBe(true);
    expect(proxy.isSingleKnowledgeTerm("知识图谱")).toBe(true);
    expect(proxy.isSingleKnowledgeTerm("GraphRAG improves retrieval.")).toBe(false);

    const result = proxy.ensureShortTermFiveDirections({
      root: "GraphRAG",
      children: [
        { topic: "技术优势", items: [] },
        { topic: "应用场景", items: [] },
      ],
      relatedTopics: ["知识图谱构建", "大模型微调方法", "检索排序算法"],
    }, "GraphRAG");

    expect(result.children.map((child) => child.topic)).toEqual([
      "技术优势",
      "应用场景",
      "知识图谱构建",
      "大模型微调方法",
      "检索排序算法",
    ]);
    expect(proxy.mindMapNodeCount(result)).toBe(6);
  });

  it("keeps long-fragment coverage concise and removes unsupported placeholder items", () => {
    const source = [
      "# SEO 计划",
      "| 页面 | 目标 | 状态 |",
      "|---|---|---|",
      "| 支柱页 | AI 知识助手 | 已上线 |",
      "生产登录页不泄漏私有知识内容。",
      "Search Console 验证尚未完成。",
      "Core Web Vitals 的 LCP p75 目标小于 2.5 秒。",
    ].join("\n");
    const result = proxy.ensureMindMapSourceCoverage({
      root: "SEO 计划",
      children: [{
        topic: "技术基础",
        desc: "生产登录页不泄漏私有知识内容",
        items: [
          "未明确具体机制内容，需结合其他文档补充",
          "核心机制：输入未提供具体机制细节",
          "核心机制：输入截断，无明确机制说明",
          "Search Console 验证尚未完成",
        ],
      }],
    }, source, [], null, {
      maxAppendedFacts: 2,
      maximumFactLength: 120,
      rejectMarkdownFacts: true,
    });
    const items = result.mindMap.children.flatMap((child) => child.items);
    expect(items.some((item) => item.includes("未明确具体机制"))).toBe(false);
    expect(items.some((item) => item.includes("输入未提供具体机制细节"))).toBe(false);
    expect(items.some((item) => item.includes("输入截断，无明确机制说明"))).toBe(false);
    expect(items.some((item) => item.includes("|"))).toBe(false);
    expect(result.audit.appendedFacts).toBeLessThanOrEqual(2);
  });

  it("keeps long-fragment display nodes semantic, compact, and complete", () => {
    const result = proxy.normalizeKnowledgeMindMapDisplay({
      root: "# MindGrow V8 SEO 内容建设与国际化增长策略",
      rootDesc: "这是一个超过显示宽度的根节点说明，需要保留核心含义但不能让卡片变成极长的横条。" + "补充".repeat(40),
      children: [{
        topic: "## 数据与实验",
        desc: "用于解释采用了哪些数据、如何设置实验、比较哪些基线以及使用什么指标。" + "说明".repeat(30),
        items: [
          "2. **输入词**：AI PDF summarizer with citations、网页文章解析、URL to mind map、会议转知识库、扫描 PDF OCR。",
          "SEV2：PDF/",
          "实验在 MovieLens-1M 数据集上比较传统 RAG 和协同过滤基线，并使用 Recall@20 与 NDCG@20 评估推荐效果。" + "结果".repeat(30),
        ],
        itemCitationIndexes: [[1], [2], [3]],
      }],
    });

    expect(result.root).not.toContain("#");
    expect(result.children[0].topic).toBe("数据与实验");
    expect(result.children[0].desc.length).toBeLessThanOrEqual(90);
    expect(result.children[0].items).toHaveLength(2);
    expect(result.children[0].items.join(" ")).not.toMatch(/\*\*|SEV2：PDF\/$/);
    expect(result.children[0].items.every((item) => item.length <= 96)).toBe(true);
    expect(result.children[0].itemCitationIndexes).toEqual([[1], [3]]);
  });

  it("turns markdown table rows into short semantic facts instead of raw table nodes", () => {
    expect(proxy.readableSourceFact("| 服务 | SLO | 延迟/质量目标 |")).toBe("");
    expect(proxy.readableSourceFact("|---|---:|---|")).toBe("");
    const fact = proxy.readableSourceFact(
      "| GitHub Pages 前端 | 99.9% | LCP p75 <2.5 秒，静态资源 404 = 0 |",
    );
    expect(fact).toBe("GitHub Pages 前端：99.9%；LCP p75 <2.5 秒，静态资源 404 = 0");
    expect(fact).not.toContain("|");
    expect(fact.length).toBeLessThanOrEqual(180);
  });

  it("uses flattened table evidence to reach the long-text minimum without raw rows", () => {
    const source = [
      "MindGrow On-call 服务目标",
      "| 服务 | SLO | 延迟/质量目标 | |---|---:|---|",
      "| GitHub Pages 前端 | 99.9% | LCP p75 <2.5 秒，静态资源 404 = 0 |",
      "| 阿里云 API | 99.5% | 非生成接口 p95 <1.5 秒，5xx <1% |",
      "| AI 生成/文章解析 | 99.0% | p95 <20 秒，结构解析成功率 ≥99% |",
      "| 知识问答 | 99.0% | 引用覆盖率 ≥95%，越权泄漏 0 |",
      "| Audio Overview | 98.5% | MP3 失败时浏览器朗读降级成功率 ≥99% |",
      "SEV0：跨租户越权时 15 分钟内响应。",
      "SEV1：核心知识读写不可用时 30 分钟内响应。",
    ].join(" ");
    const output = proxy.ensureKnowledgeNodeMinimum({
      root: "MindGrow On-call",
      children: [{
        topic: "事故分级",
        desc: "按影响范围分级",
        items: [
          "SEV0：跨租户越权时 15 分钟内响应",
          "SEV1：核心知识读写不可用时 30 分钟内响应",
        ],
      }],
    }, source, { kind: "long_text", minimum: 10, maximum: 20 }) as {
      children: Array<{ items: string[] }>;
    };
    expect(proxy.mindMapNodeCount(output)).toBeGreaterThanOrEqual(10);
    expect(proxy.mindMapNodeCount(output)).toBeLessThanOrEqual(20);
    expect(output.children.flatMap((child) => child.items).join(" ")).not.toContain("|");
  });

  it("enforces the 4–8, 10–20 and 12–20 node budgets", () => {
    expect(proxy.requestedKnowledgeNodeBudget("短文本", false)).toEqual({
      kind: "short_text",
      minimum: 4,
      maximum: 8,
    });
    expect(proxy.requestedKnowledgeNodeBudget("长".repeat(500), false).maximum).toBe(20);
    expect(proxy.requestedKnowledgeNodeBudget("网页正文", true)).toMatchObject({
      kind: "url",
      minimum: 12,
      maximum: 20,
    });

    for (const budget of [
      proxy.requestedKnowledgeNodeBudget("短文本", false),
      proxy.requestedKnowledgeNodeBudget("长".repeat(500), false),
      proxy.requestedKnowledgeNodeBudget("网页正文", true),
    ]) {
      const result = proxy.applyKnowledgeNodeBudget(oversizedMap(), budget);
      expect(proxy.mindMapNodeCount(result.mindMap)).toBeLessThanOrEqual(budget.maximum);
      expect(result.audit.actual).toBeLessThanOrEqual(budget.maximum);
      expect(result.audit.overflowCompressed).toBeGreaterThan(0);
    }
  });

  it("routes long pasted fragments to knowledge ingestion even when the client guessed question", () => {
    expect(proxy.shouldTreatAsQuestionIntent("这段资料的结论是什么？", "question")).toBe(true);
    expect(proxy.shouldTreatAsQuestionIntent("长文资料？".repeat(120), "question")).toBe(false);
    expect(proxy.shouldTreatAsQuestionIntent("短文本", "knowledge")).toBe(false);
    expect(proxy.classifyInput("长文资料？".repeat(120))).toBe("knowledge");
  });

  it("reuses canonical node labels and warns below 50% predicted reuse", () => {
    const proposal = {
      root: "Graph RAG",
      children: [
        { topic: "检索增强生成", items: ["混合检索", "全新细节"] },
      ],
    };
    const result = proxy.canonicalizeSupplementMindMap(proposal, [
      { type: "topic", content: "GraphRAG" },
      { type: "concept", content: "检索增强生成（RAG）" },
      { type: "detail", content: "混合检索" },
    ]);
    expect(result.mindMap.root).toBe("GraphRAG");
    expect(result.mindMap.children[0].items[0]).toBe("混合检索");
    expect(result.plan.predictedReuseRate).toBeGreaterThanOrEqual(0.5);
    expect(result.plan.warning).toBe("");

    const lowReuse = proxy.canonicalizeSupplementMindMap(proposal, []);
    expect(lowReuse.plan.predictedReuseRate).toBe(0);
    expect(lowReuse.plan.warning).toContain("新增较多分支");
  });

  it("creates independent sentence citations with exact normalized offsets", () => {
    const input = "第一句说明结论。\r\n第二句给出证据！\n[第 2 页]\nThird sentence is evidence. Fourth sentence differs.";
    const normalized = proxy.normalizeDocumentLayout(input);
    const citations = proxy.buildSentenceCitations(input, "pdf", "paper.pdf", 20);
    expect(citations.length).toBe(4);
    expect(new Set(citations.map((item) => item.quote)).size).toBe(4);
    for (const citation of citations) {
      expect(normalized.slice(citation.charStart, citation.charEnd)).toBe(citation.quote);
      expect(citation.charEnd).toBeGreaterThan(citation.charStart);
      expect(Number.isInteger(citation.sentenceIndex)).toBe(true);
    }
    expect(citations[2].pageNumber).toBe(2);
    expect(citations[2].locator).toContain("第 2 页");
  });

  it("does not turn a conclusion-like meeting title or negative action phrase into meeting facts", async () => {
    const result = await proxy.handleMeetingTool({
      title: "已批准全面上线",
      participants: "张三、李四",
      transcript: "团队讨论了上线风险。会议没有形成行动项，也没有批准全面上线。",
    });
    expect(result.status).toBe(200);
    expect(result.data.title).toBe("已批准全面上线");
    expect(result.data.decisions).toEqual([]);
    expect(result.data.actionItems).toEqual([]);
    expect(result.data.actionItemStatus).toBe("none");
    expect(result.data.summary).not.toContain("张三");
    for (const citation of result.data.citations) {
      expect(citation.charEnd - citation.charStart).toBe(citation.quote.length);
    }
  });

  it("keeps explicit open questions, owners and Chinese deadlines in the fixed meeting structure", async () => {
    const result = await proxy.handleMeetingTool({
      title: "QA-v18 发布评审会",
      participants: "李明、王芳、赵强",
      transcript: "李明：我们确认 v18 数据库迁移今天上线。王芳：前端由王芳负责，7月24日18点前完成缓存清理和发布。赵强：文章链接抓取对 arXiv 需要在 HTML 失败后降级 PDF。团队确认采用该方案。未决问题：Audio Overview 是否使用阿里云 TTS，明天再评估。",
    });
    expect(result.status).toBe(200);
    expect(result.data.openQuestions.map((item) => item.text).join(" ")).toContain("Audio Overview");
    expect(result.data.actionItems).toHaveLength(1);
    expect(result.data.actionItems[0]).toMatchObject({
      owner: "王芳",
      due: "7月24日18点前",
    });
    expect(result.data.actionItems[0].citationIndexes?.length).toBeGreaterThan(0);
  });
});
