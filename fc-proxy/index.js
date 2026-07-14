// MindGrow API Proxy for Alibaba Cloud Function Compute.
// Environment: MINDGROW_API_KEY, SUPABASE_URL, SUPABASE_KEY,
// optional ALLOWED_ORIGINS and UPSTREAM_TIMEOUT_MS.

const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');

const DASHSCOPE_KEY = process.env.MINDGROW_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const PORT = Number.parseInt(process.env.FC_SERVER_PORT || process.env.PORT || '9000', 10);
const UPSTREAM_TIMEOUT_MS = Number.parseInt(process.env.UPSTREAM_TIMEOUT_MS || '12000', 10);
const AUTH_REQUIRED = process.env.AUTH_REQUIRED !== 'false';
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

function requestError(statusCode, publicCode, message) {
  const error = new Error(message || publicCode);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  return error;
}

async function authenticateUser(req) {
  if (!AUTH_REQUIRED) return { id: 'local_test_user', email: 'local@mindgrow.test' };
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw requestError(401, 'AUTH_REQUIRED', 'Sign in is required');

  let response;
  try {
    response = await fetchJSON('GET', `${SUPABASE_URL}/auth/v1/user`, {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${match[1]}`,
    });
  } catch (_) {
    throw requestError(503, 'AUTH_UNAVAILABLE', 'Authentication service is unavailable');
  }
  if (response.status !== 200 || !response.body || !response.body.id) {
    throw requestError(401, 'INVALID_SESSION', 'The session is invalid or expired');
  }
  return { id: String(response.body.id), email: String(response.body.email || '') };
}

function workspaceIdForUser(userId) {
  return `ws_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}`;
}

function defaultMapIdForWorkspace(workspaceId) {
  return `map_${workspaceId}_default`;
}

async function createWorkspace(user, name) {
  const workspaceId = workspaceIdForUser(user.id);
  const now = new Date().toISOString();
  const workspace = {
    id: workspaceId,
    name: String(name || '我的工作区').trim().slice(0, 80) || '我的工作区',
    owner_id: user.id,
    created_at: now,
    updated_at: now,
  };
  await supabaseRequest('POST', 'workspaces?on_conflict=id', workspace, 'resolution=ignore-duplicates,return=minimal');
  await supabaseRequest('POST', 'workspace_members?on_conflict=workspace_id,user_id', {
    workspace_id: workspaceId,
    user_id: user.id,
    role: 'owner',
    created_at: now,
  }, 'resolution=ignore-duplicates,return=minimal');

  const defaultMapId = defaultMapIdForWorkspace(workspaceId);
  await supabaseRequest('POST', 'maps?on_conflict=id', {
    id: defaultMapId,
    workspace_id: workspaceId,
    name: '默认知识库',
    description: '我的第一个 AI 知识图谱',
    color: '#22d3a7',
    is_default: true,
    node_count: 0,
    created_at: now,
    updated_at: now,
  }, 'resolution=ignore-duplicates,return=minimal');
  return { ...workspace, role: 'owner', defaultMapId };
}

async function listUserWorkspaces(user) {
  const userId = encodeURIComponent(user.id);
  const memberships = await supabaseRequest('GET', `workspace_members?user_id=eq.${userId}&select=workspace_id,role&order=created_at.asc`);
  if (!Array.isArray(memberships) || memberships.length === 0) {
    return [await createWorkspace(user)];
  }
  const workspaceIds = memberships.map((item) => item.workspace_id).filter(Boolean);
  const filter = `(${workspaceIds.map((id) => encodeURIComponent(id)).join(',')})`;
  const workspaces = await supabaseRequest('GET', `workspaces?id=in.${filter}&select=id,name,owner_id,created_at,updated_at`);
  const rows = Array.isArray(workspaces) ? workspaces : [];
  return rows.map((workspace) => {
    const membership = memberships.find((item) => item.workspace_id === workspace.id);
    return {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.owner_id,
      role: membership ? membership.role : 'viewer',
      defaultMapId: defaultMapIdForWorkspace(workspace.id),
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
    };
  });
}

async function resolveWorkspace(req, user) {
  const workspaces = await listUserWorkspaces(user);
  const requested = String(req.headers['x-workspace-id'] || '');
  const selected = requested
    ? workspaces.find((workspace) => workspace.id === requested)
    : workspaces[0];
  if (!selected) throw requestError(403, 'WORKSPACE_FORBIDDEN', 'You do not have access to this workspace');
  return selected;
}

async function handleWorkspaces(req, user) {
  if (req.method === 'GET') {
    const workspaces = await listUserWorkspaces(user);
    return { status: 200, data: { user, workspaces } };
  }
  if (req.method !== 'POST') {
    return { status: 405, data: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
  }
  const body = await readBody(req);
  if (body.action !== 'create') {
    return { status: 400, data: { error: 'Unknown action', code: 'INVALID_INPUT' } };
  }
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const workspaceId = `ws_${suffix}`;
  const now = new Date().toISOString();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return { status: 400, data: { error: 'Workspace name is required', code: 'INVALID_INPUT' } };
  await supabaseRequest('POST', 'workspaces', { id: workspaceId, name, owner_id: user.id, created_at: now, updated_at: now }, 'return=minimal');
  await supabaseRequest('POST', 'workspace_members', { workspace_id: workspaceId, user_id: user.id, role: 'owner', created_at: now }, 'return=minimal');
  const defaultMapId = defaultMapIdForWorkspace(workspaceId);
  await supabaseRequest('POST', 'maps', { id: defaultMapId, workspace_id: workspaceId, name: '默认知识库', description: '', color: '#22d3a7', is_default: true, node_count: 0, created_at: now, updated_at: now }, 'return=minimal');
  return { status: 201, data: { workspace: { id: workspaceId, name, ownerId: user.id, role: 'owner', defaultMapId, createdAt: now, updatedAt: now } } };
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

function inFilter(values) {
  return `(${values.map((value) => encodeURIComponent(String(value))).join(',')})`;
}

async function retrieveGraphEvidence(question, mapId, workspaceId) {
  const workspace = encodeURIComponent(workspaceId);
  const map = encodeURIComponent(mapId);
  let seeds = [];
  try {
    const result = await supabaseRequest('POST', 'rpc/search_knowledge_nodes', {
      p_workspace_id: workspaceId,
      p_map_id: mapId,
      p_query: question,
      p_limit: 12,
    });
    if (Array.isArray(result)) {
      seeds = result.map((node) => ({ ...node, desc: node.description || '', score: Number(node.score || 0) }));
    }
  } catch (error) {
    // V6 deployments can still answer while the V7 search migration is being applied.
    console.warn('Indexed retrieval unavailable; using bounded fallback', { code: error.publicCode || 'SEARCH_UNAVAILABLE' });
    const nodes = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${map}&status=eq.active&select=id,content,desc,type&order=updated_at.desc&limit=500`);
    seeds = retrieveEvidence(question, Array.isArray(nodes) ? nodes : []).map(({ node, score }) => ({ ...node, score }));
  }
  if (seeds.length === 0) return [];

  const seedIds = seeds.slice(0, 8).map((node) => node.id);
  const filter = inFilter(seedIds);
  const edges = await supabaseRequest(
    'GET',
    `edges?workspace_id=eq.${workspace}&map_id=eq.${map}&or=(source_id.in.${filter},target_id.in.${filter})&select=source_id,target_id,relation&limit=80`,
  );
  const neighborIds = new Set();
  (Array.isArray(edges) ? edges : []).forEach((edge) => {
    if (!seedIds.includes(edge.source_id)) neighborIds.add(edge.source_id);
    if (!seedIds.includes(edge.target_id)) neighborIds.add(edge.target_id);
  });

  let neighbors = [];
  if (neighborIds.size > 0) {
    const ids = [...neighborIds].slice(0, 20);
    const rows = await supabaseRequest(
      'GET',
      `nodes?workspace_id=eq.${workspace}&map_id=eq.${map}&id=in.${inFilter(ids)}&status=eq.active&select=id,content,desc,type&limit=20`,
    );
    neighbors = (Array.isArray(rows) ? rows : []).map((node) => ({ ...node, score: 0.15, expanded: true }));
  }

  const deduplicated = new Map();
  [...seeds, ...neighbors].forEach((node) => {
    if (!deduplicated.has(node.id)) deduplicated.set(node.id, node);
  });
  return [...deduplicated.values()].slice(0, 20);
}

