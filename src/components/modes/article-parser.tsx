"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { extractPdfText } from "@/lib/pdf-text";
import { useScriptSpeech, type SpeechSegment } from "@/hooks/use-script-speech";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { AIMindMap, Citation } from "@/types";

interface CitedText { text: string; citationIndexes: number[] }
interface ArticleResult {
  title: string;
  summary: string;
  summaryCitationIndexes?: number[];
  keyPoints: CitedText[];
  arguments: { claim: string; evidence?: string; citationIndexes: number[] }[];
  questions: string[];
  mindMap: AIMindMap;
  citations: Citation[];
  sourceUrl?: string;
  sourceType: "url" | "pdf" | "text";
  fileName?: string;
  mimeType?: string;
}
interface AudioOverview {
  title: string;
  intro: string;
  segments: SpeechSegment[];
  audioUrl?: string;
  audioExpiresAt?: number;
  synthesis: "cosyvoice" | "browser";
}

export function ArticleParser() {
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const setNodes = useMindGrowStore((state) => state.setNodes);
  const setEdges = useMindGrowStore((state) => state.setEdges);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [pdf, setPdf] = useState<{ name: string; pages: number; truncated: boolean } | null>(null);
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [audio, setAudio] = useState<AudioOverview | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const speech = useScriptSpeech(audio?.segments || []);

  async function choosePdf(file?: File) {
    if (!file) return;
    setPdfBusy(true); setNotice(""); setResult(null); setAudio(null); speech.stop();
    try {
      const extracted = await extractPdfText(file);
      setContent(extracted.text);
      setUrl("");
      setPdf({ name: file.name, pages: extracted.pageCount, truncated: extracted.truncated });
      setNotice(`已读取 ${extracted.pageCount} 页${extracted.truncated ? "，超长部分已按安全上限截取" : ""}`);
    } catch (error) {
      setPdf(null);
      setNotice(error instanceof Error ? error.message : "PDF 读取失败");
    } finally { setPdfBusy(false); }
  }

  async function parse() {
    if (!url.trim() && content.trim().length < 50) { setNotice("请输入文章网址、选择 PDF，或粘贴至少 50 个字的正文"); return; }
    setBusy(true); setNotice(""); setResult(null); setAudio(null); setSelectedCitation(null); speech.stop();
    try {
      const response = await apiFetch("/api/tools/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(), content: content.trim(),
          sourceType: pdf ? "pdf" : (content.trim() ? "text" : "url"),
          fileName: pdf?.name, mimeType: pdf ? "application/pdf" : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "解析失败");
      setResult(data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "解析失败"); }
    finally { setBusy(false); }
  }

  async function createAudioOverview() {
    if (!result) return;
    setAudioBusy(true); setNotice(""); setAudio(null); speech.stop();
    try {
      const response = await apiFetch("/api/tools/audio-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.title, summary: result.summary,
          keyPoints: result.keyPoints, arguments: result.arguments, citations: result.citations,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "音频概览生成失败");
      setAudio(data);
      if (!data.audioUrl) setNotice("云端音频暂不可用，已切换为浏览器双角色朗读");
    } catch (error) { setNotice(error instanceof Error ? error.message : "音频概览生成失败"); }
    finally { setAudioBusy(false); }
  }

  async function save() {
    if (!result?.mindMap) return;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: currentMapId, mindMap: result.mindMap, source: "article", citations: result.citations,
          document: {
            title: result.title, sourceType: result.sourceType, sourceUrl: result.sourceUrl,
            fileName: result.fileName, mimeType: result.mimeType,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      const reload = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(currentMapId)}`);
      const graph = await reload.json();
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); }
      setNotice(`已保存 ${data.totalNodes || 0} 个文章知识节点及 ${data.totalCitations || 0} 条引用`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  const citationByIndex = new Map((result?.citations || []).map((item) => [item.index, item]));
  const showCitations = (indexes: number[] = []) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {indexes.map((index) => <button key={index} type="button" onClick={() => setSelectedCitation(citationByIndex.get(index) || null)} className="rounded bg-[var(--primary-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary-hover)] hover:ring-1 hover:ring-[var(--primary)]" aria-label={`查看引用 ${index}`}>[{index}]</button>)}
    </span>
  );

  return (
    <section className="w-full md:w-[520px] md:min-w-[420px] h-full overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-4"><h2 className="text-base font-semibold">📄 文章解析</h2><p className="text-[11px] text-[var(--text-tertiary)] mt-1">支持公开网页、粘贴正文和 PDF；要点、导图节点与音频脚本均可回到原文引用。</p></div>
      <div className="space-y-3">
        <input type="url" value={url} onChange={(event) => { setUrl(event.target.value); if (event.target.value) { setPdf(null); setContent(""); } }} placeholder="https://… 公开文章网址" className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[10px] text-[var(--text-muted)]"><span className="h-px bg-[var(--border)]" />或<span className="h-px bg-[var(--border)]" /></div>
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => void choosePdf(event.target.files?.[0])} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pdfBusy} className="w-full rounded-xl border border-dashed border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2.5 text-xs text-[var(--primary-hover)] disabled:opacity-40">{pdfBusy ? "正在读取 PDF…" : pdf ? `PDF：${pdf.name}（${pdf.pages} 页）` : "选择 PDF 文件（最大 15MB）"}</button>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[10px] text-[var(--text-muted)]"><span className="h-px bg-[var(--border)]" />或粘贴正文<span className="h-px bg-[var(--border)]" /></div>
        <textarea value={content} onChange={(event) => { setContent(event.target.value); setPdf(null); }} rows={9} placeholder="粘贴文章正文。PDF 文字也会显示在这里，便于解析前核对。" className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary)]" />
        {notice && <div role="status" className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">{notice}</div>}
        <button onClick={() => void parse()} disabled={busy || pdfBusy || (!url.trim() && content.trim().length < 50)} className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-black disabled:opacity-40">{busy ? "正在阅读、定位引用并核对原文…" : "解析文章"}</button>
      </div>

      {result && <div className="mt-5 space-y-3 animate-fade-in">
        <ArticleBlock title={result.title}><p>{result.summary || "未提取到摘要"}{showCitations(result.summaryCitationIndexes)}</p></ArticleBlock>
        <ArticleBlock title="核心要点">{result.keyPoints.length ? <ul className="space-y-1.5">{result.keyPoints.map((item, index) => <li key={index}>• {item.text}{showCitations(item.citationIndexes)}</li>)}</ul> : <span className="text-[var(--text-tertiary)]">未提取到要点</span>}</ArticleBlock>
        <ArticleBlock title="论点与证据">{result.arguments.length ? result.arguments.map((item, index) => <div key={index} className="mb-2 last:mb-0"><div className="font-medium">{index + 1}. {item.claim}{showCitations(item.citationIndexes)}</div>{item.evidence && <div className="mt-0.5 text-[var(--text-tertiary)]">依据：{item.evidence}</div>}</div>) : <span className="text-[var(--text-tertiary)]">未提取到论点</span>}</ArticleBlock>
        <ArticleBlock title="可继续追问"><SimpleList items={result.questions} empty="暂无" /></ArticleBlock>
        {selectedCitation && <ArticleBlock title={`引用 [${selectedCitation.index}] · ${selectedCitation.locator || "原文"}`}><blockquote className="border-l-2 border-[var(--primary)] pl-2 text-[var(--text-secondary)]">“{selectedCitation.quote}”</blockquote>{result.sourceUrl && <a className="mt-2 inline-block text-[var(--primary-hover)] underline" href={result.sourceUrl} target="_blank" rel="noreferrer">打开原网页核对</a>}</ArticleBlock>}
        <button onClick={() => void createAudioOverview()} disabled={audioBusy} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] py-2.5 text-sm font-medium disabled:opacity-40">{audioBusy ? "正在生成引用型播客脚本与音频…" : "🎧 生成 Audio Overview"}</button>
        {audio && <AudioOverviewCard audio={audio} speech={speech} showCitations={showCitations} />}
        <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? "正在保存…" : "保存到当前思维导图（含引用）"}</button>
      </div>}
    </section>
  );
}

function AudioOverviewCard({ audio, speech, showCitations }: { audio: AudioOverview; speech: ReturnType<typeof useScriptSpeech>; showCitations: (indexes?: number[]) => React.ReactNode }) {
  return <ArticleBlock title={`Audio Overview · ${audio.title}`}>
    <p className="mb-2 text-[var(--text-tertiary)]">{audio.intro}</p>
    {audio.audioUrl ? <audio className="mb-3 w-full" controls preload="none" src={audio.audioUrl}>你的浏览器不支持音频播放。</audio> : <div className="mb-3 flex gap-2"><button type="button" onClick={speech.toggle} disabled={!speech.supported} className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40">{speech.state === "playing" ? "暂停" : speech.state === "paused" ? "继续" : "播放"}</button><button type="button" onClick={speech.stop} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">停止</button></div>}
    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">{audio.segments.map((segment, index) => <button type="button" key={index} onClick={() => speech.playFrom(index)} className={`block w-full rounded-lg p-2 text-left ${speech.currentIndex === index ? "bg-[var(--primary-subtle)] ring-1 ring-[var(--primary)]" : "bg-[var(--bg-elevated)]"}`}><strong>{segment.speaker}：</strong>{segment.text}{showCitations(segment.citationIndexes)}</button>)}</div>
  </ArticleBlock>;
}

function ArticleBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs leading-relaxed"><h3 className="mb-2 font-semibold text-[var(--primary-hover)]">{title}</h3>{children}</div>;
}
function SimpleList({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul className="space-y-1">{items.map((item, index) => <li key={index}>• {item}</li>)}</ul> : <span className="text-[var(--text-tertiary)]">{empty}</span>;
}
