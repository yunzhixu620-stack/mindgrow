"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { entityDescriptionForReadOnlyDetail, graphEntityGroundingStatus } from "@/lib/entity-graph";
import type { GraphEntity, GraphRelation } from "@/types";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "人物",
  organization: "组织",
  model: "模型",
  method: "方法",
  dataset: "数据集",
  metric: "指标",
  task: "任务",
  event: "事件",
  decision: "决策",
  time: "时间",
  concept: "概念",
  claim: "声明",
  other: "实体",
};

const RELATION_STATUS_LABELS: Record<GraphRelation["status"], string> = {
  asserted: "已确认",
  historical: "历史",
  negated: "否定",
  proposed: "待确认",
};

export interface EntityDetailPanelProps {
  entity: GraphEntity;
  entities: GraphEntity[];
  relations: GraphRelation[];
  mapName?: string;
  onClose: () => void;
  onLocate: () => void;
  onOpenLibrary: () => void;
  className?: string;
}

export function relatedEntityRelations(entityId: string, relations: GraphRelation[]) {
  return relations.filter((relation) => relation.sourceId === entityId || relation.targetId === entityId);
}

export function EntityDetailPanel({
  entity,
  entities,
  relations,
  mapName,
  onClose,
  onLocate,
  onOpenLibrary,
  className = "",
}: EntityDetailPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const groundingStatus = graphEntityGroundingStatus(entity);
  const description = entityDescriptionForReadOnlyDetail(entity);
  const descriptionCitations = entity.descriptionCitations || [];
  const aliases = entity.aliases || [];
  const entityById = useMemo(() => new Map(entities.map((item) => [item.id, item])), [entities]);
  const relatedRelations = useMemo(() => relatedEntityRelations(entity.id, relations), [entity.id, relations]);
  const titleId = `entity-detail-title-${entity.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`fixed inset-x-3 bottom-3 z-[90] max-h-[min(78vh,680px)] overflow-y-auto rounded-2xl border border-sky-400/25 bg-[var(--card)]/95 p-4 shadow-2xl outline-none backdrop-blur-xl md:absolute md:inset-x-auto md:bottom-auto md:right-4 md:top-24 md:w-[380px] ${className}`}
      data-testid="entity-detail-panel"
      data-entity-id={entity.id}
      data-grounding-status={groundingStatus}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">实体概念解释</div>
          <h2 id={titleId} className="mt-1 break-words text-base font-semibold text-[var(--foreground)]">{entity.canonicalName}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 font-semibold text-sky-200">{ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}</span>
            {groundingStatus === "legacy" && <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-200">历史只读</span>}
            {mapName && <span className="truncate text-[var(--muted-foreground)]">来自 {mapName}</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="关闭实体详情">×</button>
      </div>

      {aliases.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="实体别名">
          {aliases.map((alias) => <span key={alias} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-[var(--text-secondary)]">{alias}</span>)}
        </div>
      )}

      <section className="mt-4" aria-label="实体定义">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">一句话说明</div>
        <p className={`mt-1.5 text-[12px] leading-6 ${groundingStatus === "legacy" ? "text-amber-100" : "text-[var(--text-secondary)]"}`}>{description}</p>
      </section>

      <section className="mt-4" aria-label="说明专属证据">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">说明专属证据</div>
          <span className="text-[9px] text-[var(--text-muted)]">{descriptionCitations.length} 条</span>
        </div>
        {descriptionCitations.length > 0 ? (
          <div className="mt-2 space-y-2">
            {descriptionCitations.map((citation) => (
              <blockquote key={`${citation.documentId || "source"}-${citation.index}-${citation.locator || ""}`} className="rounded-xl border border-sky-300/15 bg-sky-400/5 p-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                <div className="mb-1 font-semibold text-sky-200">[{citation.index}] {citation.title || "来源文档"} · {citation.locator || "原文"}</div>
                <p>“{citation.quote}”</p>
              </blockquote>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-xl border border-amber-300/15 bg-amber-400/5 px-3 py-2 text-[10px] leading-5 text-amber-100">原文未直接说明；该历史实体仅保留为只读线索，不作为新回答的正式证据。</p>
        )}
      </section>

      <section className="mt-4" aria-label="实体相关关系">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">相关关系</div>
          <span className="text-[9px] text-[var(--text-muted)]">{relatedRelations.length} 条</span>
        </div>
        {relatedRelations.length > 0 ? <div className="mt-2 space-y-2">
          {relatedRelations.map((relation) => {
            const isSource = relation.sourceId === entity.id;
            const counterpart = entityById.get(isSource ? relation.targetId : relation.sourceId);
            return (
              <details key={relation.id} className="group rounded-xl border border-violet-300/15 bg-violet-400/5 px-3 py-2" data-testid="entity-related-relation">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] text-[var(--foreground)]">
                  <span className="rounded-full bg-violet-400/15 px-2 py-0.5 font-semibold text-violet-200">{relation.shortLabel || relation.label || "相关"}</span>
                  <span className="text-[var(--text-muted)]">{isSource ? "→" : "←"}</span>
                  <span className="min-w-0 flex-1 truncate">{counterpart?.canonicalName || "未知实体"}</span>
                  <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[8px] text-[var(--text-muted)]">{RELATION_STATUS_LABELS[relation.status]}</span>
                </summary>
                <div className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-5 text-[var(--text-secondary)]">
                  <p>{relation.explanation || "原文仅确认该关系，暂无补充解释。"}</p>
                  {(relation.citations || []).map((citation) => (
                    <blockquote key={`${relation.id}-${citation.documentId || "source"}-${citation.index}`} className="mt-2 rounded-lg bg-black/20 p-2 text-[9px] leading-4 text-[var(--text-muted)]">
                      <strong className="text-violet-200">[{citation.index}] {citation.locator || "原文"}</strong> · “{citation.quote}”
                    </blockquote>
                  ))}
                </div>
              </details>
            );
          })}
        </div> : <p className="mt-2 text-[10px] text-[var(--text-muted)]">当前来源没有通过证据校验的直接关系。</p>}
      </section>

      <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 border-t border-white/10 bg-[var(--card)]/95 pt-3 backdrop-blur">
        <button type="button" onClick={onLocate} className="rounded-xl border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20">在本图定位</button>
        <button type="button" onClick={onOpenLibrary} className="rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90">进入所属知识库</button>
      </div>
    </aside>
  );
}
