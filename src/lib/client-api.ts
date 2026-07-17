import { API_BASE_URL } from "@/lib/config";
import { supabase } from "@/lib/supabase-browser";
import type { AIMindMap, Category, Citation, KnowledgeEdge, KnowledgeNode, MindMap } from "@/types";

const STORAGE_KEY = "mindgrow.local.v2";
let activeWorkspaceId: string | null = null;

export function setActiveWorkspaceId(workspaceId: string | null) {
  activeWorkspaceId = workspaceId;
}

type LocalState = {
  version: 2;
  maps: MindMap[];
  categories: Category[];
  nodes: Record<string, KnowledgeNode[]>;
  edges: Record<string, KnowledgeEdge[]>;
  layouts: Record<string, { x: number; y: number }>;
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
    layouts: {},
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
    return json({ nodes: state.nodes[mapId] || [], edges: state.edges[mapId] || [] });
  }

  if (method === "DELETE") {
    const nodeId = url.searchParams.get("nodeId");
    if (!nodeId) return json({ error: "nodeId is required" }, 400);
    for (const map of state.maps) {
      state.nodes[map.id] = (state.nodes[map.id] || []).filter((item) => item.id !== nodeId);
      state.edges[map.id] = (state.edges[map.id] || []).filter((item) => item.sourceId !== nodeId && item.targetId !== nodeId);
      updateMapCount(state, map.id);
    }
    saveState(state);
    return json({ success: true });
  }

  const body = bodyOf(init);
  if (method === "PUT") {
    if (body.nodeId) state.layouts[body.nodeId] = { x: body.positionX || 0, y: body.positionY || 0 };
    saveState(state);
    return json({ success: true });
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
  if (action === "createMap") {
    const timestamp = now();
    const map: MindMap = {
      id: makeId("map"), name: body.name || "新知识库", description: body.description || "",
      color: body.color || "#22d3a7", isDefault: false, categoryId: body.categoryId || null,
      nodeCount: 0, createdAt: timestamp, updatedAt: timestamp,
    };
    state.maps.unshift(map); state.nodes[map.id] = []; state.edges[map.id] = [];
    saveState(state);
    return json({ map });
  }
  if (action === "createFromTemplate") {
    if (!body.template?.root) return json({ error: "Invalid template data" }, 400);
    const timestamp = now();
    const map: MindMap = {
      id: makeId("map"), name: body.name || body.template.root, description: body.description || "",
      color: body.color || "#22d3a7", isDefault: false, categoryId: body.categoryId || null,
      nodeCount: 0, createdAt: timestamp, updatedAt: timestamp,
    };
    state.maps.unshift(map); state.nodes[map.id] = []; state.edges[map.id] = [];
    addMindMap(state, map.id, body.template, "ai_generated");
    saveState(state);
    return json({ map });
  }
  if (action === "deleteMap") {
    const map = state.maps.find((item) => item.id === body.mapId);
    if (!map || map.isDefault) return json({ error: "Cannot delete default map" }, 400);
    state.maps = state.maps.filter((item) => item.id !== body.mapId);
    delete state.nodes[body.mapId]; delete state.edges[body.mapId];
    saveState(state);
    return json({ success: true });
  }
  if (action === "clearMap") {
    state.nodes[body.mapId] = []; state.edges[body.mapId] = []; updateMapCount(state, body.mapId);
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
    const targetTopic = body.placement?.confidence >= 0.45 ? String(body.placement.targetTopic || "") : "";
    const result = addMindMap(state, mapId, body.mindMap, body.source || "ai_generated", body.citations || [], targetTopic);
    saveState(state);
    return json({
      node: result.root,
      additionalNodes: result.createdNodes.filter((node) => node.id !== result.root.id),
      additionalEdges: result.createdEdges,
      totalNodes: result.createdNodes.length,
      totalEdges: result.createdEdges.length,
      reusedNodes: result.reusedNodes.length,
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
  if (/(翻译|翻成|译成|translate|translation)/i.test(input)) return "translate";
  if (/(总结|概括|摘要|summari[sz]e|summary)/i.test(input)) return "summarize";
  if (/(比较|对比|区别|compare|comparison|\bvs\.?\b)/i.test(input)) return "compare";
  if (/(提取|抽取|列出|extract)/i.test(input)) return "extract";
  if (/(解释|解读|讲解|explain|interpret)/i.test(input)) return "explain";
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
    return json({
      title: mindMap.root,
      summary: mindMap.rootDesc || "",
      summaryCitationIndexes: citations.length ? [1] : [],
      topics: mindMap.children.map((child) => ({ title: child.topic, citationIndexes: child.citationIndexes, details: child.items.map((text, itemIndex) => ({ text, citationIndexes: child.itemCitationIndexes?.[itemIndex] || [] })) })),
      decisions: [],
      actionItems: [],
      risks: [],
      openQuestions: [{ text: "本地演示模式未调用云端模型，请登录云端版获得完整提取结果", citationIndexes: [] }],
      mindMap,
      citations,
      documentChunks: citations,
      citationAudit: { claimCount: 1, citedClaimCount: citations.length ? 1 : 0, coverage: citations.length ? 1 : 0, verifiedQuoteCount: citations.length, warnings: [] },
    });
  }
  if (toolPath.endsWith("/article")) {
    const content = String(body.content || "").trim();
    if (content.length < 50) return json({ error: "本地模式请粘贴至少 50 个字的文章正文" }, 400);
    const mindMap = generateLocalMindMap(content);
    const excerpts = content.split(/\n+|(?<=[。！？!?])\s*/).map((item) => item.trim()).filter((item) => item.length >= 12).slice(0, 8);
    const citations: Citation[] = excerpts.map((quote, index) => ({ index: index + 1, quote: quote.slice(0, 180), locator: `原文片段 ${index + 1}`, sourceType: body.sourceType || "text", fileName: body.fileName }));
    const cited = (index: number) => citations.length ? [citations[index % citations.length].index] : [];
    mindMap.rootCitationIndexes = cited(0);
    mindMap.children = mindMap.children.map((child, index) => ({ ...child, citationIndexes: cited(index), itemCitationIndexes: child.items.map((_, itemIndex) => cited(index + itemIndex)) }));
    return json({
      title: mindMap.root,
      summary: mindMap.rootDesc || "",
      summaryCitationIndexes: cited(0),
      keyPoints: mindMap.children.flatMap((child, index) => child.items.map((text, itemIndex) => ({ text, citationIndexes: cited(index + itemIndex) }))).slice(0, 10),
      arguments: [],
      questions: ["文章有哪些适用边界？"],
      mindMap,
      citations,
      documentChunks: citations,
      citationAudit: { claimCount: 1 + mindMap.children.length, citedClaimCount: citations.length ? 1 + mindMap.children.length : 0, coverage: citations.length ? 1 : 0, verifiedQuoteCount: citations.length, warnings: [] },
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

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (API_BASE_URL) {
    const { data } = await supabase.auth.getSession();
    const headers = new Headers(init?.headers);
    if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    const workspaceId = activeWorkspaceId || (typeof window !== "undefined" ? window.localStorage.getItem("mindgrow.workspace.v1") : null);
    if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
    return fetch(`${API_BASE_URL}${path}`, { ...init, cache: "no-store", headers });
  }
  if (typeof window === "undefined") return fetch(path, init);
  if (path.startsWith("/api/knowledge")) return handleKnowledge(path, init);
  if (path.startsWith("/api/chat")) return handleChat(init);
  if (path.startsWith("/api/tools/")) return handleLocalTool(path, init);
  return fetch(path, init);
}
