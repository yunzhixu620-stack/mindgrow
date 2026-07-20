"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { extractPdfText } from "@/lib/pdf-text";
import { useScriptSpeech, type SpeechSegment } from "@/hooks/use-script-speech";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { mindMapToPreviewGraph } from "@/lib/mindmap-preview";
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
  documentChunks?: Citation[];
  citationAudit?: { claimCount: number; citedClaimCount: number; coverage: number; verifiedQuoteCount: number; warnings: string[] };
  extraction?: PdfExtraction;
  sourceUrl?: string;
  sourceType: "url" | "pdf" | "text";
  fileName?: string;
  mimeType?: string;
}
interface PdfExtraction {
  pageCount: number;
  truncated: boolean;
  tablePages: number[];
  imagePages: number[];
  scannedPages: number[];
  warnings?: string[];
}
interface AudioOverview {
  title: string;
  intro: string;
  segments: SpeechSegment[];
  audioUrl?: string;
  audioExpiresAt?: number;
  synthesis: "cosyvoice" | "browser";
}

interface ArticleQaSource {
  id: string;
  index: number;
  title: string;
  quote?: string;
  locator?: string;
  sourceUrl?: string;
}

interface ArticleQaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  task?: "translate" | "summarize" | "compare" | "extract" | "explain" | "qa";
  sources?: ArticleQaSource[];
  retrievalTrace?: {
    mode: string;
    task?: string;
    seedNodes: number;
    expandedNodes: number;
    graphDocuments: number;
    candidateChunks: number;
  };
}

interface AnswerSection {
  title: string;
  lines: string[];
}

const articleQuickTasks: { task: NonNullable<ArticleQaMessage["task"]>; icon: string; label: string; prompt: string }[] = [
  { task: "translate", icon: "译", label: "翻译", prompt: "翻译这篇论文的摘要" },
  { task: "summarize", icon: "摘", label: "总结", prompt: "总结这篇论文的核心问题、方法、结果与限制" },
  { task: "compare", icon: "比", label: "比较", prompt: "比较这些论文的研究方法与核心结论" },
  { task: "extract", icon: "取", label: "提取", prompt: "提取这篇论文的模型、数据集、指标与主要结果" },
  { task: "explain", icon: "解", label: "解释", prompt: "用直观语言解释这篇论文的核心方法" },
  { task: "qa", icon: "问", label: "问答", prompt: "这篇论文最重要的结论是什么？" },
];

