import { describe, expect, it } from "vitest";
import type { KnowledgeNode } from "@/types";
import {
  deriveKnowledgeNodeDescription,
  hasSemanticExplanation,
  shouldHideUnexplainedGeneratedConcept,
} from "@/lib/mindmap-semantics";

function node(overrides: Partial<KnowledgeNode>): KnowledgeNode {
  return {
    id: "node",
    content: "定义与原理",
    desc: "",
    type: "concept",
    status: "active",
    source: "ai_generated",
    confidence: 0.9,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("mind-map semantic completeness", () => {
  it("uses a concrete parent definition for a generic direction", () => {
    const parent = node({
      id: "root",
      content: "LLM Wiki",
      desc: "把大语言模型领域的概念、方法和证据组织为可检索、可学习的结构化知识页面。",
      type: "topic",
    });
    expect(deriveKnowledgeNodeDescription(node({}), [], parent)).toContain("结构化知识页面");
  });

  it("summarizes concrete child content when the branch description is missing", () => {
    const detail = node({
      id: "detail",
      content: "系统先抽取概念与关系，再把证据链接到对应知识页面。",
      type: "detail",
    });
    expect(deriveKnowledgeNodeDescription(node({ content: "工作原理" }), [detail])).toContain("抽取概念与关系");
  });

  it("hides an AI-generated title-only leaf instead of presenting it as learned knowledge", () => {
    const empty = node({ content: "Prompt Engineering" });
    expect(hasSemanticExplanation(empty.content, empty.desc)).toBe(false);
    expect(shouldHideUnexplainedGeneratedConcept(empty, "", [])).toBe(true);
    expect(shouldHideUnexplainedGeneratedConcept(node({ source: "manual" }), "", [])).toBe(false);
  });
});
