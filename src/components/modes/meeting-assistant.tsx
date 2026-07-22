"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { mindMapToPreviewGraph } from "@/lib/mindmap-preview";
import { aiEntityGraphToEntityGraph } from "@/lib/entity-graph";
import { AnswerCard } from "@/components/answer/answer-card";
import type { AIEntityGraph, AIMindMap, Citation, CitationAudit } from "@/types";

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
  entityGraph?: AIEntityGraph;
  citations: Citation[];
  documentChunks?: Citation[];
  citationAudit?: CitationAudit;
}

function meetingDueLabel(item: MeetingResult["actionItems"][number]) {
  const explicitDue = String(item.due || "").trim();
  if (explicitDue) return explicitDue;
  const match = String(item.task || "").match(/(?:截止|期限(?:为|至)?|due(?:\s+on)?)[：:\s]*([0-9]{4}[-/.年][0-9]{1,2}(?:[-/.月][0-9]{1,2}日?)?)/i);
  return match?.[1] || "待确认";
}

export function MeetingAssistant() {
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
  const speech = useSpeechInput(appendSpeech);

  async function generate() {
    if (transcript.trim().length < 10) { setNotice("请先输入或录入会议内容"); return; }
    const requestMapId = currentMapId;
    setBusy(true); setNotice(""); setResult(null); setEntityGraph({ entities: [], relations: [] });
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
      setEntityGraph(aiEntityGraphToEntityGraph(data.entityGraph, data.citations || [], `meeting:${requestMapId}:${Date.now()}`));
    } catch (error) { if (isActiveMeetingMap(requestMapId)) setNotice(error instanceof Error ? error.message : "生成失败"); }
    finally { if (mountedRef.current) setBusy(false); }
  }

  async function save() {
    if (!result?.mindMap) return;
    if (result.citationAudit?.refusalReason === "ALL_KEY_CLAIMS_UNSUPPORTED") {
      setNotice("关键结论缺少直接证据，已阻止写入长期知识库");
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
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); setEntityGraph(graph.entityGraph || { entities: [], relations: [] }); }
      setNotice(`已保存 ${data.totalNodes || 0} 个会议知识节点、${data.totalCitations || 0} 条引用、${data.entityCount || 0} 个实体、${data.relationCount || 0} 条可溯源关系和 ${data.indexedChunks || 0} 个可检索分块`);
    } catch (error) { if (isActiveMeetingMap(requestMapId)) setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { if (mountedRef.current) setSaving(false); }
  }

  const answerRefused = result?.citationAudit?.refusalReason === "ALL_KEY_CLAIMS_UNSUPPORTED";

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
        <button onClick={() => void generate()} disabled={busy || transcript.trim().length < 10} className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-40">{busy ? "正在整理会议…" : "生成结构化会议纪要"}</button>
        </div>

      {result && <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 animate-fade-in">
        <AnswerCard
          title={result.title || "会议纪要"}
          conclusion={[
            ...(result.summary ? [{ text: result.summary, citationIndexes: result.summaryCitationIndexes, auditText: result.summary }] : []),
            ...result.decisions.map((item) => ({ text: item.text, citationIndexes: item.citationIndexes, auditText: item.text })),
          ]}
          evidence={[
            ...result.actionItems.map((item) => ({
              text: item.task,
              detail: `负责人：${item.owner || "待确认"} · 截止：${meetingDueLabel(item)}`,
              citationIndexes: item.citationIndexes,
              auditText: `${item.task} ${item.owner || ""} ${item.due || ""}`,
            })),
            ...result.risks.map((item) => ({ text: `风险：${item.text}`, citationIndexes: item.citationIndexes, auditText: item.text })),
          ]}
          extension={result.openQuestions.map((item) => item.text)}
          citations={result.citations}
          audit={result.citationAudit}
          sourceType="meeting"
        />
        <button onClick={() => void save()} disabled={saving || answerRefused} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? "正在保存…" : answerRefused ? "证据不足，暂不保存" : "保存到会议知识库"}</button>
      </div>}
        </div>
      </div>
    </section>
  );
}