function articleTaskMeta(task: NonNullable<ArticleQaMessage["task"]>) {
  return ({
    translate: { icon: "译", label: "论文翻译", hint: "忠实保留原文结构", className: "border-violet-400/30 bg-violet-400/10 text-violet-200" },
    summarize: { icon: "摘", label: "论文总结", hint: "问题、方法、结果、限制", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
    compare: { icon: "比", label: "论文比较", hint: "统一维度对照", className: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
    extract: { icon: "取", label: "信息提取", hint: "字段化保留原始数值", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
    explain: { icon: "解", label: "概念解释", hint: "直观理解与技术边界", className: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200" },
    qa: { icon: "问", label: "事实问答", hint: "严格基于引用证据", className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" },
  })[task];
}

function answerSectionMeta(title: string) {
  if (/^翻译结果$/.test(title)) return { icon: "译", className: "border-violet-400/30 bg-violet-400/[0.08]", titleClassName: "text-violet-200", iconClassName: "bg-violet-400/15 text-violet-200" };
  if (/^(一句话)?(核心)?结论/.test(title)) return { icon: "✓", className: "border-emerald-400/30 bg-emerald-400/[0.08]", titleClassName: "text-emerald-200", iconClassName: "bg-emerald-400/15 text-emerald-200" };
  if (/关键依据|证据/.test(title)) return { icon: "据", className: "border-cyan-400/25 bg-cyan-400/[0.06]", titleClassName: "text-cyan-200", iconClassName: "bg-cyan-400/15 text-cyan-200" };
  if (/对比表|比较/.test(title)) return { icon: "比", className: "border-sky-400/25 bg-sky-400/[0.06]", titleClassName: "text-sky-200", iconClassName: "bg-sky-400/15 text-sky-200" };
  if (/局限|待核验|风险|缺失/.test(title)) return { icon: "!", className: "border-amber-400/25 bg-amber-400/[0.06]", titleClassName: "text-amber-200", iconClassName: "bg-amber-400/15 text-amber-200" };
  return { icon: "详", className: "border-white/10 bg-white/[0.025]", titleClassName: "text-[var(--text-primary)]", iconClassName: "bg-white/[0.06] text-[var(--text-secondary)]" };
}

function renderAnswerInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.92em] text-[var(--primary-hover)]">{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isAnswerBlockStart(lines: string[], index: number) {
  const line = lines[index]?.trim() || "";
  return !line
    || /^[-*•]\s+/.test(line)
    || /^\d+[.)、]\s+/.test(line)
    || /^>\s?/.test(line)
    || (line.includes("|") && isTableDivider(lines[index + 1] || ""));
}

function renderAnswerBlocks(lines: string[]) {
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    if (line.includes("|") && isTableDivider(lines[index + 1] || "")) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="my-3 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[460px] border-collapse text-left text-xs">
            <thead className="bg-[var(--card)] text-[var(--text-primary)]"><tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-r border-[var(--border)] px-3 py-2 font-semibold last:border-r-0">{renderAnswerInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-[var(--border)] last:border-b-0 odd:bg-white/[0.015]">{header.map((_, cellIndex) => <td key={cellIndex} className="border-r border-[var(--border)] px-3 py-2 align-top text-[var(--text-secondary)] last:border-r-0">{renderAnswerInline(row[cellIndex] || "—")}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*•]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*•]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`} className="my-2 space-y-1.5 pl-4 text-[var(--text-secondary)]">{items.map((item, itemIndex) => <li key={itemIndex} className="list-disc pl-1 marker:text-[var(--primary)]">{renderAnswerInline(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)、]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)、]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)、]\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`} className="my-2 space-y-1.5 pl-5 text-[var(--text-secondary)]">{items.map((item, itemIndex) => <li key={itemIndex} className="list-decimal pl-1 marker:font-semibold marker:text-[var(--primary)]">{renderAnswerInline(item)}</li>)}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`} className="my-2 border-l-2 border-[var(--primary)] pl-3 text-[var(--text-tertiary)]">{renderAnswerInline(quote.join(" "))}</blockquote>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isAnswerBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`} className="my-2 leading-6 text-[var(--text-secondary)]">{renderAnswerInline(paragraph.join(" "))}</p>);
  }
  return blocks;
}

function splitAnswerSections(content: string) {
  const sections: AnswerSection[] = [];
  let current: AnswerSection = { title: "", lines: [] };
  for (const rawLine of content.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = rawLine.trim().match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      if (current.title || current.lines.some((line) => line.trim())) sections.push(current);
      current = { title: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(rawLine);
    }
  }
  if (current.title || current.lines.some((line) => line.trim())) sections.push(current);
  return sections;
}

