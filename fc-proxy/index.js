// MindGrow API Proxy - Alibaba Cloud FC Web Function
// Proxies: /api/chat → DashScope (intent + mind map generation + placement)
//          /api/knowledge → Supabase (CRUD operations)
// Environment: MINDGROW_API_KEY (DashScope), SUPABASE_URL, SUPABASE_KEY

const http = require('http');
const https = require('https');
const url = require('url');

const DASHSCOPE_KEY = process.env.MINDGROW_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const PORT = parseInt(process.env.FC_SERVER_PORT || process.env.PORT || '9000', 10);

if (!DASHSCOPE_KEY) console.warn('⚠️ MINDGROW_API_KEY not set');
if (!SUPABASE_URL) console.warn('⚠️ SUPABASE_URL not set');
if (!SUPABASE_KEY) console.warn('⚠️ SUPABASE_KEY not set');

// ============================================================
// Utility: fetch helper (Node.js < 18 compatible)
// ============================================================
function fetchJSON(method, targetUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
    };
    if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ============================================================
// DashScope helper
// ============================================================
async function dashscopeChat(messages, model, maxTokens, temperature) {
  return await fetchJSON('POST', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    'Authorization': 'Bearer ' + DASHSCOPE_KEY,
  }, {
    model: model || 'qwen-turbo',
    messages: messages,
    max_tokens: maxTokens || 500,
    temperature: temperature || 0.3,
  });
}

