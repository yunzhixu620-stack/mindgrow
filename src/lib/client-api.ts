import { API_BASE_URL } from "@/lib/config";
import { supabase } from "@/lib/supabase-browser";
import { aiEntityGraphToEntityGraph } from "@/lib/entity-graph";
import { migrateLegacyMapMode, normalizeMapMode } from "@/lib/mode-libraries";
import { buildLocalArticleCitations } from "@/lib/pdf-citation";
import type { TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore, type WriteRequestToken } from "@/store/mindgrow-store";
import type { AIEntityGraph, AIMindMap, Category, Citation, EntityGraph, KnowledgeEdge, KnowledgeNode, MindMap, NodeLayout, WhiteboardGroup } from "@/types";

const STORAGE_KEY = "mindgrow.local.v2";
let activeUserId: string | null = null;
let activeWorkspaceId: string | null = null;

export function setActiveUserId(userId: string | null) {
  activeUserId = userId;
}

export function setActiveWorkspaceId(workspaceId: string | null) {
  activeWorkspaceId = workspaceId;
}

type LocalState = {
  version: 2;
  maps: MindMap[];
  categories: Category[];
  nodes: Record<string, KnowledgeNode[]>;
  edges: Record<string, KnowledgeEdge[]>;
  entityGraphs: Record<string, EntityGraph>;
  layouts: Record<string, NodeLayout>;
  whiteboardGroups: Record<string, WhiteboardGroup[]>;
};

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function seedState(): LocalState {
  const createdAt = now();
  const nodes: KnowledgeNode[] = [
    node("demo_root", "AI 知识助手", "topic", "把分散信息转化为可检索、可追溯、可行动的个人知识系统", createdAt),
    node("demo_capture", "知识采集", "concept", "低摩擦记录想法、文章和会议信息", createdAt),
    node("demo_retrieval", "可信检索", "concept", "先找证据，再组织回答，并明确知识缺口", createdAt),
    node("demo_structure", "结构化输出", "concept", "把回答同步沉淀为可编辑的知识结构", createdAt),
    node("demo_learning", "持续学习", "concept", "通过反馈、复习和连接让知识不断生长", createdAt),
    node("demo_capture_1", "随手输入知识碎片", "detail", "支持短句、长文本与问题", createdAt),
    node("demo_capture_2", "从模板快速开始", "detail", "降低空白页阻力", createdAt),
    node("demo_retrieval_1", "检索当前知识库", "detail", "回答只引用与问题相关的节点", createdAt),
    node("demo_retrieval_2", "展示引用依据", "detail", "让用户可以回到原知识节点核对", createdAt),
    node("demo_structure_1", "AI 生成可选导图", "detail", "保存前可以删减不需要的分支", createdAt),
    node("demo_structure_2", "导出 Markdown、PNG、PDF", "detail", "知识成果可带走", createdAt),
    node("demo_learning_1", "对回答点赞或点踩", "detail", "把体验信号沉淀为质量数据", createdAt),
    node("demo_learning_2", "发现知识缺口", "detail", "没有证据时明确提示，而不是编造", createdAt),
  ];
  const edges: KnowledgeEdge[] = [
    edge("demo_e1", "demo_root", "demo_capture", createdAt),
    edge("demo_e2", "demo_root", "demo_retrieval", createdAt),
    edge("demo_e3", "demo_root", "demo_structure", createdAt),
    edge("demo_e4", "demo_root", "demo_learning", createdAt),
    edge("demo_e5", "demo_capture", "demo_capture_1", createdAt),
    edge("demo_e6", "demo_capture", "demo_capture_2", createdAt),
    edge("demo_e7", "demo_retrieval", "demo_retrieval_1", createdAt),
    edge("demo_e8", "demo_retrieval", "demo_retrieval_2", createdAt),
    edge("demo_e9", "demo_structure", "demo_structure_1", createdAt),
    edge("demo_e10", "demo_structure", "demo_structure_2", createdAt),
    edge("demo_e11", "demo_learning", "demo_learning_1", createdAt),
    edge("demo_e12", "demo_learning", "demo_learning_2", createdAt),
  ];
  return {
    version: 2,
    maps: [{
      id: "map_default",
      name: "MindGrow 入门",
      description: "可直接编辑的本地示例知识库",
      mode: "knowledge",
      canvasView: "mindmap",
      color: "#22d3a7",
      isDefault: true,
      categoryId: null,
      nodeCount: nodes.length,
      createdAt,
      updatedAt: createdAt,
    }],
    categories: [],
    nodes: { map_default: nodes },
    edges: { map_default: edges },
    entityGraphs: { map_default: { entities: [], relations: [] } },
    layouts: {},
    whiteboardGroups: { map_default: [] },
  };
}

function node(id: string, content: string, type: KnowledgeNode["type"], desc: string, createdAt: string): KnowledgeNode {
  return { id, content, desc, type, status: "active", source: "ai_generated", confidence: 1, createdAt, updatedAt: createdAt };
}

function edge(id: string, sourceId: string, targetId: string, createdAt: string): KnowledgeEdge {
  return { id, sourceId, targetId, relation: "contains", weight: 1, createdAt };
}

function loadState(): LocalState {
  if (typeof window === "undefined") return seedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = seedState();
      saveState(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as LocalState;
    if (parsed.version !== 2 || !Array.isArray(parsed.maps)) throw new Error("Unsupported local data");
    const legacyMaps = parsed.maps as Array<MindMap & { mode?: unknown }>;
    const upgradedMaps = legacyMaps.map(migrateLegacyMapMode);
    const upgraded = upgradedMaps.some((map, index) => map.mode !== legacyMaps[index].mode);
    parsed.maps = upgradedMaps;
    parsed.entityGraphs ||= {};
    parsed.layouts ||= {};
    parsed.whiteboardGroups ||= {};
    parsed.layouts = Object.fromEntries(Object.entries(parsed.layouts).filter(([nodeId, layout]) => (
      layout && layout.nodeId === nodeId && typeof layout.mapId === "string"
    )));
    parsed.maps = parsed.maps.map((map) => ({ ...map, canvasView: map.canvasView === "whiteboard" ? "whiteboard" : "mindmap" }));
    if (upgraded) saveState(parsed);
    return parsed;
  } catch {
    const seeded = seedState();
    saveState(seeded);
    return seeded;
  }
}

