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
  const normalized = String(content || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const markers: { position: number; page: number }[] = [];
  const pageMarker = /^\s*\[(?:(?:第\s*)?(\d+)\s*页|page\s+(\d+))\]\s*$/gim;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pageMarker.exec(normalized)) !== null) {
    markers.push({ position: pageMatch.index, page: Number(pageMatch[1] || pageMatch[2]) });
  }
  const segments: { quote: string; pageNumber: number | null; charStart: number; charEnd: number; sentenceIndex: number }[] = [];
  const matcher = /[^。！？!?\n]+(?:[。！？!?]+|(?=\n|$))/g;
  let sentenceIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = matcher.exec(normalized)) !== null && segments.length < Math.max(1, limit)) {
    const raw = found[0];
    const leading = raw.length - raw.trimStart().length;
    const quote = raw.trim();
    const charStart = found.index + leading;
    const charEnd = charStart + quote.length;
    const marker = quote.match(PAGE_MARKER) || quote.match(ENGLISH_PAGE_MARKER);
    if (!marker && quote.length >= 12) {
      const page = markers.filter((item) => item.position <= charStart).slice(-1)[0]?.page || null;
      segments.push({ quote, pageNumber: page, charStart, charEnd, sentenceIndex });
    }
    sentenceIndex += 1;
  }

  return segments.map((segment, index): Citation => ({
    index: index + 1,
    quote: segment.quote,
    locator: sourceType === "pdf" && segment.pageNumber
      ? `第 ${segment.pageNumber} 页`
      : `原文片段 ${index + 1}`,
    pageNumber: sourceType === "pdf" ? segment.pageNumber : null,
    charStart: segment.charStart,
    charEnd: segment.charEnd,
    sentenceIndex: segment.sentenceIndex,
    sourceType: sourceType || "text",
    fileName,
  }));
}
