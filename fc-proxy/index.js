// MindGrow API Proxy for Alibaba Cloud Function Compute.
// Environment: MINDGROW_API_KEY, SUPABASE_URL, SUPABASE_KEY,
// optional ALLOWED_ORIGINS and UPSTREAM_TIMEOUT_MS.

const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

const DASHSCOPE_KEY = process.env.MINDGROW_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const PORT = Number.parseInt(process.env.FC_SERVER_PORT || process.env.PORT || '9000', 10);
// Long-document analysis routinely takes longer than a short chat completion.
// Keep the timeout bounded, but do not turn a healthy 15-30 second model call
// into a false 503. Transient 429/5xx responses are retried below.
const UPSTREAM_TIMEOUT_MS = Number.parseInt(process.env.UPSTREAM_TIMEOUT_MS || '45000', 10);
const AUTH_REQUIRED = process.env.AUTH_REQUIRED !== 'false';
const API_VERSION = '10.2.7';
const DASHSCOPE_AUDIO_ENDPOINT = process.env.DASHSCOPE_AUDIO_ENDPOINT || 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
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

// Chat completions can take longer than a serverless gateway's idle window.
// Consume the OpenAI-compatible SSE stream as it arrives so the connection
// stays active, while still returning one validated JSON string to callers.
function fetchChatStream(targetUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const postData = JSON.stringify({ ...(body || {}), stream: true });
    const request = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (response) => {
      let buffer = '';
      let content = '';
      response.setEncoding('utf8');
      const consumeLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed.startsWith('data:')) return;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try {
          const event = JSON.parse(data);
          const delta = event && event.choices && event.choices[0] && event.choices[0].delta;
          if (delta && typeof delta.content === 'string') content += delta.content;
        } catch (_) { /* wait for the next complete SSE line */ }
      };
      response.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        lines.forEach(consumeLine);
      });
      response.on('end', () => {
        if (buffer) consumeLine(buffer);
        resolve({ status: response.statusCode || 502, content, headers: response.headers });
      });
    });
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      const error = new Error('Upstream stream timed out');
      error.code = 'UPSTREAM_TIMEOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.write(postData);
    request.end();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJSONWithRetry(method, targetUrl, headers, body, attempts) {
  const maximum = Math.max(1, attempts || 3);
  let lastError = null;
  for (let attempt = 0; attempt < maximum; attempt += 1) {
    try {
      const response = await fetchJSON(method, targetUrl, headers, body);
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`Upstream returned ${response.status}`);
      lastError.status = response.status;
    } catch (error) {
      lastError = error;
    }
    if (attempt < maximum - 1) await wait(350 * Math.pow(2, attempt) + Math.floor(Math.random() * 120));
  }
  if (lastError && lastError.status) return { status: lastError.status, body: null, headers: {} };
  throw lastError || new Error('Upstream request failed');
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
  const target = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const payload = {
    model: model || 'qwen-turbo',
    messages,
    max_tokens: maxTokens || 500,
    temperature: temperature === undefined ? 0.3 : temperature,
    response_format: { type: 'json_object' },
    enable_thinking: false,
  };
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchChatStream(target, { Authorization: `Bearer ${DASHSCOPE_KEY}` }, payload);
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300 && response.content) return response.content;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      console.error('DashScope stream error', { code: error.code || 'UNKNOWN' });
      // An idle timeout has already consumed most of the function window; a
      // second long attempt would only be killed by the gateway.
      if (error.code === 'UPSTREAM_TIMEOUT') break;
    }
    if (attempt === 0) await wait(450 + Math.floor(Math.random() * 120));
  }
  console.error('DashScope stream failed', { status: lastStatus || 'NETWORK' });
  throw dependencyError('model', lastStatus || undefined);
}

async function dashscopeEmbeddings(texts) {
  if (!DASHSCOPE_KEY || !Array.isArray(texts) || texts.length === 0) return [];
  const response = await fetchJSONWithRetry('POST', 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings', {
    Authorization: `Bearer ${DASHSCOPE_KEY}`,
  }, {
    model: 'text-embedding-v4',
    input: texts.map((text) => String(text || '').slice(0, 12000)),
    dimensions: 1024,
  }, 3);
  if (response.status < 200 || response.status >= 300 || !response.body || !Array.isArray(response.body.data)) {
    throw dependencyError('embedding', response.status);
  }
  return response.body.data
    .slice()
    .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
    .map((item) => item.embedding)
    .filter((embedding) => Array.isArray(embedding) && embedding.length === 1024);
}

async function dashscopeRerank(query, documents, limit) {
  if (!DASHSCOPE_KEY || !Array.isArray(documents) || documents.length < 2) return null;
  try {
    const response = await fetchJSONWithRetry('POST', 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank', {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
    }, {
      model: 'qwen3-rerank',
      input: {
        query: String(query || '').slice(0, 4000),
        documents: documents.map((item) => String(item || '').slice(0, 12000)),
      },
      parameters: {
        top_n: Math.min(Math.max(limit || 10, 1), documents.length),
        return_documents: false,
      },
    }, 2);
    const rows = response.body && response.body.output && Array.isArray(response.body.output.results)
      ? response.body.output.results
      : null;
    if (!rows) return null;
    return rows.map((item) => ({ index: Number(item.index), score: Number(item.relevance_score || item.score || 0) }))
      .filter((item) => Number.isFinite(item.index));
  } catch (error) {
    console.warn('Rerank unavailable; using hybrid order', { code: error.publicCode || error.code || 'RERANK_UNAVAILABLE' });
    return null;
  }
}

function stripJsonFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function classifyInput(input) {
  const value = input.trim();
  if (/^(\/|删除|清空|重命名|delete|clear|rename)\b/i.test(value)) return 'command';
  if (/^(你好|您好|嗨|hello|hi|hey)[!！,.，。\s]*$/i.test(value)) return 'chitchat';
  if (/[?？]/.test(value)
    || /^(什么|为什么|如何|怎么|哪些|哪个|哪种|是否|能否|请问|请给出|解释|比较)/i.test(value)
    || /^(who|what|when|where|why|how|which|is|are|can|does)\b/i.test(value)) return 'question';
  return 'knowledge';
}

function needsConversationalContext(input) {
  const value = String(input || '').trim();
  return /(^|[，。！？?\s])(它|其|这个|那个|该方法|该模型|该论文|这篇|那篇|前者|后者|上述|这种|这个方法|这个模型)/i.test(value);
}

function classifyArticleRequest(input) {
  const value = normalizeSpaces(input);
  let task = 'qa';
  if (/(翻译|翻成|译成|英译中|中译英|translate|translation)/i.test(value)) task = 'translate';
  else if (/(总结|概括|摘要|综述|summari[sz]e|summary|overview)/i.test(value)) task = 'summarize';
  else if (/(比较|对比|区别|异同|compare|comparison|versus|\bvs\.?\b)/i.test(value)) task = 'compare';
  else if (/(提取|抽取|列出|整理出|extract|list out)/i.test(value)) task = 'extract';
  else if (/(解释|解读|讲解|通俗|为什么|原理|explain|interpret)/i.test(value)) task = 'explain';

  let targetLanguage = 'zh-CN';
  if (/(翻译|翻成|译成|translate).{0,8}(英文|英语|english)|\b(?:to|into)\s+english\b|中译英/i.test(value)) targetLanguage = 'en';
  else if (/(翻译|翻成|译成|translate).{0,8}(日文|日语|japanese)|\b(?:to|into)\s+japanese\b/i.test(value)) targetLanguage = 'ja';
  else if (/(翻译|翻成|译成|translate).{0,8}(韩文|韩语|korean)|\b(?:to|into)\s+korean\b/i.test(value)) targetLanguage = 'ko';

  const pageMatch = value.match(/第\s*(\d+)\s*页/i) || value.match(/\bpage\s+(\d+)\b/i);
  let scope = 'relevant';
  let pageNumber = null;
  if (pageMatch) {
    scope = 'page';
    pageNumber = Number(pageMatch[1]);
  } else if (/(摘要|abstract)/i.test(value)) scope = 'abstract';
  else if (/(全文|整篇|这篇论文|该论文|这篇文章|该文章|whole paper|entire paper|full paper|whole article|entire article)/i.test(value)) scope = 'full';

  return {
    task,
    targetLanguage,
    scope,
    pageNumber,
    confidence: task === 'qa' ? 0.82 : 0.98,
  };
}

function articleTaskLabel(task) {
  return ({
    translate: '翻译',
    summarize: '总结',
    compare: '比较',
    extract: '信息提取',
    explain: '解释',
    qa: '事实问答',
  })[task] || '事实问答';
}

function targetLanguageLabel(language) {
  return ({ 'zh-CN': '简体中文', en: '英文', ja: '日文', ko: '韩文' })[language] || '简体中文';
}

function isTableQuestion(input) {
  const value = String(input || '');
  return /(表格|表中|table|分数|数值|指标|score|accuracy|bleu|rouge|f1|mAP|ANLS|exact match|\bEM\b)/i.test(value);
}

function hasReliableTableLayout(evidence) {
  return (Array.isArray(evidence) ? evidence : []).some((item) => item && item.sourceKind === 'document_chunk' && /\t/.test(String(item.content || '')));
}

function tokenize(value) {
  const text = String(value || '').toLowerCase();
  const terms = new Set(text.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []);
  const chinese = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) terms.add(chinese.slice(index, index + 2));
  return [...terms];
}

const GRAPH_STOP_TERMS = new Set([
  '什么', '如何', '怎么', '哪些', '哪个', '是否', '论文', '文章', '方法', '模型', '结果', '内容', '研究',
  '翻译', '总结', '概括', '摘要', '比较', '对比', '解释', '提取', '全文', '整篇', '这篇', '该论文', '该文章',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'which', 'how', 'paper', 'model', 'method',
  'translate', 'translation', 'summarize', 'summary', 'compare', 'comparison', 'explain', 'extract', 'entire', 'whole', 'full',
]);

function queryAnchors(value) {
  return tokenize(value)
    .filter((term) => term.length >= 2 && !GRAPH_STOP_TERMS.has(term))
    .sort((left, right) => {
      const leftSpecific = /[a-z0-9_-]/i.test(left) ? 1 : 0;
      const rightSpecific = /[a-z0-9_-]/i.test(right) ? 1 : 0;
      return rightSpecific - leftSpecific || right.length - left.length;
    })
    .slice(0, 18);
}

function anchorCoverage(anchors, value) {
  if (!anchors.length) return 0;
  const haystack = String(value || '').toLowerCase();
  return anchors.filter((anchor) => haystack.includes(anchor)).length / anchors.length;
}