function saveState(state: LocalState) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateMapCount(state: LocalState, mapId: string) {
  const map = state.maps.find((item) => item.id === mapId);
  if (!map) return;
  map.nodeCount = (state.nodes[mapId] || []).filter((item) => item.status === "active").length;
  map.updatedAt = now();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-MindGrow-Mode": "local" },
  });
}

function bodyOf(init?: RequestInit): Record<string, any> {
  if (!init?.body || typeof init.body !== "string") return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

function createNode(state: LocalState, mapId: string, values: Partial<KnowledgeNode> & Pick<KnowledgeNode, "content">): KnowledgeNode {
  const timestamp = now();
  const created: KnowledgeNode = {
    id: makeId("node"),
    content: values.content,
    desc: values.desc || "",
    type: values.type || "concept",
    status: values.status || "active",
    source: values.source || "manual",
    confidence: values.confidence ?? 1,
    citations: values.citations || [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.nodes[mapId] ||= [];
  state.nodes[mapId].push(created);
  return created;
}

function createEdge(state: LocalState, mapId: string, sourceId: string, targetId: string): KnowledgeEdge {
  const created: KnowledgeEdge = {
    id: makeId("edge"), sourceId, targetId, relation: "contains", weight: 1, createdAt: now(),
  };
  state.edges[mapId] ||= [];
  state.edges[mapId].push(created);
  return created;
}

function contentSimilarity(left: string, right: string) {
  const a = left.trim().toLocaleLowerCase();
  const b = right.trim().toLocaleLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.9;
  const leftTerms = new Set(terms(a));
  const rightTerms = new Set(terms(b));
  const union = new Set([...Array.from(leftTerms), ...Array.from(rightTerms)]);
  if (!union.size) return 0;
  const overlap = Array.from(leftTerms).filter((term) => rightTerms.has(term)).length;
  return overlap / union.size;
}

function addMindMap(
  state: LocalState,
  mapId: string,
  mindMap: AIMindMap,
  source: KnowledgeNode["source"] = "ai_generated",
  citations: Citation[] = [],
  targetTopic = "",
) {
  const createdNodes: KnowledgeNode[] = [];
  const createdEdges: KnowledgeEdge[] = [];
  const reusedNodes = new Set<string>();
  const citationMap = new Map(citations.map((citation) => [citation.index, citation]));
  const cited = (indexes: number[] = []) => indexes.map((index) => citationMap.get(index)).filter(Boolean) as Citation[];
  const mapNodes = state.nodes[mapId] || [];
  const mapEdges = state.edges[mapId] || [];
  const directChildren = (parentId: string) => new Set(mapEdges.filter((edge) => edge.sourceId === parentId && edge.relation === "contains").map((edge) => edge.targetId));
  const findSimilar = (content: string, candidates: KnowledgeNode[], threshold: number) => candidates
    .map((node) => ({ node, score: contentSimilarity(content, node.content) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)[0]?.node;

  const topics = mapNodes.filter((node) => node.type === "topic" && node.status === "active");
  let root = targetTopic ? topics.find((node) => node.content === targetTopic) : undefined;
  root ||= findSimilar(mindMap.root, topics, 0.42);
  if (root) {
    reusedNodes.add(root.id);
    if (!root.desc && mindMap.rootDesc) root.desc = mindMap.rootDesc;
    root.citations = [...(root.citations || []), ...cited(mindMap.rootCitationIndexes)].filter((citation, index, all) => all.findIndex((item) => item.index === citation.index && item.quote === citation.quote) === index);
    root.updatedAt = now();
  } else {
    root = createNode(state, mapId, { content: mindMap.root, desc: mindMap.rootDesc, type: "topic", source, confidence: 0.95, citations: cited(mindMap.rootCitationIndexes) });
    createdNodes.push(root);
  }
  for (const child of mindMap.children || []) {
    const rootChildren = directChildren(root.id);
    let childNode = findSimilar(child.topic, mapNodes.filter((node) => rootChildren.has(node.id)), 0.66);
    if (childNode) {
      reusedNodes.add(childNode.id);
      if (!childNode.desc && child.desc) childNode.desc = child.desc;
    } else {
      childNode = createNode(state, mapId, { content: child.topic, desc: child.desc, type: "concept", source, confidence: 0.85, citations: cited(child.citationIndexes) });
      createdNodes.push(childNode);
      const newEdge = createEdge(state, mapId, root.id, childNode.id);
      createdEdges.push(newEdge);
    }
    const childItems = child.items || [];
    for (let itemIndex = 0; itemIndex < childItems.length; itemIndex += 1) {
      const item = childItems[itemIndex];
      const childChildren = directChildren(childNode.id);
      const existingDetail = findSimilar(item, mapNodes.filter((node) => childChildren.has(node.id)), 0.72);
      if (existingDetail) {
        reusedNodes.add(existingDetail.id);
        continue;
      }
      const detail = createNode(state, mapId, { content: item, type: "detail", source, confidence: 0.75, citations: cited(child.itemCitationIndexes?.[itemIndex] || child.citationIndexes) });
      createdNodes.push(detail);
      const newEdge = createEdge(state, mapId, childNode.id, detail.id);
      createdEdges.push(newEdge);
    }
  }
  updateMapCount(state, mapId);
  return { root, createdNodes, createdEdges, reusedNodes: Array.from(reusedNodes) };
}

function handleKnowledge(path: string, init?: RequestInit): Response {
  const state = loadState();
  const url = new URL(path, window.location.origin);
  const method = (init?.method || "GET").toUpperCase();

  if (method === "GET") {
    const action = url.searchParams.get("action");
    if (action === "maps") return json({ maps: state.maps });
    if (action === "categories") return json({ categories: state.categories });
    if (action === "universe") {
      return json({
        libraries: state.maps.map((map) => ({
          map,
          nodes: state.nodes[map.id] || [],
          edges: state.edges[map.id] || [],
          entityGraph: state.entityGraphs[map.id] || { entities: [], relations: [] },
          layouts: Object.values(state.layouts).filter((layout) => layout.mapId === map.id),
          whiteboardGroups: state.whiteboardGroups[map.id] || [],
        })),
        generatedAt: now(),
      });
    }
    if (action === "search") {
      const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
      if (!query) return json({ query, results: [], total: 0 });
      const normalized = query.toLocaleLowerCase();
      const results = state.maps.flatMap((map) => {
        const mapMatches = `${map.name} ${map.description || ""}`.toLocaleLowerCase().includes(normalized);
        const matches = (state.nodes[map.id] || [])
          .filter((node) => `${node.content} ${node.desc || ""}`.toLocaleLowerCase().includes(normalized))
          .slice(0, 5)
          .map((node) => ({ id: node.id, content: node.content, desc: node.desc || "", type: node.type }));
        if (!mapMatches && matches.length === 0) return [];
        return [{ map, mapMatches, matches }];
      });
      return json({ query, results, total: results.length });
    }
    const mapId = url.searchParams.get("mapId") || "map_default";
    return json({
      nodes: state.nodes[mapId] || [],
      edges: state.edges[mapId] || [],
      entityGraph: state.entityGraphs[mapId] || { entities: [], relations: [] },
      layouts: Object.values(state.layouts).filter((layout) => layout.mapId === mapId),
      whiteboardGroups: state.whiteboardGroups[mapId] || [],
    });
  }

  if (method === "DELETE") {
    const nodeId = url.searchParams.get("nodeId");
    if (!nodeId) return json({ error: "nodeId is required" }, 400);
    for (const map of state.maps) {
      state.nodes[map.id] = (state.nodes[map.id] || []).filter((item) => item.id !== nodeId);
      state.edges[map.id] = (state.edges[map.id] || []).filter((item) => item.sourceId !== nodeId && item.targetId !== nodeId);
      delete state.layouts[nodeId];
      updateMapCount(state, map.id);
    }
    saveState(state);
    return json({ success: true });
  }

  const body = bodyOf(init);
  if (method === "PUT") {
    const mapId = String(body.mapId || "map_default");
    const inputLayouts = Array.isArray(body.layouts) ? body.layouts : [body];
    if (inputLayouts.length === 0 || inputLayouts.length > 500) return json({ error: "Invalid whiteboard layout" }, 400);
    const normalizedLayouts: NodeLayout[] = [];
    for (const input of inputLayouts) {
      if (input.mapId && String(input.mapId) !== mapId) return json({ error: "Invalid whiteboard layout" }, 400);
      const nodeId = String(input.nodeId || "");
      const nodeExists = (state.nodes[mapId] || []).some((node) => node.id === nodeId);
      const groupId = input.groupId ? String(input.groupId) : null;
      const groupExists = !groupId || (state.whiteboardGroups[mapId] || []).some((group) => group.id === groupId);
      const values = [Number(input.positionX ?? 0), Number(input.positionY ?? 0), Number(input.zoomLevel ?? 1), Number(input.cardWidth ?? 280), Number(input.cardHeight ?? 168)];
      if (!nodeExists || !groupExists || values.some((value) => !Number.isFinite(value))
        || Math.abs(values[0]) > 100000 || Math.abs(values[1]) > 100000
        || values[2] < 0.05 || values[2] > 8 || values[3] < 180 || values[3] > 800
        || values[4] < 96 || values[4] > 640) return json({ error: "Invalid whiteboard layout" }, 400);
      normalizedLayouts.push({
        nodeId,
        mapId,
        positionX: values[0],
        positionY: values[1],
        zoomLevel: values[2],
        groupId,
        cardWidth: values[3],
        cardHeight: values[4],
        updatedAt: now(),
      });
    }
    if (new Set(normalizedLayouts.map((layout) => layout.nodeId)).size !== normalizedLayouts.length) return json({ error: "Invalid whiteboard layout" }, 400);
    normalizedLayouts.forEach((layout) => { state.layouts[layout.nodeId] = layout; });
    saveState(state);
    return normalizedLayouts.length === 1
      ? json({ success: true, layout: normalizedLayouts[0] })
      : json({ success: true, layouts: normalizedLayouts });
  }

  if (method === "PATCH") {
    for (const map of state.maps) {
      const found = (state.nodes[map.id] || []).find((item) => item.id === body.nodeId);
      if (!found) continue;
      for (const key of ["content", "desc", "type", "status"] as const) {
        if (body[key] !== undefined) (found as any)[key] = body[key];
      }
      found.updatedAt = now();
      saveState(state);
      return json({ node: found });
    }
    return json({ error: "Node not found" }, 404);
  }

  if (method !== "POST") return json({ error: "Method not allowed" }, 405);
  const action = body.action;
  if (action === "setMapCanvasView") {
    const map = state.maps.find((item) => item.id === (body.mapId || "map_default"));
    if (!map || !["mindmap", "whiteboard"].includes(body.canvasView)) return json({ error: "Invalid canvas view" }, 400);
    map.canvasView = body.canvasView;
    map.updatedAt = now();
    saveState(state);
    return json({ success: true, canvasView: map.canvasView });
  }
  if (action === "createWhiteboardGroup") {
    const mapId = String(body.mapId || "map_default");
    if (!state.maps.some((map) => map.id === mapId) || !String(body.name || "").trim()) return json({ error: "Invalid whiteboard group" }, 400);
    if (body.collapsed !== undefined && typeof body.collapsed !== "boolean") return json({ error: "Invalid whiteboard group" }, 400);
    if (!/^#[0-9a-f]{6}$/i.test(String(body.color || "#22d3a7"))) return json({ error: "Invalid whiteboard group" }, 400);
    const timestamp = now();
    const requestedId = String(body.id || makeId("wbg"));
    if (!/^wbg_[a-z0-9_-]{3,88}$/i.test(requestedId)) return json({ error: "Invalid whiteboard group" }, 400);
    const group: WhiteboardGroup = {
      id: requestedId, mapId, name: String(body.name).trim().slice(0, 80), color: String(body.color || "#22d3a7"),
      positionX: Number(body.positionX ?? 0), positionY: Number(body.positionY ?? 0),
      width: Math.min(2400, Math.max(240, Number(body.width ?? 720))), height: Math.min(2000, Math.max(160, Number(body.height ?? 480))),
      collapsed: body.collapsed ?? false, sortOrder: Math.trunc(Number(body.sortOrder ?? (state.whiteboardGroups[mapId] || []).length)),
      createdAt: timestamp, updatedAt: timestamp,
    };
    if (![group.positionX, group.positionY, group.width, group.height, group.sortOrder].every(Number.isFinite)
      || Math.abs(group.positionX) > 100000 || Math.abs(group.positionY) > 100000
      || Number(body.width ?? 720) < 240 || Number(body.width ?? 720) > 2400
      || Number(body.height ?? 480) < 160 || Number(body.height ?? 480) > 2000
      || group.sortOrder < -10000 || group.sortOrder > 10000) return json({ error: "Invalid whiteboard group" }, 400);
    state.whiteboardGroups[mapId] ||= [];
    state.whiteboardGroups[mapId].push(group);
    saveState(state);
    return json({ group }, 201);
  }
  if (action === "updateWhiteboardGroup") {
    const mapId = String(body.mapId || "map_default");
    const group = (state.whiteboardGroups[mapId] || []).find((item) => item.id === body.groupId);
    if (!group) return json({ error: "Whiteboard group not found" }, 404);
    if (body.name !== undefined && !String(body.name).trim()) return json({ error: "Invalid whiteboard group" }, 400);
    if (body.name !== undefined) group.name = String(body.name).trim().slice(0, 80);
    if (body.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(String(body.color))) return json({ error: "Invalid whiteboard group" }, 400);
      group.color = String(body.color);
    }
    for (const [key, min, max] of [["positionX", -100000, 100000], ["positionY", -100000, 100000], ["width", 240, 2400], ["height", 160, 2000], ["sortOrder", -10000, 10000]] as const) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isFinite(value)) return json({ error: "Invalid whiteboard group" }, 400);
      if (value < min || value > max) return json({ error: "Invalid whiteboard group" }, 400);
      group[key] = key === "sortOrder" ? Math.trunc(value) : value;
    }
    if (body.collapsed !== undefined) {
      if (typeof body.collapsed !== "boolean") return json({ error: "Invalid whiteboard group" }, 400);
      group.collapsed = body.collapsed;
    }
    group.updatedAt = now();
    saveState(state);
    return json({ group });
  }
  if (action === "deleteWhiteboardGroup") {
    const mapId = String(body.mapId || "map_default");
    const groups = state.whiteboardGroups[mapId] || [];
    const group = groups.find((candidate) => candidate.id === body.groupId);
    if (!group) return json({ error: "Whiteboard group not found" }, 404);
    state.whiteboardGroups[mapId] = groups.filter((group) => group.id !== body.groupId);
    Object.values(state.layouts).forEach((layout) => {
      if (layout.mapId !== mapId || layout.groupId !== body.groupId) return;
      layout.positionX += group.positionX;
      layout.positionY += group.positionY;
      layout.groupId = null;
      layout.updatedAt = now();
    });
    saveState(state);
    return json({ success: true });
  }
  if (action === "createMap") {
    const timestamp = now();
    const description = body.description || "";
    const map: MindMap = {
      id: makeId("map"), name: body.name || "新知识库", description,
      mode: normalizeMapMode(body.mode, description),
      canvasView: "mindmap",
      color: body.color || "#22d3a7", isDefault: false, categoryId: body.categoryId || null,
      nodeCount: 0, createdAt: timestamp, updatedAt: timestamp,
    };
    state.maps.unshift(map); state.nodes[map.id] = []; state.edges[map.id] = []; state.entityGraphs[map.id] = { entities: [], relations: [] }; state.whiteboardGroups[map.id] = [];
    saveState(state);
    return json({ map });
  }
  if (action === "createFromTemplate") {
    if (!body.template?.root) return json({ error: "Invalid template data" }, 400);
    const timestamp = now();
    const description = body.description || "";
    const map: MindMap = {
      id: makeId("map"), name: body.name || body.template.root, description,
      mode: normalizeMapMode(body.mode, description),
      canvasView: "mindmap",
      color: body.color || "#22d3a7", isDefault: false, categoryId: body.categoryId || null,
      nodeCount: 0, createdAt: timestamp, updatedAt: timestamp,
    };
    state.maps.unshift(map); state.nodes[map.id] = []; state.edges[map.id] = []; state.entityGraphs[map.id] = { entities: [], relations: [] }; state.whiteboardGroups[map.id] = [];
    addMindMap(state, map.id, body.template, "ai_generated");
    saveState(state);
    return json({ map });
  }
  if (action === "deleteMap") {
    const map = state.maps.find((item) => item.id === body.mapId);
    if (!map || map.isDefault) return json({ error: "Cannot delete default map" }, 400);
    state.maps = state.maps.filter((item) => item.id !== body.mapId);
    delete state.nodes[body.mapId]; delete state.edges[body.mapId]; delete state.entityGraphs[body.mapId]; delete state.whiteboardGroups[body.mapId];
    Object.keys(state.layouts).forEach((nodeId) => { if (state.layouts[nodeId].mapId === body.mapId) delete state.layouts[nodeId]; });
    saveState(state);
    return json({ success: true });
  }
  if (action === "clearMap") {
    state.nodes[body.mapId] = []; state.edges[body.mapId] = []; state.entityGraphs[body.mapId] = { entities: [], relations: [] }; state.whiteboardGroups[body.mapId] = [];
    Object.keys(state.layouts).forEach((nodeId) => { if (state.layouts[nodeId].mapId === body.mapId) delete state.layouts[nodeId]; });
    updateMapCount(state, body.mapId);
    saveState(state);
    return json({ success: true });
  }
  if (action === "renameMap") {
    const map = state.maps.find((item) => item.id === body.mapId);
    if (map) { map.name = body.name; map.updatedAt = now(); }
    saveState(state);
    return json({ success: Boolean(map) });
  }
  if (action === "createCategory") {
    const category: Category = {
      id: makeId("cat"), name: body.name || "新文件夹", icon: body.icon || "📁",
      color: body.color || "#22d3a7", sortOrder: state.categories.length, createdAt: now(),
    };
    state.categories.push(category); saveState(state);
    return json({ category });
  }
  if (action === "deleteCategory") {
    state.categories = state.categories.filter((item) => item.id !== body.categoryId);
    state.maps.forEach((item) => { if (item.categoryId === body.categoryId) item.categoryId = null; });
    saveState(state);
    return json({ success: true });
  }
  if (action === "renameCategory") {
    const category = state.categories.find((item) => item.id === body.categoryId);
    if (category) category.name = body.name;
    saveState(state);
    return json({ success: Boolean(category) });
  }
  if (action === "moveMapToCategory") {
    const map = state.maps.find((item) => item.id === body.mapId);
    if (map) { map.categoryId = body.categoryId || null; map.updatedAt = now(); }
    saveState(state);
    return json({ success: Boolean(map) });
  }

  const mapId = body.mapId || "map_default";
  if (body.mindMap?.root) {
    if (String(body.source || "").toLocaleLowerCase() === "meeting" && body.confirmedForLongTerm !== true) {
      return json({ error: "请先确认会议纪要，再加入长期知识库", code: "MEETING_CONFIRMATION_REQUIRED" }, 409);
    }
    const targetTopic = body.placement?.confidence >= 0.45 ? String(body.placement.targetTopic || "") : "";
    const result = addMindMap(state, mapId, body.mindMap, body.source || "ai_generated", body.citations || [], targetTopic);
    if (body.entityGraph) {
      state.entityGraphs[mapId] = aiEntityGraphToEntityGraph(body.entityGraph as AIEntityGraph, body.citations || [], `local:${mapId}:${Date.now()}`);
    }
    saveState(state);
    return json({
      node: result.root,
      additionalNodes: result.createdNodes.filter((node) => node.id !== result.root.id),
      additionalEdges: result.createdEdges,
      totalNodes: result.createdNodes.length,
      totalEdges: result.createdEdges.length,
      reusedNodes: result.reusedNodes.length,
      entityCount: state.entityGraphs[mapId]?.entities.length || 0,
      relationCount: state.entityGraphs[mapId]?.relations.length || 0,
      longTermCommitted: true,
    });
  }
  if (!body.content) return json({ error: "Content is required" }, 400);
  const created = createNode(state, mapId, {
    content: String(body.content),
    desc: body.desc,
    type: body.type,
    status: body.status,
    source: body.source,
    confidence: body.confidence,
  });
  const parentEdge = body.parentId ? createEdge(state, mapId, body.parentId, created.id) : null;
  updateMapCount(state, mapId); saveState(state);
  return json({ node: created, edge: parentEdge, completions: [], restructureActions: [] });
}

const STOP_WORDS = new Set(["什么", "如何", "怎么", "为什么", "哪些", "是否", "可以", "这个", "那个", "以及", "一个", "我们", "目前", "知识", "关于"]);

function terms(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[？?！!，,。.;；：:\n\r]/g, " ");
  const words = normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}/g) || [];
  const result = new Set<string>();
  for (const word of words) {
    if (!STOP_WORDS.has(word)) result.add(word);
    if (/^[\u4e00-\u9fff]{4,}$/.test(word)) {
      for (let i = 0; i < word.length - 1; i += 1) result.add(word.slice(i, i + 2));
    }
  }
  return Array.from(result);
}

