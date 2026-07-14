// MindGrow API Proxy for Alibaba Cloud Function Compute.
// Environment: MINDGROW_API_KEY, SUPABASE_URL, SUPABASE_KEY,
// optional ALLOWED_ORIGINS and UPSTREAM_TIMEOUT_MS.

const http = require('http');
const https = require('https');

const DASHSCOPE_KEY = process.env.MINDGROW_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const PORT = Number.parseInt(process.env.FC_SERVER_PORT || process.env.PORT || '9000', 10);
const UPSTREAM_TIMEOUT_MS = Number.parseInt(process.env.UPSTREAM_TIMEOUT_MS || '12000', 10);
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://yunzhixu620-stack.github.io')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

function fetchJSON(method, targetUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const postData = body === undefined ? null : JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    };
    if (postData !== null) options.headers['Content-Length'] = Buffer.byteLength(postData);

    const request = transport.request(options, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let parsedBody = data;
        try { parsedBody = data ? JSON.parse(data) : null; } catch (_) { /* keep text */ }
        resolve({ status: response.statusCode || 502, body: parsedBody, headers: response.headers });
      });
    });
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      const error = new Error('Upstream request timed out');
      error.code = 'UPSTREAM_TIMEOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    if (postData !== null) request.write(postData);
    request.end();
  });
}

function dependencyError(service, status) {
  const error = new Error(`${service} unavailable`);
  error.statusCode = 503;
  error.publicCode = `${service.toUpperCase()}_UNAVAILABLE`;
  error.upstreamStatus = status;
  return error;
}

function supabaseHeaders(prefer) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function supabaseRequest(method, path, body, prefer) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw dependencyError('knowledge_store');
  try {
    const response = await fetchJSON(method, `${SUPABASE_URL}/rest/v1/${path}`, supabaseHeaders(prefer), body);
    if (response.status < 200 || response.status >= 300) {
      console.error('Supabase request failed', { method, status: response.status, path: path.split('?')[0] });
      throw dependencyError('knowledge_store', response.status);
    }
    return response.body;
  } catch (error) {
    if (error.publicCode) throw error;
    console.error('Supabase request error', { method, code: error.code || 'UNKNOWN', path: path.split('?')[0] });
    throw dependencyError('knowledge_store');
  }
}

async function dashscopeChat(messages, model, maxTokens, temperature) {
  if (!DASHSCOPE_KEY) throw dependencyError('model');
  let response;
  try {
    response = await fetchJSON('POST', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
    }, {
      model: model || 'qwen-turbo',
      messages,
      max_tokens: maxTokens || 500,
      temperature: temperature === undefined ? 0.3 : temperature,
    });
  } catch (error) {
    console.error('DashScope request error', { code: error.code || 'UNKNOWN' });
    throw dependencyError('model');
  }
  if (response.status < 200 || response.status >= 300 || !response.body || !Array.isArray(response.body.choices)) {
    console.error('DashScope request failed', { status: response.status });
    throw dependencyError('model', response.status);
  }
  return response.body.choices[0] && response.body.choices[0].message
    ? response.body.choices[0].message.content
    : '';
}

function stripJsonFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function classifyInput(input) {
  const value = input.trim();
  if (/^(\/|删除|清空|重命名|delete|clear|rename)\b/i.test(value)) return 'command';
  if (/^(你好|您好|嗨|hello|hi|hey)[!！,.，。\s]*$/i.test(value)) return 'chitchat';
  if (/[?？]$/.test(value) || /^(什么|为什么|如何|怎么|哪些|哪个|是否|能否|请问|who|what|when|where|why|how|is|are|can|does)\b/i.test(value)) return 'question';
  return 'knowledge';
}

function tokenize(value) {
  const text = String(value || '').toLowerCase();
  const terms = new Set(text.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []);
  const chinese = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) terms.add(chinese.slice(index, index + 2));
  return [...terms];
}

