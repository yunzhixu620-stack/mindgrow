import { describe, expect, it } from "vitest";
import { flattenCommandGroups, searchLoadedKnowledge } from "@/lib/command-search";
import type { ChatMessage, GraphEntity, KnowledgeNode } from "@/types";

const node = (id: string, content: string, desc = ""): KnowledgeNode => ({
  id,
  content,
  desc,
  type: "concept",
  status: "active",
  source: "manual",
  confidence: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const entity = (id: string, canonicalName: string, aliases: string[] = []): GraphEntity => ({
  id,
  canonicalName,
  aliases,
  entityType: "concept",
  description: `${canonicalName} 的原文解释`,
  confidence: 1,
  citations: [],
  descriptionCitations: [],
});

const message = (id: string, content: string): ChatMessage => ({
  id,
  role: "assistant",
  content,
  timestamp: "2026-01-01T00:00:00.000Z",
});

describe("U5 loaded knowledge search", () => {
  it("groups only loaded maps, current nodes/entities and the latest ten chat messages", () => {
    const source = {
      maps: [{ id: "map-a", name: "GraphRAG 研究", description: "检索计划", color: "#fff", isDefault: false, categoryId: null, nodeCount: 1, createdAt: "", updatedAt: "" }],
      currentMapId: "map-a",
      nodes: [node("node-a", "可信检索")],
      entities: [entity("entity-a", "向量检索", ["Vector Retrieval"])],
      messages: Array.from({ length: 12 }, (_, index) => message(`chat-${index}`, index === 11 ? "最近检索引用 Recall@5" : `历史对话 ${index}`)),
    };
    const groups = searchLoadedKnowledge(source, "检索");

    expect(groups.maps[0]?.targetId).toBe("map-a");
    expect(groups.nodes[0]?.targetId).toBe("node-a");
    expect(groups.entities[0]?.targetId).toBe("entity-a");
    expect(groups.chat[0]?.targetId).toBe("chat-11");
    expect(groups.chat).toHaveLength(1);
    expect(flattenCommandGroups(groups).every((result) => result.mapId === "map-a")).toBe(true);
    expect(searchLoadedKnowledge(source, "历史对话 0").chat).toHaveLength(0);
  });

  it("searches a 500-node current graph within the 30ms target", () => {
    const nodes = Array.from({ length: 500 }, (_, index) => node(`node-${index}`, `知识节点 ${index}`, index === 499 ? "唯一性能命中" : "普通内容"));
    const startedAt = performance.now();
    const groups = searchLoadedKnowledge({ maps: [], currentMapId: "map-a", nodes, entities: [], messages: [] }, "唯一性能命中");
    const elapsed = performance.now() - startedAt;

    expect(groups.nodes[0]?.targetId).toBe("node-499");
    expect(elapsed).toBeLessThan(30);
  });
});