function AnswerSectionView({ section }: { section: AnswerSection }) {
  const meta = answerSectionMeta(section.title);
  return <section className={`rounded-xl border px-3 py-2.5 ${meta.className}`} data-answer-section={section.title || "正文"}>
    {section.title && <h4 className={`mb-2 flex items-center gap-2 font-semibold ${meta.titleClassName}`}><span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[10px] ${meta.iconClassName}`}>{meta.icon}</span>{section.title}</h4>}
    {renderAnswerBlocks(section.lines)}
  </section>;
}

function StructuredAnswer({ content, task }: { content: string; task?: ArticleQaMessage["task"] }) {
  const sections = splitAnswerSections(content);
  const collapsible = task !== "translate" && content.length > 850 && sections.length > 2;
  const visibleSections = collapsible ? sections.slice(0, 2) : sections;
  const detailSections = collapsible ? sections.slice(2) : [];
  return <div className="space-y-2 break-words" data-testid="structured-answer">
    {visibleSections.map((section, index) => <AnswerSectionView key={`${section.title}-${index}`} section={section} />)}
    {detailSections.length > 0 && <details className="rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-[var(--primary-hover)]">展开详细说明（{detailSections.length} 部分）</summary>
      <div className="mt-2 space-y-2">{detailSections.map((section, index) => <AnswerSectionView key={`${section.title}-${index}`} section={section} />)}</div>
    </details>}
  </div>;
}

function ArticleTaskHeader({ task }: { task: NonNullable<ArticleQaMessage["task"]> }) {
  const meta = articleTaskMeta(task);
  return <div className={`sticky top-0 z-10 mb-2 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 backdrop-blur ${meta.className}`} data-testid="article-intent-badge">
    <span className="flex items-center gap-2 font-semibold"><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-black/15 px-1 text-[11px]">{meta.icon}</span>{meta.label}</span>
    <span className="text-[10px] opacity-75">{meta.hint}</span>
  </div>;
}

function articleApiError(data: Record<string, unknown>, fallback: string) {
  const code = typeof data.code === "string" ? data.code : "";
  const rawMessage = typeof data.error === "string" ? data.error : "";
  const message = rawMessage === "Service temporarily unavailable"
    ? "文章服务暂时不可用"
    : (rawMessage || fallback);
  return code ? `${message}（错误代码：${code}）` : message;
}

export function ArticleParser() {
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const currentMap = useMindGrowStore((state) => state.maps.find((map) => map.id === state.currentMapId));
  const setCurrentMapId = useMindGrowStore((state) => state.setCurrentMapId);
  const nodeCount = useMindGrowStore((state) => state.nodes.length);
  const setNodes = useMindGrowStore((state) => state.setNodes);
  const setEdges = useMindGrowStore((state) => state.setEdges);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [pdf, setPdf] = useState<(PdfExtraction & { name: string; pages: number }) | null>(null);
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [audio, setAudio] = useState<AudioOverview | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qaInput, setQaInput] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [qaMessages, setQaMessages] = useState<ArticleQaMessage[]>([]);
  const [notice, setNotice] = useState("");
  const speech = useScriptSpeech(audio?.segments || []);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isActiveArticleMap = (mapId: string) => {
    const latest = useMindGrowStore.getState();
    return mountedRef.current && latest.currentMode === "article" && latest.currentMapId === mapId;
  };

  async function choosePdf(file?: File) {
    if (!file) return;
    setPdfBusy(true); setNotice(""); setResult(null); setAudio(null); speech.stop();
    try {
      const extracted = await extractPdfText(file);
      setContent(extracted.text);
      setUrl("");
      setPdf({ name: file.name, pages: extracted.pageCount, pageCount: extracted.pageCount, truncated: extracted.truncated, tablePages: extracted.tablePages, imagePages: extracted.imagePages, scannedPages: extracted.scannedPages, warnings: extracted.warnings });
      setNotice(`已读取 ${extracted.pageCount} 页${extracted.warnings.length ? `；${extracted.warnings.join("；")}` : ""}`);
    } catch (error) {
      setPdf(null);
      setNotice(error instanceof Error ? error.message : "PDF 读取失败");
    } finally { setPdfBusy(false); }
  }

  async function parse() {
    if (!url.trim() && content.trim().length < 50) { setNotice("请输入文章网址、选择 PDF，或粘贴至少 50 个字的正文"); return; }
    const requestMapId = currentMapId;
    setBusy(true); setNotice(""); setResult(null); setAudio(null); setSelectedCitation(null); speech.stop();
    try {
      const response = await apiFetch(`/api/tools/article?client=10.3.1&request=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(), content: content.trim(),
          sourceType: pdf ? "pdf" : (content.trim() ? "text" : "url"),
          fileName: pdf?.name, mimeType: pdf ? "application/pdf" : undefined,
          extraction: pdf ? { pageCount: pdf.pageCount, truncated: pdf.truncated, tablePages: pdf.tablePages, imagePages: pdf.imagePages, scannedPages: pdf.scannedPages } : undefined,
        }),
      });
      const data = await response.json();
      if (!isActiveArticleMap(requestMapId)) return;
      if (!response.ok) throw new Error(articleApiError(data, "解析失败"));
      setResult(data);
      if (data.mindMap) {
        const preview = mindMapToPreviewGraph(data.mindMap, "article", data.citations || []);
        setNodes(preview.nodes);
        setEdges(preview.edges);
      }
    } catch (error) { if (isActiveArticleMap(requestMapId)) setNotice(error instanceof Error ? error.message : "解析失败"); }
    finally { if (mountedRef.current) setBusy(false); }
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
      if (!response.ok) throw new Error(articleApiError(data, "音频概览生成失败"));
      setAudio(data);
      if (!data.audioUrl) setNotice("云端音频暂不可用，已切换为浏览器双角色朗读");
    } catch (error) { setNotice(error instanceof Error ? error.message : "音频概览生成失败"); }
    finally { setAudioBusy(false); }
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
          mapId: requestMapId, mindMap: result.mindMap, source: "article", citations: result.citations,
          documentChunks: result.documentChunks || result.citations,
          extraction: result.extraction,
          document: {
            title: result.title, sourceType: result.sourceType, sourceUrl: result.sourceUrl,
            fileName: result.fileName, mimeType: result.mimeType,
          },
        }),
      });
      const data = await response.json();
      if (!isActiveArticleMap(requestMapId)) return;
      if (!response.ok) throw new Error(articleApiError(data, "保存失败"));
      const savedMapId = String(data.mapId || requestMapId);
      if (savedMapId !== requestMapId) setCurrentMapId(savedMapId);
      const reload = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(savedMapId)}`);
      const graph = await reload.json();
      if (!isActiveArticleMap(savedMapId)) return;
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); }
      setNotice(`已保存 ${data.totalNodes || 0} 个文章知识节点、${data.totalCitations || 0} 条节点引用和 ${data.indexedChunks || 0} 个检索分块${data.indexStatus === "ready" ? "（向量索引就绪）" : data.indexStatus ? `（${data.indexStatus}）` : ""}`);
    } catch (error) { if (isActiveArticleMap(requestMapId)) setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { if (mountedRef.current) setSaving(false); }
  }

  async function askArticleLibrary() {
    const question = qaInput.trim();
    if (!question || qaBusy) return;
    const userMessage: ArticleQaMessage = { id: `article_qa_${Date.now()}`, role: "user", content: question };
    const priorMessages = qaMessages;
    setQaMessages((messages) => [...messages, userMessage]);
    setQaInput("");
    setQaBusy(true);
    try {
      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: question,
          mapId: currentMapId,
          intent: "question",
          mode: "article",
          history: priorMessages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(articleApiError(data, "文章知识库问答失败"));
      setQaMessages((messages) => [...messages, {
        id: `article_qa_${Date.now()}_assistant`,
        role: "assistant",
        content: data.reply || "知识库中暂时没有足够证据回答这个问题。",
        task: data.intent?.task || "qa",
        sources: Array.isArray(data.sources) ? data.sources : [],
        retrievalTrace: data.retrievalTrace,
      }]);
    } catch (error) {
      setQaMessages((messages) => [...messages, {
        id: `article_qa_${Date.now()}_error`,
        role: "assistant",
        content: error instanceof Error ? error.message : "文章知识库问答失败，请稍后重试。",
      }]);
    } finally {
      setQaBusy(false);
    }
  }

  const citationByIndex = new Map((result?.citations || []).map((item) => [item.index, item]));
  const showCitations = (indexes: number[] = []) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {indexes.map((index) => <button key={index} type="button" onClick={() => setSelectedCitation(citationByIndex.get(index) || null)} className="rounded bg-[var(--primary-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary-hover)] hover:ring-1 hover:ring-[var(--primary)]" aria-label={`查看引用 ${index}`}>[{index}]</button>)}
    </span>
  );

  return (
    <section className="h-full w-full overflow-y-auto bg-[var(--background)]" data-mode-library-id={currentMapId} data-testid="article-content-workspace">
      <div className="mx-auto max-w-5xl p-4">
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="text-lg font-semibold">📄 文章解析</h2><p className="mt-1 text-xs text-[var(--text-tertiary)]">支持公开网页、粘贴正文和 PDF；要点、导图节点与音频脚本均可回到原文引用，内容只进入文章板块。</p></div><div className="rounded-xl border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs text-violet-200"><span className="font-semibold">独立文章知识库</span><span className="mx-2 opacity-40">·</span>{currentMap?.name || "文章知识库"}<span className="mx-2 opacity-40">·</span>{nodeCount} 节点</div></div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
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
        <ArticleWikiNavigator mindMap={result.mindMap} showCitations={showCitations} />
        {result.citationAudit && <ArticleBlock title="引用完整性检查"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-[var(--primary-subtle)] px-2 py-1">结论引用覆盖率 {Math.round(result.citationAudit.coverage * 100)}%</span><span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1">{result.citationAudit.verifiedQuoteCount} 个可逐字核验证据块</span></div>{result.citationAudit.warnings.length > 0 && <ul className="mt-2 space-y-1 text-amber-300">{result.citationAudit.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}</ul>}</ArticleBlock>}
        {result.extraction && (result.extraction.tablePages.length > 0 || result.extraction.imagePages.length > 0 || result.extraction.scannedPages.length > 0) && <ArticleBlock title="文档解析覆盖"><div>表格/多列页：{result.extraction.tablePages.join("、") || "无"}</div><div>图片页：{result.extraction.imagePages.join("、") || "无"}</div><div>疑似扫描页：{result.extraction.scannedPages.join("、") || "无"}</div>{result.extraction.imagePages.length > 0 && <div className="mt-1 text-amber-300">图片页已保留图注与位置提示；涉及图中曲线、坐标或像素内容的结论需视觉模型复核。</div>}</ArticleBlock>}
        <ArticleBlock title={result.title}><p>{result.summary || "未提取到摘要"}{showCitations(result.summaryCitationIndexes)}</p></ArticleBlock>
        <ArticleBlock title="核心要点">{result.keyPoints.length ? <ul className="space-y-1.5">{result.keyPoints.map((item, index) => <li key={index}>• {item.text}{showCitations(item.citationIndexes)}</li>)}</ul> : <span className="text-[var(--text-tertiary)]">未提取到要点</span>}</ArticleBlock>
        <ArticleBlock title="论点与证据">{result.arguments.length ? result.arguments.map((item, index) => <div key={index} className="mb-2 last:mb-0"><div className="font-medium">{index + 1}. {item.claim}{showCitations(item.citationIndexes)}</div>{item.evidence && <div className="mt-0.5 text-[var(--text-tertiary)]">依据：{item.evidence}</div>}</div>) : <span className="text-[var(--text-tertiary)]">未提取到论点</span>}</ArticleBlock>
        <ArticleBlock title="可继续追问"><SimpleList items={result.questions} empty="暂无" /></ArticleBlock>
        {selectedCitation && <ArticleBlock title={`引用 [${selectedCitation.index}] · ${selectedCitation.locator || "原文"}`}><blockquote className="border-l-2 border-[var(--primary)] pl-2 text-[var(--text-secondary)]">“{selectedCitation.quote}”</blockquote>{result.sourceUrl && <a className="mt-2 inline-block text-[var(--primary-hover)] underline" href={result.sourceUrl} target="_blank" rel="noreferrer">打开原网页核对</a>}</ArticleBlock>}
        <button onClick={() => void createAudioOverview()} disabled={audioBusy} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] py-2.5 text-sm font-medium disabled:opacity-40">{audioBusy ? "正在生成引用型播客脚本与音频…" : "🎧 生成音频概览"}</button>
        {audio && <AudioOverviewCard audio={audio} speech={speech} showCitations={showCitations} />}
        <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? "正在保存…" : "保存到文章知识库（含引用）"}</button>
      </div>}
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h3 className="text-sm font-semibold">与文章知识库对话</h3><p className="mt-1 text-xs text-[var(--text-tertiary)]">自动识别翻译、总结、解释、比较、信息提取与事实问答；事实结论仍可回到原文核验。</p></div>
          {qaMessages.length > 0 && <button type="button" onClick={() => setQaMessages([])} className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">清空对话</button>}
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="文章问答任务分类">
          {articleQuickTasks.map((item) => {
            const meta = articleTaskMeta(item.task);
            return <button key={item.task} type="button" onClick={() => setQaInput(item.prompt)} className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition hover:-translate-y-0.5 hover:brightness-110 ${meta.className}`} title={`填写${item.label}示例`}><span className="font-bold">{item.icon}</span><span>{item.label}</span></button>;
          })}
        </div>
        {qaMessages.length > 0 && <div className="mb-3 max-h-[420px] space-y-3 overflow-y-auto rounded-xl bg-[var(--background)] p-3">
          {qaMessages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-8 rounded-xl bg-[var(--primary)] px-3 py-2 text-sm text-black" : "mr-0 rounded-xl border border-white/5 bg-[var(--bg-elevated)] px-3 py-2 text-sm sm:mr-8"}>
            {message.role === "assistant" && message.task && <ArticleTaskHeader task={message.task} />}
            {message.role === "assistant" ? <StructuredAnswer content={message.content} task={message.task} /> : <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>}
            {message.role === "assistant" && message.retrievalTrace && <div className="mt-2 rounded-lg border border-violet-400/20 bg-violet-400/5 px-2.5 py-2 text-[10px] text-violet-200" data-testid="graphrag-trace"><span className="mr-1.5 font-semibold">检索链路</span>{message.retrievalTrace.mode === "article_translation" ? `论文翻译 · ${message.retrievalTrace.graphDocuments} 篇来源 · ${message.retrievalTrace.candidateChunks} 个原文分块` : `GraphRAG · ${message.retrievalTrace.seedNodes} 个入口节点 → ${message.retrievalTrace.expandedNodes} 个邻域节点 · 关联 ${message.retrievalTrace.graphDocuments} 篇来源 · 重排 ${message.retrievalTrace.candidateChunks} 个证据块`}</div>}
            {message.role === "assistant" && message.sources && message.sources.length > 0 && <details className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-[11px]">
              <summary className="cursor-pointer font-semibold text-[var(--primary-hover)]">引用证据 · {message.sources.length} 条（点击展开）</summary>
              <div className="mt-2 space-y-1.5">
              {message.sources.map((source) => <details key={`${message.id}-${source.id}-${source.index}`} className="rounded-lg border border-white/5 bg-[var(--background)] px-2 py-1.5 text-[11px]">
                <summary className="cursor-pointer text-[var(--primary-hover)]">[{source.index}] {source.title}{source.locator ? ` · ${source.locator}` : ""}</summary>
                {source.quote && <blockquote className="mt-1 border-l-2 border-[var(--primary)] pl-2 text-[var(--text-secondary)]">“{source.quote}”</blockquote>}
                {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[var(--primary-hover)] underline">打开来源</a>}
              </details>)}
              </div>
            </details>}
          </div>)}
          {qaBusy && <div className="mr-8 rounded-xl bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-tertiary)]">正在识别意图并处理论文内容…</div>}
        </div>}
        <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-2 focus-within:border-[var(--primary)]">
          <textarea value={qaInput} onChange={(event) => setQaInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askArticleLibrary(); } }} rows={2} aria-label="与文章知识库对话" placeholder="例如：翻译这篇论文的摘要；比较三篇论文的检索方法" className="min-h-[44px] flex-1 resize-none bg-transparent px-1 text-sm outline-none" />
          <button type="button" onClick={() => void askArticleLibrary()} disabled={!qaInput.trim() || qaBusy} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">{qaBusy ? "处理中" : "发送"}</button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">长论文全文翻译会先请你指定摘要、章节或页码，避免单次输出截断；原文引用保持原语言。</p>
      </div>
      </div>
    </section>
  );
}

