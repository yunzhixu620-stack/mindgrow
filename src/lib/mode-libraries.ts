import type { MindMap } from "@/types";

export type ProductMode = "knowledge" | "meeting" | "article";

export const MODE_LIBRARY_CONFIG: Record<ProductMode, {
  label: string;
  shortLabel: string;
  emoji: string;
  defaultName: string;
  marker: string;
  description: string;
}> = {
  knowledge: {
    label: "知识碎片",
    shortLabel: "知识",
    emoji: "💡",
    defaultName: "默认知识库",
    marker: "",
    description: "记录、检索并连接长期知识",
  },
  meeting: {
    label: "会议助手",
    shortLabel: "会议",
    emoji: "🎯",
    defaultName: "会议知识库",
    marker: "[MindGrow:meeting]",
    description: "独立沉淀会议纪要、决议、行动项和风险",
  },
  article: {
    label: "文章解析",
    shortLabel: "文章",
    emoji: "📄",
    defaultName: "文章知识库",
    marker: "[MindGrow:article]",
    description: "独立沉淀文章、网页、PDF、引用和音频概览",
  },
};

export function getMapMode(map: Pick<MindMap, "description">): ProductMode {
  if ((map.description || "").includes(MODE_LIBRARY_CONFIG.meeting.marker)) return "meeting";
  if ((map.description || "").includes(MODE_LIBRARY_CONFIG.article.marker)) return "article";
  return "knowledge";
}

export function isMapForMode(map: Pick<MindMap, "description">, mode: ProductMode) {
  return getMapMode(map) === mode;
}

export function modeLibraryDescription(mode: Exclude<ProductMode, "knowledge">, extra = "") {
  const config = MODE_LIBRARY_CONFIG[mode];
  return `${config.marker} ${extra || config.description}`.trim();
}
