import type { KnowledgeNode } from "@/types";

const GENERIC_DIRECTION = /^(定义与原理|核心概念|基本原理|关键方法|应用场景|优势与局限|局限与启示|评估指标|definition and principles|core concepts|key methods|applications|strengths and limitations|evaluation metrics)$/i;

function normalized(value: string | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function hasSemanticExplanation(title: string, value: string | undefined): boolean {
  const text = normalized(value);
  if (!text) return false;
  const compact = (input: string) => input.toLocaleLowerCase().replace(/[\s，。；：、,.!?;:'"“”‘’()（）[\]【】_-]/g, "");
  const textKey = compact(text);
  const titleKey = compact(title);
  if (!textKey || textKey === titleKey) return false;
  if (["相关内容", "具体内容", "其他内容", "relatedcontent"].includes(textKey)) return false;
  return /[\u3400-\u9fff]/.test(text)
    ? Array.from(text.replace(/\s/g, "")).length >= 8
    : text.length >= 20 && text.split(/\s+/).filter(Boolean).length >= 4;
}

export function deriveKnowledgeNodeDescription(
  node: KnowledgeNode,
  children: KnowledgeNode[],
  parent?: KnowledgeNode,
): string {
  if (hasSemanticExplanation(node.content, node.desc)) return normalized(node.desc);

  const childSummaries = children
    .map((child) => {
      if (hasSemanticExplanation(child.content, child.desc)) {
        return `${child.content}：${normalized(child.desc)}`;
      }
      if (child.type === "detail" && hasSemanticExplanation(node.content, child.content)) {
        return child.content;
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 3);
  if (childSummaries.length > 0) return `具体包括：${childSummaries.join("；")}`;

  const citation = (node.citations || []).find((item) => hasSemanticExplanation(node.content, item.quote));
  if (citation) return normalized(citation.quote);

  if (parent && GENERIC_DIRECTION.test(node.content) && hasSemanticExplanation(parent.content, parent.desc)) {
    return normalized(parent.desc);
  }
  return "";
}

export function shouldHideUnexplainedGeneratedConcept(
  node: KnowledgeNode,
  description: string,
  children: KnowledgeNode[],
): boolean {
  if (node.type !== "concept" || node.source === "manual") return false;
  return !hasSemanticExplanation(node.content, description)
    && children.length === 0
    && (node.citations || []).length === 0;
}