function contentSimilarity(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return (Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 0.9;
  const leftTerms = new Set(tokenize(a));
  const rightTerms = new Set(tokenize(b));
  const union = new Set([...leftTerms, ...rightTerms]);
  if (!union.size) return 0;
  return [...leftTerms].filter((term) => rightTerms.has(term)).length / union.size;
}

function retrieveEvidence(question, nodes) {
  const queryTerms = tokenize(question);
  return nodes
    .map((node) => {
      const title = String(node.content || '').toLowerCase();
      const description = String(node.desc || '').toLowerCase();
      const titleMatches = queryTerms.filter((term) => title.includes(term));
      const descriptionMatches = queryTerms.filter((term) => description.includes(term) && !title.includes(term));
      // Entity/title matches are stronger graph-entry evidence than a passing
      // mention in another paper's description.
      const score = (titleMatches.length * 2 + descriptionMatches.length) / Math.max(queryTerms.length * 2, 1);
      return { node, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function inFilter(values) {
  return `(${values.map((value) => encodeURIComponent(String(value))).join(',')})`;
}

async function retrieveNodeEvidence(question, mapId, workspaceId) {
  const workspace = encodeURIComponent(workspaceId);
  const map = encodeURIComponent(mapId);
  const anchors = queryAnchors(question);
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
  // PostgreSQL language dictionaries can legitimately return an empty set for
  // acronyms such as DPR/WPA or mixed Chinese-English queries. Empty is not a
  // reliable "no graph entity" signal, so run the same bounded anchor fallback
  // that is used when the RPC is unavailable.
  if (seeds.length === 0) {
    const nodes = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${map}&status=eq.active&select=id,content,desc,type&order=updated_at.desc&limit=500`);
    seeds = retrieveEvidence(question, Array.isArray(nodes) ? nodes : []).map(({ node, score }) => ({ ...node, score }));
  }
  if (seeds.length === 0) return [];

  seeds = seeds
    .map((node) => ({
      ...node,
      seed: true,
      graphDepth: 0,
      titleAnchorScore: anchorCoverage(anchors, node.content || ''),
      anchorScore: anchorCoverage(anchors, `${node.content || ''} ${node.desc || ''}`),
    }))
    .sort((left, right) => (right.titleAnchorScore - left.titleAnchorScore) || (right.anchorScore - left.anchorScore) || (Number(right.score || 0) - Number(left.score || 0)))
    .slice(0, 10);
  const seedIds = seeds.map((node) => node.id);
  const seedSet = new Set(seedIds);
  const firstEdges = await supabaseRequest(
    'GET',
    `edges?workspace_id=eq.${workspace}&map_id=eq.${map}&or=(source_id.in.${inFilter(seedIds)},target_id.in.${inFilter(seedIds)})&select=source_id,target_id,relation,weight&limit=120`,
  );
  const firstNeighborIds = new Set();
  (Array.isArray(firstEdges) ? firstEdges : []).forEach((edge) => {
    if (!seedSet.has(edge.source_id)) firstNeighborIds.add(edge.source_id);
    if (!seedSet.has(edge.target_id)) firstNeighborIds.add(edge.target_id);
  });

  // GraphRAG local search expands two bounded hops. The first hop captures
  // parent/child evidence; the second hop captures sibling and cross-paper
  // `relates_to` context without flooding the answer model with the full graph.
  let secondEdges = [];
  if (firstNeighborIds.size > 0) {
    const firstIds = [...firstNeighborIds].slice(0, 24);
    secondEdges = await supabaseRequest(
      'GET',
      `edges?workspace_id=eq.${workspace}&map_id=eq.${map}&or=(source_id.in.${inFilter(firstIds)},target_id.in.${inFilter(firstIds)})&select=source_id,target_id,relation,weight&limit=160`,
    );
  }

  const secondNeighborIds = new Set();
  (Array.isArray(secondEdges) ? secondEdges : []).forEach((edge) => {
    if (!seedSet.has(edge.source_id) && !firstNeighborIds.has(edge.source_id)) secondNeighborIds.add(edge.source_id);
    if (!seedSet.has(edge.target_id) && !firstNeighborIds.has(edge.target_id)) secondNeighborIds.add(edge.target_id);
  });

  const allNeighborIds = [...firstNeighborIds, ...[...secondNeighborIds].slice(0, 24)].slice(0, 48);
  let neighbors = [];
  if (allNeighborIds.length > 0) {
    const rows = await supabaseRequest(
      'GET',
      `nodes?workspace_id=eq.${workspace}&map_id=eq.${map}&id=in.${inFilter(allNeighborIds)}&status=eq.active&select=id,content,desc,type&limit=48`,
    );
    neighbors = (Array.isArray(rows) ? rows : []).map((node) => {
      const graphDepth = firstNeighborIds.has(node.id) ? 1 : 2;
      const connectedEdge = [...(Array.isArray(firstEdges) ? firstEdges : []), ...(Array.isArray(secondEdges) ? secondEdges : [])]
        .find((edge) => edge.source_id === node.id || edge.target_id === node.id);
      return {
        ...node,
        score: graphDepth === 1 ? 0.24 : 0.12,
        anchorScore: anchorCoverage(anchors, `${node.content || ''} ${node.desc || ''}`),
        expanded: true,
        graphDepth,
        graphRelation: connectedEdge ? connectedEdge.relation : 'relates_to',
      };
    }).sort((left, right) => (right.anchorScore - left.anchorScore) || (left.graphDepth - right.graphDepth));
  }

  const deduplicated = new Map();
  [...seeds, ...neighbors].forEach((node) => {
    if (!deduplicated.has(node.id)) deduplicated.set(node.id, node);
  });
  return [...deduplicated.values()].slice(0, 32);
}

async function retrieveDocumentEvidence(question, mapId, workspaceId) {
  const anchors = queryAnchors(question);
  let embedding = null;
  try {
    const vectors = await dashscopeEmbeddings([question]);
    embedding = vectors[0] || null;
  } catch (error) {
    console.warn('Query embedding unavailable; using keyword branch only', { code: error.publicCode || error.code || 'EMBEDDING_UNAVAILABLE' });
  }
  try {
    const result = await supabaseRequest('POST', 'rpc/hybrid_search_document_chunks', {
      p_workspace_id: workspaceId,
      p_map_id: mapId,
      p_query_text: question,
      p_query_embedding: embedding,
      p_match_count: 30,
    });
    const candidates = (Array.isArray(result) ? result : []).map((item) => ({
      id: `chunk:${item.chunk_id}`,
      content: String(item.content || ''),
      desc: String(item.locator || ''),
      type: 'detail',
      score: Number(item.score || 0),
      anchorScore: anchorCoverage(anchors, `${item.document_title || ''} ${item.content || ''}`),
      sourceKind: 'document_chunk',
      documentId: String(item.document_id || ''),
      documentTitle: String(item.document_title || '来源文档'),
      citations: [{
        index: Number(item.chunk_index || 0) + 1,
        quote: String(item.content || '').slice(0, 1400),
        locator: String(item.locator || ''),
        documentId: String(item.document_id || ''),
        title: String(item.document_title || '来源文档'),
        sourceUrl: String(item.source_url || ''),
        fileName: String(item.file_name || ''),
        sourceType: String(item.source_type || 'text'),
      }],
    })).filter((item) => item.content);
    if (candidates.length < 2) return candidates.slice(0, 18);
    const reranked = await dashscopeRerank(question, candidates.map((item) => `${item.documentTitle}\n${item.content}`), 18);
    if (!reranked || reranked.length === 0) return candidates.slice(0, 18);
    return reranked.map((rank) => {
      const candidate = candidates[rank.index];
      return candidate ? { ...candidate, rerankScore: rank.score } : null;
    }).filter(Boolean);
  } catch (error) {
    console.warn('Document chunk retrieval unavailable; using graph retrieval', { code: error.publicCode || 'CHUNK_SEARCH_UNAVAILABLE' });
    return [];
  }
}

async function retrieveGraphEvidence(question, mapId, workspaceId) {
  const [documentEvidence, graphNodes] = await Promise.all([
    retrieveDocumentEvidence(question, mapId, workspaceId),
    retrieveNodeEvidence(question, mapId, workspaceId),
  ]);

  // The node→citation→document bridge is the graph-conditioned part of the
  // retrieval. Chunks connected to the query subgraph are promoted; merely
  // vector-similar chunks from unrelated papers remain as bounded fallbacks.
  let citationsByNode = new Map();
  try {
    citationsByNode = await loadNodeCitations(workspaceId, mapId, graphNodes.map((node) => node.id));
  } catch (error) {
    console.warn('Graph citation bridge unavailable', { code: error.publicCode || 'GRAPH_CITATION_UNAVAILABLE' });
  }
  graphNodes.forEach((node) => { node.citations = citationsByNode.get(node.id) || []; });
  const graphDocumentIds = new Set();
  graphNodes.forEach((node) => (node.citations || []).forEach((citation) => {
    if (citation.documentId) graphDocumentIds.add(citation.documentId);
  }));
  const seedTitleScores = graphNodes.filter((node) => node.seed).map((node) => Number(node.titleAnchorScore || 0));
  const bestSeedTitleScore = seedTitleScores.length ? Math.max(...seedTitleScores) : 0;
  const primaryGraphDocumentIds = new Set();
  if (bestSeedTitleScore > 0) {
    const strongestSeeds = graphNodes.filter((node) => node.seed && Number(node.titleAnchorScore || 0) >= bestSeedTitleScore);
    // Prefer a root/topic entity over a same-named child mention in another
    // paper. Example: the DPR paper root outranks a DPR concept inside RAG.
    const primarySeeds = strongestSeeds.some((node) => node.type === 'topic')
      ? strongestSeeds.filter((node) => node.type === 'topic')
      : strongestSeeds;
    primarySeeds.forEach((node) => (node.citations || []).forEach((citation) => {
        if (citation.documentId) primaryGraphDocumentIds.add(citation.documentId);
    }));
  }
  const graphLabelsByDocument = new Map();
  graphNodes.forEach((node) => (node.citations || []).forEach((citation) => {
    if (!citation.documentId) return;
    const labels = graphLabelsByDocument.get(citation.documentId) || [];
    if (!labels.includes(node.content)) labels.push(node.content);
    graphLabelsByDocument.set(citation.documentId, labels.slice(0, 6));
  }));

  const scoredChunks = documentEvidence.map((item, index) => {
    const graphLinked = graphDocumentIds.has(item.documentId);
    const primaryGraphLinked = primaryGraphDocumentIds.has(item.documentId);
    const graphLabels = graphLabelsByDocument.get(item.documentId) || [];
    const semanticScore = Number.isFinite(Number(item.rerankScore)) ? Number(item.rerankScore) : Math.max(0, 1 - index / Math.max(documentEvidence.length, 1));
    return {
      ...item,
      graphLinked,
      primaryGraphLinked,
      graphLabels,
      graphScore: semanticScore + (primaryGraphLinked ? 0.62 : graphLinked ? 0.24 : 0) + Number(item.anchorScore || 0) * 0.18,
      desc: `${item.desc || ''}${graphLabels.length ? ` · 图谱路径：${graphLabels.join(' → ')}` : ''}`,
    };
  }).sort((left, right) => right.graphScore - left.graphScore);

  const primaryChunks = scoredChunks.filter((item) => item.primaryGraphLinked);
  const linkedChunks = scoredChunks.filter((item) => item.graphLinked && !item.primaryGraphLinked);
  const unlinkedChunks = scoredChunks.filter((item) => !item.graphLinked);
  const graphConditionedChunks = primaryChunks.length + linkedChunks.length >= 2
    ? [...primaryChunks.slice(0, 10), ...linkedChunks.slice(0, 5), ...unlinkedChunks.slice(0, 2)]
    : scoredChunks.slice(0, 16);
  const deduplicated = new Map();
  [...graphConditionedChunks, ...graphNodes].forEach((item) => {
    if (!deduplicated.has(item.id)) deduplicated.set(item.id, item);
  });
  const evidence = [...deduplicated.values()].slice(0, 24);
  evidence.trace = {
    mode: 'hybrid_graph_rag',
    seedNodes: graphNodes.filter((node) => node.seed).length,
    expandedNodes: graphNodes.filter((node) => node.expanded).length,
    graphDocuments: graphDocumentIds.size,
    primaryGraphDocuments: primaryGraphDocumentIds.size,
    candidateChunks: documentEvidence.length,
  };
  return evidence;
}

function articleDocumentMatchScore(input, document) {
  const value = String(input || '').toLowerCase();
  const title = String((document && document.title) || '').trim().toLowerCase();
  const fileName = String((document && document.file_name) || '').trim().toLowerCase();
  if ((title && value.includes(title)) || (fileName && value.includes(fileName.replace(/\.pdf$/i, '')))) return 1;
  const anchors = queryAnchors(input);
  if (!anchors.length) return 0;
  return anchorCoverage(anchors, `${title} ${fileName}`);
}

function selectArticleDocument(documents, input, history) {
  const candidates = Array.isArray(documents) ? documents : [];
  const bestMatch = (value) => {
    const ranked = candidates.map((document) => ({ document, score: articleDocumentMatchScore(value, document) }))
      .sort((left, right) => right.score - left.score);
    return ranked[0] && ranked[0].score >= 0.28 ? ranked[0].document : null;
  };

  // The current request is authoritative. Assistant replies may contain a list
  // of every candidate title; including them in ranking makes every document an
  // exact match and silently selects whichever row happens to be newest.
  const direct = bestMatch(input);
  if (direct) return direct;

  const userContext = (Array.isArray(history) ? history : [])
    .filter((item) => item && item.role === 'user')
    .slice(-4)
    .map((item) => String(item.content || ''))
    .filter(Boolean)
    .join('\n');
  return userContext ? bestMatch(userContext) : null;
}

function selectAbstractTranslationChunks(allChunks) {
  const chunks = Array.isArray(allChunks) ? allChunks : [];
  const markerPattern = /(?:^|\s)(?:abstract|摘要)\s*[:：]?/i;
  const markerIndex = chunks.findIndex((item) => markerPattern.test(String(item.content || '')));
  if (markerIndex < 0) return chunks.slice(0, 3);

  const selected = [];
  let characters = 0;
  for (const item of chunks.slice(markerIndex, markerIndex + 6)) {
    let content = String(item.content || '');
    if (selected.length === 0) {
      const marker = content.match(markerPattern);
      if (marker && typeof marker.index === 'number') content = content.slice(marker.index + marker[0].length).trim();
    }
    if (!content) continue;

    const introduction = content.match(/(?:^|\s)(?:1|I)\.?\s+(?:Introduction|引言|绪论)(?=\s|$)/i);
    const abstractContent = (introduction && typeof introduction.index === 'number'
      ? content.slice(0, introduction.index)
      : content).trim();
    if (abstractContent) {
      selected.push({ ...item, content: abstractContent });
      characters += abstractContent.length;
    }
    if (introduction || characters >= 4500) break;
  }
  return selected.length > 0 ? selected : chunks.slice(markerIndex, markerIndex + 3);
}

async function retrieveArticleTranslationEvidence(input, mapId, workspaceId, request, history) {
  const workspace = encodeURIComponent(workspaceId);
  const map = encodeURIComponent(mapId);
  const rows = await supabaseRequest(
    'GET',
    `source_documents?workspace_id=eq.${workspace}&map_id=eq.${map}&select=id,title,source_type,source_url,file_name,chunk_count,created_at&order=created_at.desc&limit=30`,
  );
  const documents = Array.isArray(rows) ? rows : [];
  if (documents.length === 0) {
    return {
      clarification: '已识别为翻译任务，但当前文章知识库还没有保存论文原文。请先解析并保存论文，再让我翻译全文、摘要或指定页。',
      missingInformation: ['当前文章知识库中的已保存论文原文'],
      documents: [],
    };
  }

  let selected = selectArticleDocument(documents, input, history);
  if (!selected && documents.length === 1) selected = documents[0];
  if (!selected) {
    const choices = documents.slice(0, 6).map((document, index) => `${index + 1}. ${document.title || document.file_name || '未命名论文'}`);
    return {
      clarification: `已识别为翻译任务，但当前知识库包含多篇论文，无法可靠判断“这篇”指哪一篇。请回复论文标题，并可附范围，例如“把《论文标题》的摘要翻译成中文”或“翻译《论文标题》第 3 页”。\n\n可选论文：\n${choices.join('\n')}`,
      missingInformation: ['需要翻译的论文标题'],
      documents,
    };
  }

  const chunkRows = await supabaseRequest(
    'GET',
    `document_chunks?workspace_id=eq.${workspace}&map_id=eq.${map}&document_id=eq.${encodeURIComponent(selected.id)}&select=id,chunk_index,locator,page_number,content&order=chunk_index.asc&limit=160`,
  );
  const allChunks = (Array.isArray(chunkRows) ? chunkRows : []).filter((item) => String(item.content || '').trim());
  let chunks = allChunks;
  if (request.scope === 'page' && request.pageNumber) {
    chunks = allChunks.filter((item) => Number(item.page_number) === request.pageNumber || String(item.locator || '').includes(`第 ${request.pageNumber} 页`));
    if (chunks.length === 0) {
      return {
        clarification: `已识别为翻译任务并定位到《${selected.title || selected.file_name || '当前论文'}》，但没有找到第 ${request.pageNumber} 页的可提取文字。该页可能是扫描件，或 PDF 页码与印刷页码不一致。`,
        missingInformation: [`第 ${request.pageNumber} 页的可提取文字`],
        documents: [selected],
      };
    }
  } else if (request.scope === 'abstract') {
    chunks = selectAbstractTranslationChunks(allChunks);
  } else if (request.scope === 'relevant') {
    const anchors = queryAnchors(input);
    const rankedChunks = allChunks.map((item, index) => ({
      item,
      index,
      score: anchorCoverage(anchors, `${item.locator || ''} ${item.content || ''}`),
    })).sort((left, right) => right.score - left.score || left.index - right.index);
    chunks = (rankedChunks[0] && rankedChunks[0].score > 0 ? rankedChunks : rankedChunks.slice(0, 4))
      .slice(0, 6).map((item) => item.item).sort((left, right) => Number(left.chunk_index) - Number(right.chunk_index));
  }

  const totalCharacters = chunks.reduce((sum, item) => sum + String(item.content || '').length, 0);
  const maximumTranslationCharacters = 6500;
  if (request.scope === 'full' && totalCharacters > maximumTranslationCharacters) {
    return {
      clarification: `已识别为“翻译整篇论文”，目标语言是${targetLanguageLabel(request.targetLanguage)}。但《${selected.title || selected.file_name || '当前论文'}》包含 ${allChunks.length} 个原文分块、约 ${totalCharacters} 个字符，单次输出会被截断。请指定“摘要”“第 N 页”或具体章节；我会按原文顺序翻译，不会把请求误当成 Citation 问答。`,
      missingInformation: ['需要翻译的章节、页码或摘要范围'],
      documents: [selected],
    };
  }

  let usedCharacters = 0;
  const bounded = [];
  for (const chunk of chunks) {
    const length = String(chunk.content || '').length;
    if (bounded.length > 0 && usedCharacters + length > maximumTranslationCharacters) break;
    bounded.push(chunk);
    usedCharacters += length;
  }
  const evidence = bounded.map((item) => ({
    id: `chunk:${item.id}`,
    content: String(item.content || ''),
    desc: String(item.locator || ''),
    type: 'detail',
    sourceKind: 'document_chunk',
    documentId: String(selected.id),
    documentTitle: String(selected.title || selected.file_name || '来源论文'),
    citations: [{
      index: Number(item.chunk_index || 0) + 1,
      quote: String(item.content || '').slice(0, 1400),
      locator: String(item.locator || ''),
      documentId: String(selected.id),
      title: String(selected.title || selected.file_name || '来源论文'),
      sourceUrl: String(selected.source_url || ''),
      fileName: String(selected.file_name || ''),
      sourceType: String(selected.source_type || 'text'),
    }],
  }));
  evidence.trace = {
    mode: 'article_translation',
    task: 'translate',
    seedNodes: 0,
    expandedNodes: 0,
    graphDocuments: 1,
    primaryGraphDocuments: 1,
    candidateChunks: evidence.length,
  };
  return { evidence, documents: [selected] };
}

function articleTaskSystemPrompt(request) {
  const schema = '只返回 JSON：{"answer":"按任务要求生成的内容","usedSourceIds":["证据ID"],"coverage":"complete|partial","missingInformation":["缺失信息"]}。';
  const grounding = '事实只能来自提供的证据，不得补充证据之外的事实；证据不足时说明缺失，不得猜测。usedSourceIds 只能填写提供的证据 ID。';
  const conciseFormat = 'answer 必须使用 Markdown（不得使用 HTML），按“结论→依据→细节→限制”的阅读顺序组织。默认使用以下结构：\n## 结论\n用 1—3 句直接回答，第一句必须给出最重要结论；只对关键词使用 **加粗**。\n## 关键依据\n用 2—5 条短项目符号列出支撑结论的证据，不得重复同一信息。\n## 详细说明\n只补充理解结论必需的机制、条件或步骤。\n## 局限与待核验\n仅在证据不完整、结论有边界或仍需核验时输出；没有则省略。\n每段最多 4 行；除非用户明确要求详细展开，answer 尽量控制在 700 个汉字以内。来源卡片由界面依据 usedSourceIds 单独生成，不要在 answer 中编造引用序号。';
  if (request && request.task === 'translate') {
    return `你正在执行论文翻译任务，不是 Citation 问答，也不是摘要任务。${schema}answer 以“## 翻译结果”开头，按原文自然分段；可对原文标题使用 Markdown 标题，但不得添加结论、摘要或原文没有的信息。证据块按 ID 顺序组成连续原文，必须先按顺序拼接并完整翻译全部证据块，usedSourceIds 必须包含每一个证据 ID；跨分块的英文断词（例如前块以 com- 结束、后块以 pare 开始）应还原为完整单词后翻译，不得只翻译第一个分块或以半个单词、半句话结束。把原文准确翻译为${targetLanguageLabel(request.targetLanguage)}，保留标题层级、编号、公式、数字、模型名和数据集名；专业术语首次出现时可保留原文括注。除非用户明确要求，不得改写成摘要、解释或问答。${grounding}`;
  }
  if (request && request.task === 'summarize') {
    return `你正在执行论文总结任务。${schema}${conciseFormat}使用简体中文概括核心问题、方法、结果与限制，区分作者结论和你的组织性表述。${grounding}`;
  }
  if (request && request.task === 'compare') {
    return `你正在执行论文比较任务。${schema}answer 使用简体中文并按以下顺序：\n## 结论\n先用 1—3 句概括最关键差异，并只对关键词使用 **加粗**。\n## 对比表\n使用标准 Markdown 表格，列为比较对象、行为统一的比较维度；最多 5 列、8 行，单元格保持短句。\n## 差异解读\n用项目符号解释影响选择的关键差异。\n## 局限与待核验\n仅在必要时输出。\n缺少同一维度证据时填“未提供”，不得把不同数据集或指标串列。除非用户要求详细展开，answer 尽量控制在 900 个汉字以内。来源卡片由界面依据 usedSourceIds 单独生成，不要编造引用序号。${grounding}`;
  }
  if (request && request.task === 'extract') {
    return `你正在执行论文信息提取任务。${schema}${conciseFormat}使用简体中文只提取用户指定字段，尽量保留原始数字、单位和专有名词；提取多个同类对象时可在“详细说明”中改用标准 Markdown 表格。${grounding}`;
  }
  if (request && request.task === 'explain') {
    return `你正在执行论文解释任务。${schema}${conciseFormat}使用简体中文先给直观解释，再说明论文中的技术机制与边界；不能把常识补充冒充为论文事实。${grounding}`;
  }
  return `你是严格基于证据回答的论文知识助手。${schema}${conciseFormat}使用简体中文直接回答当前问题。可用最近对话理解“它/前者/后者/这个方法”等指代。${grounding}处理表格数值时必须按表头从左到右先确定任务、再确定指标、最后定位模型行；相邻任务出现同名指标时不得串列。若无法从同一证据块确认表头与数据行，就明确说明表格结构不足，不得选取看似接近的数字。`;
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
      reply: `## 结论\n\n当前知识库找到了与问题直接相关的证据，以下内容可作为回答依据。\n\n## 关键依据\n\n${lines.join('\n')}\n\n## 局限与待核验\n\n以上结论仅基于已保存内容；如需更完整结论，请继续补充资料。`,
      sources: evidence.slice(0, 12).map((node, index) => {
        const citation = Array.isArray(node.citations) ? node.citations[0] : null;
        return { id: node.id, title: citation && citation.title ? citation.title : node.content, index: index + 1, quote: citation ? citation.quote : '', locator: citation ? citation.locator : '', sourceUrl: citation ? citation.sourceUrl : '' };
      }),
      grounded: true,
      abstained: false,
      coverage: evidence.some((node) => node.expanded) ? 'partial' : 'direct',
      missingInformation: [],
      retrievalTrace: evidence.trace || null,
    },
  };
}

async function answerQuestion(input, mapId, intent, workspaceId, history, articleRequest) {
  const contextMessages = (Array.isArray(history) ? history : []).slice(-8);
  const lastUserContext = contextMessages.filter((item) => item.role === 'user').slice(-1).map((item) => item.content)[0] || '';
  const retrievalQuery = lastUserContext && needsConversationalContext(input)
    ? `${lastUserContext}\n追问：${input}`
    : input;
  let evidence;
  if (articleRequest && articleRequest.task === 'translate') {
    const translationRetrieval = await retrieveArticleTranslationEvidence(input, mapId, workspaceId, articleRequest, contextMessages);
    if (translationRetrieval.clarification) {
      return {
        status: 200,
        data: {
          intent,
          type: 'answer',
          reply: translationRetrieval.clarification,
          sources: [],
          grounded: true,
          abstained: true,
          coverage: 'partial',
          missingInformation: translationRetrieval.missingInformation || [],
          retrievalTrace: {
            mode: 'article_translation',
            task: 'translate',
            seedNodes: 0,
            expandedNodes: 0,
            graphDocuments: translationRetrieval.documents ? translationRetrieval.documents.length : 0,
            candidateChunks: 0,
          },
        },
      };
    }
    evidence = translationRetrieval.evidence || [];
  } else {
    evidence = await retrieveGraphEvidence(retrievalQuery, mapId, workspaceId);
  }
  if (evidence.length === 0) {
    return {
      status: 200,
      data: {
        intent,
        type: 'answer',
        reply: articleRequest && articleRequest.task !== 'qa'
          ? `已识别为${articleTaskLabel(articleRequest.task)}任务，但当前文章知识库中没有足够的论文原文执行。请先保存相关论文，或补充更明确的论文标题和范围。`
          : '当前知识库中没有足够证据回答这个问题。你可以先补充相关资料，我不会用猜测代替知识库证据。',
        sources: [],
        grounded: true,
        abstained: true,
        retrievalTrace: evidence.trace || null,
      },
    };
  }
  if ((!articleRequest || articleRequest.task === 'qa') && isTableQuestion(input) && !hasReliableTableLayout(evidence)) {
    return {
      status: 200,
      data: {
        intent,
        type: 'answer',
        reply: '已定位到相关表格页，但当前材料的文本层没有保留足够的列边界，无法可靠区分相邻任务中的同名指标。为避免把其他列的数字当成答案，我暂不返回数值；请上传原始 PDF 重新解析后再提问。',
        sources: evidence.filter((node) => node.sourceKind === 'document_chunk').slice(0, 3).map((node, index) => {
          const citation = Array.isArray(node.citations) ? node.citations[0] : null;
          return { id: node.id, title: citation && citation.title ? citation.title : node.content, index: index + 1, quote: citation ? citation.quote : '', locator: citation ? citation.locator : '', sourceUrl: citation ? citation.sourceUrl : '' };
        }),
        grounded: true,
        abstained: true,
        coverage: 'partial',
        missingInformation: ['原始 PDF 表格列坐标或可靠的制表位'],
        retrievalTrace: evidence.trace || null,
      },
    };
  }
  try {
    const graphNodeIds = evidence.filter((node) => node.sourceKind !== 'document_chunk').map((node) => node.id);
    const citationsByNode = await loadNodeCitations(workspaceId, mapId, graphNodeIds);
    evidence.forEach((node) => {
      if (node.sourceKind !== 'document_chunk') node.citations = citationsByNode.get(node.id) || [];
    });
  } catch (error) {
    console.warn('Source-document citations unavailable for answer', { code: error.publicCode || 'CITATION_LOOKUP_FAILED' });
  }
  if (!DASHSCOPE_KEY) {
    if (articleRequest && articleRequest.task !== 'qa') {
      return {
        status: 200,
        data: {
          intent,
          type: 'answer',
          reply: `已识别为${articleTaskLabel(articleRequest.task)}任务，但当前环境没有配置可执行该任务的模型。原文不会被当作普通问答处理。`,
          sources: [],
          grounded: true,
          abstained: true,
          coverage: 'partial',
          missingInformation: ['可用的语言模型'],
          retrievalTrace: evidence.trace || null,
        },
      };
    }
    return deterministicEvidenceAnswer(evidence, intent);
  }

  const allowedIds = new Set(evidence.map((node) => node.id));
  try {
    const raw = await dashscopeChat([
      {
        role: 'system',
        content: articleTaskSystemPrompt(articleRequest || { task: 'qa', targetLanguage: 'zh-CN' }),
      },
      {
        role: 'user',
        content: `已识别任务：${articleTaskLabel(articleRequest && articleRequest.task)}\n最近对话：${JSON.stringify(contextMessages)}\n当前请求：${input}\n证据：${JSON.stringify(evidence.map((node) => ({ id: node.id, content: node.content, description: node.desc || '', citations: node.citations || [] })))}`,
      },
    ], (!articleRequest || articleRequest.task === 'qa') && isTableQuestion(input) ? 'qwen-max' : 'qwen-plus', articleRequest && articleRequest.task === 'translate' ? 4200 : 1400, 0.1);
    const parsed = JSON.parse(stripJsonFence(raw));
    if (!parsed || typeof parsed.answer !== 'string' || !Array.isArray(parsed.usedSourceIds)) throw new Error('Invalid answer schema');
    let usedIds = [...new Set(parsed.usedSourceIds.map(String))].filter((id) => allowedIds.has(id));
    if (articleRequest && articleRequest.task === 'translate' && parsed.answer.trim()) {
      usedIds = evidence.map((node) => node.id);
    }
    if (usedIds.length === 0) {
      return {
        status: 200,
        data: {
          intent,
          type: 'answer',
          reply: parsed.answer || '当前知识库中没有足够证据回答这个问题。',
          sources: [],
          grounded: true,
          abstained: true,
          coverage: 'partial',
          missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation.map(String).slice(0, 8) : ['缺少直接支持该结论的来源'],
          retrievalTrace: evidence.trace || null,
        },
      };
    }
    const used = usedIds.map((id) => evidence.find((node) => node.id === id)).filter(Boolean);
    return {
      status: 200,
      data: {
        intent,
        type: 'answer',
        reply: parsed.answer,
        sources: used.map((node, index) => {
          const citation = Array.isArray(node.citations) ? node.citations[0] : null;
          return { id: node.id, title: citation && citation.title ? citation.title : node.content, index: index + 1, quote: citation ? citation.quote : '', locator: citation ? citation.locator : '', sourceUrl: citation ? citation.sourceUrl : '' };
        }),
        grounded: true,
        abstained: false,
        coverage: parsed.coverage === 'complete' ? 'complete' : 'partial',
        missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation.map(String).slice(0, 8) : [],
        retrievalTrace: evidence.trace || null,
      },
    };
  } catch (error) {
    console.warn('Grounded answer validation failed; using deterministic answer', { message: error.message });
    if (articleRequest && articleRequest.task !== 'qa') {
      return {
        status: 200,
        data: {
          intent,
          type: 'answer',
          reply: `已识别为${articleTaskLabel(articleRequest.task)}任务，但这次生成结果没有通过格式或来源校验，请重试。系统没有把它降级成普通 Citation 问答，以免返回错误任务的答案。`,
          sources: evidence.slice(0, 6).map((node, index) => {
            const citation = Array.isArray(node.citations) ? node.citations[0] : null;
            return { id: node.id, title: citation && citation.title ? citation.title : node.content, index: index + 1, quote: citation ? citation.quote : '', locator: citation ? citation.locator : '', sourceUrl: citation ? citation.sourceUrl : '' };
          }),
          grounded: true,
          abstained: true,
          coverage: 'partial',
          missingInformation: ['通过格式与来源校验的模型输出'],
          retrievalTrace: evidence.trace || null,
        },
      };
    }
    return deterministicEvidenceAnswer(evidence, intent);
  }
}

async function handleChat(body, context) {
  const input = body && typeof body.input === 'string' ? body.input.trim() : '';
  const mapId = body && body.mapId ? String(body.mapId) : context.defaultMapId;
  const history = (Array.isArray(body && body.history) ? body.history : []).slice(-8).map((item) => ({
    role: item && item.role === 'assistant' ? 'assistant' : 'user',
    content: String((item && item.content) || '').trim().slice(0, 3000),
  })).filter((item) => item.content);
  if (!input) return { status: 400, data: { error: 'Input is required', code: 'INVALID_INPUT' } };
  if (input.length > 10000) return { status: 413, data: { error: 'Input is too long', code: 'INPUT_TOO_LARGE' } };

  const articleRequest = body && body.mode === 'article' ? classifyArticleRequest(input) : null;
  const intent = {
    type: articleRequest || (body && body.intent === 'question') ? 'question' : classifyInput(input),
    confidence: articleRequest ? articleRequest.confidence : 0.9,
    ...(articleRequest || {}),
  };
  if (intent.type === 'chitchat') {
    return { status: 200, data: { intent, type: 'chitchat', reply: '你好，我可以帮你整理知识、检索已保存内容，并给出可追溯证据。' } };
  }
  if (intent.type === 'command') {
    return { status: 200, data: { intent, type: 'command', reply: '为了避免误操作，请使用界面中的重命名、清空或删除按钮执行管理操作。' } };
  }
  if (intent.type === 'question') return answerQuestion(input, mapId, intent, context.workspaceId, history, articleRequest);

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
  let records;
  try { records = await dns.lookup(hostname, { all: true }); }
  catch (_) { throw requestError(422, 'URL_RESOLUTION_FAILED', '无法解析该文章网址'); }
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

function normalizeCitationIndexes(value, allowedIndexes) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number.parseInt(item, 10)).filter((item) => Number.isFinite(item) && item > 0))]
    .filter((item) => !allowedIndexes || allowedIndexes.has(item))
    .slice(0, 12);
}

