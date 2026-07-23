"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { mindMapToPreviewGraph } from "@/lib/mindmap-preview";
import { aiEntityGraphToEntityGraph } from "@/lib/entity-graph";
import { AnswerCard } from "@/components/answer/answer-card";
import type { AIEntityGraph, AIMindMap, Citation, CitationAudit } from "@/types";
import { useLocale } from "@/components/i18n/locale-provider";

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
  actionItemStatus?: "present" | "none";
  mindMap: AIMindMap;
  entityGraph?: AIEntityGraph;
  citations: Citation[];
  documentChunks?: Citation[];
  citationAudit?: CitationAudit;
}

function meetingDueLabel(item: MeetingResult["actionItems"][number]) {
  const explicitDue = String(item.due || "").trim();
  if (explicitDue) return explicitDue;
  const match = String(item.task || "").match(/(?:截止|期限(?:为|至)?|due(?:\s+on)?)[：:\s]*([0-9]{4}[-/.年][0-9]{1,2}(?:[-/.月][0-9]{1,2}日?)?)/i);
  return match?.[1] || "原文未说明";
}

function MeetingStructuredOverview({ result }: { result: MeetingResult }) {
  const citations = new Map(result.citations.map((citation) => [citation.index, citation]));
  const Evidence = ({ indexes = [] }: { indexes?: number[] }) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {indexes.map((index) => {
        const citation = citations.get(index);
        return citation ? <span key={index} title={`${citation.locator || "会议原文"}：${citation.quote}`} className="rounded-full border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">[{index}]</span> : null;
      })}
    </span>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
      <h4 className="mb-2 text-xs font-bold text-[var(--text-primary)]">{title}</h4>
      {children}
    </section>
  );
  return <div className="space-y-2" data-testid="meeting-fixed-structure">
    <Section title="一句话结论">
      <p className="leading-relaxed text-[var(--text-secondary)]">{result.summary || "原文未形成可核验结论"}<Evidence indexes={result.summaryCitationIndexes} /></p>
    </Section>
    <div className="grid gap-2 md:grid-cols-2">
      <Section title="已确认决议">
        {result.decisions.length ? <ul className="space-y-1.5">{result.decisions.map((item, index) => <li key={index} className="text-[var(--text-secondary)]">• {item.text}<Evidence indexes={item.citationIndexes} /></li>)}</ul> : <p className="text-[var(--text-tertiary)]">本段未形成已确认决议</p>}
      </Section>
      <Section title="未决问题">
        {result.openQuestions.length ? <ul className="space-y-1.5">{result.openQuestions.map((item, index) => <li key={index} className="text-[var(--text-secondary)]">• {item.text}<Evidence indexes={item.citationIndexes} /></li>)}</ul> : <p className="text-[var(--text-tertiary)]">本段没有明确未决问题</p>}
      </Section>
    </div>
    <Section title="行动项 · 负责人 · 截止时间">
      {result.actionItems.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-[var(--text-tertiary)]"><tr><th className="pb-2 pr-3">行动项</th><th className="pb-2 pr-3">负责人</th><th className="pb-2">截止时间</th></tr></thead>
        <tbody>{result.actionItems.map((item, index) => <tr key={index} className="border-t border-[var(--border)]"><td className="py-2 pr-3 text-[var(--text-secondary)]">{item.task}<Evidence indexes={item.citationIndexes} /></td><td className="py-2 pr-3">{item.owner || "原文未说明"}</td><td className="py-2">{meetingDueLabel(item)}</td></tr>)}</tbody>
      </table></div> : <p className="text-[var(--text-tertiary)]">本段未形成行动项</p>}
    </Section>
    <Section title="原文证据">
      <p className="text-[var(--text-tertiary)]">结论、决议、未决问题和行动项后的编号均对应独立原文句子；悬停编号即可核对原话。</p>
    </Section>
  </div>;
}

