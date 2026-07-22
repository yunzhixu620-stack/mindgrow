import type { MapMode, MindMap } from "@/types";

export type ProductMode = MapMode;

export const MODE_LIBRARY_CONFIG: Record<ProductMode, {
  label: string;
  shortLabel: string;
  emoji: string;
  defaultName: string;
  legacyMarker: string;
  description: string;
}> = {
  knowledge: {
    label: "知识碎片",
    shortLabel: "知识",
    emoji: "💡",
    defaultName: "默认知识库",
    legacyMarker: "",
    description: "记录、检索并连接长期知识",
  },
  meeting: {
    label: "会议助手",
    shortLabel: "会议",
    emoji: "🎯",
    defaultName: "会议知识库",
    legacyMarker: "[MindGrow:meeting]",
    description: "独立沉淀会议纪要、决议、行动项和风险",
  },
  article: {
    label: "文章解析",
    shortLabel: "文章",
    emoji: "📄",
    defaultName: "文章知识库",
    legacyMarker: "[MindGrow:article]",
    description: "独立沉淀文章、网页、PDF、引用和音频概览",
  },
};

export function normalizeMapMode(mode: unknown, description = ""): ProductMode {
  if (mode === "knowledge" || mode === "meeting" || mode === "article") return mode;
  if (description.includes(MODE_LIBRARY_CONFIG.meeting.legacyMarker)) return "meeting";
  if (description.includes(MODE_LIBRARY_CONFIG.article.legacyMarker)) return "article";
  return "knowledge";
}

export function getMapMode(map: Pick<MindMap, "mode" | "description">): ProductMode {
  // Explicit mode is authoritative. Marker parsing exists only for pre-v12 API
  // payloads and localStorage created before S2.1.
  return normalizeMapMode(map.mode, map.description || "");
}

export function migrateLegacyMapMode<T extends { mode?: unknown; description?: string }>(map: T): T & { mode: ProductMode } {
  return { ...map, mode: normalizeMapMode(map.mode, map.description || "") };
}

export function isMapForMode(map: Pick<MindMap, "mode" | "description">, mode: ProductMode) {
  return getMapMode(map) === mode;
}

export function modeLibraryDescription(mode: Exclude<ProductMode, "knowledge">, extra = "") {
  const config = MODE_LIBRARY_CONFIG[mode];
  return (extra || config.description).trim();
}