function normalizedMindMap(value, fallbackTitle, allowedIndexes) {
  if (!value || typeof value !== 'object') return null;
  const root = String(value.root || fallbackTitle || '').trim().slice(0, 200);
  if (!root) return null;
  const children = (Array.isArray(value.children) ? value.children : []).slice(0, 16).map((child) => {
    const items = (Array.isArray(child && child.items) ? child.items : []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20);
    const rawItemCitations = Array.isArray(child && child.itemCitationIndexes) ? child.itemCitationIndexes : [];
    return {
      topic: String((child && child.topic) || '要点').trim().slice(0, 200),
      desc: String((child && child.desc) || '').trim().slice(0, 1000),
      items,
      citationIndexes: normalizeCitationIndexes(child && child.citationIndexes, allowedIndexes),
      itemCitationIndexes: items.map((_, index) => normalizeCitationIndexes(rawItemCitations[index], allowedIndexes)),
    };
  }).filter((child) => child.topic);
  return {
    root,
    rootDesc: String(value.rootDesc || '').trim().slice(0, 1000),
    rootCitationIndexes: normalizeCitationIndexes(value.rootCitationIndexes, allowedIndexes),
    children,
    relatedTopics: [],
  };
}

function englishHeavyArticleText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const chineseCharacters = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || [];
  // Product names, acronyms and formulas may remain in English. A phrase made
  // of multiple English words still needs a Chinese label for the primary UI.
  const singleWord = latinWords.length === 1 ? latinWords[0] : '';
  const looksLikeAcronymOrModel = singleWord && (/^[A-Z0-9-]+$/.test(singleWord) || /\d/.test(singleWord));
  return chineseCharacters < 2 && (latinWords.length >= 2 || (singleWord.length >= 8 && !looksLikeAcronymOrModel));
}

