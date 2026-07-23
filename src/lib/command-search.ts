import type { ChatMessage, GraphEntity, KnowledgeNode, MindMap } from "@/types";

export const COMMAND_PALETTE_OPEN_EVENT = "mindgrow:command-palette-open";
export const COMMAND_NAVIGATE_EVENT = "mindgrow:command-navigate";
export const COMMAND_ENTITY_FOCUS_EVENT = "mindgrow:command-entity-focus";

export type CommandResultKind = "map" | "node" | "entity" | "document" | "chat";

export interface CommandSearchResult {
  id: string;
  kind: CommandResultKind;
  title: string;
  subtitle: string;
  targetId: string;
  mapId: string;
  score: number;
  matchReason?: string;
  scope?: "local" | "workspace";
}

export interface CommandSearchGroups {
  maps: CommandSearchResult[];
  nodes: CommandSearchResult[];
  entities: CommandSearchResult[];
  chat: CommandSearchResult[];
}

export interface CommandSearchSource {
  maps: MindMap[];
  currentMapId: string;
  nodes: KnowledgeNode[];
  entities: GraphEntity[];
  messages: ChatMessage[];
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();
const visibleMapDescription = (value: string) => value.replace(/\[MindGrow:(?:meeting|article)\]\s*/g, "").trim();

function matchScore(query: string, title: string, content: string, aliases: string[] = []) {
  if (!query) return 1;
  const normalizedTitle = normalize(title);
  const titleIndex = normalizedTitle.indexOf(query);
  if (normalizedTitle === query) return 500;
  if (titleIndex === 0) return 420;
  if (titleIndex > 0) return 360 - Math.min(titleIndex, 80);
  const aliasIndex = aliases.map(normalize).findIndex((alias) => alias.includes(query));
  if (aliasIndex >= 0) return 280 - aliasIndex;
  const contentIndex = normalize(content).indexOf(query);
  if (contentIndex >= 0) return 180 - Math.min(contentIndex, 100);
  return 0;
}

const topFive = (results: CommandSearchResult[]) => results
  .filter((result) => result.score > 0)
  .sort((left, right) => right.score - left.score)
  .slice(0, 5);

const WORKSPACE_MATCH_LABELS: Record<string, string> = {
  map_title: "知识库标题命中",
  map_description: "知识库说明命中",
  node_title: "知识节点内容命中",
  node_description: "知识节点说明命中",
  entity_name: "实体名称命中",
  entity_alias: "实体别名命中",
  entity_description: "实体解释命中",
  document_title: "原文标题命中",
  citation_text: "原文引用命中",
};

type WorkspaceSearchRow = {
  kind?: unknown;
  resultId?: unknown;
  mapId?: unknown;
  mapName?: unknown;
  title?: unknown;
  snippet?: unknown;
  matchField?: unknown;
  locator?: unknown;
  score?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

export function normalizeWorkspaceSearchResults(value: unknown): CommandSearchResult[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { results?: unknown }).results)) return [];
  return ((value as { results: WorkspaceSearchRow[] }).results || []).flatMap((row) => {
    const kind = cleanText(row.kind, 20) as CommandResultKind;
    if (!["map", "node", "entity", "document"].includes(kind)) return [];
    const resultId = cleanText(row.resultId, 180);
    const mapId = cleanText(row.mapId, 180);
    const title = cleanText(row.title, 240);
    if (!resultId || !mapId || !title) return [];
    const mapName = cleanText(row.mapName, 120);
    const locator = cleanText(row.locator, 160);
    const matchField = cleanText(row.matchField, 40);
    const matchLabel = WORKSPACE_MATCH_LABELS[matchField] || "工作区内容命中";
    const reasonParts = [matchLabel, locator, mapName].filter(Boolean);
    const numericScore = Number(row.score);
    return [{
      id: `workspace:${kind}:${resultId}`,
      kind,
      title,
      subtitle: cleanText(row.snippet, 360) || mapName || matchLabel,
      targetId: resultId,
      mapId,
      score: Number.isFinite(numericScore) ? numericScore : 0,
      matchReason: reasonParts.join(" · "),
      scope: "workspace" as const,
    }];
  });
}

export function mergeCommandResults(local: CommandSearchResult[], workspace: CommandSearchResult[]) {
  const seen = new Set(local.map((result) => `${result.kind}:${result.targetId}:${result.mapId}`));
  return [
    ...local,
    ...workspace.filter((result) => {
      const key = `${result.kind}:${result.targetId}:${result.mapId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

export function searchLoadedKnowledge(source: CommandSearchSource, rawQuery: string): CommandSearchGroups {
  const query = normalize(rawQuery);
  const maps = topFive(source.maps.map((map) => {
    const description = visibleMapDescription(map.description || "");
    return {
      id: `map:${map.id}`,
      kind: "map" as const,
      title: map.name,
      subtitle: description || `${map.nodeCount || 0} 个节点`,
      targetId: map.id,
      mapId: map.id,
      score: matchScore(query, map.name, description),
      scope: "local" as const,
    };
  }));

  const nodes = query ? topFive(source.nodes.map((node) => ({
    id: `node:${node.id}`,
    kind: "node" as const,
    title: node.content,
    subtitle: node.desc || "当前知识图谱节点",
    targetId: node.id,
    mapId: source.currentMapId,
    score: matchScore(query, node.content, node.desc || ""),
    scope: "local" as const,
  }))) : [];

  const entities = query ? topFive(source.entities.map((entity) => ({
    id: `entity:${entity.id}`,
    kind: "entity" as const,
    title: entity.canonicalName,
    subtitle: entity.description || "当前知识图谱实体",
    targetId: entity.id,
    mapId: source.currentMapId,
    score: matchScore(query, entity.canonicalName, entity.description || "", entity.aliases || []),
    scope: "local" as const,
  }))) : [];

  const recentMessages = source.messages
    .filter((message) => message.role !== "system" && !message.id.startsWith("welcome_") && message.content.trim())
    .slice(-10)
    .reverse();
  const chat = topFive(recentMessages.map((message, index) => ({
    id: `chat:${message.id}`,
    kind: "chat" as const,
    title: message.content.replace(/\s+/g, " ").trim().slice(0, 90),
    subtitle: `${message.role === "user" ? "我的提问" : "助手回答"} · 最近对话`,
    targetId: message.id,
    mapId: source.currentMapId,
    score: query ? matchScore(query, "", message.content) : Math.max(1, 20 - index),
    scope: "local" as const,
  })));

  return { maps, nodes, entities, chat };
}

export function flattenCommandGroups(groups: CommandSearchGroups) {
  return [...groups.maps, ...groups.nodes, ...groups.entities, ...groups.chat];
}
