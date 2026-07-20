"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { mindMapToPreviewGraph } from "@/lib/mindmap-preview";
import type { AIMindMap, Citation } from "@/types";

interface CitedText { text: string; citationIndexes: number[] }

interface MeetingResult {
  title: string;
  summary: string;
  summaryCitationIndexes?: number[];
  topics: { title: string; citationIndexes?: number[]; details?: CitedText[] }[];
  decisions: CitedText[];
  actionItems: { task: string; owner?: string; due?: string; status?: string; citationIndexes?: number[] }[];
  risks: CitedText[];
  openQuestions: CitedText[];
  mindMap: AIMindMap;
  citations: Citation[];
  documentChunks?: Citation[];
  citationAudit?: { claimCount: number; citedClaimCount: number; coverage: number; verifiedQuoteCount: number; warnings: string[] };
}

export function MeetingAssistant() {
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const currentMap = useMindGrowStore((state) => state.maps.find((map) => map.id === state.currentMapId));
  const setCurrentMapId = useMindGrowStore((state) => state.setCurrentMapId);
  const nodeCount = useMindGrowStore((state) => state.nodes.length);
  const setNodes = useMindGrowStore((state) => state.setNodes);
  const setEdges = useMindGrowStore((state) => state.setEdges);
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isActiveMeetingMap = (mapId: string) => {
    const latest = useMindGrowStore.getState();
    return mountedRef.current && latest.currentMode === "meeting" && latest.currentMapId === mapId;
  };

  const appendSpeech = useCallback((text: string) => setTranscript((current) => `${current}${current && !current.endsWith("\n") ? " " : ""}${text}`), []);
  const speech = useSpeechInput(appendSpeech);

  async function generate() {
    if (transcript.trim().length < 10) { setNotice("请先输入或录入会议内容"); return; }
    const requestMapId = currentMapId;
    setBusy(true); setNotice(""); setResult(null); setSelectedCitation(null);
    try {
      const response = await apiFetch("/api/tools/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, participants, transcript }),
      });
      const data = await response.json();
      if (!isActiveMeetingMap(requestMapId)) return;
      if (!response.ok) throw new Error(data.error || "生成失败");
      setResult(data);
      if (data.mindMap) {
        const preview = mindMapToPreviewGraph(data.mindMap, "meeting", data.citations || []);
        setNodes(preview.nodes);
        setEdges(preview.edges);
      }
    } catch (error) { if (isActiveMeetingMap(requestMapId)) setNotice(error instanceof Error ? error.message : "生成失败"); }
    finally { if (mountedRef.current) setBusy(false); }
  }

  async function save() {
    if (!result?.mindMap) return;
    const requestMapId = currentMapId;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: requestMapId, mindMap: result.mindMap, source: "meeting",
          citations: result.citations,
          documentChunks: result.documentChunks || result.citations,
          document: { title: result.title, sourceType: "meeting", fileName: "" },
          extraction: { pageCount: 0, tablePages: [], imagePages: [], scannedPages: [], truncated: false },
        }),
      });
      const data = await response.json();
      if (!isActiveMeetingMap(requestMapId)) return;
      if (!response.ok) throw new Error(data.error || "保存失败");
      const savedMapId = String(data.mapId || requestMapId);
      if (savedMapId !== requestMapId) setCurrentMapId(savedMapId);
      const reload = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(savedMapId)}`);
      const graph = await reload.json();
      if (!isActiveMeetingMap(savedMapId)) return;
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); }
      setNotice(`已保存 ${data.totalNodes || 0} 个会议知识节点、${data.totalCitations || 0} 条引用和 ${data.indexedChunks || 0} 个可检索分块`);
    } catch (error) { if (isActiveMeetingMap(requestMapId)) setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { if (mountedRef.current) setSaving(false); }
  }

  const citationByIndex = new Map((result?.citations || []).map((item) => [item.index, item]));
  const showCitations = (indexes: number[] = []) => <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">{indexes.map((index) => <button key={index} type="button" onClick={() => setSelectedCitation(citationByIndex.get(index) || null)} aria-label={`查看会议引用 ${index}`} className="rounded bg-[var(--primary-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary-hover)] hover:ring-1 hover:ring-[var(--primary)]">[{index}]</button>)}</span>;

  return (
    <section className="h-full w-full overflow-y-auto bg-[var(--background)]" data-mode-library-id={currentMapId} data-testid="meeting-content-workspace">
      <div className="mx-auto max-w-6xl p-4">
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-lg font-semibold">🎯 会议助手</h2><p className="mt-1 text-xs text-[var(--text-tertiary)]">实时口述或粘贴会议原文，提取决议、行动项和风险；内容只进入会议板块。</p></div>
          <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs text-sky-200"><span className="font-semibold">独立会议知识库</span><span className="mx-2 opacity-40">·</span>{currentMap?.name || "会议知识库"}<span className="mx-2 opacity-40">·</span>{nodeCount} 节点</div>
        </div>
        <div className={`grid gap-5 ${result ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "mx-auto max-w-2xl"}`}>
        <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="会议标题（可选）" className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
        <input value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder="参会人，用逗号分隔（可选）" className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={10} placeholder="粘贴会议记录，或点击麦克风开始口述…" className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none" />
          {speech.interimText && <div className="text-xs text-[var(--primary)] mt-1">正在识别：{speech.interimText}</div>}
          <div className="flex items-center justify-between mt-2 border-t border-[var(--border-subtle)] pt-2">
            <button type="button" onClick={speech.toggle} aria-label={speech.isListening ? "停止语音输入" : "开始语音输入"} className={`rounded-lg px-3 py-1.5 text-xs ${speech.isListening ? "bg-red-500/20 text-red-300" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"}`}>{speech.isListening ? "■ 停止录音" : "🎙 语音输入"}</button>
            <span className="text-[10px] text-[var(--text-muted)]">{transcript.length} 字</span>
          </div>
        </div>
        {(speech.error || notice) && <div role="status" className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">{speech.error || notice}</div>}
        <button onClick={() => void generate()} disabled={busy || transcript.trim().length < 10} className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-black disabled:opacity-40">{busy ? "正在整理会议…" : "生成结构化会议纪要"}</button>
        </div>

      {result && <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 animate-fade-in">
        {result.citationAudit && <ResultBlock title="引用完整性"><div>结论引用覆盖率：{Math.round(result.citationAudit.coverage * 100)}% · {result.citationAudit.verifiedQuoteCount} 个原文证据块</div>{result.citationAudit.warnings.length > 0 && <div className="mt-1 text-amber-300">{result.citationAudit.warnings.join("；")}</div>}</ResultBlock>}
        <ResultBlock title="会议摘要"><p>{result.summary || "未提取到摘要"}{showCitations(result.summaryCitationIndexes)}</p></ResultBlock>
        <ResultBlock title="会议决议"><ResultList items={result.decisions} empty="未形成明确决议" showCitations={showCitations} /></ResultBlock>
        <ResultBlock title="行动项">{result.actionItems.length ? result.actionItems.map((item, index) => <div key={index} className="mb-2 last:mb-0"><div className="font-medium">□ {item.task}{showCitations(item.citationIndexes)}</div><div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">负责人：{item.owner || "待确认"} · 截止：{item.due || "待确认"}</div></div>) : <span className="text-[var(--text-tertiary)]">未提取到行动项</span>}</ResultBlock>
        <ResultBlock title="风险与待确认"><ResultList items={[...result.risks, ...result.openQuestions]} empty="暂无" showCitations={showCitations} /></ResultBlock>
        {selectedCitation && <ResultBlock title={`会议引用 [${selectedCitation.index}] · ${selectedCitation.locator || "原文"}`}><blockquote className="border-l-2 border-[var(--primary)] pl-2 text-[var(--text-secondary)]">“{selectedCitation.quote}”</blockquote></ResultBlock>}
        <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? "正在保存…" : "保存到会议知识库"}</button>
      </div>}
        </div>
      </div>
    </section>
  );
}

function ResultBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs leading-relaxed"><h3 className="mb-2 font-semibold text-[var(--primary-hover)]">{title}</h3>{children}</div>;
}

function ResultList({ items, empty, showCitations }: { items: CitedText[]; empty: string; showCitations: (indexes?: number[]) => React.ReactNode }) {
  return items.length ? <ul className="space-y-1">{items.map((item, index) => <li key={index}>• {item.text}{showCitations(item.citationIndexes)}</li>)}</ul> : <span className="text-[var(--text-tertiary)]">{empty}</span>;
}