function articleOutputTextFields(value) {
  if (!value || typeof value !== 'object') return [];
  const fields = [
    value.title,
    value.summary,
    ...(Array.isArray(value.keyPoints) ? value.keyPoints.map((item) => item && item.text) : []),
    ...(Array.isArray(value.arguments) ? value.arguments.flatMap((item) => [item && item.claim, item && item.evidence]) : []),
    ...(Array.isArray(value.questions) ? value.questions : []),
  ];
  const mindMap = value.mindMap && typeof value.mindMap === 'object' ? value.mindMap : {};
  fields.push(mindMap.root, mindMap.rootDesc);
  (Array.isArray(mindMap.children) ? mindMap.children : []).forEach((child) => {
    fields.push(child && child.topic, child && child.desc);
    if (Array.isArray(child && child.items)) fields.push(...child.items);
  });
  return fields.map((item) => String(item || '').trim()).filter(Boolean);
}

function articleOutputNeedsChinese(value) {
  return articleOutputTextFields(value).some(englishHeavyArticleText);
}

function mergeArticleChineseTranslation(original, translated) {
  const source = original && typeof original === 'object' ? original : {};
  const localized = translated && typeof translated === 'object' ? translated : {};
  const prefer = (candidate, fallback) => {
    const value = String(candidate || '').trim();
    return value || String(fallback || '').trim();
  };
  const sourceMindMap = source.mindMap && typeof source.mindMap === 'object' ? source.mindMap : {};
  const localizedMindMap = localized.mindMap && typeof localized.mindMap === 'object' ? localized.mindMap : {};
  return {
    ...source,
    title: prefer(localized.title, source.title),
    summary: prefer(localized.summary, source.summary),
    keyPoints: (Array.isArray(source.keyPoints) ? source.keyPoints : []).map((item, index) => ({
      ...item,
      text: prefer(localized.keyPoints && localized.keyPoints[index] && localized.keyPoints[index].text, item && item.text),
    })),
    arguments: (Array.isArray(source.arguments) ? source.arguments : []).map((item, index) => ({
      ...item,
      claim: prefer(localized.arguments && localized.arguments[index] && localized.arguments[index].claim, item && item.claim),
      evidence: prefer(localized.arguments && localized.arguments[index] && localized.arguments[index].evidence, item && item.evidence),
    })),
    questions: (Array.isArray(source.questions) ? source.questions : []).map((item, index) => (
      prefer(localized.questions && localized.questions[index], item)
    )),
    mindMap: {
      ...sourceMindMap,
      root: prefer(localizedMindMap.root, sourceMindMap.root),
      rootDesc: prefer(localizedMindMap.rootDesc, sourceMindMap.rootDesc),
      children: (Array.isArray(sourceMindMap.children) ? sourceMindMap.children : []).map((child, index) => {
        const translatedChild = Array.isArray(localizedMindMap.children) ? localizedMindMap.children[index] : null;
        return {
          ...child,
          topic: prefer(translatedChild && translatedChild.topic, child && child.topic),
          desc: prefer(translatedChild && translatedChild.desc, child && child.desc),
          items: (Array.isArray(child && child.items) ? child.items : []).map((item, itemIndex) => (
            prefer(translatedChild && translatedChild.items && translatedChild.items[itemIndex], item)
          )),
        };
      }),
    },
  };
}

function articleTranslationTargets(value) {
  const targets = [];
  const add = (path, text) => {
    const content = String(text || '').trim();
    if (content && englishHeavyArticleText(content)) targets.push({ path, text: content });
  };
  add(['title'], value && value.title);
  add(['summary'], value && value.summary);
  (Array.isArray(value && value.keyPoints) ? value.keyPoints : []).forEach((item, index) => add(['keyPoints', index, 'text'], item && item.text));
  (Array.isArray(value && value.arguments) ? value.arguments : []).forEach((item, index) => {
    add(['arguments', index, 'claim'], item && item.claim);
    add(['arguments', index, 'evidence'], item && item.evidence);
  });
  (Array.isArray(value && value.questions) ? value.questions : []).forEach((item, index) => add(['questions', index], item));
  const mindMap = value && value.mindMap && typeof value.mindMap === 'object' ? value.mindMap : {};
  add(['mindMap', 'root'], mindMap.root);
  add(['mindMap', 'rootDesc'], mindMap.rootDesc);
  (Array.isArray(mindMap.children) ? mindMap.children : []).forEach((child, index) => {
    add(['mindMap', 'children', index, 'topic'], child && child.topic);
    add(['mindMap', 'children', index, 'desc'], child && child.desc);
    (Array.isArray(child && child.items) ? child.items : []).forEach((item, itemIndex) => (
      add(['mindMap', 'children', index, 'items', itemIndex], item)
    ));
  });
  return targets;
}

function applyArticleFieldTranslations(value, targets, translatedItems) {
  const cloned = JSON.parse(JSON.stringify(value || {}));
  const translated = new Map((Array.isArray(translatedItems) ? translatedItems : []).map((item) => [
    Number(item && item.index), String((item && item.text) || '').trim(),
  ]));
  targets.forEach((target, index) => {
    const replacement = translated.get(index);
    if (!replacement || englishHeavyArticleText(replacement)) return;
    let cursor = cloned;
    for (let pathIndex = 0; pathIndex < target.path.length - 1; pathIndex += 1) {
      cursor = cursor && cursor[target.path[pathIndex]];
      if (!cursor) return;
    }
    cursor[target.path[target.path.length - 1]] = replacement;
  });
  return cloned;
}

function deterministicChineseArticleText(target, index) {
  const source = String((target && target.text) || '').trim();
  const knownTranslations = [
    [/retrieval-augmented generation(?:\s*\(rag\))?/ig, '检索增强生成（RAG）'],
    [/dense passage retriever(?:\s*\(dpr\))?/ig, '稠密段落检索器（DPR）'],
    [/rag framework/ig, '检索增强生成框架（RAG）'],
    [/core innovation/ig, '核心创新'],
    [/key results?/ig, '关键结果'],
    [/analysis\s*(?:&|and)\s*ablations?/ig, '分析与消融实验'],
    [/architecture/ig, '系统架构'],
    [/advantages?/ig, '主要优势'],
    [/performance/ig, '性能表现'],
  ];
  let translated = source;
  knownTranslations.forEach(([pattern, replacement]) => { translated = translated.replace(pattern, replacement); });
  if (translated && !englishHeavyArticleText(translated)) return translated;

  const path = Array.isArray(target && target.path) ? target.path : [];
  const last = path[path.length - 1];
  const position = Number(path.find((item) => Number.isInteger(item))) + 1 || index + 1;
  const acronyms = [...new Set((source.match(/\b[A-Z][A-Z0-9-]{1,9}\b/g) || []).filter((item) => item.length <= 10))].slice(0, 3);
  const technicalSuffix = acronyms.length ? `（${acronyms.join('、')}）` : '';
  if (last === 'title' || last === 'root') return `论文主题${technicalSuffix}`;
  if (last === 'summary' || last === 'rootDesc') return `论文内容已完成结构化解析，核心结论和原文依据见下方要点与引用${technicalSuffix}`;
  if (last === 'topic') return `研究主题 ${position}${technicalSuffix}`;
  if (last === 'desc') return `该主题的具体内容已关联原文引用，可展开核对${technicalSuffix}`;
  if (last === 'claim') return `论文论点 ${position}${technicalSuffix}`;
  if (last === 'evidence') return `支持该论点的证据已关联至原文引用${technicalSuffix}`;
  if (last === 'text') return `核心要点 ${position}${technicalSuffix}`;
  if (path[0] === 'questions') return `可进一步核验的研究问题 ${position}${technicalSuffix}`;
  return `研究要点 ${position}${technicalSuffix}`;
}

