import type { ChatMessage, GraphEntity, KnowledgeNode, MindMap } from "@/types";

export const COMMAND_PALETTE_OPEN_EVENT = "mindgrow:command-palette-open";
export const COMMAND_NAVIGATE_EVENT = "mindgrow:command-navigate";
export const COMMAND_ENTITY_FOCUS_EVENT = "mindgrow:command-entity-focus";

export type CommandResultKind = "map" | "node" | "entity" | "chat";

export interface CommandSearchResult {
  id: string;
  kind: CommandResultKind;
  title: string;
  subtitle: string;
  targetId: string;
  mapId: string;
  score: number;
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
  }))) : [];

  const entities = query ? topFive(source.entities.map((entity) => ({
    id: `entity:${entity.id}`,
    kind: "entity" as const,
    title: entity.canonicalName,
    subtitle: entity.description || "当前知识图谱实体",
    targetId: entity.id,
    mapId: source.currentMapId,
    score: matchScore(query, entity.canonicalName, entity.description || "", entity.aliases || []),
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
  })));

  return { maps, nodes, entities, chat };
}

export function flattenCommandGroups(groups: CommandSearchGroups) {
  return [...groups.maps, ...groups.nodes, ...groups.entities, ...groups.chat];
}
