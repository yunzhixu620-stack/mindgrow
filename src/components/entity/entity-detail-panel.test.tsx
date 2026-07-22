import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EntityDetailPanel, formatEntityTimestamp, relatedEntityRelations } from "@/components/entity/entity-detail-panel";
import type { GraphEntity, GraphRelation } from "@/types";

const grounded: GraphEntity = {
  id: "entity-a",
  canonicalName: "GraphRAG",
  entityType: "method",
  aliases: ["Graph RAG"],
  description: "一种结合知识图谱与检索增强生成的方法。",
  groundingStatus: "grounded",
  confidence: 0.94,
  createdAt: "2026-07-20T08:30:00.000Z",
  updatedAt: "2026-07-22T09:45:00.000Z",
  citations: [{ index: 9, quote: "普通实体引用不应替代定义证据", locator: "附录" }],
  descriptionCitations: [{ index: 1, quote: "GraphRAG 使用知识图谱增强检索与回答。", locator: "第 2 页" }],
};

const neighbor: GraphEntity = {
  ...grounded,
  id: "entity-b",
  canonicalName: "知识图谱",
  aliases: [],
};

const relation: GraphRelation = {
  id: "relation-a",
  sourceId: grounded.id,
  targetId: neighbor.id,
  relationType: "uses",
  shortLabel: "使用",
  label: "使用",
  explanation: "GraphRAG 使用知识图谱组织跨段证据。",
  status: "asserted",
  confidence: 0.9,
  citations: [{ index: 2, quote: "GraphRAG uses a knowledge graph for retrieval.", locator: "Section 3" }],
};

const actions = {
  onClose: vi.fn(),
  onLocate: vi.fn(),
  onOpenLibrary: vi.fn(),
};

describe("EntityDetailPanel", () => {
  it("renders aliases, dedicated description evidence and explainable relations", () => {
    const html = renderToStaticMarkup(
      <EntityDetailPanel entity={grounded} entities={[grounded, neighbor]} relations={[relation]} mapName="论文库" {...actions} />,
    );

    expect(html).toContain("Graph RAG");
    expect(html).toContain("GraphRAG 使用知识图谱增强检索与回答。");
    expect(html).not.toContain("普通实体引用不应替代定义证据");
    expect(html).toContain("GraphRAG 使用知识图谱组织跨段证据。");
    expect(html).toContain("知识图谱");
    expect(html).toContain("在本图定位");
    expect(html).toContain("进入所属知识库");
    expect(html).toContain("首次记录");
    expect(html).toContain("2026-07-20 08:30 UTC");
    expect(html).toContain("最近更新");
  });

  it("keeps legacy entities read-only without inventing description evidence", () => {
    const legacy = { ...grounded, id: "legacy", description: "", descriptionCitations: [], groundingStatus: "legacy" as const };
    const html = renderToStaticMarkup(
      <EntityDetailPanel entity={legacy} entities={[legacy]} relations={[]} {...actions} />,
    );

    expect(html).toContain("data-grounding-status=\"legacy\"");
    expect(html).toContain("历史只读");
    expect(html).toContain("原文未直接说明");
  });

  it("selects only relations directly connected to the entity", () => {
    const unrelated = { ...relation, id: "unrelated", sourceId: "entity-c", targetId: "entity-d" };
    expect(relatedEntityRelations(grounded.id, [relation, unrelated])).toEqual([relation]);
  });

  it("formats entity timestamps deterministically and ignores invalid legacy values", () => {
    expect(formatEntityTimestamp("2026-07-22T09:45:00.000Z")).toBe("2026-07-22 09:45 UTC");
    expect(formatEntityTimestamp("legacy")).toBe("");
  });
});
