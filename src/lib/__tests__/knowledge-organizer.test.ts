import { describe, expect, it } from "vitest";
import type { MindMap } from "@/types";
import {
  buildRuleProposal,
  needsLibraryOrganization,
  normalizeAiProposal,
  organizerUndoKey,
  parseCustomCategories,
} from "@/lib/knowledge-organizer";

const { __organizerInternal } = require("../../../fc-proxy/index.js") as {
  __organizerInternal: {
    normalizeOrganizationProposal: (value: unknown, maps: Array<{ id: string }>) => {
      categories: Array<{ key: string; name: string }>;
      assignments: Array<{ mapId: string; categoryKey: string | null; confidence: number }>;
    } | null;
  };
};

function map(id: string, name: string): MindMap {
  return {
    id,
    name,
    description: "",
    mode: "knowledge",
    canvasView: "mindmap",
    color: "#22d3a7",
    isDefault: false,
    categoryId: null,
    nodeCount: 1,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("knowledge organizer", () => {
  it("deduplicates custom directories and preserves their descriptions", () => {
    expect(parseCustomCategories("产品：用户、需求\n产品：重复\n技术：RAG、检索")).toEqual([
      { key: "custom-0", name: "产品", description: "用户、需求", icon: "📁" },
      { key: "custom-2", name: "技术", description: "RAG、检索", icon: "📁" },
    ]);
  });

  it("uses different semantic and workflow structures with explainable assignments", () => {
    const maps = [
      { map: map("rag", "RAG 检索"), text: "RAG 向量检索与模型部署" },
      { map: map("paper", "论文证据"), text: "论文实验、引用与数据报告" },
    ];
    const semantic = buildRuleProposal(maps, "semantic");
    const workflow = buildRuleProposal(maps, "workflow");
    expect(semantic.assignments.rag.categoryKey).toBe("ai");
    expect(workflow.assignments.paper.categoryKey).toBe("evidence");
    expect(workflow.assignments.paper.reason).toContain("匹配");
  });

  it("keeps maps in place when an AI response omits or invents assignments", () => {
    const maps = [map("a", "A"), map("b", "B")];
    const proposal = normalizeAiProposal({
      categories: [{ key: "research", name: "研究", description: "论文", icon: "📚" }],
      assignments: [
        { mapId: "a", categoryKey: "research", confidence: 1.4, reason: "论文主题" },
        { mapId: "b", categoryKey: "invented" },
      ],
    }, maps);
    expect(proposal?.assignments.a).toMatchObject({ categoryKey: "research", confidence: 1 });
    expect(proposal?.assignments.b).toMatchObject({ categoryKey: null, confidence: 0 });
  });

  it("scopes undo records and only reminds after the structure grows", () => {
    expect(organizerUndoKey("user-a:workspace-a")).not.toBe(organizerUndoKey("user-a:workspace-b"));
    expect(needsLibraryOrganization(3, 3, 0)).toBe(false);
    expect(needsLibraryOrganization(4, 4, 0)).toBe(true);
    expect(needsLibraryOrganization(12, 1, 1)).toBe(true);
  });

  it("rejects hallucinated backend categories and leaves omitted maps untouched", () => {
    const proposal = __organizerInternal.normalizeOrganizationProposal({
      categories: [
        { key: "research", name: "研究", description: "论文", icon: "📚" },
        { key: "research", name: "重复键" },
      ],
      assignments: [
        { mapId: "map-a", categoryKey: "research", confidence: 0.8 },
        { mapId: "map-b", categoryKey: "hallucinated", confidence: 1 },
        { mapId: "map-outside", categoryKey: "research", confidence: 1 },
      ],
    }, [{ id: "map-a" }, { id: "map-b" }]);
    expect(proposal?.categories).toHaveLength(1);
    expect(proposal?.assignments).toEqual([
      expect.objectContaining({ mapId: "map-a", categoryKey: "research", confidence: 0.8 }),
      expect.objectContaining({ mapId: "map-b", categoryKey: null, confidence: 0 }),
    ]);
  });
});
