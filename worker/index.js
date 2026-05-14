// MindGrow API Worker — Cloudflare Workers
// Handles /api/knowledge (Supabase) + /api/chat (DashScope AI)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Supabase REST helpers
function supabaseUrl(env) { return `${env.SUPABASE_URL}/rest/v1`; }

function supabaseHeaders(env) {
  return {
    'apikey': env.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
  };
}

async function sbGet(env, table, query) {
  const url = `${supabaseUrl(env)}/${table}?${query}`;
  const res = await fetch(url, { headers: supabaseHeaders(env) });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function sbPost(env, table, body, prefer = 'return=minimal') {
  const res = await fetch(`${supabaseUrl(env)}/${table}`, {
    method: 'POST',
    headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json', 'Prefer': prefer },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase POST ${table}: ${text}`);
  return prefer.includes('representation') ? (text ? JSON.parse(text) : null) : true;
}

async function sbPatch(env, table, body, query) {
  const res = await fetch(`${supabaseUrl(env)}/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function sbDelete(env, table, query) {
  const res = await fetch(`${supabaseUrl(env)}/${table}?${query}`, {
    method: 'DELETE',
    headers: supabaseHeaders(env),
  });
  return res.ok;
}

async function sbCount(env, table, query) {
  const url = `${supabaseUrl(env)}/${table}?${query}`;
  const res = await fetch(url, {
    headers: { ...supabaseHeaders(env), 'Prefer': 'count=exact' },
  });
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)$/);
    if (m) return parseInt(m[1]);
  }
  return 0;
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Entry
// ============================================================
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const body = request.method !== 'GET' && request.method !== 'DELETE' ? await request.json() : {};

      if (path.startsWith('/api/knowledge')) {
        if (request.method === 'GET') return handleKnowledgeGET(url, env);
        if (request.method === 'POST') return handleKnowledgePOST(body, env);
        if (request.method === 'PUT') return handleKnowledgePUT(body, env);
        if (request.method === 'DELETE') return handleKnowledgeDELETE(url, env);
        if (request.method === 'PATCH') return handleKnowledgePATCH(body, env);
      }

      if (path.startsWith('/api/chat')) {
        if (request.method === 'POST') return handleChatPOST(body, env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err.message, err.stack);
      return json({ error: 'Server error', detail: err.message }, 500);
    }
  },
};

// ============================================================
// /api/knowledge GET
// ============================================================
async function handleKnowledgeGET(url, env) {
  const action = url.searchParams.get('action');
  const mapId = url.searchParams.get('mapId') || 'map_default';

  if (action === 'maps') {
    const maps = await sbGet(env, 'maps', `select=*&order=is_default.desc,updated_at.desc`);
    return json({ maps: (maps || []).map(rowToMap) });
  }

  if (action === 'categories') {
    const cats = await sbGet(env, 'categories', `select=*&order=sort_order.asc`);
    return json({ categories: (cats || []).map(rowToCat) });
  }

  const [nodes, edges] = await Promise.all([
    sbGet(env, 'nodes', `select=*&map_id=eq.${mapId}&status=eq.active&order=created_at.asc`),
    sbGet(env, 'edges', `select=*&map_id=eq.${mapId}&order=created_at.asc`),
  ]);
  return json({ nodes: (nodes || []).map(rowToNode), edges: (edges || []).map(rowToEdge) });
}

// ============================================================
// /api/knowledge POST
// ============================================================
async function handleKnowledgePOST(body, env) {
  const { action } = body;
  const now = new Date().toISOString();

  if (action === 'createMap') {
    const id = genId('map');
    await sbPost(env, 'maps', {
      id, name: body.name || '新知识库', description: body.description || '',
      color: body.color || '#22d3a7', is_default: false, node_count: 0,
      category_id: body.categoryId || null, created_at: now, updated_at: now,
    });
    return json({ map: { id, name: body.name || '新知识库', description: body.description || '',
      color: body.color || '#22d3a7', isDefault: false, categoryId: body.categoryId || null,
      nodeCount: 0, createdAt: now, updatedAt: now } });
  }

  if (action === 'deleteMap') {
    const mapId = body.mapId;
    if (!mapId || mapId === 'map_default') return json({ error: 'Cannot delete default map' }, 400);
    await sbDelete(env, 'maps', `id=eq.${mapId}&is_default=eq.false`);
    return json({ success: true });
  }

  if (action === 'renameMap') {
    await sbPatch(env, 'maps', { name: body.name, updated_at: now }, `id=eq.${body.mapId}`);
    return json({ success: true });
  }

  if (action === 'clearMap') {
    const mapId = body.mapId;
    if (mapId === 'map_default') return json({ error: 'Cannot clear default map' }, 400);
    await Promise.all([
      sbDelete(env, 'edges', `map_id=eq.${mapId}`),
      sbDelete(env, 'nodes', `map_id=eq.${mapId}`),
      sbPatch(env, 'maps', { node_count: 0, updated_at: now }, `id=eq.${mapId}`),
    ]);
    return json({ success: true });
  }

  if (action === 'createCategory') {
    const existing = await sbGet(env, 'categories', 'select=sort_order&order=sort_order.desc&limit=1');
    const nextOrder = (existing && existing[0] ? existing[0].sort_order || 0 : 0) + 1;
    const id = genId('cat');
    const cat = await sbPost(env, 'categories', {
      id, name: body.name || '新文件夹', icon: body.icon || '📁',
      sort_order: nextOrder, created_at: now,
    }, 'return=representation');
    if (cat && cat.length) return json({ category: rowToCat(cat[0]) });
    return json({ category: { id, name: body.name, icon: body.icon, sortOrder: nextOrder, createdAt: now } });
  }

  if (action === 'deleteCategory') {
    await Promise.all([
      sbPatch(env, 'maps', { category_id: null, updated_at: now }, `category_id=eq.${body.categoryId}`),
      sbDelete(env, 'categories', `id=eq.${body.categoryId}`),
    ]);
    return json({ success: true });
  }

  if (action === 'renameCategory') {
    await sbPatch(env, 'categories', { name: body.name }, `id=eq.${body.categoryId}`);
    return json({ success: true });
  }

  if (action === 'moveMapToCategory') {
    await sbPatch(env, 'maps', { category_id: body.categoryId || null, updated_at: now }, `id=eq.${body.mapId}`);
    return json({ success: true });
  }

  // Handle AI mind map creation
  const { mindMap } = body;
  if (mindMap && mindMap.root) return handleMindMapCreate(body, env, now);

  return json({ error: 'Invalid action' }, 400);
}

async function handleMindMapCreate(body, env, now) {
  const { mindMap, mapId: cMapId, source, parentId, position } = body;
  const mapId = cMapId || 'map_default';

  // Sort children by topic for consistent ordering
  const children = [...(mindMap.children || [])];
  children.sort((a, b) => a.topic.localeCompare(b.topic));

  // Create all nodes
  const rootId = genId('node');
  const nodeInserts = [];
  const edgeInserts = [];

  // Root
  nodeInserts.push({
    id: rootId, map_id: mapId, content: mindMap.root, desc: mindMap.rootDesc || '',
    type: 'topic', status: 'active', source: source || 'manual', confidence: 1.0,
    created_at: now, updated_at: now,
  });

  // Children & items (sequential order preserves logical grouping)
  for (const child of children) {
    const childId = genId('node');
    nodeInserts.push({
      id: childId, map_id: mapId, content: child.topic, desc: child.desc || '',
      type: 'concept', status: 'active', source: 'ai_generated', confidence: 0.8,
      created_at: now, updated_at: now,
    });
    edgeInserts.push({
      id: genId('edge'), map_id: mapId, source_id: rootId, target_id: childId,
      relation: 'contains', weight: 1.0, created_at: now,
    });

    for (const item of (child.items || [])) {
      const itemId = genId('node');
      nodeInserts.push({
        id: itemId, map_id: mapId, content: item, desc: '',
        type: 'detail', status: 'active', source: 'ai_generated', confidence: 0.6,
        created_at: now, updated_at: now,
      });
      edgeInserts.push({
        id: genId('edge'), map_id: mapId, source_id: childId, target_id: itemId,
        relation: 'contains', weight: 0.8, created_at: now,
      });
    }
  }

  // Link to parent
  if (parentId) {
    edgeInserts.push({
      id: genId('edge'), map_id: mapId, source_id: parentId, target_id: rootId,
      relation: 'contains', weight: 1.0, created_at: now,
    });
  }

  // Batch inserts in chunks (Supabase REST has limits on batch size)
  const chunkSize = 50;
  for (let i = 0; i < nodeInserts.length; i += chunkSize) {
    await sbPost(env, 'nodes', nodeInserts.slice(i, i + chunkSize));
  }
  for (let i = 0; i < edgeInserts.length; i += chunkSize) {
    await sbPost(env, 'edges', edgeInserts.slice(i, i + chunkSize));
  }

  // Save layout
  if (position) {
    await sbPost(env, 'node_layouts', {
      node_id: rootId, map_id: mapId, position_x: position.x, position_y: position.y, zoom_level: 1,
    }, 'resolution=merge-duplicates');
  }

  // Update node count
  const count = nodeInserts.length;
  await sbPatch(env, 'maps', { node_count: count, updated_at: now }, `id=eq.${mapId}`);

  return json({ node: { id: rootId, content: mindMap.root }, totalNodes: count, totalEdges: edgeInserts.length });
}

// ============================================================
// /api/knowledge PUT
// ============================================================
async function handleKnowledgePUT(body, env) {
  const { nodeId, mapId, positionX, positionY } = body;
  if (!nodeId) return json({ error: 'nodeId required' }, 400);
  await sbPost(env, 'node_layouts', {
    node_id: nodeId, map_id: mapId || 'map_default', position_x: positionX, position_y: positionY, zoom_level: 1,
  }, 'resolution=merge-duplicates');
  return json({ success: true });
}

// ============================================================
// /api/knowledge DELETE
// ============================================================
async function handleKnowledgeDELETE(url, env) {
  const nodeId = url.searchParams.get('nodeId');
  if (!nodeId) return json({ error: 'nodeId required' }, 400);
  const now = new Date().toISOString();
  await Promise.all([
    sbPatch(env, 'nodes', { status: 'deleted', updated_at: now }, `id=eq.${nodeId}`),
    sbDelete(env, 'edges', `source_id=eq.${nodeId}`),
    sbDelete(env, 'edges', `target_id=eq.${nodeId}`),
    sbDelete(env, 'node_layouts', `node_id=eq.${nodeId}`),
  ]);
  return json({ success: true });
}

// ============================================================
// /api/knowledge PATCH
// ============================================================
async function handleKnowledgePATCH(body, env) {
  const { nodeId, content, desc, type, status } = body;
  if (!nodeId) return json({ error: 'nodeId required' }, 400);
  const updates = { updated_at: new Date().toISOString() };
  if (content !== undefined) updates.content = content;
  if (desc !== undefined) updates.desc = desc;
  if (type !== undefined) updates.type = type;
  if (status !== undefined) updates.status = status;
  await sbPatch(env, 'nodes', updates, `id=eq.${nodeId}`);
  return json({ success: true });
}

// ============================================================
// /api/chat POST
// ============================================================
async function handleChatPOST(body, env) {
  const { input, mapId } = body;
  if (!input) return json({ error: 'Input required' }, 400);
  const currentMapId = mapId || 'map_default';

  const intent = await classifyIntent(input, env);

  if (intent.type === 'chitchat') {
    const replies = ['好的，想到什么就输入什么 🌱', '我在这里，随时帮你整理知识', '有什么灵感就随手记下来吧'];
    return json({ intent, reply: replies[Math.floor(Math.random() * replies.length)], type: 'chitchat' });
  }

  if (intent.type === 'command') {
    return json({ intent, reply: '指令功能开发中，敬请期待 🔧', type: 'command' });
  }

  const nodes = await sbGet(env, 'nodes', `select=content&map_id=eq.${currentMapId}&status=eq.active&type=eq.topic`);
  const existingTopics = (nodes || []).map(n => n.content);

  const mindMap = await generateMindMap(input, existingTopics, env);
  if (!mindMap) {
    return json({ intent, reply: '😅 我没能理解这段内容，能换个说法试试吗？', type: 'knowledge', placement: null, mindMap: null });
  }

  const placement = await suggestPlacement(input, existingTopics, env);

  let reply = '';
  if (placement && existingTopics.length > 0) {
    reply = `📌 我建议将这段内容整合到「${placement.targetTopic}」下\n\n`;
  } else {
    reply = `🌱 新的知识结构：\n\n`;
  }
  reply += `🔹 **${mindMap.root}**\n`;
  if (mindMap.rootDesc) reply += `   _${mindMap.rootDesc}_\n`;
  for (const child of (mindMap.children || [])) {
    reply += `  ├─ ${child.topic}`;
    if (child.desc) reply += ` — ${child.desc}`;
    reply += `\n`;
    for (const item of (child.items || [])) reply += `  │  ├─ ${item}\n`;
  }
  if (mindMap.relatedTopics?.length) reply += `\n🔗 可能关联：${mindMap.relatedTopics.join('、')}`;
  reply += `\n\n确认后将自动创建以上所有节点`;

  return json({ intent, reply, type: 'knowledge', placement, mindMap });
}

// ============================================================
// DashScope AI helpers
// ============================================================
async function dashscopeChat(messages, model, maxTokens, temperature, env) {
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'API error');
  return { content: json.choices?.[0]?.message?.content || '' };
}

async function classifyIntent(input, env) {
  const msgs = [
    { role: 'system', content: '判断输入意图，仅返回 JSON: {"type":"knowledge|question|chitchat|command","keywords":["k1","k2"],"summary":"概括"}' },
    { role: 'user', content: input },
  ];
  try {
    const r = await dashscopeChat(msgs, 'qwen-turbo', 100, 0.1, env);
    return JSON.parse(r.content);
  } catch {
    if (/[？?]$/.test(input) || /^(what|how|why|什么时候|怎么|为什么)/i.test(input)) return { type: 'question', keywords: [], summary: '提问' };
    if (/^(你好|谢谢|嗯|好的|ok|哈哈|hi|hello)/i.test(input)) return { type: 'chitchat', keywords: [], summary: '闲聊' };
    return { type: 'knowledge', keywords: [], summary: '知识点' };
  }
}

async function generateMindMap(input, existingTopics, env) {
  const prompt = `你是知识图谱助手。将用户输入整理为结构化思维导图，只返回 JSON：
{"root":"核心主题(≤10字)","rootDesc":"定义(10-25字)","children":[{"topic":"子主题(3-10字)","desc":"说明(10-25字)","items":["概念A","概念B"]}]}
规则：3-5子主题，每子2-3概念，总10-18节点，2层结构，不复制原文长句。
已知主题：${existingTopics.join('、') || '（空）'}`;

  try {
    const r = await dashscopeChat([{ role: 'system', content: prompt }, { role: 'user', content: input }], 'qwen-plus', 1500, 0.3, env);
    let t = r.content.trim();
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) t = m[1].trim();
    return JSON.parse(t);
  } catch { return null; }
}

async function suggestPlacement(input, existingTopics, env) {
  if (!existingTopics.length) return null;
  const prompt = `判断最适合归类到哪个已有主题。\n已有主题：${existingTopics.join('、')}\n\n返回 JSON：{"target":"主题名","confidence":0.0~1.0,"reason":"理由"}\n不匹配返回：{"target":null,"confidence":0,"reason":"不匹配"}`;
  try {
    const r = await dashscopeChat([{ role: 'system', content: prompt }, { role: 'user', content: input }], 'qwen-turbo', 200, 0.2, env);
    const result = JSON.parse(r.content);
    return result.target ? { targetTopic: result.target, confidence: result.confidence, reason: result.reason } : null;
  } catch { return null; }
}

// ============================================================
// Row mappers
// ============================================================
function rowToMap(r) { return { id: r.id, name: r.name, description: r.description || '', color: r.color || '#22d3a7', isDefault: r.is_default, categoryId: r.category_id || null, nodeCount: r.node_count || 0, createdAt: r.created_at, updatedAt: r.updated_at }; }
function rowToNode(r) { return { id: r.id, content: r.content, desc: r.desc || '', type: r.type, status: r.status, source: r.source, confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at }; }
function rowToEdge(r) { return { id: r.id, sourceId: r.source_id, targetId: r.target_id, relation: r.relation, weight: r.weight, createdAt: r.created_at }; }
function rowToCat(r) { return { id: r.id, name: r.name, icon: r.icon || '📁', color: r.color || '#22d3a7', sortOrder: r.sort_order || 0, createdAt: r.created_at }; }