function search(nodes: KnowledgeNode[], query: string) {
  const queryTerms = terms(query);
  return nodes.map((item) => {
    const haystack = `${item.content} ${item.desc || ""}`.toLowerCase();
    let score = queryTerms.reduce((total, term) => total + (haystack.includes(term) ? (term.length > 2 ? 3 : 1) : 0), 0);
    if (query.includes(item.content) || item.content.includes(query.replace(/[？?]/g, ""))) score += 8;
    if (item.type === "topic") score += 0.2;
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
}

function compact(text: string, max = 26) {
  const cleaned = text.replace(/\s+/g, " ").replace(/[。！？!?]+$/, "").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function generateLocalMindMap(input: string): AIMindMap {
  const sentences = input.split(/[。！？!?;；\n]+/).map((item) => item.trim()).filter(Boolean);
  const extracted = Array.from(new Set(terms(input).filter((item) => item.length >= 2))).slice(0, 6);
  const root = compact(sentences[0] || input, 24);
  const firstItems = extracted.slice(0, 3);
  const secondItems = sentences.slice(1, 4).map((item) => compact(item, 34));
  return {
    root,
    rootDesc: compact(input, 64),
    children: [
      { topic: "核心概念", desc: "先明确主题中的关键对象与边界", items: firstItems.length ? firstItems : ["定义与范围", "核心对象", "关键术语"] },
      { topic: "关键要点", desc: "保留输入中可继续展开的信息", items: secondItems.length ? secondItems : ["主要观点", "适用场景", "限制条件"] },
      { topic: "行动与延伸", desc: "把知识转化为下一步可执行动作", items: ["补充一个具体案例", "记录反例或风险", "提出一个复习问题"] },
    ],
    relatedTopics: extracted.slice(3, 6),
  };
}

function classifyLocalArticleTask(input: string) {
  const normalized = input.trim();
  const explicitCommand = normalized.match(/^(?:请(?:你)?|帮我|请帮我)?\s*(翻译|翻成|译成|translate|translation|总结|概括|摘要|summari[sz]e|summary|比较|对比|compare|comparison|提取|抽取|列出|extract|解释|解读|讲解|explain|interpret)(?:\s|[：:，,]|$)/i)?.[1] || "";
  if (/^(翻译|翻成|译成|translate|translation)$/i.test(explicitCommand)) return "translate";
  if (/^(总结|概括|摘要|summari[sz]e|summary)$/i.test(explicitCommand)) return "summarize";
  if (/^(比较|对比|compare|comparison)$/i.test(explicitCommand)) return "compare";
  if (/^(提取|抽取|列出|extract)$/i.test(explicitCommand)) return "extract";
  if (/^(解释|解读|讲解|explain|interpret)$/i.test(explicitCommand)) return "explain";
  if (/(翻译|翻成|译成|translate|translation)/i.test(normalized)) return "translate";
  if (/(总结|概括|摘要|summari[sz]e|summary)/i.test(normalized)) return "summarize";
  if (/(比较|对比|区别|compare|comparison|\bvs\.?\b)/i.test(normalized)) return "compare";
  if (/(提取|抽取|列出|extract)/i.test(normalized)) return "extract";
  if (/(解释|解读|讲解|explain|interpret)/i.test(normalized)) return "explain";
  return "qa";
}

function handleChat(init?: RequestInit): Response {
  const body = bodyOf(init);
  const input = String(body.input || "").trim();
  if (!input) return json({ error: "Input is required" }, 400);
  if (/^(你好|嗨|hello|hi|hey)[!！。\s]*$/i.test(input)) {
    return json({ type: "chitchat", intent: { type: "chitchat", keywords: [], summary: input }, reply: "你好！你可以直接记录一段知识，也可以向当前知识库提问。回答会优先引用已有节点。" });
  }
  const state = loadState();
  const mapId = body.mapId || "map_default";
  const mapNodes = state.nodes[mapId] || [];
  const articleTask = body.mode === "article" ? classifyLocalArticleTask(input) : null;
  const isQuestion = Boolean(articleTask) || /[?？]$/.test(input) || /^(什么|如何|怎么|为什么|哪些|是否|能否|请问)/.test(input);
  if (isQuestion) {
    if (articleTask === "translate") {
      return json({
        type: "question",
        intent: { type: "question", task: "translate", confidence: 0.98 },
        reply: "已识别为翻译任务。本地演示模式只保存知识节点，不保存可供逐段翻译的论文原文；请登录云端版并先保存论文，再指定摘要、章节或页码。",
        sources: [],
        retrievalTrace: { mode: "article_translation", task: "translate", seedNodes: 0, expandedNodes: 0, graphDocuments: 0, candidateChunks: 0 },
      });
    }
    const hits = search(mapNodes, input);
    if (!hits.length) {
      return json({
        type: "question",
        intent: { type: "question", task: articleTask || "qa", keywords: terms(input), summary: input },
        reply: articleTask
          ? "## 结论\n\n**当前证据不足，暂时无法可靠回答。**\n\n## 建议\n\n- 补充相关论文或原文分块\n- 缩小问题范围后重新提问\n\n## 局限与待核验\n\n本地知识库没有命中可核验内容，因此不会用猜测补全答案。"
          : "当前知识库里还没有足够证据回答这个问题。\n\n你可以补充相关资料，或把问题改写为一条知识记录；我不会在没有依据时编造答案。",
        retrieval: { mode: "local", hits: [] },
      });
    }
    const evidence = hits.map(({ item }, index) => `**[${index + 1}] ${item.content}**\n${item.desc || "该节点暂无补充说明"}`).join("\n\n");
    return json({
      type: "question",
      intent: { type: "question", task: articleTask || "qa", keywords: terms(input), summary: input },
      reply: articleTask
        ? `## 结论\n\n当前知识库找到 **${hits.length} 条直接相关依据**，可以据此继续核对问题。\n\n## 关键依据\n\n${evidence}\n\n## 局限与待核验\n\n以上回答仅基于当前知识库节点；建议打开导图核对上下文。`
        : `根据当前知识库，找到 ${hits.length} 条相关依据：\n\n${evidence}\n\n_以上回答仅基于当前知识库节点；建议打开导图核对上下文。_`,
      retrieval: { mode: "local", hits: hits.map(({ item, score }) => ({ id: item.id, title: item.content, score })) },
    });
  }
  const mindMap = generateLocalMindMap(input);
  const closestTopic = mapNodes
    .filter((node) => node.type === "topic")
    .map((node) => ({ node, score: Math.max(contentSimilarity(input, node.content), contentSimilarity(mindMap.root, node.content)) }))
    .sort((a, b) => b.score - a.score)[0];
  const placement = closestTopic && closestTopic.score >= 0.2
    ? { targetTopic: closestTopic.node.content, confidence: Math.min(0.95, 0.55 + closestTopic.score / 2), reason: "与已有主题共享关键词，保存时将复用相似分支" }
    : null;
  return json({
    type: "knowledge",
    intent: { type: "knowledge", keywords: terms(input), topic: mindMap.root, summary: compact(input, 60) },
    reply: placement
      ? `已把内容整理为可编辑结构，并识别到它与「${placement.targetTopic}」相关；保存时会自动复用相似节点。`
      : "已把这段内容整理为可编辑的知识结构。它与现有主题关联较弱，将保留为独立主题。",
    placement,
    mindMap,
  });
}

function buildLocalEntityGraph(mindMap: AIMindMap): AIEntityGraph {
  const entities: AIEntityGraph["entities"] = [{
    tempId: "E1",
    name: mindMap.root,
    type: "concept",
    aliases: [],
    description: mindMap.rootDesc || "",
    descriptionEvidence: mindMap.rootCitationIndexes || [],
    citationIndexes: mindMap.rootCitationIndexes || [],
    confidence: 0.9,
  }];
  const relations: AIEntityGraph["relations"] = [];
  (mindMap.children || []).slice(0, 16).forEach((child, index) => {
    const tempId = `E${index + 2}`;
    entities.push({
      tempId,
      name: child.topic,
      type: "concept",
      aliases: [],
      description: child.desc || "",
      descriptionEvidence: child.citationIndexes || [],
      citationIndexes: child.citationIndexes || [],
      confidence: 0.8,
    });
    relations.push({
      source: "E1",
      target: tempId,
      type: "contains_concept",
      shortLabel: "包含概念",
      explanation: `${mindMap.root} 的知识结构包含 ${child.topic} 这一直接子主题。`,
      status: "asserted",
      citationIndexes: child.citationIndexes || [],
      confidence: 0.75,
    });
  });
  return { entities, relations };
}

function localCitationAudit(
  claims: { id: string; section: string; text: string; citationIndexes: number[]; critical?: boolean }[],
  citations: Citation[],
) {
  const perClaim = claims.filter((claim) => claim.text.trim()).map((claim, index) => {
    const citationIndexes = Array.from(new Set(claim.citationIndexes.filter((item) => Number.isInteger(item) && item > 0)));
    const supported = citationIndexes.length > 0;
    return { index, ...claim, critical: claim.critical !== false, citationIndexes, supported, status: supported ? "supported" : "unsupported" };
  });
  const supported = perClaim.filter((claim) => claim.supported);
  const critical = perClaim.filter((claim) => claim.critical);
  const supportedCritical = critical.filter((claim) => claim.supported);
  const refusalReason = critical.length > 0 && supportedCritical.length === 0 ? "ALL_KEY_CLAIMS_UNSUPPORTED" : null;
  const warnings = [];
  if (supported.length < perClaim.length) warnings.push(`${perClaim.length - supported.length} 条结论缺少足够直接证据，已逐条标记而不是强行配引`);
  if (refusalReason) warnings.push("关键结论全部缺少直接证据，已拒绝输出事实性结论");
  return {
    claimCount: perClaim.length,
    citedClaimCount: supported.length,
    unsupportedClaimCount: perClaim.length - supported.length,
    coverage: perClaim.length ? supported.length / perClaim.length : 1,
    criticalClaimCount: critical.length,
    supportedCriticalClaimCount: supportedCritical.length,
    unsupportedCriticalClaimCount: critical.length - supportedCritical.length,
    verifiedQuoteCount: citations.length,
    perClaim,
    refusalReason,
    warnings,
  };
}

function handleLocalTool(path: string, init?: RequestInit): Response {
  const body = bodyOf(init);
  const toolPath = new URL(path, "http://mindgrow.local").pathname;
  if (toolPath.endsWith("/meeting")) {
    const transcript = String(body.transcript || "").trim();
    if (transcript.length < 10) return json({ error: "请至少输入 10 个字的会议内容" }, 400);
    const mindMap = generateLocalMindMap(transcript);
    mindMap.root = String(body.title || mindMap.root || "会议纪要");
    const excerpts = transcript.split(/\n+|(?<=[。！？!?])\s*/).map((item) => item.trim()).filter((item) => item.length >= 4);
    const citations: Citation[] = excerpts.map((quote, index) => ({ index: index + 1, quote, locator: `会议原文第 ${index + 1} 句`, sourceType: "meeting" }));
    mindMap.rootCitationIndexes = citations.length ? [1] : [];
    mindMap.children = mindMap.children.map((child, index) => ({ ...child, citationIndexes: citations.length ? [Math.min(index + 1, citations.length)] : [], itemCitationIndexes: child.items.map((_, itemIndex) => citations.length ? [Math.min(index + itemIndex + 1, citations.length)] : []) }));
    const summary = mindMap.rootDesc || "";
    const summaryCitationIndexes = citations.length ? [1] : [];
    const openQuestions = [{ text: "本地演示模式未调用云端模型，请登录云端版获得完整提取结果", citationIndexes: [] }];
    return json({
      title: mindMap.root,
      summary,
      summaryCitationIndexes,
      topics: mindMap.children.map((child) => ({ title: child.topic, citationIndexes: child.citationIndexes, details: child.items.map((text, itemIndex) => ({ text, citationIndexes: child.itemCitationIndexes?.[itemIndex] || [] })) })),
      decisions: [],
      actionItems: [],
      risks: [],
      openQuestions,
      mindMap,
      entityGraph: buildLocalEntityGraph(mindMap),
      citations,
      documentChunks: citations,
      citationAudit: localCitationAudit([
        { id: "summary", section: "conclusion", text: summary, citationIndexes: summaryCitationIndexes },
        { id: "open-question-1", section: "extension", text: openQuestions[0].text, citationIndexes: [], critical: false },
      ], citations),
    });
  }
  if (toolPath.endsWith("/article")) {
    const content = String(body.content || "").trim();
    if (content.length < 50) return json({ error: "本地模式请粘贴至少 50 个字的文章正文" }, 400);
    const mindMap = generateLocalMindMap(content);
    const citations = buildLocalArticleCitations(content, body.sourceType || "text", body.fileName, 8);
    const cited = (index: number) => citations.length ? [citations[index % citations.length].index] : [];
    mindMap.rootCitationIndexes = cited(0);
    mindMap.children = mindMap.children.map((child, index) => ({ ...child, citationIndexes: cited(index), itemCitationIndexes: child.items.map((_, itemIndex) => cited(index + itemIndex)) }));
    const summary = mindMap.rootDesc || "";
    const keyPoints = mindMap.children.flatMap((child, index) => child.items.map((text, itemIndex) => ({ text, citationIndexes: cited(index + itemIndex) }))).slice(0, 10);
    const auditClaims = [
      { id: "summary", section: "conclusion", text: summary, citationIndexes: cited(0) },
      ...keyPoints.map((item, index) => ({ id: `key-point-${index + 1}`, section: "conclusion", text: item.text, citationIndexes: item.citationIndexes })),
      { id: "mind-map-root", section: "structure", text: `${mindMap.root} ${mindMap.rootDesc || ""}`, citationIndexes: mindMap.rootCitationIndexes || [], critical: false },
      ...mindMap.children.map((child, index) => ({ id: `mind-map-branch-${index + 1}`, section: "structure", text: `${child.topic} ${child.desc || ""}`, citationIndexes: child.citationIndexes || [], critical: false })),
    ];
    return json({
      title: mindMap.root,
      summary,
      summaryCitationIndexes: cited(0),
      keyPoints,
      arguments: [],
      questions: ["文章有哪些适用边界？"],
      mindMap,
      entityGraph: buildLocalEntityGraph(mindMap),
      citations,
      documentChunks: citations,
      citationAudit: localCitationAudit(auditClaims, citations),
      extraction: body.extraction || { pageCount: 0, tablePages: [], imagePages: [], scannedPages: [], truncated: false },
      sourceUrl: body.url || "",
      sourceType: body.sourceType || "text",
      fileName: body.fileName || "",
      mimeType: body.mimeType || "",
    });
  }
  if (toolPath.endsWith("/audio-overview")) {
    const keyPoints = Array.isArray(body.keyPoints) ? body.keyPoints : [];
    const segments = keyPoints.slice(0, 6).map((item, index) => ({
      speaker: index % 2 === 0 ? "主持人" : "分析师",
      text: `${index === 0 ? "先看核心结论：" : "接着来看："}${String(item.text || item)}`,
      citationIndexes: Array.isArray(item.citationIndexes) ? item.citationIndexes : [],
    }));
    return json({ title: String(body.title || "文章音频概览"), intro: "根据文章引用生成的双角色概览。", segments, synthesis: "browser" });
  }
  return json({ error: "Tool not found" }, 404);
}

export const IS_LOCAL_MODE = !API_BASE_URL;

export interface ApiFetchOptions extends RequestInit {
  writeForMapId?: string;
}

let networkListenerUsers = 0;
let removeNetworkListeners: (() => void) | null = null;

export function retainNetworkStatusListener(): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};
  networkListenerUsers += 1;
  if (!removeNetworkListeners) {
    const update = () => useMindGrowStore.getState().setNetworkOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    removeNetworkListeners = () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    networkListenerUsers = Math.max(0, networkListenerUsers - 1);
    if (networkListenerUsers === 0 && removeNetworkListeners) {
      removeNetworkListeners();
      removeNetworkListeners = null;
    }
  };
}

export function sanitizeWriteErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || "写入失败");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(/\b(?:authorization|apikey|api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 180);
}