function deterministicEvidenceAnswer(evidence, intent) {
  const lines = evidence.slice(0, 12).map((node, index) => {
    const description = node.desc ? `：${node.desc}` : '';
    return `${index + 1}. **${node.content}**${description} 〔来源 ${index + 1}〕`;
  });
  return {
    status: 200,
    data: {
      intent,
      type: 'answer',
      reply: `根据当前知识库，找到以下直接相关证据：\n\n${lines.join('\n')}\n\n以上结论仅基于已保存内容；如需更完整结论，请继续补充资料。`,
      sources: evidence.slice(0, 12).map((node, index) => ({ id: node.id, title: node.content, index: index + 1 })),
      grounded: true,
      abstained: false,
      coverage: evidence.some((node) => node.expanded) ? 'partial' : 'direct',
      missingInformation: [],
    },
  };
}

async function answerQuestion(input, mapId, intent, workspaceId) {
  const evidence = await retrieveGraphEvidence(input, mapId, workspaceId);
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
  if (!DASHSCOPE_KEY) return deterministicEvidenceAnswer(evidence, intent);

  const allowedIds = new Set(evidence.map((node) => node.id));
  try {
    const raw = await dashscopeChat([
      {
        role: 'system',
        content: '你是严格基于证据回答的知识助手。只返回 JSON：{"answer":"结论","usedSourceIds":["节点ID"],"coverage":"complete|partial","missingInformation":["缺失信息"]}。不得使用证据之外的信息；证据不足时必须说明缺失，不得猜测。',
      },
      {
        role: 'user',
        content: `问题：${input}\n证据：${JSON.stringify(evidence.map((node) => ({ id: node.id, content: node.content, description: node.desc || '' })))}`,
      },
    ], 'qwen-plus', 900, 0.1);
    const parsed = JSON.parse(stripJsonFence(raw));
    if (!parsed || typeof parsed.answer !== 'string' || !Array.isArray(parsed.usedSourceIds)) throw new Error('Invalid answer schema');
    const usedIds = [...new Set(parsed.usedSourceIds.map(String))].filter((id) => allowedIds.has(id));
    if (usedIds.length === 0) throw new Error('Answer has no valid citations');
    const used = usedIds.map((id) => evidence.find((node) => node.id === id)).filter(Boolean);
    return {
      status: 200,
      data: {
        intent,
        type: 'answer',
        reply: parsed.answer,
        sources: used.map((node, index) => ({ id: node.id, title: node.content, index: index + 1 })),
        grounded: true,
        abstained: false,
        coverage: parsed.coverage === 'complete' ? 'complete' : 'partial',
        missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation.map(String).slice(0, 8) : [],
      },
    };
  } catch (error) {
    console.warn('Grounded answer validation failed; using deterministic answer', { message: error.message });
    return deterministicEvidenceAnswer(evidence, intent);
  }
}

