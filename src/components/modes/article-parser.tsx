"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { useMindGrowStore } from "@/store/mindgrow-store";
import type { AIMindMap } from "@/types";

interface ArticleResult {
  title: string;
  summary: string;
  keyPoints: string[];
  arguments: { claim: string; evidence?: string }[];
  questions: string[];
  mindMap: AIMindMap;
  sourceUrl?: string;
}

export function ArticleParser() {
  const currentMapId = useMindGrowStore((state) => state.currentMapId);
  const setNodes = useMindGrowStore((state) => state.setNodes);
  const setEdges = useMindGrowStore((state) => state.setEdges);
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function parse() {
    if (!url.trim() && content.trim().length < 50) { setNotice("请输入文章网址，或粘贴至少 50 个字的正文"); return; }
    setBusy(true); setNotice(""); setResult(null);
    try {
      const response = await apiFetch("/api/tools/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), content: content.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "解析失败");
      setResult(data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "解析失败"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!result?.mindMap) return;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: currentMapId, mindMap: result.mindMap, source: "article" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      const reload = await apiFetch(`/api/knowledge?mapId=${encodeURIComponent(currentMapId)}`);
      const graph = await reload.json();
      if (reload.ok) { setNodes(graph.nodes || []); setEdges(graph.edges || []); }
      setNotice(`已保存 ${data.totalNodes || 0} 个文章知识节点`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  return (
    <section className="w-full md:w-[480px] md:min-w-[400px] h-full overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-4"><h2 className="text-base font-semibold">📄 文章解析</h2><p className="text-[11px] text-[var(--text-tertiary)] mt-1">读取公开网页或粘贴正文，忠于原文提炼观点与证据。</p></div>
      <div className="space-y-3">
        <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://… 公开文章网址" className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
        <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]"><span className="h-px flex-1 bg-[var(--border)]" />或粘贴正文<span className="h-px flex-1 bg-[var(--border)]" /></div>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={10} placeholder="粘贴文章正文。若同时填写网址，将优先解析粘贴内容。" className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary)]" />
        {notice && <div role="status" className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">{notice}</div>}
        <button onClick={() => void parse()} disabled={busy || (!url.trim() && content.trim().length < 50)} className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-black disabled:opacity-40">{busy ? "正在阅读并核对原文…" : "解析文章"}</button>
      </div>

      {result && <div className="mt-5 space-y-3 animate-fade-in">
        <ArticleBlock title={result.title}><p>{result.summary || "未提取到摘要"}</p></ArticleBlock>
        <ArticleBlock title="核心要点"><List items={result.keyPoints} empty="未提取到要点" /></ArticleBlock>
        <ArticleBlock title="论点与证据">{result.arguments.length ? result.arguments.map((item, index) => <div key={index} className="mb-2 last:mb-0"><div className="font-medium">{index + 1}. {item.claim}</div>{item.evidence && <div className="mt-0.5 text-[var(--text-tertiary)]">依据：{item.evidence}</div>}</div>) : <span className="text-[var(--text-tertiary)]">未提取到论点</span>}</ArticleBlock>
        <ArticleBlock title="可继续追问"><List items={result.questions} empty="暂无" /></ArticleBlock>
        <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] py-2.5 text-sm font-medium text-[var(--primary-hover)] disabled:opacity-40">{saving ? "正在保存…" : "保存到当前思维导图"}</button>
      </div>}
    </section>
  );
}

function ArticleBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs leading-relaxed"><h3 className="mb-2 font-semibold text-[var(--primary-hover)]">{title}</h3>{children}</div>;
}
function List({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul className="space-y-1">{items.map((item, index) => <li key={index}>• {item}</li>)}</ul> : <span className="text-[var(--text-tertiary)]">{empty}</span>;
}
