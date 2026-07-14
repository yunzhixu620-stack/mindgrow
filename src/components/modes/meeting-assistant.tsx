"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { useSpeechInput } from "@/hooks/use-speech-input";
import type { AIMindMap } from "@/types";

interface MeetingResult {
  title: string;
  summary: string;
  topics: { title: string; details?: string[] }[];
  decisions: string[];
  actionItems: { task: string; owner?: string; due?: string; status?: string }[];
  risks: string[];
  openQuestions: string[];
  mindMap: AIMindMap;
}

export function MeetingAssistant() {
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const setNodes = useMindGrowStore((state) => state.setNodes);
  const setEdges = useMindGrowStore((state) => state.setEdges);
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const appendSpeech = useCallback((text: string) => setTranscript((current) => `${current}${current && !current.endsWith("\n") ? " " : ""}${text}`), []);
  const speech = useSpeechInput(appendSpeech);

  async function generate() {
    if (transcript.trim().length < 10) { setNotice("请先输入或录入会议内容"); return; }
    setBusy(true); setNotice(""); setResult(null);
    try {
      const response = await apiFetch("/api/tools/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, participants, transcript }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成失败");
      setResult(data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "生成失败"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!result?.mindMap) return;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: currentMapId, mindMap: result.mindMap, source: "meeting" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      const reload = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(currentMapId)}`);
      const graph = await reload.json();
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); }
      setNotice(`已保存 ${data.totalNodes || 0} 个会议知识节点`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  return (
    <section className="w-full md:w-[480px] md:min-w-[400px] h-full overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-4"><h2 className="text-base font-semibold">🎯 会议助手</h2><p className="text-[11px] text-[var(--text-tertiary)] mt-1">实时口述或粘贴会议原文，提取决议、行动项和风险。</p></div>
      <div className="space-y-3">
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

      {result && <div className="mt-5 space-y-3 animate-fade-in">
        <ResultBlock title="会议摘要"><p>{result.summary || "未提取到摘要"}</p></ResultBlock>
        <ResultBlock title="会议决议"><ResultList items={result.decisions} empty="未形成明确决议" /></ResultBlock>
        <ResultBlock title="行动项">{result.actionItems.length ? result.actionItems.map((item, index) => <div key={index} className="mb-2 last:mb-0"><div className="font-medium">□ {item.task}</div><div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">负责人：{item.owner || "待确认"} · 截止：{item.due || "待确认"}</div></div>) : <span className="text-[var(--text-tertiary)]">未提取到行动项</span>}</ResultBlock>
        <ResultBlock title="风险与待确认"><ResultList items={[...result.risks, ...result.openQuestions]} empty="暂无" /></ResultBlock>
        <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? "正在保存…" : "保存到当前思维导图"}</button>
      </div>}
    </section>
  );
}

function ResultBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs leading-relaxed"><h3 className="mb-2 font-semibold text-[var(--primary-hover)]">{title}</h3>{children}</div>;
}

function ResultList({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul className="space-y-1">{items.map((item, index) => <li key={index}>• {item}</li>)}</ul> : <span className="text-[var(--text-tertiary)]">{empty}</span>;
}
