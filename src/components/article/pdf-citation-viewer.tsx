"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pdfFindQuery, pdfPageNumber } from "@/lib/pdf-citation";
import type { Citation } from "@/types";

interface PdfCitationViewerProps {
  file: File;
  citation: Citation;
  onClose: () => void;
}

interface ViewerEventBus {
  on: (name: string, listener: (event: Record<string, unknown>) => void) => void;
  off: (name: string, listener: (event: Record<string, unknown>) => void) => void;
  dispatch: (name: string, event: Record<string, unknown>) => void;
}

interface ViewerRuntime {
  eventBus: ViewerEventBus;
  viewer: {
    currentPageNumber: number;
    currentScaleValue: string;
    pagesCount: number;
  };
  loadingTask: { destroy: () => Promise<void> };
  cleanup: () => void;
}

function findStateMessage(state: number, total: number) {
  if (state === 1) return "当前 PDF 中没有找到这段原文，可缩短关键词后重试";
  if (total > 0) return `已高亮 ${total} 处匹配`;
  return "正在定位并核对原文…";
}

export function PdfCitationViewer({ file, citation, onClose }: PdfCitationViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const pendingCitationRef = useRef(citation);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [pageNumber, setPageNumber] = useState(() => pdfPageNumber(citation) || 1);
  const [pageCount, setPageCount] = useState(0);
  const [searchText, setSearchText] = useState(() => pdfFindQuery(citation.quote));
  const [status, setStatus] = useState("正在加载 PDF 原文…");
  const [error, setError] = useState("");

  const locateCitation = useCallback((target: Citation, manualQuery?: string) => {
    pendingCitationRef.current = target;
    const runtime = runtimeRef.current;
    const query = (manualQuery ?? pdfFindQuery(target.quote)).trim();
    const requestedPage = pdfPageNumber(target);
    if (!runtime) return;
    const targetPage = Math.min(Math.max(requestedPage || runtime.viewer.currentPageNumber || 1, 1), Math.max(runtime.viewer.pagesCount, 1));
    runtime.viewer.currentPageNumber = targetPage;
    setPageNumber(targetPage);
    if (!query) {
      setStatus(`已定位第 ${targetPage} 页；该引用没有可用于高亮的逐字 quote`);
      return;
    }
    setStatus(`已定位第 ${targetPage} 页，正在高亮逐字引用…`);
    runtime.eventBus.dispatch("find", {
      source: runtime.viewer,
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: true,
      type: "",
    });
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    pendingCitationRef.current = citation;
    const query = pdfFindQuery(citation.quote);
    setSearchText(query);
    locateCitation(citation, query);
  }, [citation, locateCitation]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ViewerRuntime["loadingTask"] | null = null;
    const viewerElement = viewerRef.current;

    async function loadPdf() {
      const container = containerRef.current;
      if (!container || !viewerElement) return;
      setError("");
      setStatus("正在加载 PDF 原文…");
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const viewerModule = await import("pdfjs-dist/web/pdf_viewer.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const createdLoadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        loadingTask = createdLoadingTask;
        const document = await createdLoadingTask.promise;
        if (cancelled) {
          await createdLoadingTask.destroy();
          return;
        }

        const eventBus = new viewerModule.EventBus();
        const linkService = new viewerModule.PDFLinkService({ eventBus });
        const findController = new viewerModule.PDFFindController({ eventBus, linkService });
        const viewer = new viewerModule.PDFViewer({
          container,
          viewer: viewerElement,
          eventBus,
          linkService,
          findController,
          textLayerMode: 1,
          removePageBorders: true,
        });
        linkService.setViewer(viewer);

        const onPagesInit = () => {
          viewer.currentScaleValue = "page-width";
          setPageCount(document.numPages);
          setStatus(`PDF 已加载，共 ${document.numPages} 页`);
        };
        const onPagesLoaded = () => {
          window.setTimeout(() => locateCitation(pendingCitationRef.current), 0);
        };
        const onPageChanging = (event: Record<string, unknown>) => {
          const nextPage = Number(event.pageNumber);
          if (Number.isInteger(nextPage) && nextPage > 0) setPageNumber(nextPage);
        };
        const onMatchesCount = (event: Record<string, unknown>) => {
          const matches = event.matchesCount as { total?: number } | undefined;
          const total = Number(matches?.total || 0);
          if (total > 0) setStatus(`已高亮 ${total} 处匹配`);
        };
        const onFindState = (event: Record<string, unknown>) => {
          const matches = event.matchesCount as { total?: number } | undefined;
          setStatus(findStateMessage(Number(event.state), Number(matches?.total || 0)));
        };
        eventBus.on("pagesinit", onPagesInit);
        eventBus.on("pagesloaded", onPagesLoaded);
        eventBus.on("pagechanging", onPageChanging);
        eventBus.on("updatefindmatchescount", onMatchesCount);
        eventBus.on("updatefindcontrolstate", onFindState);
        viewer.setDocument(document);
        linkService.setDocument(document, null);
        runtimeRef.current = {
          eventBus,
          viewer,
          loadingTask,
          cleanup: () => {
            eventBus.off("pagesinit", onPagesInit);
            eventBus.off("pagesloaded", onPagesLoaded);
            eventBus.off("pagechanging", onPageChanging);
            eventBus.off("updatefindmatchescount", onMatchesCount);
            eventBus.off("updatefindcontrolstate", onFindState);
          },
        };
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "PDF Viewer 加载失败");
        setStatus("");
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      runtime?.cleanup();
      void (runtime?.loadingTask || loadingTask)?.destroy();
      viewerElement?.replaceChildren();
    };
  }, [file, locateCitation]);

  function goToPage(next: number) {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const clamped = Math.min(Math.max(next, 1), Math.max(pageCount, 1));
    runtime.viewer.currentPageNumber = clamped;
    setPageNumber(clamped);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-stretch justify-end bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`PDF 原文：${file.name}`} data-testid="pdf-viewer" data-pdf-page={pageNumber}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭 PDF 遮罩" onClick={onClose} />
      <section className="relative z-10 flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl lg:w-[72vw]">
        <header className="shrink-0 border-b border-[var(--border)] bg-[var(--card)] px-3 py-3 sm:px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">PDF 原文核验 · {file.name}</h3>
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{citation.locator || "页码未标注"} · 引用 [{citation.index}]</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                window.setTimeout(onClose, 0);
              }}
              aria-label="关闭 PDF 原文查看"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary-border)] hover:text-[var(--primary-hover)]"
            >关闭</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-35">上一页</button>
            <span className="min-w-20 text-center text-xs text-[var(--text-secondary)]" data-testid="pdf-viewer-page">{pageNumber} / {pageCount || "…"}</span>
            <button type="button" onClick={() => goToPage(pageNumber + 1)} disabled={!pageCount || pageNumber >= pageCount} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-35">下一页</button>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1 focus-within:border-[var(--primary-border)]">
              <input value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") locateCitation(citation, searchText); }} aria-label="PDF 原文搜索" className="min-w-24 flex-1 bg-transparent px-2 py-1 text-xs outline-none" />
              <button type="button" onClick={() => locateCitation(citation, searchText)} className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--primary-foreground)]">查找</button>
            </div>
          </div>
          <p role="status" className={`mt-2 text-[10px] ${error ? "text-red-300" : "text-[var(--text-tertiary)]"}`} data-testid="pdf-viewer-status">{error || status}</p>
        </header>
        <div className="relative min-h-0 flex-1 bg-neutral-900">
          <div ref={containerRef} className="mindgrow-pdf-container absolute inset-0 overflow-auto" tabIndex={0} aria-label="PDF 页面画布">
            <div ref={viewerRef} className="pdfViewer" />
          </div>
        </div>
        <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--card)] px-4 py-2 text-[10px] leading-4 text-[var(--text-tertiary)]">
          “{citation.quote}”
        </footer>
      </section>
    </div>
  );
}