function retrieveEvidence(question, nodes) {
  const queryTerms = tokenize(question);
  return nodes
    .map((node) => {
      const haystack = `${node.content || ''} ${node.desc || ''}`.toLowerCase();
      const matches = queryTerms.filter((term) => haystack.includes(term));
      return { node, score: matches.length / Math.max(queryTerms.length, 1) };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function answerQuestion(input, mapId, intent) {
  const id = encodeURIComponent(mapId || 'map_default');
  const nodes = await supabaseRequest('GET', `nodes?map_id=eq.${id}&status=eq.active&select=id,content,desc,type`);
  if (!Array.isArray(nodes)) throw dependencyError('knowledge_store');
  const evidence = retrieveEvidence(input, nodes);
  if (evidence.length === 0) {
    return {
      status: 200,
      data: {
        intent,
        type: 'answer',
        reply: '当前知识库中没有足够证据回答这个问题。你可以先补充相关资料，我不会用猜测代替知识库证据。',
        sources: [],
        grounded: true,
        abstained: true,
      },
    };
  }
  const lines = evidence.map(({ node }, index) => {
    const description = node.desc ? `：${node.desc}` : '';
    return `${index + 1}. **${node.content}**${description} 〔来源 ${index + 1}〕`;
  });
  return {
    status: 200,
    data: {
      intent,
      type: 'answer',
      reply: `根据当前知识库，找到以下直接相关证据：\n\n${lines.join('\n')}\n\n以上结论仅基于已保存内容；如需更完整结论，请继续补充资料。`,
      sources: evidence.map(({ node }, index) => ({ id: node.id, title: node.content, index: index + 1 })),
      grounded: true,
      abstained: false,
    },
  };
}

async function handleChat(body) {
  const input = body && typeof body.input === 'string' ? body.input.trim() : '';
  const mapId = body && body.mapId ? String(body.mapId) : 'map_default';
  if (!input) return { status: 400, data: { error: 'Input is required', code: 'INVALID_INPUT' } };
  if (input.length > 10000) return { status: 413, data: { error: 'Input is too long', code: 'INPUT_TOO_LARGE' } };

  const intent = { type: classifyInput(input), confidence: 0.9 };
  if (intent.type === 'chitchat') {
    return { status: 200, data: { intent, type: 'chitchat', reply: '你好，我可以帮你整理知识、检索已保存内容，并给出可追溯证据。' } };
  }
  if (intent.type === 'command') {
    return { status: 200, data: { intent, type: 'command', reply: '为了避免误操作，请使用界面中的重命名、清空或删除按钮执行管理操作。' } };
  }
  if (intent.type === 'question') return answerQuestion(input, mapId, intent);

  const generated = await dashscopeChat([
    {
      role: 'system',
      content: '你是知识结构提取器。只返回严格 JSON：{"root":"核心主题","rootDesc":"简短描述","children":[{"topic":"子主题","desc":"描述","items":["要点"]}],"relatedTopics":["相关主题"]}。不得输出 Markdown。',
    },
    { role: 'user', content: input },
  ], 'qwen-plus', 900, 0.4);

  let mindMap;
  try {
    mindMap = JSON.parse(stripJsonFence(generated));
    if (!mindMap || typeof mindMap.root !== 'string' || !Array.isArray(mindMap.children)) throw new Error('Invalid schema');
  } catch (_) {
    return { status: 502, data: { error: 'The model returned an invalid structure', code: 'MODEL_OUTPUT_INVALID' } };
  }

  let placement = null;
  try {
    const id = encodeURIComponent(mapId);
    const nodes = await supabaseRequest('GET', `nodes?map_id=eq.${id}&status=eq.active&select=content,type`);
    const topics = Array.isArray(nodes) ? nodes.filter((node) => node.type === 'topic').map((node) => node.content).slice(0, 50) : [];
    if (topics.length > 0) {
      const placementText = await dashscopeChat([
        { role: 'system', content: '判断新知识应该归入哪个已有主题。只返回 JSON：{"targetTopic":null,"confidence":0,"reason":"独立主题"}。targetTopic 必须是候选主题之一，否则为 null。' },
        { role: 'user', content: `新知识：${input}\n候选主题：${topics.join('、')}` },
      ], 'qwen-turbo', 200, 0.1);
      const candidate = JSON.parse(stripJsonFence(placementText));
      if (candidate && topics.includes(candidate.targetTopic)) placement = candidate;
    }
  } catch (error) {
    // Placement is an optional enhancement. Structure generation still succeeds.
    console.warn('Placement unavailable', { code: error.publicCode || 'PLACEMENT_FAILED' });
  }

  const reply = [
    placement ? `建议整合到「${placement.targetTopic}」下。` : '已生成新的知识结构。',
    '',
    `**${mindMap.root}**${mindMap.rootDesc ? `：${mindMap.rootDesc}` : ''}`,
    ...(mindMap.children || []).map((child) => `- ${child.topic}${child.desc ? `：${child.desc}` : ''}${Array.isArray(child.items) && child.items.length ? `\n  - ${child.items.join('\n  - ')}` : ''}`),
    '',
    '确认后可将这些节点保存到当前知识库。',
  ].join('\n');
  return { status: 200, data: { intent, reply, type: 'knowledge', placement, mindMap } };
}

function convertMap(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    color: row.color || '#22d3a7',
    isDefault: Boolean(row.is_default),
    categoryId: row.category_id || null,
    nodeCount: row.node_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function convertNode(node) {
  return {
    id: node.id,
    content: node.content,
    desc: node.desc || '',
    type: node.type,
    status: node.status,
    source: node.source,
    confidence: node.confidence,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
  };
}

function convertEdge(edge) {
  return {
    id: edge.id,
    sourceId: edge.source_id,
    targetId: edge.target_id,
    relation: edge.relation,
    weight: edge.weight,
    createdAt: edge.created_at,
  };
}

async function createGraph(mapId, mindMap, source) {
  const now = new Date().toISOString();
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nodes = [];
  const edges = [];
  const rootId = `node_${seed}_r`;
  nodes.push({ id: rootId, content: mindMap.root, desc: mindMap.rootDesc || '', type: 'topic', status: 'active', source, confidence: 1, map_id: mapId, created_at: now, updated_at: now });

  (mindMap.children || []).forEach((child, childIndex) => {
    const childId = `node_${seed}_c${childIndex}`;
    nodes.push({ id: childId, content: child.topic, desc: child.desc || '', type: 'concept', status: 'active', source, confidence: 0.9, map_id: mapId, created_at: now, updated_at: now });
    edges.push({ id: `edge_${seed}_c${childIndex}`, source_id: rootId, target_id: childId, relation: 'contains', weight: 1, map_id: mapId, created_at: now });
    (child.items || []).forEach((item, itemIndex) => {
      const itemId = `node_${seed}_c${childIndex}i${itemIndex}`;
      nodes.push({ id: itemId, content: item, desc: '', type: 'detail', status: 'active', source, confidence: 0.8, map_id: mapId, created_at: now, updated_at: now });
      edges.push({ id: `edge_${seed}_c${childIndex}i${itemIndex}`, source_id: childId, target_id: itemId, relation: 'contains', weight: 0.8, map_id: mapId, created_at: now });
    });
  });
  await supabaseRequest('POST', 'nodes', nodes);
  if (edges.length) await supabaseRequest('POST', 'edges', edges);
  return { nodes, edges };
}

async function updateMapNodeCount(mapId) {
  const id = encodeURIComponent(mapId);
  const nodes = await supabaseRequest('GET', `nodes?map_id=eq.${id}&status=eq.active&select=id`);
  const count = Array.isArray(nodes) ? nodes.length : 0;
  await supabaseRequest('PATCH', `maps?id=eq.${id}`, { node_count: count, updated_at: new Date().toISOString() }, 'return=minimal');
  return count;
}

async function handleKnowledge(req) {
  const parsed = new URL(req.url, 'http://localhost');
  // Function Compute may still run an older Node.js runtime where
  // Object.fromEntries is unavailable. URLSearchParams#forEach works there.
  const query = {};
  parsed.searchParams.forEach((value, key) => { query[key] = value; });

  if (req.method === 'GET') {
    if (query.action === 'maps') {
      const rows = await supabaseRequest('GET', 'maps?select=*&order=is_default.desc,updated_at.desc');
      if (!Array.isArray(rows)) throw dependencyError('knowledge_store');
      return { status: 200, data: { maps: rows.map(convertMap) } };
    }
    if (query.action === 'categories') {
      const rows = await supabaseRequest('GET', 'categories?select=*&order=sort_order.asc');
      if (!Array.isArray(rows)) throw dependencyError('knowledge_store');
      return {
        status: 200,
        data: { categories: rows.map((category) => ({ id: category.id, name: category.name, icon: category.icon || '📁', color: category.color || '#22d3a7', sortOrder: category.sort_order || 0, createdAt: category.created_at })) },
      };
    }
    const mapId = encodeURIComponent(String(query.mapId || 'map_default'));
    const [nodeRows, edgeRows] = await Promise.all([
      supabaseRequest('GET', `nodes?map_id=eq.${mapId}&status=eq.active&select=*`),
      supabaseRequest('GET', `edges?map_id=eq.${mapId}&select=*`),
    ]);
    if (!Array.isArray(nodeRows) || !Array.isArray(edgeRows)) throw dependencyError('knowledge_store');
    return { status: 200, data: { nodes: nodeRows.map(convertNode), edges: edgeRows.map(convertEdge) } };
  }

  if (req.method === 'DELETE') {
    const nodeId = String(query.nodeId || '');
    if (!nodeId) return { status: 400, data: { error: 'nodeId is required', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(nodeId);
    const rows = await supabaseRequest('GET', `nodes?id=eq.${id}&select=map_id&limit=1`);
    const mapId = Array.isArray(rows) && rows[0] ? rows[0].map_id : null;
    await supabaseRequest('DELETE', `edges?source_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?target_id=eq.${id}`);
    await supabaseRequest('DELETE', `node_layouts?node_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?id=eq.${id}`);
    if (mapId) await updateMapNodeCount(mapId);
    return { status: 200, data: { success: true } };
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (!body.nodeId) return { status: 400, data: { error: 'nodeId is required', code: 'INVALID_INPUT' } };
    const layout = {
      node_id: String(body.nodeId),
      map_id: String(body.mapId || 'map_default'),
      position_x: Number(body.positionX || 0),
      position_y: Number(body.positionY || 0),
      zoom_level: Number(body.zoomLevel || 1),
    };
    await supabaseRequest('POST', 'node_layouts?on_conflict=node_id,map_id', layout, 'resolution=merge-duplicates,return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    if (!body.nodeId) return { status: 400, data: { error: 'nodeId is required', code: 'INVALID_INPUT' } };
    const updates = { updated_at: new Date().toISOString() };
    ['content', 'desc', 'type', 'status', 'source', 'confidence'].forEach((field) => {
      if (body[field] !== undefined) updates[field] = body[field];
    });
    const rows = await supabaseRequest('PATCH', `nodes?id=eq.${encodeURIComponent(String(body.nodeId))}`, updates, 'return=representation');
    const node = Array.isArray(rows) ? rows[0] : rows;
    if (!node) return { status: 404, data: { error: 'Node not found', code: 'NOT_FOUND' } };
    return { status: 200, data: { node: convertNode(node) } };
  }

  if (req.method !== 'POST') {
    return { status: 405, data: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
  }
  const body = await readBody(req);
  const action = body.action;

  if (action === 'createMap' || action === 'createFromTemplate') {
    const id = `map_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const template = action === 'createFromTemplate' ? body.template : null;
    if (template && (!template.root || !Array.isArray(template.children))) {
      return { status: 400, data: { error: 'Invalid template data', code: 'INVALID_INPUT' } };
    }
    const map = {
      id,
      name: body.name || (template && template.root) || '新知识库',
      description: body.description || (template && template.rootDesc) || '',
      color: body.color || '#22d3a7',
      is_default: false,
      node_count: 0,
      category_id: body.categoryId || null,
      created_at: now,
      updated_at: now,
    };
    const rows = await supabaseRequest('POST', 'maps', map, 'return=representation');
    let nodeCount = 0;
    if (template) {
      try {
        const graph = await createGraph(id, template, 'template');
        nodeCount = graph.nodes.length;
        await supabaseRequest('PATCH', `maps?id=eq.${encodeURIComponent(id)}`, { node_count: nodeCount, updated_at: now }, 'return=minimal');
      } catch (error) {
        try {
          await supabaseRequest('DELETE', `edges?map_id=eq.${encodeURIComponent(id)}`);
          await supabaseRequest('DELETE', `nodes?map_id=eq.${encodeURIComponent(id)}`);
          await supabaseRequest('DELETE', `maps?id=eq.${encodeURIComponent(id)}`);
        } catch (_) { /* best-effort rollback */ }
        throw error;
      }
    }
    const created = Array.isArray(rows) ? rows[0] : rows;
    return { status: 201, data: { map: convertMap({ ...map, ...(created || {}), node_count: nodeCount }), nodeCount } };
  }

  if (action === 'deleteMap') {
    const mapId = String(body.mapId || '');
    if (!mapId || mapId === 'map_default') return { status: 400, data: { error: 'Cannot delete the default map', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(mapId);
    await supabaseRequest('DELETE', `node_layouts?map_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?map_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?map_id=eq.${id}`);
    await supabaseRequest('DELETE', `maps?id=eq.${id}`);
    return { status: 200, data: { success: true } };
  }

  if (action === 'clearMap') {
    const mapId = String(body.mapId || '');
    if (!mapId || mapId === 'map_default') return { status: 400, data: { error: 'Cannot clear the default map', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(mapId);
    await supabaseRequest('DELETE', `node_layouts?map_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?map_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?map_id=eq.${id}`);
    await supabaseRequest('PATCH', `maps?id=eq.${id}`, { node_count: 0, updated_at: new Date().toISOString() }, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (action === 'renameMap' || action === 'moveMapToCategory') {
    if (!body.mapId) return { status: 400, data: { error: 'mapId is required', code: 'INVALID_INPUT' } };
    const changes = action === 'renameMap'
      ? { name: String(body.name || '').trim(), updated_at: new Date().toISOString() }
      : { category_id: body.categoryId || null, updated_at: new Date().toISOString() };
    if (action === 'renameMap' && !changes.name) return { status: 400, data: { error: 'name is required', code: 'INVALID_INPUT' } };
    await supabaseRequest('PATCH', `maps?id=eq.${encodeURIComponent(String(body.mapId))}`, changes, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (action === 'createCategory') {
    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const existing = await supabaseRequest('GET', 'categories?select=sort_order&order=sort_order.desc&limit=1');
    const nextOrder = Array.isArray(existing) && existing[0] ? Number(existing[0].sort_order || 0) + 1 : 0;
    const category = { id, name: String(body.name || '新文件夹').trim(), icon: body.icon || '📁', color: body.color || '#22d3a7', sort_order: nextOrder, created_at: now };
    const rows = await supabaseRequest('POST', 'categories', category, 'return=representation');
    const created = Array.isArray(rows) ? rows[0] : rows;
    return { status: 201, data: { category: { id, name: created.name, icon: created.icon, color: created.color, sortOrder: created.sort_order, createdAt: created.created_at } } };
  }

  if (action === 'deleteCategory') {
    if (!body.categoryId) return { status: 400, data: { error: 'categoryId is required', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(String(body.categoryId));
    await supabaseRequest('PATCH', `maps?category_id=eq.${id}`, { category_id: null }, 'return=minimal');
    await supabaseRequest('DELETE', `categories?id=eq.${id}`);
    return { status: 200, data: { success: true } };
  }

  if (action === 'renameCategory') {
    if (!body.categoryId || !String(body.name || '').trim()) return { status: 400, data: { error: 'categoryId and name are required', code: 'INVALID_INPUT' } };
    await supabaseRequest('PATCH', `categories?id=eq.${encodeURIComponent(String(body.categoryId))}`, { name: String(body.name).trim() }, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (body.mindMap && body.mindMap.root) {
    const mapId = String(body.mapId || 'map_default');
    const graph = await createGraph(mapId, body.mindMap, body.source || 'ai_generated');
    await updateMapNodeCount(mapId);
    return {
      status: 201,
      data: {
        node: { id: graph.nodes[0].id, content: graph.nodes[0].content },
        additionalNodes: graph.nodes.slice(1).map((node) => ({ id: node.id, content: node.content })),
        additionalEdges: graph.edges.map((edge) => edge.id),
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
      },
    };
  }
  return { status: 400, data: { error: 'Unknown action', code: 'INVALID_INPUT' } };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        const error = new Error('Request body too large');
        error.statusCode = 413;
        error.publicCode = 'REQUEST_TOO_LARGE';
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) {
        const error = new Error('Invalid JSON');
        error.statusCode = 400;
        error.publicCode = 'INVALID_JSON';
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const localhost = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin || ALLOWED_ORIGINS.has(origin) || localhost) {
    res.setHeader('Access-Control-Allow-Origin', origin || [...ALLOWED_ORIGINS][0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname === '/health' || pathname === '/api/health') {
      const checks = {
        function: 'ok',
        modelConfigured: Boolean(DASHSCOPE_KEY),
        knowledgeStoreConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY),
        knowledgeStore: 'unknown',
      };
      if (checks.knowledgeStoreConfigured) {
        try {
          await supabaseRequest('GET', 'maps?select=id&limit=1');
          checks.knowledgeStore = 'ok';
        } catch (_) {
          checks.knowledgeStore = 'unreachable';
        }
      } else {
        checks.knowledgeStore = 'not_configured';
      }
      const healthy = checks.modelConfigured && checks.knowledgeStore === 'ok';
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() }));
    }

    let result;
    if (pathname === '/api/chat' || pathname === '/mindgrow/api/chat') {
      if (req.method !== 'POST') result = { status: 405, data: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
      else result = await handleChat(await readBody(req));
    } else if (pathname === '/api/knowledge' || pathname === '/mindgrow/api/knowledge') {
      result = await handleKnowledge(req);
    } else {
      result = { status: 404, data: { error: 'Not found', code: 'NOT_FOUND' } };
    }
    res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result.data));
  } catch (error) {
    const status = error.statusCode || 500;
    const code = error.publicCode || 'INTERNAL_ERROR';
    console.error('Request failed', { pathname, status, code });
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: status >= 500 ? 'Service temporarily unavailable' : error.message, code }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MindGrow proxy listening on port ${PORT}`);
  console.log(`DashScope configured: ${Boolean(DASHSCOPE_KEY)}`);
  console.log(`Knowledge store configured: ${Boolean(SUPABASE_URL && SUPABASE_KEY)}`);
});