async function handleChat(body, context) {
  const input = body && typeof body.input === 'string' ? body.input.trim() : '';
  const mapId = body && body.mapId ? String(body.mapId) : context.defaultMapId;
  if (!input) return { status: 400, data: { error: 'Input is required', code: 'INVALID_INPUT' } };
  if (input.length > 10000) return { status: 413, data: { error: 'Input is too long', code: 'INPUT_TOO_LARGE' } };

  const intent = { type: classifyInput(input), confidence: 0.9 };
  if (intent.type === 'chitchat') {
    return { status: 200, data: { intent, type: 'chitchat', reply: '你好，我可以帮你整理知识、检索已保存内容，并给出可追溯证据。' } };
  }
  if (intent.type === 'command') {
    return { status: 200, data: { intent, type: 'command', reply: '为了避免误操作，请使用界面中的重命名、清空或删除按钮执行管理操作。' } };
  }
  if (intent.type === 'question') return answerQuestion(input, mapId, intent, context.workspaceId);

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
    const workspace = encodeURIComponent(context.workspaceId);
    const nodes = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${id}&status=eq.active&select=content,type&limit=200`);
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

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }
  return true;
}

async function assertPublicUrl(targetUrl) {
  let parsed;
  try { parsed = new URL(targetUrl); } catch (_) { throw requestError(400, 'INVALID_URL', '请输入有效的文章网址'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw requestError(400, 'INVALID_URL', '仅支持 http 或 https 网址');
  if (parsed.username || parsed.password) throw requestError(400, 'INVALID_URL', '网址不能包含账号信息');
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw requestError(400, 'URL_NOT_ALLOWED', '不允许访问内网地址');
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw requestError(400, 'URL_NOT_ALLOWED', '不允许访问内网地址');
  }
  return parsed;
}

async function fetchArticleText(targetUrl, redirects) {
  const parsed = await assertPublicUrl(targetUrl);
  const transport = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/html,text/plain,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'User-Agent': 'MindGrow-Article-Parser/1.0',
      },
    }, (response) => {
      const status = response.statusCode || 502;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if ((redirects || 0) >= 3) return reject(requestError(400, 'TOO_MANY_REDIRECTS', '文章网址重定向次数过多'));
        const next = new URL(response.headers.location, parsed).toString();
        return fetchArticleText(next, (redirects || 0) + 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(requestError(422, 'ARTICLE_FETCH_FAILED', `文章页面返回 ${status}`));
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml+xml')) {
        response.resume();
        return reject(requestError(415, 'UNSUPPORTED_ARTICLE_TYPE', '该网址不是可解析的网页文章'));
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          response.destroy(requestError(413, 'ARTICLE_TOO_LARGE', '文章页面超过 1MB 限制'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: parsed.toString() }));
      response.on('error', reject);
    });
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => request.destroy(requestError(504, 'ARTICLE_FETCH_TIMEOUT', '读取文章超时')));
    request.on('error', reject);
    request.end();
  });
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToReadableText(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|article|section|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 120000);
}

function normalizedMindMap(value, fallbackTitle) {
  if (!value || typeof value !== 'object') return null;
  const root = String(value.root || fallbackTitle || '').trim().slice(0, 200);
  if (!root) return null;
  const children = (Array.isArray(value.children) ? value.children : []).slice(0, 16).map((child) => ({
    topic: String((child && child.topic) || '要点').trim().slice(0, 200),
    desc: String((child && child.desc) || '').trim().slice(0, 1000),
    items: (Array.isArray(child && child.items) ? child.items : []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20),
  })).filter((child) => child.topic);
  return { root, rootDesc: String(value.rootDesc || '').trim().slice(0, 1000), children, relatedTopics: [] };
}

function fallbackMindMap(title, text) {
  const items = String(text || '').split(/[。！？!?\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
  return {
    root: String(title || '整理结果').slice(0, 200),
    rootDesc: items[0] || '',
    children: items.slice(1).map((item, index) => ({ topic: `要点 ${index + 1}`, desc: item.slice(0, 500), items: [] })),
    relatedTopics: [],
  };
}

async function handleMeetingTool(body) {
  const transcript = String(body.transcript || '').trim();
  if (transcript.length < 10) return { status: 400, data: { error: '请至少输入 10 个字的会议内容', code: 'INVALID_INPUT' } };
  if (transcript.length > 120000) return { status: 413, data: { error: '会议内容超过 12 万字限制', code: 'INPUT_TOO_LARGE' } };
  const title = String(body.title || '会议纪要').trim().slice(0, 200);
  const participants = String(body.participants || '').trim().slice(0, 2000);
  const raw = await dashscopeChat([
    {
      role: 'system',
      content: '你是严谨的会议助手。只返回 JSON：{"title":"","summary":"","topics":[{"title":"","details":[""]}],"decisions":[""],"actionItems":[{"task":"","owner":"","due":"","status":"待办"}],"risks":[""],"openQuestions":[""],"mindMap":{"root":"","rootDesc":"","children":[{"topic":"","desc":"","items":[""]}]}}。不得编造会议中未出现的人名、日期或结论；不确定字段留空。',
    },
    { role: 'user', content: `会议标题：${title}\n参会人：${participants || '未提供'}\n会议原文：\n${transcript}` },
  ], 'qwen-plus', 2400, 0.1);
  let parsed;
  try { parsed = JSON.parse(stripJsonFence(raw)); } catch (_) { parsed = {}; }
  const mindMap = normalizedMindMap(parsed.mindMap, title) || fallbackMindMap(title, transcript);
  return {
    status: 200,
    data: {
      title: String(parsed.title || title),
      summary: String(parsed.summary || mindMap.rootDesc || ''),
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 20) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String).slice(0, 30) : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.slice(0, 50) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 30) : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.map(String).slice(0, 30) : [],
      mindMap,
    },
  };
}

async function handleArticleTool(body) {
  let content = String(body.content || '').trim();
  let sourceUrl = '';
  if (!content && body.url) {
    const fetched = await fetchArticleText(String(body.url), 0);
    content = htmlToReadableText(fetched.html);
    sourceUrl = fetched.finalUrl;
  }
  if (content.length < 50) return { status: 400, data: { error: '请粘贴至少 50 个字的文章，或输入可公开访问的网址', code: 'INVALID_INPUT' } };
  if (content.length > 120000) content = content.slice(0, 120000);
  const raw = await dashscopeChat([
    {
      role: 'system',
      content: '你是忠于原文的文章解析助手。只返回 JSON：{"title":"","summary":"","keyPoints":[""],"arguments":[{"claim":"","evidence":""}],"questions":[""],"mindMap":{"root":"","rootDesc":"","children":[{"topic":"","desc":"","items":[""]}]}}。不得补充原文没有的事实；每个论点要保留原文证据或明确写“原文未给出”。',
    },
    { role: 'user', content: `文章来源：${sourceUrl || '用户粘贴'}\n文章正文：\n${content}` },
  ], 'qwen-plus', 2600, 0.1);
  let parsed;
  try { parsed = JSON.parse(stripJsonFence(raw)); } catch (_) { parsed = {}; }
  const inferredTitle = String(parsed.title || content.split('\n')[0] || '文章解析').slice(0, 200);
  const mindMap = normalizedMindMap(parsed.mindMap, inferredTitle) || fallbackMindMap(inferredTitle, content);
  return {
    status: 200,
    data: {
      title: inferredTitle,
      summary: String(parsed.summary || mindMap.rootDesc || ''),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String).slice(0, 40) : [],
      arguments: Array.isArray(parsed.arguments) ? parsed.arguments.slice(0, 40) : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 30) : [],
      mindMap,
      sourceUrl,
    },
  };
}

async function handleTool(pathname, body) {
  if (pathname.endsWith('/meeting')) return handleMeetingTool(body);
  if (pathname.endsWith('/article')) return handleArticleTool(body);
  return { status: 404, data: { error: 'Tool not found', code: 'NOT_FOUND' } };
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

async function createGraph(workspaceId, mapId, mindMap, source) {
  const now = new Date().toISOString();
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nodes = [];
  const edges = [];
  const rootId = `node_${seed}_r`;
  nodes.push({ id: rootId, workspace_id: workspaceId, content: mindMap.root, desc: mindMap.rootDesc || '', type: 'topic', status: 'active', source, confidence: 1, map_id: mapId, created_at: now, updated_at: now });

  (mindMap.children || []).forEach((child, childIndex) => {
    const childId = `node_${seed}_c${childIndex}`;
    nodes.push({ id: childId, workspace_id: workspaceId, content: child.topic, desc: child.desc || '', type: 'concept', status: 'active', source, confidence: 0.9, map_id: mapId, created_at: now, updated_at: now });
    edges.push({ id: `edge_${seed}_c${childIndex}`, workspace_id: workspaceId, source_id: rootId, target_id: childId, relation: 'contains', weight: 1, map_id: mapId, created_at: now });
    (child.items || []).forEach((item, itemIndex) => {
      const itemId = `node_${seed}_c${childIndex}i${itemIndex}`;
      nodes.push({ id: itemId, workspace_id: workspaceId, content: item, desc: '', type: 'detail', status: 'active', source, confidence: 0.8, map_id: mapId, created_at: now, updated_at: now });
      edges.push({ id: `edge_${seed}_c${childIndex}i${itemIndex}`, workspace_id: workspaceId, source_id: childId, target_id: itemId, relation: 'contains', weight: 0.8, map_id: mapId, created_at: now });
    });
  });
  await supabaseRequest('POST', 'nodes', nodes);
  if (edges.length) await supabaseRequest('POST', 'edges', edges);
  return { nodes, edges };
}

async function updateMapNodeCount(workspaceId, mapId) {
  const id = encodeURIComponent(mapId);
  const workspace = encodeURIComponent(workspaceId);
  const nodes = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${id}&status=eq.active&select=id`);
  const count = Array.isArray(nodes) ? nodes.length : 0;
  await supabaseRequest('PATCH', `maps?workspace_id=eq.${workspace}&id=eq.${id}`, { node_count: count, updated_at: new Date().toISOString() }, 'return=minimal');
  return count;
}