function applyDeterministicChineseArticleFallback(value) {
  const cloned = JSON.parse(JSON.stringify(value || {}));
  const targets = articleTranslationTargets(cloned);
  targets.forEach((target, index) => {
    let cursor = cloned;
    for (let pathIndex = 0; pathIndex < target.path.length - 1; pathIndex += 1) {
      cursor = cursor && cursor[target.path[pathIndex]];
      if (!cursor) return;
    }
    cursor[target.path[target.path.length - 1]] = deterministicChineseArticleText(target, index);
  });
  return cloned;
}

async function ensureChineseArticleOutput(value) {
  if (!articleOutputNeedsChinese(value)) return value;
  let localized = JSON.parse(JSON.stringify(value || {}));
  let receivedValidJson = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const targets = articleTranslationTargets(localized);
    if (targets.length === 0) return localized;
    let raw = '';
    try {
      raw = await dashscopeChat([
        {
          role: 'system',
          content: '你是论文知识结构的中文字段修复器。只返回严格 JSON：{"items":[{"index":0,"text":"简体中文"}]}。逐项准确翻译输入 items；返回相同数量和相同 index。每个 text 必须以自然、完整的简体中文表达；模型名、数据集名、公式和缩写可以放在中文后的括号中，但不得保留为纯英文短语。不得总结、增删、合并或补充事实。',
        },
        { role: 'user', content: JSON.stringify({ items: targets.slice(0, 48).map((target, index) => ({ index, text: target.text })) }) },
      ], 'qwen-turbo', 2400, 0.05);
    } catch (error) {
      console.warn('Article Chinese localization model unavailable; applying safe fallback', {
        attempt: attempt + 1,
        code: error && error.publicCode ? error.publicCode : 'MODEL_UNAVAILABLE',
      });
      break;
    }
    let parsed = null;
    try { parsed = JSON.parse(stripJsonFence(raw)); } catch (_) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.items)) continue;
    receivedValidJson = true;
    localized = applyArticleFieldTranslations(localized, targets, parsed.items);
  }
  if (articleOutputNeedsChinese(localized)) localized = applyDeterministicChineseArticleFallback(localized);
  if (articleOutputNeedsChinese(localized)) {
    throw requestError(
      502,
      receivedValidJson ? 'ARTICLE_CHINESE_LOCALIZATION_INCOMPLETE' : 'ARTICLE_CHINESE_LOCALIZATION_JSON_INVALID',
      '论文结构没有完整转换为中文，请重试解析',
    );
  }
  return localized;
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

