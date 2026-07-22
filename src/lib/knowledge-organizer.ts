import type { MindMap } from "@/types";

export type OrganizeMode = "recommended" | "semantic" | "workflow" | "custom";

export interface OrganizerCategory {
  key: string;
  name: string;
  description: string;
  icon: string;
}

export interface OrganizerAssignment {
  categoryKey: string | null;
  confidence: number;
  reason: string;
}

export interface OrganizerProposal {
  categories: OrganizerCategory[];
  assignments: Record<string, OrganizerAssignment>;
  source: "ai" | "rules";
  note?: string;
}

export interface OrganizerMapText {
  map: MindMap;
  text: string;
}

export const SEMANTIC_CATEGORIES: OrganizerCategory[] = [
  { key: "ai", name: "AI与技术", description: "模型、RAG、检索、数据与工程", icon: "⚙️" },
  { key: "product", name: "产品与用户", description: "产品、需求、用户、竞品与商业", icon: "💡" },
  { key: "research", name: "研究与资料", description: "论文、文章、PDF、报告与学习", icon: "📚" },
  { key: "project", name: "项目与决策", description: "项目、会议、任务、决策与行动", icon: "🎯" },
  { key: "other", name: "其他知识", description: "暂未形成稳定主题的内容", icon: "🗂️" },
];

export const WORKFLOW_CATEGORIES: OrganizerCategory[] = [
  { key: "question", name: "问题与目标", description: "待解决问题、需求和目标", icon: "❓" },
  { key: "method", name: "概念与方法", description: "概念、模型、框架和方法", icon: "🧩" },
  { key: "evidence", name: "证据与资料", description: "论文、数据、报告和引用", icon: "📎" },
  { key: "result", name: "结论与行动", description: "结论、决策、任务和下一步", icon: "✅" },
  { key: "workflow-other", name: "待整理", description: "暂时无法可靠归入工作流阶段", icon: "🗂️" },
];

const KEYWORDS: Record<string, string[]> = {
  ai: ["ai", "llm", "rag", "模型", "算法", "检索", "向量", "代码", "数据库", "部署", "api"],
  product: ["产品", "用户", "需求", "竞品", "体验", "商业", "市场", "增长", "设计"],
  research: ["论文", "文章", "pdf", "研究", "报告", "实验", "学习", "文献", "citation"],
  project: ["项目", "会议", "任务", "决策", "行动", "计划", "负责人", "进度"],
  question: ["问题", "目标", "需求", "为什么", "挑战", "缺口"],
  method: ["方法", "概念", "模型", "框架", "技术", "流程", "设计"],
  evidence: ["证据", "引用", "论文", "数据", "报告", "实验", "来源"],
  result: ["结论", "决策", "行动", "任务", "计划", "建议", "下一步"],
};

export function parseCustomCategories(value: string): OrganizerCategory[] {
  const seen = new Set<string>();
  return value.split(/\r?\n/).map((line, index) => {
    const [name, ...description] = line.split(/[：:]/);
    return {
      key: `custom-${index}`,
      name: name.trim().slice(0, 32),
      description: description.join("：").trim().slice(0, 120),
      icon: "📁",
    };
  }).filter((category) => {
    const normalized = category.name.toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 12);
}

function categoryTerms(category: OrganizerCategory) {
  return [category.name, category.description, ...(KEYWORDS[category.key] || [])]
    .flatMap((value) => value.toLocaleLowerCase().split(/[\s、，,；;\/]+/))
    .filter((value) => value.length >= 2);
}

function scoreText(text: string, category: OrganizerCategory) {
  const normalized = text.toLocaleLowerCase();
  const matched = categoryTerms(category).filter((term) => normalized.includes(term));
  const score = matched.reduce((total, term) => total + Math.min(4, term.length), 0);
  return { score, matched: Array.from(new Set(matched)).slice(0, 3) };
}

export function buildRuleProposal(
  maps: OrganizerMapText[],
  mode: Exclude<OrganizeMode, "recommended">,
  customDirectory = "",
): OrganizerProposal {
  const categories = mode === "workflow"
    ? WORKFLOW_CATEGORIES
    : mode === "custom"
      ? parseCustomCategories(customDirectory)
      : SEMANTIC_CATEGORIES;
  if (categories.length === 0) throw new Error("至少需要一个大目录");

  const assignments: Record<string, OrganizerAssignment> = {};
  for (const { map, text } of maps) {
    const ranked = categories
      .map((category) => ({ category, ...scoreText(text, category) }))
      .sort((left, right) => right.score - left.score || left.category.name.localeCompare(right.category.name, "zh-CN"));
    const strongest = ranked[0];
    const fallback = categories.at(-1)!;
    const category = strongest.score > 0 ? strongest.category : fallback;
    assignments[map.id] = {
      categoryKey: category.key,
      confidence: strongest.score > 0 ? Math.min(0.95, 0.55 + strongest.score / 24) : 0.35,
      reason: strongest.score > 0 && strongest.matched.length
        ? `匹配：${strongest.matched.join("、")}`
        : "未发现强信号，先放入兜底目录",
    };
  }
  const used = new Set(Object.values(assignments).map((assignment) => assignment.categoryKey));
  return {
    categories: categories.filter((category) => used.has(category.key)),
    assignments,
    source: "rules",
  };
}

export function normalizeAiProposal(value: unknown, maps: MindMap[]): OrganizerProposal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const categories = rawCategories.flatMap((item): OrganizerCategory[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const key = String(row.key || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
    const name = String(row.name || "").trim().slice(0, 32);
    const normalizedName = name.toLocaleLowerCase();
    if (!key || !name || seenKeys.has(key) || seenNames.has(normalizedName)) return [];
    seenKeys.add(key);
    seenNames.add(normalizedName);
    return [{
      key,
      name,
      description: String(row.description || "").trim().slice(0, 120),
      icon: Array.from(String(row.icon || "📁"))[0] || "📁",
    }];
  }).slice(0, 12);
  if (categories.length === 0) return null;

  const allowedMaps = new Set(maps.map((map) => map.id));
  const allowedCategories = new Set(categories.map((category) => category.key));
  const rawAssignments = Array.isArray(raw.assignments) ? raw.assignments : [];
  const assignments: Record<string, OrganizerAssignment> = {};
  for (const item of rawAssignments) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mapId = String(row.mapId || "").trim();
    const categoryKey = String(row.categoryKey || "").trim();
    if (!allowedMaps.has(mapId) || !allowedCategories.has(categoryKey) || assignments[mapId]) continue;
    const confidence = Number(row.confidence);
    assignments[mapId] = {
      categoryKey,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      reason: String(row.reason || "AI 根据知识库主题建议").trim().slice(0, 160),
    };
  }
  maps.forEach((map) => {
    if (!assignments[map.id]) assignments[map.id] = { categoryKey: null, confidence: 0, reason: "AI 未给出可靠分类，保持原位置" };
  });
  return {
    categories,
    assignments,
    source: "ai",
    note: String(raw.note || "").trim().slice(0, 240) || undefined,
  };
}

export function organizerUndoKey(scopeKey: string) {
  const normalized = scopeKey.trim() || "local-user:local-workspace";
  return `mindgrow.organize.undo.v2:${encodeURIComponent(normalized)}`;
}

export function needsLibraryOrganization(mapCount: number, uncategorizedCount: number, categoryCount: number) {
  return uncategorizedCount >= 4 || (mapCount >= 12 && categoryCount < 2);
}