function beginTrackedWrite(mapId: string | undefined, scope: TenantScope | null): WriteRequestToken | null {
  if (!mapId?.trim() || !scope) return null;
  return useMindGrowStore.getState().beginWrite(mapId, scope);
}

function finishTrackedWrite(token: WriteRequestToken | null, response?: Response, error?: unknown): void {
  if (!token) return;
  if (error instanceof Error && error.name === "AbortError") {
    useMindGrowStore.getState().endWrite(token, { ok: false, cancelled: true });
    return;
  }
  if (error) {
    useMindGrowStore.getState().endWrite(token, {
      ok: false,
      code: error instanceof Error ? error.name : "NETWORK_ERROR",
      message: sanitizeWriteErrorMessage(error),
    });
    return;
  }
  if (response?.ok) {
    useMindGrowStore.getState().endWrite(token, { ok: true });
    return;
  }
  useMindGrowStore.getState().endWrite(token, {
    ok: false,
    code: response ? `HTTP_${response.status}` : "WRITE_FAILED",
    message: response ? `写入失败（HTTP ${response.status}）` : "写入失败",
  });
}

export async function apiFetch(path: string, options?: ApiFetchOptions): Promise<Response> {
  const { writeForMapId, ...init } = options || {};
  const method = (init.method || "GET").toUpperCase();
  const trackedMapId = method === "GET" || method === "HEAD" ? undefined : writeForMapId;
  if (API_BASE_URL) {
    const storedWorkspaceId = activeWorkspaceId || (typeof window !== "undefined" ? window.localStorage.getItem("mindgrow.workspace.v1") : null);
    const writeScope = activeUserId && storedWorkspaceId ? { userId: activeUserId, workspaceId: storedWorkspaceId } : null;
    // Capture the local edit version at the API call boundary. Waiting for
    // getSession first would let a newer edit be mistaken for the payload
    // already being sent by this request.
    const writeToken = beginTrackedWrite(trackedMapId, writeScope);
    try {
      const { data } = await supabase.auth.getSession();
      const headers = new Headers(init?.headers);
      if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
      if (storedWorkspaceId) headers.set("X-Workspace-Id", storedWorkspaceId);
      const response = await fetch(`${API_BASE_URL}${path}`, { ...init, cache: "no-store", headers });
      finishTrackedWrite(writeToken, response);
      return response;
    } catch (error) {
      finishTrackedWrite(writeToken, undefined, error);
      throw error;
    }
  }
  if (typeof window === "undefined") return fetch(path, init);
  // Local mode resolves API calls in memory, so browser Network tooling cannot
  // observe duplicate loader calls. Emit metadata-only diagnostics for local
  // regression tests; the hosted API path above never emits this event.
  window.dispatchEvent(new CustomEvent("mindgrow:local-api-request", {
    detail: { path, method: (init?.method || "GET").toUpperCase() },
  }));
  const writeToken = beginTrackedWrite(trackedMapId, { userId: "local-user", workspaceId: "local-workspace" });
  try {
    let response: Response;
    if (path.startsWith("/api/knowledge")) response = handleKnowledge(path, init);
    else if (path.startsWith("/api/chat")) response = handleChat(init);
    else if (path.startsWith("/api/tools/")) response = handleLocalTool(path, init);
    else response = await fetch(path, init);
    finishTrackedWrite(writeToken, response);
    return response;
  } catch (error) {
    finishTrackedWrite(writeToken, undefined, error);
    throw error;
  }
}
