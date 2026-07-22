import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodeContextPanel } from "@/components/node/node-context-panel";
import type { KnowledgeNode, NodeContext } from "@/types";

const node: KnowledgeNode = {
  id: "target",
  content: "GraphRAG",
  desc: "图谱增强检索",
  type: "concept",
  status: "active",
  source: "article",
  confidence: 1,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T01:00:00.000Z",
  citations: [{ index: 1, documentId: "doc-a", title: "论文 A", locator: "第 2 页", quote: "GraphRAG 使用实体关系增强检索。" }],
};

const context: NodeContext = {
  node,
  sources: node.citations || [],
  backlinks: [{ node: { ...node, id: "parent", content: "检索方法" }, kinds: ["incoming_edge", "shared_source"], relation: "contains", relationCreatedAt: node.createdAt, sharedCitations: node.citations || [] }],
  timeline: [{ id: "revision", eventType: "updated", content: node.content, desc: node.desc || "", changedFields: ["desc"], createdAt: node.updatedAt }],
};

describe("NodeContextPanel", () => {
  it("renders source backlinks and timeline as separate traceability sections", () => {
    const html = renderToStaticMarkup(<NodeContextPanel node={node} context={context} loading={false} error="" onClose={() => undefined} onLocate={() => undefined} />);
    expect(html).toContain("原文来源");
    expect(html).toContain("谁指向或复用了它");
    expect(html).toContain("同源引用");
    expect(html).toContain("变更时间轴");
    expect(html).toContain("更新节点");
  });

  it("does not pretend an uncited node has a source", () => {
    const html = renderToStaticMarkup(<NodeContextPanel node={{ ...node, citations: [] }} context={{ ...context, sources: [], backlinks: [] }} loading={false} error="" onClose={() => undefined} onLocate={() => undefined} />);
    expect(html).toContain("不会把它伪装成可追溯事实");
  });
});