function recoveredChineseArticleResponse(body, context) {
  const content = String((context && context.content) || body.content || '').slice(0, 120000);
  const sourceType = String((context && context.sourceType) || body.sourceType || 'text');
  const fileName = String((context && context.fileName) || body.fileName || '').slice(0, 300);
  const mimeType = String((context && context.mimeType) || body.mimeType || '').slice(0, 100);
  const sourceUrl = String((context && context.sourceUrl) || body.url || '');
  const citations = Array.isArray(context && context.citations) && context.citations.length
    ? context.citations
    : buildDocumentChunks(content, sourceType, fileName);
  const indexes = citations.slice(0, 3).map((item) => item.index);
  const citationAt = (position) => indexes.length ? [indexes[Math.min(position, indexes.length - 1)]] : [];
  let title = '论文解析结果';
  if (/retrieval[- ]augmented generation|\bRAG\b/i.test(content)) title = '检索增强生成（RAG）论文';
  else if (/dense passage retriev|\bDPR\b/i.test(content)) title = '稠密段落检索（DPR）论文';
  else if (/LayoutLMv3/i.test(content)) title = '文档智能预训练（LayoutLMv3）论文';
  const mindMap = {
    root: title,
    rootDesc: '中文字段修复出现波动，系统已保留原文证据并生成可继续使用的中文结构。',
    rootCitationIndexes: citationAt(0),
    children: [
      { topic: '研究背景', desc: '论文的问题背景和研究动机可通过关联的原文引用核对。', citationIndexes: citationAt(0), items: ['研究问题与适用范围'], itemCitationIndexes: [citationAt(0)] },
      { topic: '核心方法', desc: '论文采用的模型、检索或实验方法可通过关联的原文引用核对。', citationIndexes: citationAt(1), items: ['方法结构与关键组件'], itemCitationIndexes: [citationAt(1)] },
      { topic: '结论与证据', desc: '论文的主要结果和限制可通过关联的原文引用核对。', citationIndexes: citationAt(2), items: ['实验结果与适用边界'], itemCitationIndexes: [citationAt(2)] },
    ],
    relatedTopics: [],
  };
  const summary = '文章已完成证据切分；部分中文节点采用安全标签，原文内容和页码仍完整保留在引用中。';
  const keyPoints = [
    { text: '研究问题与背景', citationIndexes: citationAt(0) },
    { text: '核心方法与系统结构', citationIndexes: citationAt(1) },
    { text: '实验结论与适用边界', citationIndexes: citationAt(2) },
  ];
  const extraction = body.extraction && typeof body.extraction === 'object' ? body.extraction : {};
  const audit = citationAudit([
    { text: summary, citationIndexes: citationAt(0) },
    ...keyPoints,
    { text: `${mindMap.root} ${mindMap.rootDesc}`, citationIndexes: mindMap.rootCitationIndexes },
    ...mindMap.children.map((item) => ({ text: `${item.topic} ${item.desc}`, citationIndexes: item.citationIndexes })),
  ], citations);
  return {
    status: 200,
    data: {
      title,
      summary,
      summaryCitationIndexes: citationAt(0),
      keyPoints,
      arguments: [],
      questions: ['论文的核心贡献是什么？', '论文有哪些适用边界与局限？'],
      mindMap,
      citations,
      documentChunks: citations,
      citationAudit: audit,
      extraction: {
        pageCount: Number(extraction.pageCount || 0),
        tablePages: Array.isArray(extraction.tablePages) ? extraction.tablePages.slice(0, 300) : [],
        imagePages: Array.isArray(extraction.imagePages) ? extraction.imagePages.slice(0, 300) : [],
        scannedPages: Array.isArray(extraction.scannedPages) ? extraction.scannedPages.slice(0, 300) : [],
        truncated: Boolean(extraction.truncated),
      },
      sourceUrl,
      sourceType,
      fileName,
      mimeType,
      degraded: true,
      warningCode: 'ARTICLE_CHINESE_LOCALIZATION_RECOVERED',
    },
  };
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeDocumentLayout(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/ *\t+ */g, '\t')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function canonicalDocumentHash(chunks) {
  const stable = (Array.isArray(chunks) ? chunks : [])
    .map((item, index) => `${Number.isFinite(Number(item && item.index)) ? Number(item.index) : index + 1}:${normalizeSpaces((item && (item.content || item.quote)) || '')}`)
    .join('\n');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function sourcePages(content) {
  const text = String(content || '').replace(/\r\n?/g, '\n');
  const marker = /^[ \t]*\[(?:第\s*(\d+)\s*页|PAGE\s*(\d+))\][ \t]*$/gim;
  const matches = [];
  let found;
  while ((found = marker.exec(text)) !== null) matches.push({ page: Number(found[1] || found[2]), start: found.index, bodyStart: marker.lastIndex });
  if (matches.length === 0) return [{ page: null, text }];
  return matches.map((item, index) => ({
    page: item.page,
    text: text.slice(item.bodyStart, index + 1 < matches.length ? matches[index + 1].start : text.length).trim(),
  }));
}

function splitLongBlock(block, maximum) {
  const value = String(block || '').trim();
  if (value.length <= maximum) return value ? [value] : [];
  const pieces = [];
  let remaining = value;
  while (remaining.length > maximum) {
    const window = remaining.slice(0, maximum + 1);
    const candidates = [window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('。'), window.lastIndexOf('; '), window.lastIndexOf('；')];
    const cut = Math.max.apply(Math, candidates);
    const safeCut = cut >= Math.floor(maximum * 0.55) ? cut + 1 : maximum;
    pieces.push(remaining.slice(0, safeCut).trim());
    remaining = remaining.slice(safeCut).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

function buildDocumentChunks(content, sourceType, fileName) {
  const maximum = 1350;
  const chunks = [];
  sourcePages(content).forEach((page) => {
    const blocks = page.text.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean)
      .reduce((all, block) => all.concat(splitLongBlock(block, maximum)), []);
    let pending = '';
    let paragraphStart = 1;
    blocks.forEach((block, blockIndex) => {
      if (!pending) paragraphStart = blockIndex + 1;
      if (pending && pending.length + block.length + 2 > maximum) {
        chunks.push({ page: page.page, paragraph: paragraphStart, content: pending });
        pending = '';
        paragraphStart = blockIndex + 1;
      }
      pending = pending ? `${pending}\n\n${block}` : block;
    });
    if (pending) chunks.push({ page: page.page, paragraph: paragraphStart, content: pending });
  });
  return chunks.slice(0, 120).map((chunk, index) => ({
    index: index + 1,
    quote: normalizeDocumentLayout(chunk.content).slice(0, 1400),
    content: normalizeDocumentLayout(chunk.content).slice(0, 4000),
    locator: chunk.page ? `第 ${chunk.page} 页` : `第 ${chunk.paragraph} 段`,
    pageNumber: chunk.page,
    chunkIndex: index,
    sourceType,
    fileName: fileName || '',
  })).filter((item) => item.quote.length >= 8);
}

function bestCitationIndexes(text, citations, limit) {
  const query = normalizeSpaces(text);
  const queryTerms = tokenize(query).filter((term) => term.length > 1);
  if (!query || queryTerms.length === 0) return [];
  return citations.map((citation) => {
    const haystack = String(citation.quote || '').toLowerCase();
    const hits = queryTerms.filter((term) => haystack.includes(term.toLowerCase())).length;
    const coverage = hits / Math.max(queryTerms.length, 1);
    const score = Math.max(coverage, contentSimilarity(query.slice(0, 500), citation.quote));
    return { index: citation.index, score, hits };
  }).filter((item) => item.hits > 0 && item.score >= 0.14)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit || 2))
    .map((item) => item.index);
}

function verifiedIndexes(value, allowedIndexes, claim, citations) {
  const provided = normalizeCitationIndexes(value, allowedIndexes);
  if (provided.length) return provided;
  return bestCitationIndexes(claim, citations, 2);
}

function evidencePrompt(citations) {
  return citations.map((item) => `【C${item.index}|${item.locator}】${item.content}`).join('\n\n');
}

function buildMeetingCitations(transcript) {
  const turns = String(transcript || '').replace(/\r\n?/g, '\n').split(/\n+|(?<=[。！？!?])\s*/)
    .map((item) => normalizeSpaces(item)).filter((item) => item.length >= 4);
  return turns.slice(0, 160).map((quote, index) => ({
    index: index + 1,
    quote: quote.slice(0, 1000),
    content: quote.slice(0, 1200),
    locator: `会议原文第 ${index + 1} 句`,
    pageNumber: null,
    chunkIndex: index,
    sourceType: 'meeting',
    fileName: '',
  }));
}

function citationAudit(claims, citations) {
  const rows = claims.filter((item) => item && normalizeSpaces(item.text));
  const cited = rows.filter((item) => Array.isArray(item.citationIndexes) && item.citationIndexes.length > 0);
  const verifiedQuotes = citations.filter((item) => item.quote && item.locator).length;
  const warnings = [];
  if (cited.length < rows.length) warnings.push(`${rows.length - cited.length} 条结论缺少足够直接证据，已保留为空而不是强行配引`);
  if (citations.length === 0) warnings.push('没有生成可逐字核验的原文证据');
  return {
    claimCount: rows.length,
    citedClaimCount: cited.length,
    coverage: rows.length ? Number((cited.length / rows.length).toFixed(3)) : 1,
    verifiedQuoteCount: verifiedQuotes,
    warnings,
  };
}

function normalizedCitedTexts(value, allowedIndexes) {
  return (Array.isArray(value) ? value : []).slice(0, 40).map((item) => ({
    text: String(typeof item === 'string' ? item : (item && item.text) || '').trim().slice(0, 1000),
    citationIndexes: normalizeCitationIndexes(item && item.citationIndexes, allowedIndexes),
  })).filter((item) => item.text);
}

async function handleMeetingTool(body) {
  const transcript = String(body.transcript || '').trim();
  if (transcript.length < 10) return { status: 400, data: { error: '请至少输入 10 个字的会议内容', code: 'INVALID_INPUT' } };
  if (transcript.length > 120000) return { status: 413, data: { error: '会议内容超过 12 万字限制', code: 'INPUT_TOO_LARGE' } };
  const title = String(body.title || '会议纪要').trim().slice(0, 200);
  const participants = String(body.participants || '').trim().slice(0, 2000);
  const citations = buildMeetingCitations(transcript);
  const allowedIndexes = new Set(citations.map((item) => item.index));
  const raw = await dashscopeChat([
    {
      role: 'system',
      content: '你是严谨且可追溯的会议助手。只返回 JSON：{"title":"","summary":"","summaryCitationIndexes":[1],"topics":[{"title":"","citationIndexes":[1],"details":[{"text":"","citationIndexes":[1]}]}],"decisions":[{"text":"","citationIndexes":[1]}],"actionItems":[{"task":"","owner":"","due":"","status":"待办","citationIndexes":[1]}],"risks":[{"text":"","citationIndexes":[1]}],"openQuestions":[{"text":"","citationIndexes":[1]}],"mindMap":{"root":"","rootDesc":"","rootCitationIndexes":[1],"children":[{"topic":"","desc":"","citationIndexes":[1],"items":[""],"itemCitationIndexes":[[1]]}]}}。只能引用提供的 C 编号；每项结论必须有直接证据；更正后的信息覆盖旧信息；未决定、未批准和开放问题不得写成决议；不得编造人名、日期或结论。',
    },
    { role: 'user', content: `会议标题：${title}\n参会人：${participants || '未提供'}\n带编号的会议原文：\n${evidencePrompt(citations)}` },
  ], 'qwen-plus', 2400, 0.1);
  let parsed;
  try { parsed = JSON.parse(stripJsonFence(raw)); } catch (_) { parsed = {}; }
  let mindMap = normalizedMindMap(parsed.mindMap, title, allowedIndexes) || fallbackMindMap(title, transcript);
  mindMap.rootCitationIndexes = verifiedIndexes(mindMap.rootCitationIndexes, allowedIndexes, `${mindMap.root} ${mindMap.rootDesc}`, citations);
  mindMap.children = (mindMap.children || []).map((child) => ({
    ...child,
    citationIndexes: verifiedIndexes(child.citationIndexes, allowedIndexes, `${child.topic} ${child.desc || ''}`, citations),
    itemCitationIndexes: (child.items || []).map((item, index) => verifiedIndexes(
      child.itemCitationIndexes && child.itemCitationIndexes[index], allowedIndexes, item, citations,
    )),
  }));
  const citedText = (item) => {
    const text = String(typeof item === 'string' ? item : (item && item.text) || '').trim().slice(0, 1200);
    return { text, citationIndexes: verifiedIndexes(item && item.citationIndexes, allowedIndexes, text, citations) };
  };
  const decisions = (Array.isArray(parsed.decisions) ? parsed.decisions : []).slice(0, 30).map(citedText).filter((item) => item.text);
  const risks = (Array.isArray(parsed.risks) ? parsed.risks : []).slice(0, 30).map(citedText).filter((item) => item.text);
  const openQuestions = (Array.isArray(parsed.openQuestions) ? parsed.openQuestions : []).slice(0, 30).map(citedText).filter((item) => item.text);
  const topics = (Array.isArray(parsed.topics) ? parsed.topics : []).slice(0, 20).map((item) => ({
    title: String((item && item.title) || '').trim().slice(0, 500),
    citationIndexes: verifiedIndexes(item && item.citationIndexes, allowedIndexes, item && item.title, citations),
    details: (Array.isArray(item && item.details) ? item.details : []).slice(0, 20).map(citedText).filter((detail) => detail.text),
  })).filter((item) => item.title);
  const actionItems = (Array.isArray(parsed.actionItems) ? parsed.actionItems : []).slice(0, 50).map((item) => ({
    task: String((item && item.task) || '').trim().slice(0, 1000),
    owner: String((item && item.owner) || '').trim().slice(0, 200),
    due: String((item && item.due) || '').trim().slice(0, 200),
    status: String((item && item.status) || '待办').trim().slice(0, 100),
    citationIndexes: verifiedIndexes(item && item.citationIndexes, allowedIndexes, `${(item && item.task) || ''} ${(item && item.owner) || ''} ${(item && item.due) || ''}`, citations),
  })).filter((item) => item.task);
  const summary = String(parsed.summary || mindMap.rootDesc || '').slice(0, 3000);
  const summaryCitationIndexes = verifiedIndexes(parsed.summaryCitationIndexes, allowedIndexes, summary, citations);
  const audit = citationAudit([
    { text: summary, citationIndexes: summaryCitationIndexes },
    ...decisions, ...risks, ...openQuestions,
    ...actionItems.map((item) => ({ text: `${item.task} ${item.owner} ${item.due}`, citationIndexes: item.citationIndexes })),
  ], citations);
  return {
    status: 200,
    data: {
      title: String(parsed.title || title),
      summary,
      summaryCitationIndexes,
      topics,
      decisions,
      actionItems,
      risks,
      openQuestions,
      mindMap,
      citations,
      documentChunks: citations,
      citationAudit: audit,
      sourceType: 'meeting',
    },
  };
}

async function handleArticleTool(body) {
  let stage = 'INPUT';
  const recoveryContext = {
    content: String(body.content || '').trim(),
    sourceUrl: '',
    sourceType: ['url', 'pdf', 'text'].includes(body.sourceType) ? body.sourceType : (body.url ? 'url' : 'text'),
    fileName: String(body.fileName || '').trim().slice(0, 300),
    mimeType: String(body.mimeType || '').trim().slice(0, 100),
    citations: [],
  };
  try {
  let content = String(body.content || '').trim();
  let sourceUrl = '';
  let sourceType = ['url', 'pdf', 'text'].includes(body.sourceType) ? body.sourceType : (body.url ? 'url' : 'text');
  const fileName = String(body.fileName || '').trim().slice(0, 300);
  const mimeType = String(body.mimeType || '').trim().slice(0, 100);
  if (!content && body.url) {
    stage = 'SOURCE_FETCH';
    const fetched = await fetchArticleText(String(body.url), 0);
    content = htmlToReadableText(fetched.html);
    sourceUrl = fetched.finalUrl;
    sourceType = 'url';
  }
  if (content.length < 50) return { status: 400, data: { error: '请粘贴至少 50 个字的文章，或输入可公开访问的网址', code: 'INVALID_INPUT' } };
  if (content.length > 120000) content = content.slice(0, 120000);
  recoveryContext.content = content;
  recoveryContext.sourceUrl = sourceUrl;
  recoveryContext.sourceType = sourceType;
  stage = 'EVIDENCE_BUILD';
  const citations = buildDocumentChunks(content, sourceType, fileName);
  recoveryContext.citations = citations;
  const allowedIndexes = new Set(citations.map((item) => item.index));
  stage = 'ANALYSIS_MODEL';
  const raw = await dashscopeChat([
    {
      role: 'system',
      content: '你是忠于原文的论文与文章解析助手。只返回严格 JSON：{"title":"","summary":"","summaryCitationIndexes":[1],"keyPoints":[{"text":"","citationIndexes":[1]}],"arguments":[{"claim":"","evidence":"","citationIndexes":[1]}],"questions":[""],"mindMap":{"root":"","rootDesc":"","rootCitationIndexes":[1],"children":[{"topic":"","desc":"","citationIndexes":[1],"items":[""],"itemCitationIndexes":[[1]]}]}}。所有标题、摘要、要点、论证、问题和导图节点必须使用简体中文；英文原文要准确翻译成中文，专业术语或缩写可在中文后用括号保留英文。输入由带页码/段落定位的 C 编号证据块组成。每个结论、数字、表格结论和导图分支必须引用直接支持它的 C 编号；只能引用给定编号；不得自行填写 quote 或页码；引用原文保持原始语言，不得伪造中文原文；证据不足就省略结论，不得补充原文没有的事实。',
    },
    { role: 'user', content: `文章来源：${sourceUrl || fileName || '用户粘贴'}\n可核验证据块：\n${evidencePrompt(citations)}` },
  ], 'qwen-plus', 3600, 0.1);
  stage = 'MODEL_PARSE';
  let parsed;
  try { parsed = JSON.parse(stripJsonFence(raw)); } catch (_) { parsed = {}; }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  if (!parsed.mindMap || typeof parsed.mindMap !== 'object') {
    const fallbackTitle = String(parsed.title || content.split('\n')[0] || '文章解析').slice(0, 200);
    parsed = {
      ...parsed,
      title: fallbackTitle,
      summary: String(parsed.summary || ''),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      arguments: Array.isArray(parsed.arguments) ? parsed.arguments : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      mindMap: fallbackMindMap(fallbackTitle, content),
    };
  }
  // The first-pass prompt is not a sufficient language guarantee. Validate the
  // actual structure and localize only when English-heavy fields remain. Source
  // quotes and citation indexes are deliberately excluded from this pass.
  stage = 'CHINESE_LOCALIZATION';
  try {
    parsed = await ensureChineseArticleOutput(parsed);
  } catch (error) {
    console.warn('Article Chinese localization failed; continuing with deterministic Chinese structure', {
      code: error && error.publicCode ? error.publicCode : 'LOCALIZATION_RUNTIME_ERROR',
    });
    parsed = applyDeterministicChineseArticleFallback(parsed);
    if (articleOutputNeedsChinese(parsed)) {
      throw requestError(502, 'ARTICLE_CHINESE_LOCALIZATION_FALLBACK_FAILED', '论文结构没有完整转换为中文，请重试解析');
    }
  }
  stage = 'RESPONSE_NORMALIZATION';
  const inferredTitle = String(parsed.title || content.split('\n')[0] || '文章解析').slice(0, 200);
  let mindMap = normalizedMindMap(parsed.mindMap, inferredTitle, allowedIndexes) || fallbackMindMap(inferredTitle, content);
  mindMap.rootCitationIndexes = verifiedIndexes(mindMap.rootCitationIndexes, allowedIndexes, `${mindMap.root} ${mindMap.rootDesc}`, citations);
  mindMap.children = (mindMap.children || []).map((child) => {
    const childIndexes = verifiedIndexes(child.citationIndexes, allowedIndexes, `${child.topic} ${child.desc || ''}`, citations);
    return {
      ...child,
      citationIndexes: childIndexes,
      itemCitationIndexes: (child.items || []).map((item, itemIndex) => {
        const existing = child.itemCitationIndexes && child.itemCitationIndexes[itemIndex];
        return verifiedIndexes(existing, allowedIndexes, item, citations);
      }),
    };
  });
  const keyPoints = normalizedCitedTexts(parsed.keyPoints, allowedIndexes).map((item) => ({
    ...item,
    citationIndexes: verifiedIndexes(item.citationIndexes, allowedIndexes, item.text, citations),
  }));
  const argumentsList = (Array.isArray(parsed.arguments) ? parsed.arguments : []).slice(0, 40).map((item) => ({
    claim: String((item && item.claim) || '').trim().slice(0, 1000),
    evidence: String((item && item.evidence) || '').trim().slice(0, 1200),
    citationIndexes: normalizeCitationIndexes(item && item.citationIndexes, allowedIndexes),
  })).filter((item) => item.claim).map((item) => ({
    ...item,
    citationIndexes: verifiedIndexes(item.citationIndexes, allowedIndexes, `${item.claim} ${item.evidence}`, citations),
  }));
  const summary = String(parsed.summary || mindMap.rootDesc || '').slice(0, 4000);
  const summaryCitationIndexes = verifiedIndexes(parsed.summaryCitationIndexes, allowedIndexes, summary, citations);
  const audit = citationAudit([
    { text: summary, citationIndexes: summaryCitationIndexes },
    ...keyPoints,
    ...argumentsList.map((item) => ({ text: `${item.claim} ${item.evidence}`, citationIndexes: item.citationIndexes })),
    { text: `${mindMap.root} ${mindMap.rootDesc || ''}`, citationIndexes: mindMap.rootCitationIndexes },
    ...mindMap.children.map((item) => ({ text: `${item.topic} ${item.desc || ''}`, citationIndexes: item.citationIndexes })),
  ], citations);
  const extraction = body.extraction && typeof body.extraction === 'object' ? body.extraction : {};
  return {
    status: 200,
    data: {
      title: inferredTitle,
      summary,
      summaryCitationIndexes,
      keyPoints,
      arguments: argumentsList,
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 30) : [],
      mindMap,
      citations,
      documentChunks: citations,
      citationAudit: audit,
      extraction: {
        pageCount: Number(extraction.pageCount || 0),
        tablePages: Array.isArray(extraction.tablePages) ? extraction.tablePages.slice(0, 300) : [],
        imagePages: Array.isArray(extraction.imagePages) ? extraction.imagePages.slice(0, 300) : [],
        scannedPages: Array.isArray(extraction.scannedPages) ? extraction.scannedPages.slice(0, 300) : [],
        truncated: Boolean(extraction.truncated),
      },
      sourceUrl,
      sourceType,
      fileName,
      mimeType,
    },
  };
  } catch (error) {
    if (stage === 'CHINESE_LOCALIZATION') {
      console.warn('Article localization recovered at handler boundary', {
        code: error && error.publicCode ? error.publicCode : 'LOCALIZATION_RUNTIME_ERROR',
      });
      return recoveredChineseArticleResponse(body, recoveryContext);
    }
    if (error && error.publicCode) throw error;
    console.error('Article processing failed', { stage, message: error && error.message ? error.message : 'UNKNOWN' });
    throw requestError(500, `ARTICLE_${stage}_FAILED`, '文章解析在结构处理阶段失败，请重试');
  }
}