function ArticleWikiNavigator({ mindMap, showCitations }: { mindMap: AIMindMap; showCitations: (indexes?: number[]) => React.ReactNode }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const branches = mindMap.children.map((child) => ({
    ...child,
    visibleItems: child.items.map((item, index) => ({ item, index })).filter(({ item }) => !normalized || item.toLowerCase().includes(normalized)),
  })).filter((child) => !normalized || child.topic.toLowerCase().includes(normalized) || String(child.desc || "").toLowerCase().includes(normalized) || child.visibleItems.length > 0);

  return <ArticleBlock title="图谱增强检索（GraphRAG）论文结构预览">
    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="font-medium text-[var(--text-primary)]">📄 {mindMap.root}{showCitations(mindMap.rootCitationIndexes)}</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索论文链路" placeholder="搜索章节、主题或证据…" className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs outline-none focus:border-[var(--primary)]" />
    </div>
    {mindMap.rootDesc && <p className="mb-2 text-[var(--text-tertiary)]">{mindMap.rootDesc}</p>}
    <div className="space-y-1.5 border-l border-[var(--primary-border)] pl-3">
      {branches.map((child, childIndex) => <details key={`${child.topic}-${childIndex}`} open={Boolean(normalized)} className="rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
        <summary className="cursor-pointer font-medium text-[var(--primary-hover)]">{child.topic}{showCitations(child.citationIndexes)}</summary>
        {child.desc && <p className="mt-1 text-[var(--text-tertiary)]">{child.desc}</p>}
        {child.visibleItems.length > 0 && <ul className="mt-1.5 space-y-1 border-l border-[var(--border)] pl-3">
          {child.visibleItems.map(({ item, index }) => <li key={index}>↳ {item}{showCitations(child.itemCitationIndexes?.[index] || child.citationIndexes)}</li>)}
        </ul>}
      </details>)}
      {branches.length === 0 && <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-tertiary)]">没有匹配的链路节点</div>}
    </div>
    <p className="mt-2 text-[10px] text-[var(--text-muted)]">右侧同步生成可交互知识图谱；保存后将通过实体入口、关系邻域和文档引用参与图谱增强检索，避免只靠语义相似度误召回。</p>
  </ArticleBlock>;
}

function AudioOverviewCard({ audio, speech, showCitations }: { audio: AudioOverview; speech: ReturnType<typeof useScriptSpeech>; showCitations: (indexes?: number[]) => React.ReactNode }) {
  return <ArticleBlock title={`音频概览 · ${audio.title}`}>
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