export function MeetingAssistant() {
  const { locale } = useLocale();
  const english = locale === "en";
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const currentMap = useMindGrowStore((state) => state.maps.find((map) => map.id === state.currentMapId));
  const setCurrentMapId = useMindGrowStore((state) => state.setCurrentMapId);
  const nodeCount = useMindGrowStore((state) => state.nodes.length);
  const setNodes = useMindGrowStore((state) => state.setNodes);
  const setEdges = useMindGrowStore((state) => state.setEdges);
  const setEntityGraph = useMindGrowStore((state) => state.setEntityGraph);
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
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
  const speech = useSpeechInput(appendSpeech, english ? "en-US" : "zh-CN");

  async function generate() {
    if (transcript.trim().length < 10) { setNotice(english ? "Add or dictate meeting content first" : "请先输入或录入会议内容"); return; }
    const requestMapId = currentMapId;
    setBusy(true); setNotice(""); setResult(null); setConfirmed(false); setEntityGraph({ entities: [], relations: [] });
    try {
      const response = await apiFetch("/api/tools/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, participants, transcript }),
      });
      const data = await response.json();
      if (!isActiveMeetingMap(requestMapId)) return;
      if (!response.ok) throw new Error(data.error || (english ? "Generation failed" : "生成失败"));
      setResult(data);
      if (data.mindMap) {
        const preview = mindMapToPreviewGraph(data.mindMap, "meeting", data.citations || []);
        setNodes(preview.nodes);
        setEdges(preview.edges);
      }
      setEntityGraph(aiEntityGraphToEntityGraph(data.entityGraph, data.citations || [], `meeting:${requestMapId}:${Date.now()}`));
    } catch (error) { if (isActiveMeetingMap(requestMapId)) setNotice(error instanceof Error ? error.message : (english ? "Generation failed" : "生成失败")); }
    finally { if (mountedRef.current) setBusy(false); }
  }

  async function save() {
    if (!result?.mindMap) return;
    if (result.citationAudit?.refusalReason === "ALL_KEY_CLAIMS_UNSUPPORTED") {
      setNotice(english ? "Key conclusions lack direct evidence, so long-term storage was blocked" : "关键结论缺少直接证据，已阻止写入长期知识库");
      return;
    }
    const requestMapId = currentMapId;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: requestMapId,
        body: JSON.stringify({
          mapId: requestMapId, mindMap: result.mindMap, source: "meeting",
          citations: result.citations,
          documentChunks: result.documentChunks || result.citations,
          document: { title: result.title, sourceType: "meeting", fileName: "" },
          extraction: { pageCount: 0, tablePages: [], imagePages: [], scannedPages: [], truncated: false },
          entityGraph: result.entityGraph,
          confirmedForLongTerm: true,
        }),
      });
      const data = await response.json();
      if (!isActiveMeetingMap(requestMapId)) return;
      if (!response.ok) throw new Error(data.error || (english ? "Save failed" : "保存失败"));
      if (data.longTermCommitted !== true) throw new Error(english ? "The server did not confirm long-term storage. Please try again." : "服务器未确认长期知识写入，请重试");
      const savedMapId = String(data.mapId || requestMapId);
      if (savedMapId !== requestMapId) setCurrentMapId(savedMapId);
      const reload = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(savedMapId)}`);
      const graph = await reload.json();
      if (!isActiveMeetingMap(savedMapId)) return;
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); setEntityGraph(graph.entityGraph || { entities: [], relations: [] }); }
      setConfirmed(true);
      setNotice(english
        ? `Saved ${data.totalNodes || 0} meeting nodes, ${data.totalCitations || 0} citations, ${data.entityCount || 0} entities, ${data.relationCount || 0} grounded relations, and ${data.indexedChunks || 0} searchable chunks`
        : `已保存 ${data.totalNodes || 0} 个会议知识节点、${data.totalCitations || 0} 条引用、${data.entityCount || 0} 个实体、${data.relationCount || 0} 条可溯源关系和 ${data.indexedChunks || 0} 个可检索分块`);
    } catch (error) { if (isActiveMeetingMap(requestMapId)) setNotice(error instanceof Error ? error.message : (english ? "Save failed" : "保存失败")); }
    finally { if (mountedRef.current) setSaving(false); }
  }

  const answerRefused = result?.citationAudit?.refusalReason === "ALL_KEY_CLAIMS_UNSUPPORTED";

  return (
    <section className="h-full w-full overflow-y-auto bg-[var(--background)]" data-mode-library-id={currentMapId} data-testid="meeting-content-workspace">
      <div className="mx-auto max-w-6xl p-4">
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-lg font-semibold">🎯 {english ? "Meeting Assistant" : "会议助手"}</h2><p className="mt-1 text-xs text-[var(--text-tertiary)]">{english ? "Generate a reviewable draft first. Meeting content enters long-term knowledge only after you confirm it." : "先生成可检查的草稿；只有你明确确认后，会议内容才会进入长期知识库和统一知识宇宙。"}</p></div>
          <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs text-sky-200"><span className="font-semibold">{english ? "Dedicated meeting library" : "独立会议知识库"}</span><span className="mx-2 opacity-40">·</span>{currentMap?.name || (english ? "Meeting library" : "会议知识库")}<span className="mx-2 opacity-40">·</span>{english ? `${nodeCount} nodes` : `${nodeCount} 节点`}</div>
        </div>
        <div className={`grid gap-5 ${result ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "mx-auto max-w-2xl"}`}>
        <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={english ? "Meeting title (optional)" : "会议标题（可选）"} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
        <input value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder={english ? "Participants, separated by commas (optional)" : "参会人，用逗号分隔（可选）"} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={10} placeholder={english ? "Paste meeting notes or use the microphone to dictate…" : "粘贴会议记录，或点击麦克风开始口述…"} className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none" />
          {speech.interimText && <div className="text-xs text-[var(--primary)] mt-1">{english ? "Recognizing: " : "正在识别："}{speech.interimText}</div>}
          <div className="flex items-center justify-between mt-2 border-t border-[var(--border-subtle)] pt-2">
            <button type="button" onClick={speech.toggle} aria-label={speech.isListening ? (english ? "Stop voice input" : "停止语音输入") : (english ? "Start voice input" : "开始语音输入")} className={`rounded-lg px-3 py-1.5 text-xs ${speech.isListening ? "bg-red-500/20 text-red-300" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"}`}>{speech.isListening ? (english ? "■ Stop recording" : "■ 停止录音") : (english ? "🎙 Voice input" : "🎙 语音输入")}</button>
            <span className="text-[10px] text-[var(--text-muted)]">{transcript.length} {english ? "chars" : "字"}</span>
          </div>
        </div>
        {(speech.error || notice) && <div role="status" className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">{speech.error || notice}</div>}
        <button onClick={() => void generate()} disabled={busy || transcript.trim().length < 10} className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-40">{busy ? (english ? "Processing meeting…" : "正在整理会议…") : (english ? "Generate structured notes" : "生成结构化会议纪要")}</button>
        </div>

      {result && <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 animate-fade-in">
        <div
          className={`rounded-xl border px-3 py-2 text-xs ${confirmed ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-100"}`}
          data-testid="meeting-draft-status"
          data-persisted={confirmed ? "true" : "false"}
        >
          {confirmed
            ? (english ? "Confirmed: these notes are now in long-term knowledge and the unified universe." : "已确认：这份会议纪要已进入长期知识库和统一知识宇宙。")
            : (english ? "Preview draft: review conclusions and citations before saving to long-term knowledge." : "当前仅为预览草稿：可先核对结论与引用，尚未写入长期知识库。")}
        </div>
        <MeetingStructuredOverview result={result} />
        <details className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--primary-hover)]">展开完整证据核验</summary>
          <div className="mt-3"><AnswerCard
          title={result.title || "会议纪要"}
          conclusion={[
            ...(result.summary ? [{ text: result.summary, citationIndexes: result.summaryCitationIndexes, auditText: result.summary }] : []),
            ...result.decisions.map((item) => ({ text: item.text, citationIndexes: item.citationIndexes, auditText: item.text })),
          ]}
          evidence={[
            ...result.actionItems.map((item) => ({
              text: item.task,
              detail: `负责人：${item.owner || "原文未说明"} · 截止：${meetingDueLabel(item)}`,
              citationIndexes: item.citationIndexes,
              auditText: `${item.task} ${item.owner || ""} ${item.due || ""}`,
            })),
            ...result.risks.map((item) => ({ text: `风险：${item.text}`, citationIndexes: item.citationIndexes, auditText: item.text })),
          ]}
          extension={result.openQuestions.map((item) => item.text)}
          citations={result.citations}
          audit={result.citationAudit}
          sourceType="meeting"
        /></div>
        </details>
        <button onClick={() => void save()} disabled={saving || answerRefused || confirmed} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? (english ? "Saving…" : "正在保存…") : answerRefused ? (english ? "Insufficient evidence — not saved" : "证据不足，暂不保存") : confirmed ? (english ? "Confirmed and saved" : "已确认并进入长期知识库") : (english ? "Confirm and add to long-term knowledge" : "确认并加入长期知识库")}</button>
      </div>}
        </div>
      </div>
    </section>
  );
}
