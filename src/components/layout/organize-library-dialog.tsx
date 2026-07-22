"use client";

import { useState } from "react";
import type { Category, KnowledgeNode, MindMap } from "@/types";
import { apiFetch } from "@/lib/client-api";

type OrganizeMode = "recommended" | "semantic" | "workflow" | "custom";

interface ProposedCategory {
  key: string;
  name: string;
  description: string;
  icon: string;
}

interface Proposal {
  categories: ProposedCategory[];
  assignments: Record<string, string>;
}

interface UndoSnapshot {
  assignments: Record<string, string | null>;
  createdCategoryIds: string[];
}

const UNDO_KEY = "mindgrow.organize.undo.v1";

const MODE_OPTIONS: Array<{ id: OrganizeMode; title: string; description: string }> = [
  { id: "recommended", title: "AI 推荐", description: "根据内容自动选择最稳妥的主题结构" },
  { id: "semantic", title: "语义主题", description: "按技术、产品、研究和行业主题聚合" },
  { id: "workflow", title: "知识工作流", description: "按问题、方法、证据、结论和行动整理" },
  { id: "custom", title: "自定义大目录", description: "按你的目录名称和说明自动迁移小知识库" },
];

const SEMANTIC_CATEGORIES: ProposedCategory[] = [
  { key: "ai", name: "AI与技术", description: "模型、RAG、检索、数据与工程", icon: "⚙️" },
  { key: "product", name: "产品与用户", description: "产品、需求、用户、竞品与商业", icon: "💡" },
  { key: "research", name: "研究与资料", description: "论文、文章、PDF、报告与学习", icon: "📚" },
  { key: "project", name: "项目与决策", description: "项目、会议、任务、决策与行动", icon: "🎯" },
  { key: "other", name: "其他知识", description: "暂未形成稳定主题的内容", icon: "🗂️" },
];

const WORKFLOW_CATEGORIES: ProposedCategory[] = [
  { key: "question", name: "问题与目标", description: "待解决问题、需求和目标", icon: "❓" },
  { key: "method", name: "概念与方法", description: "概念、模型、框架和方法", icon: "🧩" },
  { key: "evidence", name: "证据与资料", description: "论文、数据、报告和引用", icon: "📎" },
  { key: "result", name: "结论与行动", description: "结论、决策、任务和下一步", icon: "✅" },
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

function parseCustomCategories(value: string): ProposedCategory[] {
  return value.split(/\r?\n/).map((line, index) => {
    const [name, ...description] = line.split(/[：:]/);
    return { key: `custom-${index}`, name: name.trim(), description: description.join("：").trim(), icon: "📁" };
  }).filter((category) => category.name);
}

function scoreText(text: string, category: ProposedCategory) {
  const normalized = text.toLocaleLowerCase();
  const terms = [category.name, category.description, ...(KEYWORDS[category.key] || [])]
    .flatMap((value) => value.toLocaleLowerCase().split(/[\s、，,；;\/]+/))
    .filter((value) => value.length >= 2);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? Math.min(4, term.length) : 0), 0);
}

