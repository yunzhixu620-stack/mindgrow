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
      actionItems: unknown[];
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
});
