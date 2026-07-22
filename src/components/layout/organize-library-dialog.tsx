"use client";

import { useEffect, useMemo, useState } from "react";
import type { Category, KnowledgeNode, MindMap } from "@/types";
import { apiFetch } from "@/lib/client-api";
import {
  buildRuleProposal,
  normalizeAiProposal,
  organizerUndoKey,
  parseCustomCategories,
  type OrganizeMode,
  type OrganizerProposal,
} from "@/lib/knowledge-organizer";

interface UndoSnapshot {
  scopeKey: string;
  assignments: Record<string, string | null>;
  createdCategoryIds: string[];
  createdAt: string;
}

const MODE_OPTIONS: Array<{ id: OrganizeMode; title: string; description: string }> = [
  { id: "recommended", title: "AI 推荐", description: "读取当前知识库内容，生成更贴合现状的大目录" },
  { id: "semantic", title: "语义主题", description: "按技术、产品、研究和项目主题聚合" },
  { id: "workflow", title: "知识工作流", description: "按问题、方法、证据、结论和行动整理" },
  { id: "custom", title: "自定义大目录", description: "按你的目录名称和说明迁移小知识库" },
];

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

export function OrganizeLibraryDialog({ maps, categories, organizerScopeKey, onClose, onDone }: {
  maps: MindMap[];
  categories: Category[];
  organizerScopeKey: string;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const undoKey = useMemo(() => organizerUndoKey(organizerScopeKey), [organizerScopeKey]);
  const [mode, setMode] = useState<OrganizeMode>("recommended");
  const [customDirectory, setCustomDirectory] = useState("产品设计：需求、用户、竞品\n技术架构：AI、RAG、数据库、部署\n研究资料：论文、文章、PDF、报告");
  const [proposal, setProposal] = useState<OrganizerProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [hasUndo, setHasUndo] = useState(false);

  useEffect(() => {
    try { setHasUndo(Boolean(window.localStorage.getItem(undoKey))); }
    catch { setHasUndo(false); }
  }, [undoKey]);

  const createRulePreview = async (selectedMode: Exclude<OrganizeMode, "recommended">) => {
    if (selectedMode === "custom" && parseCustomCategories(customDirectory).length === 0) {
      throw new Error("请至少填写一个不重复的大目录");
    }
    const texts = await Promise.all(maps.map(async (map) => ({ map, text: await mapText(map) })));
    return buildRuleProposal(texts, selectedMode, customDirectory);
  };

  const createPreview = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (mode === "recommended") {
        try {
          const response = await apiFetch("/api/knowledge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "suggestOrganization", mapIds: maps.map((map) => map.id) }),
          });
          const data = await response.json();
          const aiProposal = response.ok ? normalizeAiProposal(data.proposal || data, maps) : null;
          if (!aiProposal) throw new Error(data.error || "AI proposal unavailable");
          setProposal(aiProposal);
          setNotice("AI 已生成建议；你可以修改目录、逐个调整归属或选择保持原位置。未确认前不会改变知识库。");
          return;
        } catch {
          const fallback = await createRulePreview("semantic");
          setProposal({ ...fallback, note: "AI 服务暂不可用，当前为本地语义规则预览。" });
          setNotice("AI 服务暂不可用，已生成本地语义预览；确认前不会改变知识库。");
          return;
        }
      }
      setProposal(await createRulePreview(mode));
      setNotice("预览已生成；确认前不会改变知识库。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取知识库失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  };

  const restoreSnapshot = async (snapshot: UndoSnapshot) => {
    for (const [mapId, categoryId] of Object.entries(snapshot.assignments)) {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: mapId,
        body: JSON.stringify({ action: "moveMapToCategory", mapId, categoryId }),
      });
      if (!response.ok) throw new Error("知识库恢复失败");
    }
    for (const categoryId of snapshot.createdCategoryIds) {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteCategory", categoryId }),
      });
      if (!response.ok) throw new Error("目录清理失败");
    }
  };

  const applyProposal = async () => {
    if (!proposal) return;
    const usedKeys = new Set(Object.values(proposal.assignments).map((assignment) => assignment.categoryKey).filter(Boolean));
    const usedCategories = proposal.categories.filter((category) => usedKeys.has(category.key));
    const normalizedNames = usedCategories.map((category) => category.name.trim().toLocaleLowerCase());
    if (normalizedNames.some((name) => !name)) {
      setNotice("请先填写所有将使用的目录名称。");
      return;
    }
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setNotice("目录名称不能重复，请合并或修改后再确认。");
      return;
    }
    setBusy(true);
    setNotice("");
    const undo: UndoSnapshot = {
      scopeKey: organizerScopeKey,
      assignments: Object.fromEntries(maps.map((map) => [map.id, map.categoryId])),
      createdCategoryIds: [],
      createdAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(undoKey, JSON.stringify(undo));
      setHasUndo(true);
      const categoryIds = new Map<string, string>();
      for (const proposed of usedCategories) {
        const existing = categories.find((category) => category.name.trim().toLocaleLowerCase() === proposed.name.trim().toLocaleLowerCase());
        if (existing) {
          categoryIds.set(proposed.key, existing.id);
          continue;
        }
        const response = await apiFetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "createCategory", name: proposed.name, icon: proposed.icon }),
        });
        const data = await response.json();
        if (!response.ok || !data.category?.id) throw new Error("目录创建失败");
        categoryIds.set(proposed.key, data.category.id);
        undo.createdCategoryIds.push(data.category.id);
        window.localStorage.setItem(undoKey, JSON.stringify(undo));
      }

      let moved = 0;
      for (const map of maps) {
        const categoryKey = proposal.assignments[map.id]?.categoryKey;
        if (!categoryKey) continue;
        const categoryId = categoryIds.get(categoryKey);
        if (!categoryId || categoryId === map.categoryId) continue;
        const response = await apiFetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          writeForMapId: map.id,
          body: JSON.stringify({ action: "moveMapToCategory", mapId: map.id, categoryId }),
        });
        if (!response.ok) throw new Error("知识库迁移失败");
        moved += 1;
      }
      await onDone();
      setNotice(`已整理：移动 ${moved} 个知识库；原结构可一键撤销。`);
    } catch {
      try {
        await restoreSnapshot(undo);
        window.localStorage.removeItem(undoKey);
        setHasUndo(false);
        await onDone();
        setNotice("整理未完成，已自动恢复原目录结构；可检查连接后重试。");
      } catch {
        setNotice("整理与自动恢复均未完成；撤销记录已保留，请点击“撤销上次整理”重试。");
      }
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    const raw = window.localStorage.getItem(undoKey);
    if (!raw) return;
    setBusy(true);
    setNotice("");
    try {
      const snapshot = JSON.parse(raw) as UndoSnapshot;
      if (snapshot.scopeKey !== organizerScopeKey) throw new Error("撤销记录不属于当前工作区");
      await restoreSnapshot(snapshot);
      window.localStorage.removeItem(undoKey);
      setHasUndo(false);
      await onDone();
      setProposal(null);
      setNotice("已恢复整理前的目录结构。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "撤销未完成，请重试；原始整理记录仍保留。");
    } finally {
      setBusy(false);
    }
  };

  const changeAssignment = (mapId: string, categoryKey: string | null) => {
    setProposal((current) => current ? {
      ...current,
      assignments: {
        ...current.assignments,
        [mapId]: {
          ...current.assignments[mapId],
          categoryKey,
          reason: categoryKey ? "用户在预览中手动调整" : "用户选择保持原位置",
          confidence: 1,
        },
      },
    } : current);
  };

  const assignedCount = proposal
    ? Object.values(proposal.assignments).filter((assignment) => assignment.categoryKey).length
    : 0;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-[var(--overlay-bg)] p-4 backdrop-blur-sm" data-testid="organize-library-dialog">
      <div className="max-h-[88vh] w-[min(820px,96vw)] overflow-y-auto rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">按需执行 · 默认不整理</div>
            <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">一键整理知识库</h2>
            <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">选择结构后先预览；只移动小知识库到大目录，不改写节点、引用和关系。你可以逐个调整，随时撤销。</p>
          </div>
          <button type="button" data-testid="organize-close" onClick={onClose} className="rounded-lg border border-[var(--border-default)] px-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="关闭一键整理">×</button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {MODE_OPTIONS.map((option) => (
            <button key={option.id} type="button" data-testid={`organize-mode-${option.id}`} onClick={() => { setMode(option.id); setProposal(null); setNotice(""); }} className={`rounded-2xl border p-4 text-left ${mode === option.id ? "border-[var(--primary-border)] bg-[var(--primary-subtle)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"}`}>
              <div className="text-sm font-semibold text-[var(--text-primary)]">{option.title}</div>
              <div className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{option.description}</div>
            </button>
          ))}
        </div>

        {mode === "custom" && (
          <textarea value={customDirectory} onChange={(event) => { setCustomDirectory(event.target.value); setProposal(null); }} rows={5} className="mt-4 w-full rounded-2xl border border-[var(--border-default)] bg-[var(--bg-base)] p-4 text-xs leading-6 text-[var(--text-primary)] outline-none focus:border-[var(--primary-border)]" aria-label="自定义大目录" />
        )}

        {proposal && (
          <div className="mt-5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-base)] p-4" data-testid="organize-preview" data-proposal-source={proposal.source}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[var(--text-primary)]">整理预览 · {proposal.source === "ai" ? "AI 建议" : "本地规则"}</div>
              <div className="text-[10px] text-[var(--text-tertiary)]">计划移动 {assignedCount}/{maps.length} 个知识库 · {proposal.categories.length} 个目录</div>
            </div>
            {proposal.note && <div className="mb-3 rounded-lg bg-amber-300/5 px-3 py-2 text-[10px] leading-5 text-amber-200">{proposal.note}</div>}
            <div className="space-y-3">
              {proposal.categories.map((category) => (
                <div key={category.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <div className="flex items-center gap-2">
                    <span>{category.icon}</span>
                    <input value={category.name} onChange={(event) => setProposal((current) => current ? { ...current, categories: current.categories.map((item) => item.key === category.key ? { ...item, name: event.target.value } : item) } : current)} className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-[var(--text-primary)] outline-none" aria-label={`目录名称 ${category.key}`} />
                  </div>
                  <input value={category.description} onChange={(event) => setProposal((current) => current ? { ...current, categories: current.categories.map((item) => item.key === category.key ? { ...item, description: event.target.value } : item) } : current)} className="mt-1 w-full bg-transparent text-[10px] text-[var(--text-tertiary)] outline-none" aria-label={`目录说明 ${category.key}`} />
                  <div className="mt-2 space-y-1.5">
                    {maps.filter((map) => proposal.assignments[map.id]?.categoryKey === category.key).map((map) => (
                      <div key={map.id} className="flex items-center gap-2 rounded-lg bg-[var(--bg-hover)] px-2 py-1.5" data-testid={`organize-map-${map.id}`}>
                        <div className="min-w-0 flex-1"><div className="truncate text-[10px] font-medium text-[var(--text-primary)]">{map.name}</div><div className="truncate text-[9px] text-[var(--text-tertiary)]">{proposal.assignments[map.id]?.reason}</div></div>
                        <select aria-label={`调整 ${map.name} 的目录`} value={category.key} onChange={(event) => changeAssignment(map.id, event.target.value || null)} className="max-w-[150px] rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-1.5 py-1 text-[9px] text-[var(--text-secondary)]">
                          <option value="">保持原位置</option>
                          {proposal.categories.map((option) => <option key={option.key} value={option.key}>{option.icon} {option.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {maps.filter((map) => !proposal.assignments[map.id]?.categoryKey).length > 0 && (
                <div className="rounded-xl border border-dashed border-[var(--border-default)] p-3" data-testid="organize-kept-maps">
                  <div className="text-[10px] font-semibold text-[var(--text-secondary)]">保持原位置</div>
                  <div className="mt-2 space-y-1.5">{maps.filter((map) => !proposal.assignments[map.id]?.categoryKey).map((map) => (
                    <div key={map.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-tertiary)]">{map.name}</span><select aria-label={`调整 ${map.name} 的目录`} value="" onChange={(event) => changeAssignment(map.id, event.target.value || null)} className="max-w-[150px] rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-1.5 py-1 text-[9px] text-[var(--text-secondary)]"><option value="">保持原位置</option>{proposal.categories.map((option) => <option key={option.key} value={option.key}>{option.icon} {option.name}</option>)}</select></div>
                  ))}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {notice && <div role="status" aria-live="polite" data-testid="organize-status" className="mt-4 rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2 text-xs leading-5 text-[var(--primary)]">{notice}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" data-testid="organize-undo" onClick={() => void undoLast()} disabled={!hasUndo || busy} className="rounded-xl border border-[var(--border-default)] px-4 py-2 text-xs text-[var(--text-secondary)] disabled:opacity-30">撤销上次整理</button>
          <button type="button" data-testid="organize-create-preview" onClick={() => void createPreview()} disabled={busy || maps.length === 0} className="rounded-xl border border-[var(--primary-border)] px-4 py-2 text-xs font-semibold text-[var(--primary)] disabled:opacity-30">{busy ? "正在分析…" : "生成预览"}</button>
          <button type="button" data-testid="organize-apply" onClick={() => void applyProposal()} disabled={!proposal || busy || assignedCount === 0} className="rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-30">确认整理</button>
        </div>
      </div>
    </div>
  );
}
