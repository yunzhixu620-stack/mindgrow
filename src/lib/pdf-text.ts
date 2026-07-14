const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 300;
const MAX_TEXT_LENGTH = 120_000;

export interface ExtractedPdf {
  text: string;
  pageCount: number;
  truncated: boolean;
  tablePages: number[];
  imagePages: number[];
  scannedPages: number[];
  warnings: string[];
}

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

function layoutAwarePageText(items: unknown[]): { text: string; tableLike: boolean } {
  const positioned = items.map((raw) => {
    const item = raw as { str?: string; transform?: number[]; width?: number };
    if (!item.str?.trim() || !Array.isArray(item.transform)) return null;
    return { str: item.str.trim(), x: Number(item.transform[4] || 0), y: Number(item.transform[5] || 0), width: Number(item.width || 0) };
  }).filter((item): item is PositionedTextItem => Boolean(item));

  const rows: PositionedTextItem[][] = [];
  positioned.sort((left, right) => right.y - left.y || left.x - right.x).forEach((item) => {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2.5);
    if (row) row.push(item);
    else rows.push([item]);
  });

  let tableRows = 0;
  const lines = rows.map((row) => {
    row.sort((left, right) => left.x - right.x);
    let line = "";
    let previousRight = 0;
    let wideGaps = 0;
    row.forEach((item, index) => {
      const gap = index ? item.x - previousRight : 0;
      if (index) {
        if (gap > 22) { line += "\t"; wideGaps += 1; }
        else line += " ";
      }
      line += item.str;
      previousRight = item.x + item.width;
    });
    if (wideGaps >= 2 && row.length >= 3) tableRows += 1;
    return line.replace(/[ ]{2,}/g, " ").trim();
  }).filter(Boolean);

  return { text: lines.join("\n"), tableLike: tableRows >= 2 };
}

export async function extractPdfText(file: File): Promise<ExtractedPdf> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("请选择 PDF 文件");
  }
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF 不能超过 15MB");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  const tablePages: number[] = [];
  const imagePages: number[] = [];
  const scannedPages: number[] = [];
  let length = 0;
  let truncated = pdf.numPages > MAX_PAGES;

  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const layout = layoutAwarePageText(content.items);
      const pageText = layout.text.trim();
      if (layout.tableLike) tablePages.push(pageNumber);
      try {
        const operators = await page.getOperatorList();
        const imageOperators = new Set([
          pdfjs.OPS.paintImageXObject,
          pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintImageMaskXObject,
        ].filter((value): value is number => typeof value === "number"));
        if (operators.fnArray.some((operator) => imageOperators.has(operator))) imagePages.push(pageNumber);
      } catch { /* image diagnostics are best-effort */ }
      if (pageText.length < 20) scannedPages.push(pageNumber);
      if (!pageText) continue;
      const marked = `[第 ${pageNumber} 页]\n${pageText}`;
      if (length + marked.length > MAX_TEXT_LENGTH) {
        pages.push(marked.slice(0, Math.max(0, MAX_TEXT_LENGTH - length)));
        truncated = true;
        break;
      }
      pages.push(marked);
      length += marked.length;
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = pages.join("\n\n").trim();
  if (text.length < 50) throw new Error("没有从 PDF 中识别到足够文字；扫描版 PDF 请先进行 OCR");
  const warnings: string[] = [];
  if (tablePages.length) warnings.push(`检测到 ${tablePages.length} 个含表格/多列结构的页面，已保留换行与列间隔`);
  if (imagePages.length) warnings.push(`检测到 ${imagePages.length} 个含图片的页面；当前会保留图注文字，但图片像素仍需视觉模型复核`);
  if (scannedPages.length) warnings.push(`${scannedPages.length} 页文字过少，可能需要 OCR`);
  if (truncated) warnings.push("文档超过安全处理上限，末尾内容未进入本次解析");
  return { text, pageCount: pdf.numPages, truncated, tablePages, imagePages, scannedPages, warnings };
}
