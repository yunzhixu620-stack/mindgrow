const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 300;
const MAX_TEXT_LENGTH = 120_000;

export interface ExtractedPdf {
  text: string;
  pageCount: number;
  truncated: boolean;
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
  let length = 0;
  let truncated = pdf.numPages > MAX_PAGES;

  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
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
  return { text, pageCount: pdf.numPages, truncated };
}
