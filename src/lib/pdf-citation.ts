import type { Citation } from "@/types";

const PAGE_MARKER = /^\s*\[(?:第\s*)?(\d+)\s*页\]\s*$/i;
const ENGLISH_PAGE_MARKER = /^\s*\[page\s+(\d+)\]\s*$/i;

export function pdfPageNumber(citation: Pick<Citation, "pageNumber" | "locator">) {
  const explicit = Number(citation.pageNumber);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const locator = String(citation.locator || "");
  const match = locator.match(/第\s*(\d+)\s*页/i) || locator.match(/\bpage\s*(\d+)\b/i);
  const parsed = Number(match?.[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function pdfFindQuery(quote: string) {
  const normalized = String(quote || "")
    .replace(/^\s*[“”"'‘’]+|[“”"'‘’]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 72) return normalized;

  const sentence = normalized.split(/(?<=[。！？!?])\s+/)[0]?.trim() || normalized;
  const source = sentence.length >= 18 ? sentence : normalized;
  const words = source.match(/[A-Za-z0-9][A-Za-z0-9_./+-]*/g) || [];
  if (words.length >= 8) return words.slice(0, 12).join(" ").slice(0, 96);
  return source.slice(0, 48).trim();
}

export function buildLocalArticleCitations(
  content: string,
  sourceType: Citation["sourceType"],
  fileName?: string,
  limit = 8,
) {
  const segments: { quote: string; pageNumber: number | null }[] = [];
  let currentPage: number | null = null;

  for (const rawLine of String(content || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const marker = line.match(PAGE_MARKER) || line.match(ENGLISH_PAGE_MARKER);
    if (marker) {
      currentPage = Number(marker[1]);
      continue;
    }
    if (!line) continue;
    const sentences = line.split(/(?<=[。！？!?])\s*/).map((item) => item.trim()).filter(Boolean);
    for (const sentence of sentences) {
      if (sentence.length < 12) continue;
      segments.push({ quote: sentence.slice(0, 180), pageNumber: currentPage });
      if (segments.length >= Math.max(1, limit)) break;
    }
    if (segments.length >= Math.max(1, limit)) break;
  }

  return segments.map((segment, index): Citation => ({
    index: index + 1,
    quote: segment.quote,
    locator: sourceType === "pdf" && segment.pageNumber
      ? `第 ${segment.pageNumber} 页`
      : `原文片段 ${index + 1}`,
    pageNumber: sourceType === "pdf" ? segment.pageNumber : null,
    sourceType: sourceType || "text",
    fileName,
  }));
}
