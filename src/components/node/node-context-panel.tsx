"use client";

import React from "react";
import type { KnowledgeNode, NodeContext } from "@/types";

const RELATION_LABELS = {
  contains: "上级结构",
  relates_to: "语义关联",
  contradicts: "冲突关系",
} as const;

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export interface NodeContextPanelProps {
  node: KnowledgeNode;
  context: NodeContext | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onLocate: (nodeId: string) => void;
}

export function NodeContextPanel({ node, context, loading, error, onClose, onLocate }: NodeContextPanelProps) {
  const sources = context?.sources || node.citations || [];
  const backlinks = context?.backlinks || [];
  const timeline = context?.timeline || [];
  return (
    <aside className="fixed inset-x-3 bottom-3 z-[95] max-h-[min(82vh,720px)] overflow-y-auto rounded-2xl border border-emerald-400/25 bg-[var(--card)]/95 p-4 shadow-2xl backdrop-blur-xl md:absolute md:inset-x-auto md:bottom-auto md:right-4 md:top-24 md:w-[400px]" role="dialog" aria-label="节点引用与时间轴" data-testid="node-context-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">引用反查 · 变更时间轴</div>
          <h2 className="mt-1 break-words text-base font-semibold text-[var(--foreground)]">{node.content}</h2>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">来源、反向关联和历史修改均限定在当前工作区与知识库。</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="关闭节点引用与时间轴">×</button>
      </div>

      {loading && <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-3 text-xs text-[var(--muted-foreground)]">正在加载可追溯关系…</p>}
      {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-3 text-xs text-red-200">{error}</p>}

      {!loading && !error && <>
        <section className="mt-4" aria-label="原文来源">
          <div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">原文来源</h3><span className="text-[9px] text-[var(--text-muted)]">{sources.length} 条</span></div>
          {sources.length ? <div className="mt-2 space-y-2">{sources.map((citation) => (
            <blockquote key={`${citation.documentId || "source"}-${citation.index}-${citation.locator || ""}`} className="rounded-xl border border-emerald-300/15 bg-emerald-400/5 p-3 text-[11px] leading-5 text-[var(--text-secondary)]">
              <div className="font-semibold text-emerald-200">[{citation.index}] {citation.title || "来源文档"} · {citation.locator || "原文"}</div>
              <p className="mt-1">“{citation.quote}”</p>
              {citation.sourceUrl && <a href={citation.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] text-emerald-300 underline">打开原网页</a>}
            </blockquote>
          ))}</div> : <p className="mt-2 text-[10px] text-[var(--text-muted)]">这个节点没有原文引用；系统不会把它伪装成可追溯事实。</p>}
        </section>

        <section className="mt-5" aria-label="反向关联">
          <div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">谁指向或复用了它</h3><span className="text-[9px] text-[var(--text-muted)]">{backlinks.length} 个节点</span></div>
          {backlinks.length ? <div className="mt-2 space-y-2">{backlinks.map((backlink) => (
            <button key={backlink.node.id} type="button" onClick={() => onLocate(backlink.node.id)} className="block w-full rounded-xl border border-sky-300/15 bg-sky-400/5 p-3 text-left hover:border-sky-300/35" data-testid="node-backlink">
              <div className="flex flex-wrap items-center gap-1.5">
                <strong className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">{backlink.node.content}</strong>
                {backlink.kinds.includes("incoming_edge") && <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[9px] text-sky-200">{backlink.relation ? RELATION_LABELS[backlink.relation] : "指向本节点"}</span>}
                {backlink.kinds.includes("shared_source") && <span className="rounded-full bg-violet-400/10 px-2 py-0.5 text-[9px] text-violet-200">同源引用</span>}
              </div>
              {backlink.sharedCitations[0] && <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[var(--text-muted)]">“{backlink.sharedCitations[0].quote}”</p>}
            </button>
          ))}</div> : <p className="mt-2 text-[10px] text-[var(--text-muted)]">当前没有其他节点指向或复用同一来源。</p>}
        </section>

        <section className="mt-5" aria-label="变更时间轴">
          <div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">变更时间轴</h3><span className="text-[9px] text-[var(--text-muted)]">{timeline.length} 条</span></div>
          <ol className="mt-3 border-l border-emerald-400/25 pl-4">{timeline.map((event) => (
            <li key={event.id} className="relative pb-4 last:pb-0" data-testid="node-timeline-event">
              <span className="absolute -left-[19px] top-1 h-2 w-2 rounded-full bg-emerald-300" />
              <div className="flex items-center gap-2"><strong className="text-[11px] text-[var(--foreground)]">{event.eventType === "created" ? "创建节点" : "更新节点"}</strong><span className="text-[9px] text-[var(--text-muted)]">{formatTime(event.createdAt)}</span></div>
              {event.changedFields.length > 0 && <p className="mt-1 text-[9px] text-emerald-200">变更：{event.changedFields.map((field) => field === "content" ? "标题" : field === "desc" ? "说明" : field).join("、")}</p>}
              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">{event.content}{event.desc ? ` · ${event.desc}` : ""}</p>
            </li>
          ))}</ol>
        </section>
      </>}
    </aside>
  );
}
