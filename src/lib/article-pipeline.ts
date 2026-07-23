export type ArticleSourceKind = "url" | "pdf" | "text";
export type ArticleStageId = "read" | "extract" | "summary" | "citations" | "graph";
export type ArticleStageStatus = "pending" | "active" | "done" | "failed";

// The backend may spend up to 10s trying arXiv HTML and then up to 30s on
// the official PDF fallback. Keep the client above that combined budget but
// below the 60s function execution limit.
export const ARTICLE_SOURCE_STAGE_TIMEOUT_MS = 55_000;

export interface ArticleStage {
  id: ArticleStageId;
  label: string;
  status: ArticleStageStatus;
}

export interface PdfSourceMetadata {
  name: string;
  pageCount: number;
  truncated: boolean;
  tablePages: number[];
  imagePages: number[];
  scannedPages: number[];
}

export interface ArticleSourceState {
  kind: ArticleSourceKind | null;
  url: string;
  content: string;
  pdf: PdfSourceMetadata | null;
}

export const ARTICLE_STAGE_DEFINITIONS: Array<{ id: ArticleStageId; label: string }> = [
  { id: "read", label: "读取网页" },
  { id: "extract", label: "提取正文" },
  { id: "summary", label: "生成摘要" },
  { id: "citations", label: "定位引用" },
  { id: "graph", label: "构建图谱" },
];

export function initialArticleStages(): ArticleStage[] {
  return ARTICLE_STAGE_DEFINITIONS.map((stage) => ({ ...stage, status: "pending" }));
}

export function updateArticleStage(
  stages: ArticleStage[],
  stageId: ArticleStageId,
  status: ArticleStageStatus,
): ArticleStage[] {
  return stages.map((stage) => stage.id === stageId ? { ...stage, status } : stage);
}

export function resetArticleStagesFrom(stages: ArticleStage[], stageId: ArticleStageId): ArticleStage[] {
  const startIndex = ARTICLE_STAGE_DEFINITIONS.findIndex((stage) => stage.id === stageId);
  return stages.map((stage, index) => index < startIndex
    ? { ...stage, status: "done" }
    : { ...stage, status: "pending" });
}

export function isArticleSourceStage(stageId: ArticleStageId) {
  return stageId === "read" || stageId === "extract";
}

export function articleStageForError(code: string, fallback: ArticleStageId): ArticleStageId {
  if (/SOURCE|FETCH|URL|REDIRECT|SSRF|CONNECT|FIRST_BYTE/i.test(code)) return "read";
  if (/CONTENT|PDF|OCR|EXTRACT|EVIDENCE_BUILD|PREPARED_SOURCE/i.test(code)) return "extract";
  if (/CITATION|VERBATIM|GROUNDING|EVIDENCE/i.test(code)) return "citations";
  if (/ENTITY|GRAPH/i.test(code)) return "graph";
  if (/MODEL|ANALYSIS|PARSE|LOCALIZATION|SUMMARY/i.test(code)) return "summary";
  return fallback;
}

export function createArticleSourceRequest(state: ArticleSourceState): Record<string, unknown> {
  if (state.kind === "url") {
    const url = state.url.trim();
    if (!url) throw new Error("ARTICLE_URL_REQUIRED");
    return { sourceType: "url", url };
  }
  if (state.kind === "pdf") {
    if (!state.pdf || state.content.trim().length < 50) throw new Error("ARTICLE_PDF_REQUIRED");
    return {
      sourceType: "pdf",
      content: state.content.trim(),
      fileName: state.pdf.name,
      mimeType: "application/pdf",
      extraction: {
        pageCount: state.pdf.pageCount,
        truncated: state.pdf.truncated,
        tablePages: state.pdf.tablePages,
        imagePages: state.pdf.imagePages,
        scannedPages: state.pdf.scannedPages,
      },
    };
  }
  if (state.kind === "text") {
    const content = state.content.trim();
    if (content.length < 50) throw new Error("ARTICLE_TEXT_TOO_SHORT");
    return { sourceType: "text", content };
  }
  throw new Error("ARTICLE_SOURCE_REQUIRED");
}