async function handleKnowledge(req, context) {
  const parsed = new URL(req.url, 'http://localhost');
  // Function Compute may still run an older Node.js runtime where
  // Object.fromEntries is unavailable. URLSearchParams#forEach works there.
  const query = {};
  parsed.searchParams.forEach((value, key) => { query[key] = value; });
  const workspaceId = context.workspaceId;
  const workspace = encodeURIComponent(workspaceId);

  if (req.method === 'GET') {
    if (query.action === 'maps') {
      const rows = await supabaseRequest('GET', `maps?workspace_id=eq.${workspace}&select=*&order=is_default.desc,updated_at.desc`);
      if (!Array.isArray(rows)) throw dependencyError('knowledge_store');
      return { status: 200, data: { maps: rows.map(convertMap) } };
    }
    if (query.action === 'categories') {
      const rows = await supabaseRequest('GET', `categories?workspace_id=eq.${workspace}&select=*&order=sort_order.asc`);
      if (!Array.isArray(rows)) throw dependencyError('knowledge_store');
      return {
        status: 200,
        data: { categories: rows.map((category) => ({ id: category.id, name: category.name, icon: category.icon || '📁', color: category.color || '#22d3a7', sortOrder: category.sort_order || 0, createdAt: category.created_at })) },
      };
    }
    const mapId = encodeURIComponent(String(query.mapId || context.defaultMapId));
    const [nodeRows, edgeRows] = await Promise.all([
      supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${mapId}&status=eq.active&select=*&limit=2000`),
      supabaseRequest('GET', `edges?workspace_id=eq.${workspace}&map_id=eq.${mapId}&select=*&limit=4000`),
    ]);
    if (!Array.isArray(nodeRows) || !Array.isArray(edgeRows)) throw dependencyError('knowledge_store');
    return { status: 200, data: { nodes: nodeRows.map(convertNode), edges: edgeRows.map(convertEdge) } };
  }

  if (req.method === 'DELETE') {
    const nodeId = String(query.nodeId || '');
    if (!nodeId) return { status: 400, data: { error: 'nodeId is required', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(nodeId);
    const rows = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&id=eq.${id}&select=map_id&limit=1`);
    const mapId = Array.isArray(rows) && rows[0] ? rows[0].map_id : null;
    if (!mapId) return { status: 404, data: { error: 'Node not found', code: 'NOT_FOUND' } };
    await supabaseRequest('DELETE', `edges?workspace_id=eq.${workspace}&source_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?workspace_id=eq.${workspace}&target_id=eq.${id}`);
    await supabaseRequest('DELETE', `node_layouts?workspace_id=eq.${workspace}&node_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?workspace_id=eq.${workspace}&id=eq.${id}`);
    await updateMapNodeCount(workspaceId, mapId);
    return { status: 200, data: { success: true } };
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (!body.nodeId) return { status: 400, data: { error: 'nodeId is required', code: 'INVALID_INPUT' } };
    const layout = {
      node_id: String(body.nodeId),
      workspace_id: workspaceId,
      map_id: String(body.mapId || context.defaultMapId),
      position_x: Number(body.positionX || 0),
      position_y: Number(body.positionY || 0),
      zoom_level: Number(body.zoomLevel || 1),
    };
    const nodeRows = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(layout.node_id)}&select=id&limit=1`);
    if (!Array.isArray(nodeRows) || !nodeRows[0]) return { status: 404, data: { error: 'Node not found', code: 'NOT_FOUND' } };
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
    const rows = await supabaseRequest('PATCH', `nodes?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(String(body.nodeId))}`, updates, 'return=representation');
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
      workspace_id: workspaceId,
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
        const graph = await createGraph(workspaceId, id, template, 'template');
        nodeCount = graph.nodes.length;
        await supabaseRequest('PATCH', `maps?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(id)}`, { node_count: nodeCount, updated_at: now }, 'return=minimal');
      } catch (error) {
        try {
          await supabaseRequest('DELETE', `edges?workspace_id=eq.${workspace}&map_id=eq.${encodeURIComponent(id)}`);
          await supabaseRequest('DELETE', `nodes?workspace_id=eq.${workspace}&map_id=eq.${encodeURIComponent(id)}`);
          await supabaseRequest('DELETE', `maps?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(id)}`);
        } catch (_) { /* best-effort rollback */ }
        throw error;
      }
    }
    const created = Array.isArray(rows) ? rows[0] : rows;
    return { status: 201, data: { map: convertMap({ ...map, ...(created || {}), node_count: nodeCount }), nodeCount } };
  }

  if (action === 'deleteMap') {
    const mapId = String(body.mapId || '');
    if (!mapId || mapId === context.defaultMapId) return { status: 400, data: { error: 'Cannot delete the default map', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(mapId);
    await supabaseRequest('DELETE', `node_layouts?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `maps?workspace_id=eq.${workspace}&id=eq.${id}`);
    return { status: 200, data: { success: true } };
  }

  if (action === 'clearMap') {
    const mapId = String(body.mapId || '');
    if (!mapId || mapId === context.defaultMapId) return { status: 400, data: { error: 'Cannot clear the default map', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(mapId);
    await supabaseRequest('DELETE', `node_layouts?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('PATCH', `maps?workspace_id=eq.${workspace}&id=eq.${id}`, { node_count: 0, updated_at: new Date().toISOString() }, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (action === 'renameMap' || action === 'moveMapToCategory') {
    if (!body.mapId) return { status: 400, data: { error: 'mapId is required', code: 'INVALID_INPUT' } };
    const changes = action === 'renameMap'
      ? { name: String(body.name || '').trim(), updated_at: new Date().toISOString() }
      : { category_id: body.categoryId || null, updated_at: new Date().toISOString() };
    if (action === 'renameMap' && !changes.name) return { status: 400, data: { error: 'name is required', code: 'INVALID_INPUT' } };
    await supabaseRequest('PATCH', `maps?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(String(body.mapId))}`, changes, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (action === 'createCategory') {
    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const existing = await supabaseRequest('GET', `categories?workspace_id=eq.${workspace}&select=sort_order&order=sort_order.desc&limit=1`);
    const nextOrder = Array.isArray(existing) && existing[0] ? Number(existing[0].sort_order || 0) + 1 : 0;
    const category = { id, workspace_id: workspaceId, name: String(body.name || '新文件夹').trim(), icon: body.icon || '📁', color: body.color || '#22d3a7', sort_order: nextOrder, created_at: now };
    const rows = await supabaseRequest('POST', 'categories', category, 'return=representation');
    const created = Array.isArray(rows) ? rows[0] : rows;
    return { status: 201, data: { category: { id, name: created.name, icon: created.icon, color: created.color, sortOrder: created.sort_order, createdAt: created.created_at } } };
  }

  if (action === 'deleteCategory') {
    if (!body.categoryId) return { status: 400, data: { error: 'categoryId is required', code: 'INVALID_INPUT' } };
    const id = encodeURIComponent(String(body.categoryId));
    await supabaseRequest('PATCH', `maps?workspace_id=eq.${workspace}&category_id=eq.${id}`, { category_id: null }, 'return=minimal');
    await supabaseRequest('DELETE', `categories?workspace_id=eq.${workspace}&id=eq.${id}`);
    return { status: 200, data: { success: true } };
  }

  if (action === 'renameCategory') {
    if (!body.categoryId || !String(body.name || '').trim()) return { status: 400, data: { error: 'categoryId and name are required', code: 'INVALID_INPUT' } };
    await supabaseRequest('PATCH', `categories?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(String(body.categoryId))}`, { name: String(body.name).trim() }, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (body.mindMap && body.mindMap.root) {
    const mapId = String(body.mapId || context.defaultMapId);
    const graph = await createGraph(workspaceId, mapId, body.mindMap, body.source || 'ai_generated');
    await updateMapNodeCount(workspaceId, mapId);
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-Workspace-Id');
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
    const user = await authenticateUser(req);
    if (pathname === '/api/workspaces' || pathname === '/mindgrow/api/workspaces') {
      result = await handleWorkspaces(req, user);
    } else if (pathname === '/api/tools/meeting' || pathname === '/mindgrow/api/tools/meeting'
      || pathname === '/api/tools/article' || pathname === '/mindgrow/api/tools/article') {
      if (req.method !== 'POST') result = { status: 405, data: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
      else {
        await resolveWorkspace(req, user);
        result = await handleTool(pathname, await readBody(req));
      }
    } else if (pathname === '/api/chat' || pathname === '/mindgrow/api/chat') {
      if (req.method !== 'POST') result = { status: 405, data: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } };
      else {
        const workspace = await resolveWorkspace(req, user);
        result = await handleChat(await readBody(req), { user, workspaceId: workspace.id, defaultMapId: workspace.defaultMapId });
      }
    } else if (pathname === '/api/knowledge' || pathname === '/mindgrow/api/knowledge') {
      const workspace = await resolveWorkspace(req, user);
      result = await handleKnowledge(req, { user, workspaceId: workspace.id, defaultMapId: workspace.defaultMapId });
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
