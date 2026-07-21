"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Citation, CitationAudit } from "@/types";

export interface AnswerClaim {
  text: string;
  detail?: string;
  citationIndexes?: number[];
  auditText?: string;
}

interface AnswerCardProps {
  title?: string;
  conclusion: AnswerClaim[];
  evidence?: AnswerClaim[];
  extension?: string[];
  citations: Citation[];
  audit?: CitationAudit;
  sourceType?: Citation["sourceType"];
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function shortQuote(value: string) {
  const text = normalizedText(value);
  return text.length > 15 ? `${text.slice(0, 15)}…` : text;
}

function sourceLabel(citation: Citation, fallback?: Citation["sourceType"]) {
  if (citation.title) return citation.title;
  if (citation.fileName) return citation.fileName;
  const kind = citation.sourceType || fallback;
  if (kind === "pdf") return "PDF";
  if (kind === "url") return "网页";
  if (kind === "meeting") return "会议原文";
  return "原文";
}

function claimAuditRow(claim: AnswerClaim, audit?: CitationAudit) {
  const target = normalizedText(claim.auditText || [claim.text, claim.detail].filter(Boolean).join(" "));
  return audit?.perClaim?.find((row) => normalizedText(row.text) === target);
}

export function AnswerCard({
  title,
  conclusion,
  evidence = [],
  extension = [],
  citations,
  audit,
  sourceType,
}: AnswerCardProps) {
  const instanceId = useId().replace(/:/g, "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedCitation, setHighlightedCitation] = useState<number | null>(null);
  const [expandedConclusion, setExpandedConclusion] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState(false);
  const citationByIndex = useMemo(() => new Map(citations.map((item) => [item.index, item])), [citations]);
  const refused = audit?.refusalReason === "ALL_KEY_CLAIMS_UNSUPPORTED";
  const supportedCriticalCount = audit?.supportedCriticalClaimCount ?? audit?.citedClaimCount ?? 0;
  const criticalClaimCount = audit?.criticalClaimCount ?? audit?.claimCount ?? 0;

  const visibleClaims = refused ? [] : [...conclusion, ...evidence];
  const usedCitationIndexes = Array.from(new Set(visibleClaims.flatMap((claim) => {
    const row = claimAuditRow(claim, audit);
    return row?.citationIndexes ?? claim.citationIndexes ?? [];
  }))).filter((index) => citationByIndex.has(index));

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  function focusCitation(index: number) {
    const target = document.getElementById(`answer-evidence-${instanceId}-${index}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setHighlightedCitation(index);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setHighlightedCitation(null), 3000);
  }

  function CitationChip({ index }: { index: number }) {
    const citation = citationByIndex.get(index);
    if (!citation) return null;
    const label = sourceLabel(citation, sourceType);
    const locator = citation.locator || "位置未标注";
    return (
      <span className="group relative inline-flex align-middle">
        <button
          type="button"
          onClick={() => focusCitation(index)}
          data-testid="citation-chip"
          data-citation-index={index}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--primary-hover)] transition hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          aria-label={`查看引用 ${index}：${label}，${locator}`}
        >
          <span aria-hidden="true">▣</span>
          <span className="max-w-28 truncate">{label}</span>
          <span className="max-w-36 truncate text-[var(--text-secondary)]">“{shortQuote(citation.quote)}”</span>
          <span className="shrink-0 text-[var(--text-tertiary)]">{locator}</span>
        </button>
        <span role="tooltip" data-testid="citation-tooltip" className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left text-[11px] leading-relaxed text-[var(--text-secondary)] opacity-0 shadow-2xl transition delay-300 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          <strong className="mb-1 block text-[var(--text-primary)]">{label} · {locator}</strong>
          “{citation.quote}”
        </span>
      </span>
    );
  }

  function ClaimList({
    items,
    empty,
    initialLimit = 5,
    expanded = false,
    onToggle,
  }: {
    items: AnswerClaim[];
    empty: string;
    initialLimit?: number;
    expanded?: boolean;
    onToggle?: () => void;
  }) {
    if (items.length === 0) return <p className="text-[var(--text-tertiary)]">{empty}</p>;
    const hasMore = items.length > initialLimit;
    const visibleItems = hasMore && !expanded ? items.slice(0, initialLimit) : items;
    return (
      <>
      <ul className="space-y-3">
        {visibleItems.map((claim, index) => {
          const row = claimAuditRow(claim, audit);
          const indexes = row?.citationIndexes ?? claim.citationIndexes ?? [];
          const unsupported = row ? !row.supported : indexes.length === 0;
          return (
            <li key={`${claim.text}-${index}`} data-claim-status={unsupported ? "unsupported" : "supported"} className={`rounded-xl border p-3 ${unsupported ? "border-amber-400/30 bg-amber-400/[0.06]" : "border-white/5 bg-white/[0.025]"}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 ${unsupported ? "text-amber-300" : "text-[var(--primary)]"}`} aria-hidden="true">{unsupported ? "⚠" : "✓"}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-relaxed text-[var(--text-primary)]">{claim.text}</p>
                  {claim.detail && <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">{claim.detail}</p>}
                  {unsupported ? (
                    <p className="mt-2 text-[10px] text-amber-300">未找到能逐字核验这条结论的直接证据</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">{indexes.map((citationIndex) => <CitationChip key={citationIndex} index={citationIndex} />)}</div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && onToggle && <button type="button" data-testid="answer-claims-toggle" onClick={onToggle} className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--primary-border)] hover:text-[var(--primary-hover)]">{expanded ? "收起次要信息" : `展开其余 ${items.length - initialLimit} 条`}</button>}
      </>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] text-xs" data-testid="answer-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3">
        <h3 className="font-semibold text-[var(--text-primary)]">{title || "分析结果"}</h3>
        {audit && <span className={`rounded-full px-2 py-1 text-[10px] ${refused ? "bg-red-400/10 text-red-300" : "bg-[var(--primary-subtle)] text-[var(--primary-hover)]"}`}>{refused ? "证据不足，已拒答" : `关键结论支持 ${supportedCriticalCount}/${criticalClaimCount}`}</span>}
      </header>

      <section className="border-b border-[var(--border)] bg-[var(--card)] p-4" data-testid="answer-conclusion" aria-labelledby={`answer-conclusion-${instanceId}`}>
        <h4 id={`answer-conclusion-${instanceId}`} className="mb-3 text-sm font-bold text-[var(--text-primary)]">结论</h4>
        {refused ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/[0.07] p-3" data-testid="answer-refusal">
            <p className="font-semibold text-red-200">当前材料不足以支持可靠结论</p>
            <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">所有关键结论都未通过逐字证据核验，因此本次不展示事实性答案，避免把推测当成原文结论。</p>
          </div>
        ) : <ClaimList items={conclusion} empty="未提取到可核验的核心结论" initialLimit={4} expanded={expandedConclusion} onToggle={() => setExpandedConclusion((value) => !value)} />}
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--background)] p-4" data-testid="answer-evidence" aria-labelledby={`answer-evidence-title-${instanceId}`}>
        <h4 id={`answer-evidence-title-${instanceId}`} className="mb-3 text-sm font-bold text-[var(--text-primary)]">证据</h4>
        {!refused && evidence.length > 0 && <div className="mb-3"><ClaimList items={evidence} empty="" initialLimit={5} expanded={expandedEvidence} onToggle={() => setExpandedEvidence((value) => !value)} /></div>}
        {usedCitationIndexes.length > 0 ? (
          <div className="space-y-2">
            {usedCitationIndexes.map((index) => {
              const citation = citationByIndex.get(index)!;
              const isPdf = (citation.sourceType || sourceType) === "pdf";
              return (
                <div
                  key={index}
                  id={`answer-evidence-${instanceId}-${index}`}
                  data-testid="citation-evidence"
                  data-citation-index={index}
                  data-highlighted={highlightedCitation === index ? "true" : "false"}
                  className={`scroll-m-6 rounded-xl border p-3 transition duration-300 ${highlightedCitation === index ? "border-[var(--primary)] bg-[var(--primary-subtle)] ring-2 ring-[var(--primary)]/40" : "border-[var(--border)] bg-[var(--card)]"}`}
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[var(--primary-hover)]">引用 {index} · {sourceLabel(citation, sourceType)}</strong>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{citation.locator || "位置未标注"}</span>
                  </div>
                  <blockquote className="border-l-2 border-[var(--primary)] pl-2 leading-relaxed text-[var(--text-secondary)]">“{citation.quote}”</blockquote>
                  {isPdf && <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">PDF 本轮仅提供页码/段落 locator，不代表已在 PDF Viewer 中定位或高亮。</p>}
                  {!isPdf && citation.sourceUrl && <a className="mt-2 inline-block text-[10px] text-[var(--primary-hover)] underline" href={citation.sourceUrl} target="_blank" rel="noreferrer">打开原网页核对</a>}
                </div>
              );
            })}
          </div>
        ) : <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-amber-200">没有通过逐字核验的原文证据。</p>}
      </section>

      <section className="bg-[var(--bg-elevated)] p-4" data-testid="answer-extension" aria-labelledby={`answer-extension-${instanceId}`}>
        <h4 id={`answer-extension-${instanceId}`} className="mb-1 text-sm font-bold text-[var(--text-primary)]">ⓘ AI 延伸</h4>
        <p className="mb-3 text-[10px] text-[var(--text-tertiary)]">以下内容用于继续探索，不等同于原文已确认的事实。</p>
        {extension.length > 0 ? <ul className="space-y-1.5 text-[var(--text-secondary)]">{extension.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}</ul> : <p className="text-[var(--text-tertiary)]">可补充材料或追问具体结论、方法与限制。</p>}
      </section>
    </article>
  );
}