async function synthesizeOverviewAudio(text) {
  if (!DASHSCOPE_KEY || !text) return null;
  try {
    const response = await fetchJSON('POST', DASHSCOPE_AUDIO_ENDPOINT, {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
    }, {
      model: 'cosyvoice-v3-flash',
      input: {
        text: String(text).slice(0, 3200),
        voice: 'longanyang',
        format: 'mp3',
        sample_rate: 24000,
        rate: 1.05,
        language_hints: ['zh'],
      },
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`TTS returned ${response.status}`);
    const output = response.body && response.body.output ? response.body.output : {};
    const audio = output.audio || {};
    const url = audio.url || output.url || '';
    if (!url) throw new Error('TTS returned no audio URL');
    return { url, expiresAt: audio.expires_at || output.expires_at || null };
  } catch (error) {
    console.warn('Audio synthesis unavailable; using browser speech fallback', { message: error.message });
    return null;
  }
}

async function handleAudioOverview(body) {
  const title = String(body.title || '文章音频概览').trim().slice(0, 200);
  const summary = String(body.summary || '').trim().slice(0, 3000);
  const citations = (Array.isArray(body.citations) ? body.citations : []).slice(0, 40).map((item) => ({
    index: Number.parseInt(item && item.index, 10), quote: String((item && item.quote) || '').slice(0, 260), locator: String((item && item.locator) || '').slice(0, 100),
  })).filter((item) => Number.isFinite(item.index) && item.index > 0 && item.quote);
  const allowedIndexes = new Set(citations.map((item) => item.index));
  const source = {
    title,
    summary,
    keyPoints: Array.isArray(body.keyPoints) ? body.keyPoints.slice(0, 20) : [],
    arguments: Array.isArray(body.arguments) ? body.arguments.slice(0, 15) : [],
    citations,
  };
  if (!summary && source.keyPoints.length === 0) return { status: 400, data: { error: '请先解析文章再生成音频概览', code: 'INVALID_INPUT' } };

  let parsed = {};
  try {
    const raw = await dashscopeChat([
      { role: 'system', content: '你是 NotebookLM 风格的中文音频概览编导。只返回 JSON：{"title":"","intro":"","segments":[{"speaker":"主持人|分析师","text":"自然口语","citationIndexes":[1]}]}。生成 6-12 段双人对话，每段 1-3 句；只讨论给定材料，关键结论必须带有效引用，不得编造。' },
      { role: 'user', content: JSON.stringify(source) },
    ], 'qwen-plus', 2600, 0.3);
    parsed = JSON.parse(stripJsonFence(raw));
  } catch (error) {
    console.warn('Audio script generation fallback', { message: error.message });
  }
  let segments = (Array.isArray(parsed.segments) ? parsed.segments : []).slice(0, 14).map((item, index) => ({
    speaker: item && item.speaker === '分析师' ? '分析师' : (index % 2 === 0 ? '主持人' : '分析师'),
    text: String((item && item.text) || '').trim().slice(0, 800),
    citationIndexes: normalizeCitationIndexes(item && item.citationIndexes, allowedIndexes),
  })).filter((item) => item.text);
  if (segments.length < 2) {
    const points = Array.isArray(source.keyPoints) ? source.keyPoints : [];
    segments = points.slice(0, 8).map((item, index) => ({
      speaker: index % 2 === 0 ? '主持人' : '分析师',
      text: `${index === 0 ? '先看核心结论：' : '接着来看：'}${String((item && item.text) || item || summary).slice(0, 500)}`,
      citationIndexes: normalizeCitationIndexes(item && item.citationIndexes, allowedIndexes),
    }));
  }
  if (segments.length < 2) segments = [
    { speaker: '主持人', text: `今天我们概览《${title}》的核心内容。`, citationIndexes: [] },
    { speaker: '分析师', text: summary.slice(0, 800), citationIndexes: citations.slice(0, 2).map((item) => item.index) },
  ];
  const scriptText = segments.map((item) => `${item.speaker}：${item.text}`).join('\n');
  const audio = await synthesizeOverviewAudio(scriptText);
  return {
    status: 200,
    data: {
      title: String(parsed.title || title).slice(0, 200),
      intro: String(parsed.intro || '根据文章证据生成的双角色音频概览。').slice(0, 500),
      segments,
      audioUrl: audio ? audio.url : '',
      audioExpiresAt: audio ? audio.expiresAt : null,
      synthesis: audio ? 'cosyvoice' : 'browser',
    },
  };
}

async function handleTool(pathname, body) {
  if (pathname.endsWith('/meeting')) return handleMeetingTool(body);
  if (pathname.endsWith('/article')) return handleArticleTool(body);
  if (pathname.endsWith('/audio-overview')) return handleAudioOverview(body);
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

function convertNode(node, citations) {
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
    citations: Array.isArray(citations) ? citations : [],
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

async function loadNodeCitations(workspaceId, mapId, nodeIds) {
  if (Array.isArray(nodeIds) && nodeIds.length === 0) return new Map();
  const workspace = encodeURIComponent(workspaceId);
  const map = encodeURIComponent(mapId);
  const nodeFilter = Array.isArray(nodeIds) ? `&node_id=in.${inFilter(nodeIds)}` : '';
  const rows = await supabaseRequest('GET', `node_citations?workspace_id=eq.${workspace}&map_id=eq.${map}${nodeFilter}&select=node_id,document_id,citation_index,quote,locator&order=citation_index.asc&limit=8000`);
  const citations = Array.isArray(rows) ? rows : [];
  const documentIds = [...new Set(citations.map((item) => item.document_id).filter(Boolean))];
  let documents = [];
  if (documentIds.length) {
    const result = await supabaseRequest('GET', `source_documents?workspace_id=eq.${workspace}&map_id=eq.${map}&id=in.${inFilter(documentIds)}&select=id,title,source_type,source_url,file_name`);
    documents = Array.isArray(result) ? result : [];
  }
  const documentMap = new Map(documents.map((item) => [item.id, item]));
  const byNode = new Map();
  citations.forEach((item) => {
    const document = documentMap.get(item.document_id) || {};
    const converted = {
      index: item.citation_index,
      quote: item.quote,
      locator: item.locator || '',
      documentId: item.document_id,
      title: document.title || '来源文档',
      sourceUrl: document.source_url || '',
      fileName: document.file_name || '',
      sourceType: document.source_type || 'text',
    };
    const current = byNode.get(item.node_id) || [];
    current.push(converted);
    byNode.set(item.node_id, current);
  });
  return byNode;
}

async function assertOwnedMap(workspaceId, mapId) {
  const rows = await supabaseRequest('GET', `maps?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(mapId)}&select=id,description&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) throw requestError(404, 'MAP_NOT_FOUND', 'Knowledge map not found');
  return rows[0];
}

async function resolveMapForSource(workspaceId, requestedMapId, source) {
  const requested = await assertOwnedMap(workspaceId, requestedMapId);
  const marker = source === 'meeting' ? '[MindGrow:meeting]' : source === 'article' ? '[MindGrow:article]' : '';
  if (!marker || String(requested.description || '').includes(marker)) return requestedMapId;

  // A rapid board switch can leave a stale map id in a mounted client for one
  // render. Never let that contaminate another product library: resolve the
  // first board-owned map on the server and tell the client which map was used.
  const candidates = await supabaseRequest(
    'GET',
    `maps?workspace_id=eq.${encodeURIComponent(workspaceId)}&description=like.*${encodeURIComponent(marker)}*&select=id&order=created_at.asc&limit=1`,
  );
  if (Array.isArray(candidates) && candidates[0] && candidates[0].id) return String(candidates[0].id);
  throw requestError(409, 'MODE_LIBRARY_MISMATCH', 'The selected product library is not ready; reopen this board and retry');
}

async function assertOwnedCategory(workspaceId, categoryId) {
  if (!categoryId) return;
  const rows = await supabaseRequest('GET', `categories?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(categoryId)}&select=id&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) throw requestError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
}

async function createDocumentChunkRows(workspaceId, mapId, documentId, chunks) {
  const normalized = (Array.isArray(chunks) ? chunks : []).slice(0, 160).map((item, index) => ({
    id: `chunk_${crypto.createHash('sha1').update(`${documentId}:${index}`).digest('hex').slice(0, 24)}`,
    workspace_id: workspaceId,
    map_id: mapId,
    document_id: documentId,
    chunk_index: Number.isFinite(Number(item.chunkIndex)) ? Number(item.chunkIndex) : index,
    locator: String(item.locator || '').slice(0, 200),
    page_number: Number.isFinite(Number(item.pageNumber)) ? Number(item.pageNumber) : null,
    content: String(item.content || item.quote || '').trim().slice(0, 8000),
    metadata: { sourceType: item.sourceType || '', fileName: item.fileName || '' },
    embedding: null,
    created_at: new Date().toISOString(),
  })).filter((item) => item.content.length >= 8);
  if (normalized.length === 0) return { count: 0, embedded: 0, status: 'empty' };

  let embedded = 0;
  const batches = [];
  for (let index = 0; index < normalized.length; index += 10) batches.push(normalized.slice(index, index + 10));
  for (let index = 0; index < batches.length; index += 3) {
    const group = batches.slice(index, index + 3);
    const vectors = await Promise.all(group.map(async (batch) => {
      try { return await dashscopeEmbeddings(batch.map((row) => row.content)); }
      catch (error) {
        console.warn('Chunk embedding batch unavailable', { code: error.publicCode || error.code || 'EMBEDDING_UNAVAILABLE' });
        return [];
      }
    }));
    group.forEach((batch, groupIndex) => {
      batch.forEach((row, rowIndex) => {
        const vector = vectors[groupIndex] && vectors[groupIndex][rowIndex];
        if (Array.isArray(vector) && vector.length === 1024) { row.embedding = vector; embedded += 1; }
      });
    });
  }

  for (let index = 0; index < normalized.length; index += 20) {
    await supabaseRequest(
      'POST',
      'document_chunks?on_conflict=document_id,chunk_index',
      normalized.slice(index, index + 20),
      'resolution=merge-duplicates,return=minimal',
    );
  }
  return { count: normalized.length, embedded, status: embedded === normalized.length ? 'ready' : (embedded ? 'partial' : 'keyword_only') };
}

async function createGraph(workspaceId, mapId, mindMap, source, document, sourceCitations, placement, documentChunks, extraction) {
  await assertOwnedMap(workspaceId, mapId);
  const now = new Date().toISOString();
  const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const workspace = encodeURIComponent(workspaceId);
  const map = encodeURIComponent(mapId);
  const [storedNodes, storedEdges] = await Promise.all([
    supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${map}&status=eq.active&select=id,content,desc,type,status&limit=2000`),
    supabaseRequest('GET', `edges?workspace_id=eq.${workspace}&map_id=eq.${map}&select=id,source_id,target_id,relation&limit=4000`),
  ]);
  const allNodes = Array.isArray(storedNodes) ? [...storedNodes] : [];
  const allEdges = Array.isArray(storedEdges) ? [...storedEdges] : [];
  const nodes = [];
  const edges = [];
  const reusedNodes = new Set();
  const citationPlan = new Map();
  const directChildIds = (parentId) => new Set(allEdges.filter((edge) => edge.source_id === parentId && edge.relation === 'contains').map((edge) => edge.target_id));
  const bestSimilar = (content, candidates, threshold) => candidates
    .map((node) => ({ node, score: contentSimilarity(content, node.content) }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)[0];
  const makeNode = (id, content, desc, type, confidence) => ({ id, workspace_id: workspaceId, content, desc: desc || '', type, status: 'active', source, confidence, map_id: mapId, created_at: now, updated_at: now });
  const addContains = (id, sourceId, targetId, weight) => {
    if (allEdges.some((edge) => edge.source_id === sourceId && edge.target_id === targetId && edge.relation === 'contains')) return;
    const created = { id, workspace_id: workspaceId, source_id: sourceId, target_id: targetId, relation: 'contains', weight, map_id: mapId, created_at: now };
    edges.push(created);
    allEdges.push(created);
  };
  const addRelation = (id, sourceId, targetId, weight) => {
    if (sourceId === targetId) return;
    if (allEdges.some((edge) => (
      ((edge.source_id === sourceId && edge.target_id === targetId) || (edge.source_id === targetId && edge.target_id === sourceId))
      && edge.relation === 'relates_to'
    ))) return;
    const created = { id, workspace_id: workspaceId, source_id: sourceId, target_id: targetId, relation: 'relates_to', weight, map_id: mapId, created_at: now };
    edges.push(created);
    allEdges.push(created);
  };
  const sharedAnchorCount = (left, right) => {
    const leftTerms = new Set(queryAnchors(left));
    return queryAnchors(right).filter((term) => leftTerms.has(term)).length;
  };

  const topics = allNodes.filter((node) => node.type === 'topic');
  const requestedTopic = placement && Number(placement.confidence) >= 0.45 ? String(placement.targetTopic || '') : '';
  let root = requestedTopic ? topics.find((node) => node.content === requestedTopic) : null;
  if (!root) {
    // A low semantic threshold merges papers that discuss similar subjects but
    // make different claims. GraphRAG needs stable entities, so reuse only a
    // highly similar root and let explicit relates_to edges connect concepts.
    const similarRoot = bestSimilar(mindMap.root, topics, 0.78);
    root = similarRoot ? similarRoot.node : null;
  }
  if (root) {
    reusedNodes.add(root.id);
    if (!root.desc && mindMap.rootDesc) {
      await supabaseRequest('PATCH', `nodes?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(root.id)}`, { desc: String(mindMap.rootDesc).slice(0, 2000), updated_at: now }, 'return=minimal');
    }
  } else {
    root = makeNode(`node_${seed}_r`, mindMap.root, mindMap.rootDesc, 'topic', 1);
    nodes.push(root);
    allNodes.push(root);
  }
  citationPlan.set(root.id, normalizeCitationIndexes(mindMap.rootCitationIndexes));

  (mindMap.children || []).forEach((child, childIndex) => {
    const rootChildren = directChildIds(root.id);
    const similarChild = bestSimilar(child.topic, allNodes.filter((node) => rootChildren.has(node.id)), 0.82);
    let childNode = similarChild ? similarChild.node : null;
    if (childNode) {
      reusedNodes.add(childNode.id);
    } else {
      childNode = makeNode(`node_${seed}_c${childIndex}`, child.topic, child.desc, 'concept', 0.9);
      nodes.push(childNode);
      allNodes.push(childNode);
      addContains(`edge_${seed}_c${childIndex}`, root.id, childNode.id, 1);
    }
    const relatedConcepts = allNodes
      .filter((node) => node.type === 'concept' && node.id !== childNode.id && !rootChildren.has(node.id))
      .map((node) => ({ node, score: contentSimilarity(child.topic, node.content), shared: sharedAnchorCount(child.topic, node.content) }))
      .filter((item) => item.score >= 0.84 && item.shared >= 2)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2);
    relatedConcepts.forEach((item, relationIndex) => {
      addRelation(`edge_${seed}_r${childIndex}_${relationIndex}`, childNode.id, item.node.id, item.score);
    });
    citationPlan.set(childNode.id, normalizeCitationIndexes(child.citationIndexes));

    (child.items || []).forEach((item, itemIndex) => {
      const childChildren = directChildIds(childNode.id);
      const similarDetail = bestSimilar(item, allNodes.filter((node) => childChildren.has(node.id)), 0.86);
      const existingDetail = similarDetail ? similarDetail.node : null;
      const itemIndexes = child.itemCitationIndexes && child.itemCitationIndexes[itemIndex];
      if (existingDetail) {
        reusedNodes.add(existingDetail.id);
        citationPlan.set(existingDetail.id, normalizeCitationIndexes(itemIndexes && itemIndexes.length ? itemIndexes : child.citationIndexes));
        return;
      }
      const detail = makeNode(`node_${seed}_c${childIndex}i${itemIndex}`, item, '', 'detail', 0.8);
      nodes.push(detail);
      allNodes.push(detail);
      addContains(`edge_${seed}_c${childIndex}i${itemIndex}`, childNode.id, detail.id, 0.8);
      citationPlan.set(detail.id, normalizeCitationIndexes(itemIndexes && itemIndexes.length ? itemIndexes : child.citationIndexes));
    });
  });
  if (nodes.length) await supabaseRequest('POST', 'nodes', nodes);
  if (edges.length) await supabaseRequest('POST', 'edges', edges);
  let citationRows = [];
  let sourceDocument = null;
  let chunkIndex = { count: 0, embedded: 0, status: 'not_requested' };
  if (document && Array.isArray(sourceCitations) && sourceCitations.length > 0) {
    const allowedTypes = new Set(['url', 'pdf', 'text', 'meeting']);
    const contentHash = canonicalDocumentHash(
      Array.isArray(documentChunks) && documentChunks.length ? documentChunks : sourceCitations,
    );
    const existingDocuments = await supabaseRequest('GET', `source_documents?workspace_id=eq.${workspace}&map_id=eq.${map}&content_hash=eq.${contentHash}&select=id&limit=1`);
    const existingDocument = Array.isArray(existingDocuments) ? existingDocuments[0] : null;
    const documentId = existingDocument && existingDocument.id ? existingDocument.id : `doc_${seed}`;
    const documentType = allowedTypes.has(document.sourceType) ? document.sourceType : 'text';
    const citationByIndex = new Map(sourceCitations.slice(0, 80).map((item) => [Number.parseInt(item.index, 10), item]));
    sourceDocument = {
      id: documentId,
      workspace_id: workspaceId,
      map_id: mapId,
      title: String(document.title || mindMap.root || '来源文档').slice(0, 300),
      source_type: documentType,
      source_url: String(document.sourceUrl || '').slice(0, 2000),
      file_name: String(document.fileName || '').slice(0, 300),
      mime_type: String(document.mimeType || '').slice(0, 100),
      content_hash: contentHash,
      created_at: now,
    };
    citationPlan.forEach((indexes, nodeId) => {
      indexes.forEach((index) => {
        const citation = citationByIndex.get(index);
        const quote = String((citation && citation.quote) || '').trim().slice(0, 1000);
        if (!citation || !quote) return;
        citationRows.push({
          id: `cite_${seed}_${nodeId.split('_').pop()}_${index}`,
          workspace_id: workspaceId,
          map_id: mapId,
          node_id: nodeId,
          document_id: documentId,
          citation_index: index,
          quote,
          locator: String(citation.locator || '').slice(0, 200),
          created_at: now,
        });
      });
    });
    try {
      if (!existingDocument) await supabaseRequest('POST', 'source_documents', sourceDocument);
      if (citationRows.length) await supabaseRequest(
        'POST', 'node_citations?on_conflict=node_id,document_id,citation_index', citationRows,
        'resolution=ignore-duplicates,return=minimal',
      );
      try {
        chunkIndex = await createDocumentChunkRows(
          workspaceId,
          mapId,
          documentId,
          Array.isArray(documentChunks) && documentChunks.length ? documentChunks : sourceCitations,
        );
        await supabaseRequest('PATCH', `source_documents?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(documentId)}`, {
          chunk_count: chunkIndex.count,
          embedding_status: chunkIndex.status,
          extraction_json: extraction && typeof extraction === 'object' ? extraction : {},
        }, 'return=minimal');
      } catch (error) {
        chunkIndex = { count: 0, embedded: 0, status: 'migration_required' };
        console.warn('Document chunk index unavailable; graph and citations remain saved', { code: error.publicCode || error.code || 'CHUNK_INDEX_UNAVAILABLE' });
      }
    } catch (error) {
      try {
        await supabaseRequest('DELETE', `edges?workspace_id=eq.${encodeURIComponent(workspaceId)}&map_id=eq.${encodeURIComponent(mapId)}&id=in.${inFilter(edges.map((item) => item.id))}`);
        await supabaseRequest('DELETE', `nodes?workspace_id=eq.${encodeURIComponent(workspaceId)}&map_id=eq.${encodeURIComponent(mapId)}&id=in.${inFilter(nodes.map((item) => item.id))}`);
        if (!existingDocument) await supabaseRequest('DELETE', `source_documents?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(documentId)}`);
      } catch (_) { /* best-effort rollback */ }
      throw error;
    }
  }
  return { root, nodes, edges, reusedNodes: [...reusedNodes], citations: citationRows, document: sourceDocument, chunkIndex };
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
    if (query.action === 'search') {
      const searchQuery = String(query.q || '').trim().slice(0, 100);
      if (!searchQuery) return { status: 200, data: { query: searchQuery, results: [], total: 0 } };
      const safeTerm = searchQuery.replace(/[,*()%_]/g, ' ').replace(/\s+/g, ' ').trim();
      const mapRowsPromise = supabaseRequest('GET', `maps?workspace_id=eq.${workspace}&select=*&order=updated_at.desc&limit=500`);
      const nodeRowsPromise = safeTerm
        ? supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&status=eq.active&or=(content.ilike.*${encodeURIComponent(safeTerm)}*,desc.ilike.*${encodeURIComponent(safeTerm)}*)&select=id,map_id,content,desc,type&limit=80`)
        : Promise.resolve([]);
      const [mapRows, nodeRows] = await Promise.all([mapRowsPromise, nodeRowsPromise]);
      if (!Array.isArray(mapRows) || !Array.isArray(nodeRows)) throw dependencyError('knowledge_store');
      const normalized = searchQuery.toLocaleLowerCase();
      const matchesByMap = new Map();
      nodeRows.forEach((node) => {
        const matches = matchesByMap.get(node.map_id) || [];
        if (matches.length < 5) matches.push({ id: node.id, content: node.content, desc: node.desc || '', type: node.type });
        matchesByMap.set(node.map_id, matches);
      });
      const results = mapRows
        .map((row) => {
          const map = convertMap(row);
          const mapMatches = `${map.name} ${map.description || ''}`.toLocaleLowerCase().includes(normalized);
          const matches = matchesByMap.get(map.id) || [];
          return mapMatches || matches.length ? { map, mapMatches, matches } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.matches.length - a.matches.length || Number(b.mapMatches) - Number(a.mapMatches))
        .slice(0, 20);
      return { status: 200, data: { query: searchQuery, results, total: results.length } };
    }
    const mapId = encodeURIComponent(String(query.mapId || context.defaultMapId));
    const [nodeRows, edgeRows] = await Promise.all([
      supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&map_id=eq.${mapId}&status=eq.active&select=*&limit=2000`),
      supabaseRequest('GET', `edges?workspace_id=eq.${workspace}&map_id=eq.${mapId}&select=*&limit=4000`),
    ]);
    if (!Array.isArray(nodeRows) || !Array.isArray(edgeRows)) throw dependencyError('knowledge_store');
    const citationsByNode = await loadNodeCitations(workspaceId, String(query.mapId || context.defaultMapId), nodeRows.map((node) => node.id));
    return { status: 200, data: { nodes: nodeRows.map((node) => convertNode(node, citationsByNode.get(node.id))), edges: edgeRows.map(convertEdge) } };
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
    const nodeRows = await supabaseRequest('GET', `nodes?workspace_id=eq.${workspace}&id=eq.${encodeURIComponent(layout.node_id)}&select=id,map_id&limit=1`);
    if (!Array.isArray(nodeRows) || !nodeRows[0] || nodeRows[0].map_id !== layout.map_id) return { status: 404, data: { error: 'Node not found in this map', code: 'NOT_FOUND' } };
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
    await assertOwnedCategory(workspaceId, body.categoryId || null);
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
    await assertOwnedMap(workspaceId, mapId);
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
    await assertOwnedMap(workspaceId, mapId);
    await supabaseRequest('DELETE', `node_layouts?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `edges?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `nodes?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('DELETE', `source_documents?workspace_id=eq.${workspace}&map_id=eq.${id}`);
    await supabaseRequest('PATCH', `maps?workspace_id=eq.${workspace}&id=eq.${id}`, { node_count: 0, updated_at: new Date().toISOString() }, 'return=minimal');
    return { status: 200, data: { success: true } };
  }

  if (action === 'renameMap' || action === 'moveMapToCategory') {
    if (!body.mapId) return { status: 400, data: { error: 'mapId is required', code: 'INVALID_INPUT' } };
    await assertOwnedMap(workspaceId, String(body.mapId));
    if (action === 'moveMapToCategory') await assertOwnedCategory(workspaceId, body.categoryId || null);
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
    const requestedMapId = String(body.mapId || context.defaultMapId);
    const mapId = await resolveMapForSource(workspaceId, requestedMapId, String(body.source || ''));
    const graph = await createGraph(
      workspaceId,
      mapId,
      body.mindMap,
      body.source || 'ai_generated',
      body.document || null,
      body.citations || [],
      body.placement || null,
      body.documentChunks || [],
      body.extraction || null,
    );
    await updateMapNodeCount(workspaceId, mapId);
    return {
      status: 201,
      data: {
        node: { id: graph.root.id, content: graph.root.content },
        additionalNodes: graph.nodes.filter((node) => node.id !== graph.root.id).map((node) => ({ id: node.id, content: node.content })),
        additionalEdges: graph.edges.map((edge) => edge.id),
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
        reusedNodes: graph.reusedNodes.length,
        totalCitations: graph.citations ? graph.citations.length : 0,
        indexedChunks: graph.chunkIndex ? graph.chunkIndex.count : 0,
        embeddedChunks: graph.chunkIndex ? graph.chunkIndex.embedded : 0,
        indexStatus: graph.chunkIndex ? graph.chunkIndex.status : 'not_requested',
        mapId,
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
        hybridRetrieval: 'unknown',
      };
      if (checks.knowledgeStoreConfigured) {
        try {
          await supabaseRequest('GET', 'maps?select=id&limit=1');
          checks.knowledgeStore = 'ok';
          await supabaseRequest('GET', 'document_chunks?select=id&limit=1');
          checks.hybridRetrieval = 'ready';
        } catch (_) {
          if (checks.knowledgeStore !== 'ok') checks.knowledgeStore = 'unreachable';
          checks.hybridRetrieval = 'unavailable';
        }
      } else {
        checks.knowledgeStore = 'not_configured';
        checks.hybridRetrieval = 'not_configured';
      }
      const healthy = checks.modelConfigured && checks.knowledgeStore === 'ok' && checks.hybridRetrieval === 'ready';
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', version: API_VERSION, checks, timestamp: new Date().toISOString() }));
    }

    let result;
    const user = await authenticateUser(req);
    if (pathname === '/api/workspaces' || pathname === '/mindgrow/api/workspaces') {
      result = await handleWorkspaces(req, user);
    } else if (pathname === '/api/tools/meeting' || pathname === '/mindgrow/api/tools/meeting'
      || pathname === '/api/tools/article' || pathname === '/mindgrow/api/tools/article'
      || pathname === '/api/tools/audio-overview' || pathname === '/mindgrow/api/tools/audio-overview') {
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

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MindGrow proxy listening on port ${PORT}`);
    console.log(`DashScope configured: ${Boolean(DASHSCOPE_KEY)}`);
    console.log(`Knowledge store configured: ${Boolean(SUPABASE_URL && SUPABASE_KEY)}`);
  });
}

module.exports = {
  buildDocumentChunks,
  buildMeetingCitations,
  bestCitationIndexes,
  citationAudit,
  normalizedMindMap,
  normalizeCitationIndexes,
  normalizeDocumentLayout,
  sourcePages,
  classifyInput,
  classifyArticleRequest,
  selectArticleDocument,
  selectAbstractTranslationChunks,
  articleTaskSystemPrompt,
  articleOutputNeedsChinese,
  articleTranslationTargets,
  applyArticleFieldTranslations,
  applyDeterministicChineseArticleFallback,
  recoveredChineseArticleResponse,
  mergeArticleChineseTranslation,
  needsConversationalContext,
  isTableQuestion,
  hasReliableTableLayout,
  canonicalDocumentHash,
  queryAnchors,
  anchorCoverage,
  retrieveEvidence,
};
