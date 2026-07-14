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
const API_VERSION = '9.0.0';
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
  let response;
  try {
    response = await fetchJSONWithRetry('POST', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
    }, {
      model: model || 'qwen-turbo',
      messages,
      max_tokens: maxTokens || 500,
      temperature: temperature === undefined ? 0.3 : temperature,
    }, 3);
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

async function retrieveNodeEvidence(question, mapId, workspaceId) {
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

async function retrieveDocumentEvidence(question, mapId, workspaceId) {
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
      sourceKind: 'document_chunk',
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
    if (candidates.length < 2) return candidates.slice(0, 12);
    const reranked = await dashscopeRerank(question, candidates.map((item) => item.content), 12);
    if (!reranked || reranked.length === 0) return candidates.slice(0, 12);
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
  const results = await Promise.all([
    retrieveDocumentEvidence(question, mapId, workspaceId),
    retrieveNodeEvidence(question, mapId, workspaceId),
  ]);
  const deduplicated = new Map();
  [...results[0], ...results[1]].forEach((item) => {
    if (!deduplicated.has(item.id)) deduplicated.set(item.id, item);
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
      sources: evidence.slice(0, 12).map((node, index) => {
        const citation = Array.isArray(node.citations) ? node.citations[0] : null;
        return { id: node.id, title: citation && citation.title ? citation.title : node.content, index: index + 1, quote: citation ? citation.quote : '', locator: citation ? citation.locator : '', sourceUrl: citation ? citation.sourceUrl : '' };
      }),
      grounded: true,
      abstained: false,
      coverage: evidence.some((node) => node.expanded) ? 'partial' : 'direct',
      missingInformation: [],
    },
  };
}

async function answerQuestion(input, mapId, intent, workspaceId, history) {
  const contextMessages = (Array.isArray(history) ? history : []).slice(-8);
  const recentUserContext = contextMessages.filter((item) => item.role === 'user').slice(-2).map((item) => item.content).join(' ');
  const retrievalQuery = recentUserContext ? `${recentUserContext}\n当前问题：${input}` : input;
  const evidence = await retrieveGraphEvidence(retrievalQuery, mapId, workspaceId);
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
  try {
    const graphNodeIds = evidence.filter((node) => node.sourceKind !== 'document_chunk').map((node) => node.id);
    const citationsByNode = await loadNodeCitations(workspaceId, mapId, graphNodeIds);
    evidence.forEach((node) => {
      if (node.sourceKind !== 'document_chunk') node.citations = citationsByNode.get(node.id) || [];
    });
  } catch (error) {
    console.warn('Source-document citations unavailable for answer', { code: error.publicCode || 'CITATION_LOOKUP_FAILED' });
  }
  if (!DASHSCOPE_KEY) return deterministicEvidenceAnswer(evidence, intent);

  const allowedIds = new Set(evidence.map((node) => node.id));
  try {
    const raw = await dashscopeChat([
      {
        role: 'system',
        content: '你是严格基于证据回答的知识助手。只返回 JSON：{"answer":"回答当前问题的结论","usedSourceIds":["证据ID"],"coverage":"complete|partial","missingInformation":["缺失信息"]}。可用最近对话理解“它/前者/后者/这个方法”等指代，但事实只能来自证据；不得使用证据之外的信息；证据不足时必须说明缺失，不得猜测。',
      },
      {
        role: 'user',
        content: `最近对话：${JSON.stringify(contextMessages)}\n当前问题：${input}\n证据：${JSON.stringify(evidence.map((node) => ({ id: node.id, content: node.content, description: node.desc || '', citations: node.citations || [] })))}`,
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
        sources: used.map((node, index) => {
          const citation = Array.isArray(node.citations) ? node.citations[0] : null;
          return { id: node.id, title: citation && citation.title ? citation.title : node.content, index: index + 1, quote: citation ? citation.quote : '', locator: citation ? citation.locator : '', sourceUrl: citation ? citation.sourceUrl : '' };
        }),
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
  const history = (Array.isArray(body && body.history) ? body.history : []).slice(-8).map((item) => ({
    role: item && item.role === 'assistant' ? 'assistant' : 'user',
    content: String((item && item.content) || '').trim().slice(0, 3000),
  })).filter((item) => item.content);
  if (!input) return { status: 400, data: { error: 'Input is required', code: 'INVALID_INPUT' } };
  if (input.length > 10000) return { status: 413, data: { error: 'Input is too long', code: 'INPUT_TOO_LARGE' } };

  const intent = { type: classifyInput(input), confidence: 0.9 };
  if (intent.type === 'chitchat') {
    return { status: 200, data: { intent, type: 'chitchat', reply: '你好，我可以帮你整理知识、检索已保存内容，并给出可追溯证据。' } };
  }
  if (intent.type === 'command') {
    return { status: 200, data: { intent, type: 'command', reply: '为了避免误操作，请使用界面中的重命名、清空或删除按钮执行管理操作。' } };
  }
  if (intent.type === 'question') return answerQuestion(input, mapId, intent, context.workspaceId, history);

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

function fallbackMindMap(title, text) {
  const items = String(text || '').split(/[。！？!?\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
  return {
    root: String(title || '整理结果').slice(0, 200),
    rootDesc: items[0] || '',
    children: items.slice(1).map((item, index) => ({ topic: `要点 ${index + 1}`, desc: item.slice(0, 500), items: [] })),
    relatedTopics: [],
  };
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
    quote: normalizeSpaces(chunk.content).slice(0, 1400),
    content: normalizeSpaces(chunk.content).slice(0, 4000),
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
  let content = String(body.content || '').trim();
  let sourceUrl = '';
  let sourceType = ['url', 'pdf', 'text'].includes(body.sourceType) ? body.sourceType : (body.url ? 'url' : 'text');
  const fileName = String(body.fileName || '').trim().slice(0, 300);
  const mimeType = String(body.mimeType || '').trim().slice(0, 100);
  if (!content && body.url) {
    const fetched = await fetchArticleText(String(body.url), 0);
    content = htmlToReadableText(fetched.html);
    sourceUrl = fetched.finalUrl;
    sourceType = 'url';
  }
  if (content.length < 50) return { status: 400, data: { error: '请粘贴至少 50 个字的文章，或输入可公开访问的网址', code: 'INVALID_INPUT' } };
  if (content.length > 120000) content = content.slice(0, 120000);
  const citations = buildDocumentChunks(content, sourceType, fileName);
  const allowedIndexes = new Set(citations.map((item) => item.index));
  const raw = await dashscopeChat([
    {
      role: 'system',
      content: '你是忠于原文的论文与文章解析助手。只返回严格 JSON：{"title":"","summary":"","summaryCitationIndexes":[1],"keyPoints":[{"text":"","citationIndexes":[1]}],"arguments":[{"claim":"","evidence":"","citationIndexes":[1]}],"questions":[""],"mindMap":{"root":"","rootDesc":"","rootCitationIndexes":[1],"children":[{"topic":"","desc":"","citationIndexes":[1],"items":[""],"itemCitationIndexes":[[1]]}]}}。输入由带页码/段落定位的 C 编号证据块组成。每个结论、数字、表格结论和导图分支必须引用直接支持它的 C 编号；只能引用给定编号；不得自行填写 quote 或页码；证据不足就省略结论，不得补充原文没有的事实。',
    },
    { role: 'user', content: `文章来源：${sourceUrl || fileName || '用户粘贴'}\n可核验证据块：\n${evidencePrompt(citations)}` },
  ], 'qwen-plus', 3600, 0.1);
  let parsed;
  try { parsed = JSON.parse(stripJsonFence(raw)); } catch (_) { parsed = {}; }
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
  const rows = await supabaseRequest('GET', `maps?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(mapId)}&select=id&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) throw requestError(404, 'MAP_NOT_FOUND', 'Knowledge map not found');
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
      'resolution=ignore-duplicates,return=minimal',
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

  const topics = allNodes.filter((node) => node.type === 'topic');
  const requestedTopic = placement && Number(placement.confidence) >= 0.45 ? String(placement.targetTopic || '') : '';
  let root = requestedTopic ? topics.find((node) => node.content === requestedTopic) : null;
  if (!root) {
    const similarRoot = bestSimilar(mindMap.root, topics, 0.42);
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
    const similarChild = bestSimilar(child.topic, allNodes.filter((node) => rootChildren.has(node.id)), 0.66);
    let childNode = similarChild ? similarChild.node : null;
    if (childNode) {
      reusedNodes.add(childNode.id);
    } else {
      childNode = makeNode(`node_${seed}_c${childIndex}`, child.topic, child.desc, 'concept', 0.9);
      nodes.push(childNode);
      allNodes.push(childNode);
      addContains(`edge_${seed}_c${childIndex}`, root.id, childNode.id, 1);
    }
    citationPlan.set(childNode.id, normalizeCitationIndexes(child.citationIndexes));

    (child.items || []).forEach((item, itemIndex) => {
      const childChildren = directChildIds(childNode.id);
      const similarDetail = bestSimilar(item, allNodes.filter((node) => childChildren.has(node.id)), 0.72);
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
    const contentHash = crypto.createHash('sha256').update(
      (Array.isArray(documentChunks) && documentChunks.length ? documentChunks : sourceCitations)
        .map((item) => `${item.index}:${item.content || item.quote || ''}`).join('\n'),
    ).digest('hex');
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
    const mapId = String(body.mapId || context.defaultMapId);
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
  sourcePages,
};