// ============================================================
// /api/chat handler
// ============================================================
async function handleChat(body) {
  const { input, mapId } = body;
  if (!input || typeof input !== 'string') {
    return { status: 400, data: { error: 'Input is required' } };
  }

  // Step 1: Classify intent
  const intentRes = await dashscopeChat([
    { role: 'system', content: '你是一个意图分类器。根据用户输入判断意图类型。只返回JSON：{"type":"knowledge|chitchat|command","confidence":0.95}' },
    { role: 'user', content: input },
  ], 'qwen-turbo', 100, 0.1);

  let intent;
  try {
    const content = intentRes.body.choices[0].message.content;
    intent = JSON.parse(content);
  } catch (e) {
    intent = { type: 'chitchat', confidence: 0.5 };
  }

  if (intent.type === 'chitchat') {
    const replies = ['好的，想到什么就输入什么 🌱', '我在这里，随时帮你整理知识', '有什么灵感就随手记下来吧'];
    return {
      status: 200,
      data: {
        intent,
        reply: replies[Math.floor(Math.random() * replies.length)],
        type: 'chitchat',
      },
    };
  }

  if (intent.type === 'command') {
    return { status: 200, data: { intent, reply: '指令功能开发中，敬请期待 🔧', type: 'command' } };
  }

  // Step 2: Generate mind map
  const mapRes = await dashscopeChat([
    { role: 'system', content: `你是一个知识结构提取器。从用户输入中提取知识结构，返回JSON格式：
{
  "root": "核心主题",
  "rootDesc": "简短描述",
  "children": [
    { "topic": "子主题", "desc": "描述", "items": ["要点1", "要点2"] }
  ],
  "relatedTopics": ["相关话题"]
}
只返回JSON，不要其他文字。` },
    { role: 'user', content: input },
  ], 'qwen-plus', 800, 0.7);

  let mindMap = null;
  try {
    const content = mapRes.body.choices[0].message.content;
    mindMap = JSON.parse(content);
  } catch (e) {
    return { status: 200, data: { intent, reply: '😅 我没能理解这段内容，能换个说法试试吗？', type: 'knowledge', placement: null, mindMap: null } };
  }

  // Step 3: Suggest placement
  let placement = null;
  try {
    // Get existing nodes from Supabase
    const currentMapId = mapId || 'map_default';
    const nodesRes = await fetchJSON('GET', `${SUPABASE_URL}/rest/v1/nodes?map_id=eq.${currentMapId}&select=content`, {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    });
    const existingTopics = (nodesRes.body || []).filter(n => n.type === 'topic').map(n => n.content);

    if (existingTopics.length > 0) {
      const placeRes = await dashscopeChat([
        { role: 'system', content: `你是知识归属分析器。判断新知识应归入哪个已有主题，返回JSON：{"targetTopic":"主题名","confidence":0.8,"reason":"原因"}。如果都不合适，返回{"targetTopic":null,"confidence":0,"reason":"独立主题"}` },
        { role: 'user', content: `新知识：${input}\n\n已有主题：${existingTopics.join('、')}` },
      ], 'qwen-turbo', 200, 0.2);
      try {
        const content = placeRes.body.choices[0].message.content;
        placement = JSON.parse(content);
        if (placement && !placement.targetTopic) placement = null;
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* non-critical, ignore */ }

  // Build reply
  let reply = '';
  if (placement) {
    reply = `📌 我建议将这段内容整合到「${placement.targetTopic}」下\n\n`;
  } else {
    reply = `🌱 新的知识结构：\n\n`;
  }
  reply += `🔹 **${mindMap.root}**\n`;
  if (mindMap.rootDesc) reply += `   _${mindMap.rootDesc}_\n`;
  for (const child of (mindMap.children || [])) {
    reply += `  ├─ ${child.topic}`;
    if (child.desc) reply += ` — ${child.desc}`;
    reply += '\n';
    for (const item of (child.items || [])) reply += `  │  ├─ ${item}\n`;
  }
  if (mindMap.relatedTopics && mindMap.relatedTopics.length > 0) {
    reply += `\n🔗 可能关联：${mindMap.relatedTopics.join('、')}`;
  }
  reply += '\n\n确认后将自动创建以上所有节点';

  return { status: 200, data: { intent, reply, type: 'knowledge', placement, mindMap } };
}

// ============================================================
// /api/knowledge handler (proxy to Supabase)
// ============================================================
async function handleKnowledge(req) {
  const parsed = url.parse(req.url, true);
  const query = parsed.query;

  // GET
  if (req.method === 'GET') {
    const action = query.action;
    const mapId = query.mapId || 'map_default';

    if (action === 'maps') {
      const mapsRes = await fetchJSON('GET', `${SUPABASE_URL}/rest/v1/maps?select=*&order=is_default.desc,updated_at.desc`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      });
      return { status: mapsRes.status, data: { maps: (mapsRes.body || []).map(convertMap) } };
    }

    if (action === 'categories') {
      const catsRes = await fetchJSON('GET', `${SUPABASE_URL}/rest/v1/categories?select=*&order=sort_order.asc`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      });
      const categories = (catsRes.body || []).map(c => ({
        id: c.id,
        name: c.name,
        icon: c.icon || '📁',
        color: c.color || '#22d3a7',
        sortOrder: c.sort_order || 0,
        createdAt: c.created_at,
      }));
      return { status: catsRes.status, data: { categories } };
    }

    // Return nodes, edges (with camelCase conversion)
    const [nodesRes, edgesRes] = await Promise.all([
      fetchJSON('GET', `${SUPABASE_URL}/rest/v1/nodes?map_id=eq.${mapId}&status=eq.active&select=*`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('GET', `${SUPABASE_URL}/rest/v1/edges?map_id=eq.${mapId}&select=*`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
    ]);

    // Convert snake_case to camelCase
    const nodes = (nodesRes.body || []).map(n => ({
      id: n.id,
      content: n.content,
      desc: n.desc || '',
      type: n.type,
      status: n.status,
      source: n.source,
      confidence: n.confidence,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));
    const edges = (edgesRes.body || []).map(e => ({
      id: e.id,
      sourceId: e.source_id,
      targetId: e.target_id,
      relation: e.relation,
      weight: e.weight,
      createdAt: e.created_at,
    }));

    return { status: 200, data: { nodes, edges } };
  }

  // DELETE
  if (req.method === 'DELETE') {
    const nodeId = query.nodeId;
    if (!nodeId) return { status: 400, data: { error: 'nodeId is required' } };
    await Promise.all([
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/nodes?id=eq.${nodeId}`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/edges?source_id=eq.${nodeId}`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/edges?target_id=eq.${nodeId}`, {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
    ]);
    return { status: 200, data: { success: true } };
  }

  // POST body
  const body = await readBody(req);

  if (body.action === 'createMap') {
    const id = 'map_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    const mapData = {
      id, name: body.name || '新知识库', description: body.description || '',
      color: body.color || '#22d3a7', is_default: false, node_count: 0,
      created_at: now, updated_at: now,
    };
    if (body.categoryId) mapData.category_id = body.categoryId;
    const res = await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/maps`, {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=representation',
    }, mapData);
    return { status: res.status, data: { map: convertMap(res.body && res.body[0] ? res.body[0] : res.body) } };
  }

  // Create map from template: creates map + nodes + edges from mindMap structure
  if (body.action === 'createFromTemplate') {
    const id = 'map_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    const template = body.template;
    if (!template || !template.root) return { status: 400, data: { error: 'Invalid template data' } };

    // Create map
    const mapData = {
      id, name: body.name || template.root, description: body.description || (template.rootDesc || '从模板创建'),
      color: body.color || '#22d3a7', is_default: false, node_count: 0,
      created_at: now, updated_at: now,
    };
    if (body.categoryId) mapData.category_id = body.categoryId;

    const mapRes = await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/maps`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=representation',
    }, mapData);

    // Create nodes and edges from template structure
    const createdNodes = [];
    const createdEdges = [];
    const rootId = 'node_' + Date.now() + '_r';

    await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/nodes`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
    }, { id: rootId, content: template.root, desc: template.rootDesc || '', type: 'topic', status: 'active', source: 'template', confidence: 1.0, map_id: id, created_at: now, updated_at: now });
    createdNodes.push({ id: rootId, content: template.root });

    for (const child of (template.children || [])) {
      const childId = 'node_' + Date.now() + '_c' + createdNodes.length;
      await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/nodes`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }, { id: childId, content: child.topic, desc: child.desc || '', type: 'concept', status: 'active', source: 'template', confidence: 0.9, map_id: id, created_at: now, updated_at: now });
      createdNodes.push({ id: childId, content: child.topic });

      const edgeId = 'edge_' + Date.now() + '_' + createdEdges.length;
      await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/edges`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }, { id: edgeId, source_id: rootId, target_id: childId, relation: 'contains', weight: 1.0, map_id: id, created_at: now });
      createdEdges.push(edgeId);

      for (const item of (child.items || [])) {
        const itemId = 'node_' + Date.now() + '_i' + createdNodes.length;
        await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/nodes`, {
          'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
        }, { id: itemId, content: item, type: 'detail', status: 'active', source: 'template', confidence: 0.8, map_id: id, created_at: now, updated_at: now });
        createdNodes.push({ id: itemId, content: item });

        const itemEdgeId = 'edge_' + Date.now() + '_' + createdEdges.length;
        await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/edges`, {
          'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
        }, { id: itemEdgeId, source_id: childId, target_id: itemId, relation: 'contains', weight: 0.8, map_id: id, created_at: now });
        createdEdges.push(itemEdgeId);
      }
    }

    // Update node count
    await fetchJSON('PATCH', `${SUPABASE_URL}/rest/v1/maps?id=eq.${id}`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal',
    }, { node_count: createdNodes.length, updated_at: now });

    return { status: 200, data: { map: convertMap(mapRes.body && mapRes.body[0] ? mapRes.body[0] : mapRes.body), nodeCount: createdNodes.length } };
  }

  if (body.action === 'deleteMap') {
    const mapId = body.mapId;
    if (!mapId || mapId === 'map_default') return { status: 400, data: { error: 'Cannot delete default map' } };
    await Promise.all([
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/maps?id=eq.${mapId}`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/nodes?map_id=eq.${mapId}`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/edges?map_id=eq.${mapId}`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/node_layouts?map_id=eq.${mapId}`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
    ]);
    return { status: 200, data: { success: true } };
  }

  if (body.action === 'clearMap') {
    const mapId = body.mapId;
    if (!mapId || mapId === 'map_default') return { status: 400, data: { error: 'Cannot clear default map' } };
    await Promise.all([
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/nodes?map_id=eq.${mapId}`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
      fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/edges?map_id=eq.${mapId}`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }),
    ]);
    return { status: 200, data: { success: true } };
  }

  if (body.action === 'renameMap') {
    const res = await fetchJSON('PATCH', `${SUPABASE_URL}/rest/v1/maps?id=eq.${body.mapId}`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal',
    }, { name: body.name, updated_at: new Date().toISOString() });
    return { status: res.status, data: { success: true } };
  }

  // ---- Category operations ----
  if (body.action === 'createCategory') {
    const id = 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    const res = await fetchJSON('GET', `${SUPABASE_URL}/rest/v1/categories?select=sort_order&order=sort_order.desc&limit=1`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
    });
    const nextOrder = (res.body && res.body.length > 0) ? ((res.body[0].sort_order || 0) + 1) : 0;

    const catRes = await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/categories`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=representation',
    }, {
      id, name: body.name || '新文件夹', icon: body.icon || '📁',
      color: body.color || '#22d3a7', sort_order: nextOrder, created_at: now,
    });
    const cat = catRes.body && catRes.body[0] ? catRes.body[0] : catRes.body;
    return { status: catRes.status, data: { category: { id: cat.id, name: cat.name, icon: cat.icon, color: cat.color, sortOrder: cat.sort_order, createdAt: cat.created_at } } };
  }

  if (body.action === 'deleteCategory') {
    const catId = body.categoryId;
    // Move maps out first
    await fetchJSON('PATCH', `${SUPABASE_URL}/rest/v1/maps?category_id=eq.${catId}`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal',
    }, { category_id: null });
    const res = await fetchJSON('DELETE', `${SUPABASE_URL}/rest/v1/categories?id=eq.${catId}`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
    });
    return { status: res.status, data: { success: true } };
  }

  if (body.action === 'renameCategory') {
    const res = await fetchJSON('PATCH', `${SUPABASE_URL}/rest/v1/categories?id=eq.${body.categoryId}`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal',
    }, { name: body.name });
    return { status: res.status, data: { success: true } };
  }

  if (body.action === 'moveMapToCategory') {
    const res = await fetchJSON('PATCH', `${SUPABASE_URL}/rest/v1/maps?id=eq.${body.mapId}`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal',
    }, { category_id: body.categoryId || null, updated_at: new Date().toISOString() });
    return { status: res.status, data: { success: true } };
  }

  // Create mind map nodes
  if (body.mindMap && body.mindMap.root) {
    const currentMapId = body.mapId || 'map_default';
    const now = new Date().toISOString();
    const createdNodes = [];
    const createdEdges = [];

    const rootId = 'node_' + Date.now() + '_r';
    await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/nodes`, {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
    }, { id: rootId, content: body.mindMap.root, desc: body.mindMap.rootDesc || '', type: 'topic', status: 'active', source: body.source || 'manual', confidence: 1.0, map_id: currentMapId, created_at: now, updated_at: now });
    createdNodes.push({ id: rootId, content: body.mindMap.root });

    for (const child of (body.mindMap.children || [])) {
      const childId = 'node_' + Date.now() + '_c' + createdNodes.length;
      await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/nodes`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }, { id: childId, content: child.topic, desc: child.desc || '', type: 'concept', status: 'active', source: body.source || 'ai_generated', confidence: 0.8, map_id: currentMapId, created_at: now, updated_at: now });
      createdNodes.push({ id: childId, content: child.topic });

      const edgeId = 'edge_' + Date.now() + '_' + createdEdges.length;
      await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/edges`, {
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      }, { id: edgeId, source_id: rootId, target_id: childId, relation: 'contains', weight: 1.0, map_id: currentMapId, created_at: now });
      createdEdges.push(edgeId);

      for (const item of (child.items || [])) {
        const itemId = 'node_' + Date.now() + '_i' + createdNodes.length;
        await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/nodes`, {
          'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
        }, { id: itemId, content: item, type: 'detail', status: 'active', source: 'ai_generated', confidence: 0.6, map_id: currentMapId, created_at: now, updated_at: now });
        createdNodes.push({ id: itemId, content: item });

        const itemEdgeId = 'edge_' + Date.now() + '_' + createdEdges.length;
        await fetchJSON('POST', `${SUPABASE_URL}/rest/v1/edges`, {
          'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
        }, { id: itemEdgeId, source_id: childId, target_id: itemId, relation: 'contains', weight: 0.8, map_id: currentMapId, created_at: now });
        createdEdges.push(itemEdgeId);
      }
    }

    return {
      status: 200,
      data: {
        node: createdNodes[0],
        additionalNodes: createdNodes.slice(1),
        additionalEdges: createdEdges,
        totalNodes: createdNodes.length,
        totalEdges: createdEdges.length,
      },
    };
  }

  return { status: 400, data: { error: 'Unknown action' } };
}

// ============================================================
// Body reader
// ============================================================
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function convertMap(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    color: row.color || '#22d3a7',
    isDefault: row.is_default,
    categoryId: row.category_id || null,
    nodeCount: row.node_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Main server
// ============================================================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const pathname = url.parse(req.url).pathname;

  try {
    if (pathname === '/api/chat' || pathname === '/mindgrow/api/chat') {
      const body = await readBody(req);
      const result = await handleChat(body);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.data));
    } else if (pathname === '/api/knowledge' || pathname === '/mindgrow/api/knowledge') {
      const result = await handleKnowledge(req);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.data));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('Error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error: ' + error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ MindGrow proxy running on port ' + PORT);
  console.log('📍 DashScope: ' + (DASHSCOPE_KEY ? 'Yes ***' + DASHSCOPE_KEY.slice(-4) : 'No ❌'));
  console.log('📍 Supabase: ' + (SUPABASE_URL ? SUPABASE_URL : 'No ❌'));
});
