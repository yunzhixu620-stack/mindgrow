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