async function mapText(map: MindMap) {
  try {
    const response = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(map.id)}`);
    if (!response.ok) throw new Error("load failed");
    const data = await response.json();
    const nodes = (data.nodes || []) as KnowledgeNode[];
    return `${map.name} ${map.description || ""} ${nodes.slice(0, 60).map((node) => `${node.content} ${node.desc || ""}`).join(" ")}`;
  } catch {
    return `${map.name} ${map.description || ""}`;
  }
}

export function OrganizeLibraryDialog({ maps, categories, onClose, onDone }: {
  maps: MindMap[];
  categories: Category[];
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<OrganizeMode>("recommended");
  const [customDirectory, setCustomDirectory] = useState("产品设计：需求、用户、竞品\n技术架构：AI、RAG、数据库、部署\n研究资料：论文、文章、PDF、报告");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  let hasUndo = false;
  try { hasUndo = typeof window !== "undefined" && Boolean(window.localStorage.getItem(UNDO_KEY)); } catch { hasUndo = false; }

  const createPreview = async () => {
    setBusy(true); setNotice("");
    try {
      const candidateCategories = mode === "workflow"
        ? WORKFLOW_CATEGORIES
        : mode === "custom"
          ? parseCustomCategories(customDirectory)
          : SEMANTIC_CATEGORIES;
      if (!candidateCategories.length) { setNotice("请至少填写一个大目录"); return; }
      const texts = await Promise.all(maps.map(async (map) => [map.id, await mapText(map)] as const));
      const assignments: Record<string, string> = {};
      texts.forEach(([mapId, text]) => {
        const ranked = candidateCategories.map((category) => ({ category, score: scoreText(text, category) })).sort((left, right) => right.score - left.score);
        assignments[mapId] = ranked[0]?.score > 0 ? ranked[0].category.key : candidateCategories.at(-1)!.key;
      });
      const used = new Set(Object.values(assignments));
      const selectedCategories = candidateCategories.filter((category) => used.has(category.key));
      setProposal({ categories: selectedCategories, assignments });
    } catch {
      setNotice("读取知识库失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  };

  const applyProposal = async () => {
    if (!proposal) return;
    setBusy(true); setNotice("");
    try {
      const undo: UndoSnapshot = { assignments: Object.fromEntries(maps.map((map) => [map.id, map.categoryId])), createdCategoryIds: [] };
      window.localStorage.setItem(UNDO_KEY, JSON.stringify(undo));
      const categoryIds = new Map<string, string>();
      for (const proposed of proposal.categories) {
        const existing = categories.find((category) => category.name.trim() === proposed.name.trim());
        if (existing) { categoryIds.set(proposed.key, existing.id); continue; }
        const response = await apiFetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createCategory", name: proposed.name, icon: proposed.icon }) });
        const data = await response.json();
        if (!response.ok || !data.category?.id) throw new Error("目录创建失败");
        categoryIds.set(proposed.key, data.category.id);
        undo.createdCategoryIds.push(data.category.id);
        window.localStorage.setItem(UNDO_KEY, JSON.stringify(undo));
      }
      for (const map of maps) {
        const categoryId = categoryIds.get(proposal.assignments[map.id]) || null;
        const response = await apiFetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, writeForMapId: map.id, body: JSON.stringify({ action: "moveMapToCategory", mapId: map.id, categoryId }) });
        if (!response.ok) throw new Error("知识库迁移失败");
      }
      await onDone();
      setNotice(`已整理 ${maps.length} 个知识库；原结构可一键撤销。`);
    } catch {
      setNotice("整理未完成，请检查连接后重试；已成功的操作可用撤销恢复。");
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    const raw = window.localStorage.getItem(UNDO_KEY);
    if (!raw) return;
    setBusy(true); setNotice("");
    try {
      const snapshot = JSON.parse(raw) as UndoSnapshot;
      for (const [mapId, categoryId] of Object.entries(snapshot.assignments)) {
        const response = await apiFetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, writeForMapId: mapId, body: JSON.stringify({ action: "moveMapToCategory", mapId, categoryId }) });
        if (!response.ok) throw new Error("知识库恢复失败");
      }
      for (const categoryId of snapshot.createdCategoryIds) {
        const response = await apiFetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteCategory", categoryId }) });
        if (!response.ok) throw new Error("目录清理失败");
      }
      window.localStorage.removeItem(UNDO_KEY);
      await onDone();
      setProposal(null); setNotice("已恢复整理前的目录结构。");
    } catch {
      setNotice("撤销未完成，请重试；原始整理记录仍保留。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" data-testid="organize-library-dialog">
      <div className="max-h-[88vh] w-[min(760px,96vw)] overflow-y-auto rounded-3xl border border-white/10 bg-[#111116] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">按需执行 · 默认不整理</div><h2 className="mt-1 text-xl font-semibold text-white">一键整理知识库</h2><p className="mt-2 text-xs text-zinc-400">选择结构后先预览；只移动小知识库到大目录，不改写节点、引用和关系。</p></div>
          <button type="button" data-testid="organize-close" onClick={onClose} className="rounded-lg border border-white/10 px-2 py-1 text-sm text-zinc-400 hover:text-white" aria-label="关闭一键整理">×</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {MODE_OPTIONS.map((option) => <button key={option.id} type="button" data-testid={`organize-mode-${option.id}`} onClick={() => { setMode(option.id); setProposal(null); }} className={`rounded-2xl border p-4 text-left ${mode === option.id ? "border-emerald-300/50 bg-emerald-300/10" : "border-white/10 bg-white/[0.025] hover:border-white/20"}`}><div className="text-sm font-semibold text-white">{option.title}</div><div className="mt-1 text-[11px] leading-5 text-zinc-400">{option.description}</div></button>)}
        </div>
        {mode === "custom" && <textarea value={customDirectory} onChange={(event) => { setCustomDirectory(event.target.value); setProposal(null); }} rows={5} className="mt-4 w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-zinc-200 outline-none focus:border-emerald-300/40" aria-label="自定义大目录" />}
        {proposal && <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4" data-testid="organize-preview"><div className="mb-3 flex items-center justify-between"><div className="text-xs font-semibold text-white">整理预览</div><div className="text-[10px] text-zinc-500">{maps.length} 个知识库 · {proposal.categories.length} 个目录</div></div><div className="space-y-3">{proposal.categories.map((category) => <div key={category.key} className="rounded-xl border border-white/5 bg-white/[0.025] p-3"><div className="flex items-center gap-2"><span>{category.icon}</span><input value={category.name} onChange={(event) => setProposal((current) => current ? { ...current, categories: current.categories.map((item) => item.key === category.key ? { ...item, name: event.target.value } : item) } : current)} className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-white outline-none" aria-label={`目录名称 ${category.key}`} /></div><div className="mt-2 flex flex-wrap gap-1.5">{maps.filter((map) => proposal.assignments[map.id] === category.key).map((map) => <span key={map.id} className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-zinc-300">{map.name}</span>)}</div></div>)}</div></div>}
        {notice && <div role="status" data-testid="organize-status" className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-3 py-2 text-xs text-emerald-200">{notice}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" data-testid="organize-undo" onClick={() => void undoLast()} disabled={!hasUndo || busy} className="rounded-xl border border-white/10 px-4 py-2 text-xs text-zinc-300 disabled:opacity-30">撤销上次整理</button><button type="button" data-testid="organize-create-preview" onClick={() => void createPreview()} disabled={busy || maps.length === 0} className="rounded-xl border border-emerald-300/30 px-4 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-30">{busy ? "正在分析…" : "生成预览"}</button><button type="button" data-testid="organize-apply" onClick={() => void applyProposal()} disabled={!proposal || busy} className="rounded-xl bg-emerald-300 px-4 py-2 text-xs font-semibold text-black disabled:opacity-30">确认整理</button></div>
      </div>
    </div>
  );
}
