const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { readApiVersion } = require("./deployment-fact");

const projectRoot = path.join(__dirname, "..");
const backendEntry = process.env.MINDGROW_LOCAL_BACKEND_ENTRY
  ? path.resolve(projectRoot, process.env.MINDGROW_LOCAL_BACKEND_ENTRY)
  : path.join(projectRoot, "fc-proxy", "index.js");
const backendPort = 9000;
const backendBase = `http://127.0.0.1:${backendPort}`;
const localApiVersion = process.env.MINDGROW_LOCAL_API_VERSION || readApiVersion();
const localApiGitSha = process.env.MINDGROW_LOCAL_API_GIT_SHA || "0000000000000000000000000000000000000000";
const allowedHealthTables = new Set([
  "maps",
  "document_chunks",
  "graph_entities",
  "graph_relations",
  "graph_evidence",
  "node_revisions",
  "product_feedback",
]);

let backendProcess;
let supabaseStub;
let cleanupPromise;
const workspaceSearchPayloads = [];
const feedbackRows = [];

function startSupabaseStub() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const workspaceId = "ws_localbootstrapuser";
      const defaultMapId = `map_${workspaceId}_default`;

      if (request.method === "GET" && url.pathname === "/auth/v1/user") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ id: "local-bootstrap-user", email: "bootstrap@mindgrow.test" }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/rest/v1/rpc/hybrid_search_document_chunks_v2") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify([]));
        return;
      }

      if (request.method === "POST" && url.pathname === "/rest/v1/rpc/search_workspace_knowledge") {
        let rawBody = "";
        request.on("data", (chunk) => { rawBody += chunk; });
        request.on("end", () => {
          const payload = JSON.parse(rawBody || "{}");
          workspaceSearchPayloads.push(payload);
          const rows = payload.p_query_text ? [{
            result_type: "node",
            result_id: "node_bootstrap",
            map_id: defaultMapId,
            map_name: "默认知识库",
            title: "Bootstrap ready",
            snippet: "one-request graph",
            match_field: "node_title",
            locator: "",
            score: 0.91,
          }] : [];
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(rows));
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/rest/v1/product_feedback") {
        let rawBody = "";
        request.on("data", (chunk) => { rawBody += chunk; });
        request.on("end", () => {
          const payload = JSON.parse(rawBody || "{}");
          feedbackRows.unshift(payload);
          response.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify([payload]));
        });
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/rest/v1/product_feedback") {
        let rawBody = "";
        request.on("data", (chunk) => { rawBody += chunk; });
        request.on("end", () => {
          const payload = JSON.parse(rawBody || "{}");
          const id = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
          const row = feedbackRows.find((item) => item.id === id);
          if (row) Object.assign(row, payload);
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(row ? [row] : []));
        });
        return;
      }

      const match = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
      const table = match?.[1];
      const rowsByTable = {
        workspace_members: [{ workspace_id: workspaceId, role: "owner" }],
        workspaces: [{ id: workspaceId, name: "Bootstrap workspace", owner_id: "local-bootstrap-user", created_at: "2026-07-22T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z" }],
        maps: [{ id: defaultMapId, workspace_id: workspaceId, name: "默认知识库", description: "", mode: "knowledge", color: "#22d3a7", is_default: true, category_id: null, node_count: 1, created_at: "2026-07-22T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z" }],
        categories: [],
        nodes: [{ id: "node_bootstrap", map_id: defaultMapId, content: "Bootstrap ready", desc: "one-request graph", type: "concept", status: "active", source: "manual", confidence: 1, created_at: "2026-07-22T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z" }],
        edges: [],
        node_layouts: [],
        whiteboard_groups: [],
        graph_entities: [],
        graph_relations: [],
        graph_evidence: [],
        source_documents: [],
        node_citations: [],
        node_revisions: [],
        document_chunks: [],
        product_feedback: feedbackRows,
      };

      if (request.method === "GET" && (Object.prototype.hasOwnProperty.call(rowsByTable, table) || allowedHealthTables.has(table))) {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(rowsByTable[table] || []));
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Local dependency stub only supports health probes" }));
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function assertBackendPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      reject(new Error(`Local backend port ${backendPort} is unavailable (${error.code || error.message})`));
    });
    probe.listen(backendPort, "0.0.0.0", () => {
      probe.close(resolve);
    });
  });
}

function startBackend(supabaseUrl) {
  return spawn(process.execPath, [backendEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AUTH_REQUIRED: "true",
      FC_SERVER_PORT: String(backendPort),
      MINDGROW_API_KEY: "local-smoke-model-key",
      MINDGROW_GIT_SHA: localApiGitSha,
      NODE_ENV: "test",
      SUPABASE_KEY: "local-smoke-service-role-key",
      SUPABASE_URL: supabaseUrl,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealthyBackend(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "not reachable";

  while (Date.now() < deadline) {
    if (backendProcess.exitCode !== null) {
      throw new Error(`Local backend exited before becoming healthy (exit ${backendProcess.exitCode})`);
    }

    try {
      const response = await fetch(`${backendBase}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = await response.json().catch(() => null);
      lastStatus = `HTTP ${response.status}, version ${body?.version || "unknown"}`;
      if (response.status === 200 && body?.status === "ok"
        && body?.version === localApiVersion && body?.checks?.function === "ok") return;
    } catch (error) {
      lastStatus = error.message;
    }

    await delay(200);
  }

  throw new Error(`Timed out waiting for ${backendBase}/health (${lastStatus})`);
}

async function testUnifiedUniverseAndMeetingGate() {
  const headers = {
    Authorization: "Bearer local-bootstrap-token",
    "Content-Type": "application/json",
    "X-Workspace-Id": "ws_localbootstrapuser",
  };
  const universe = await fetch(`${backendBase}/api/knowledge?action=universe`, { headers });
  const universeBody = await universe.json();
  if (universe.status !== 200 || !Array.isArray(universeBody.libraries) || universeBody.libraries.length !== 1) {
    throw new Error(`Unified universe aggregate failed (HTTP ${universe.status})`);
  }

  const unconfirmed = await fetch(`${backendBase}/api/knowledge`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mapId: "map_ws_localbootstrapuser_default",
      source: "meeting",
      mindMap: { root: "Unconfirmed meeting", children: [] },
    }),
  });
  const unconfirmedBody = await unconfirmed.json();
  if (unconfirmed.status !== 409 || unconfirmedBody.code !== "MEETING_CONFIRMATION_REQUIRED") {
    throw new Error(`Meeting confirmation gate failed (HTTP ${unconfirmed.status}, ${unconfirmedBody.code || "no code"})`);
  }
  console.log("Unified universe aggregate and meeting confirmation gate passed");
}

async function testArticleSourceAndAudioGate() {
  const headers = {
    Authorization: "Bearer local-bootstrap-token",
    "Content-Type": "application/json",
    "X-Workspace-Id": "ws_localbootstrapuser",
  };
  const ambiguous = await fetch(`${backendBase}/api/tools/article`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: "https://example.com/paper",
      content: "同一次请求不应同时提交网页和正文。".repeat(8),
      sourceType: "url",
    }),
  });
  const ambiguousBody = await ambiguous.json();
  if (ambiguous.status !== 400 || ambiguousBody.code !== "ARTICLE_SOURCE_AMBIGUOUS") {
    throw new Error(`Article single-source gate failed (HTTP ${ambiguous.status}, ${ambiguousBody.code || "no code"})`);
  }

  const blocked = await fetch(`${backendBase}/api/tools/article`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: "http://127.0.0.1/private", sourceType: "url" }),
  });
  const blockedBody = await blocked.json();
  if (blocked.status !== 400 || blockedBody.code !== "URL_NOT_ALLOWED") {
    throw new Error(`Unreadable URL refusal failed (HTTP ${blocked.status}, ${blockedBody.code || "no code"})`);
  }

  const ungroundedAudio = await fetch(`${backendBase}/api/tools/audio-overview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "无引用文章", summary: "这段摘要没有可核验证据。", citations: [] }),
  });
  const ungroundedBody = await ungroundedAudio.json();
  if (ungroundedAudio.status !== 422 || ungroundedBody.code !== "AUDIO_EVIDENCE_REQUIRED") {
    throw new Error(`Audio evidence gate failed (HTTP ${ungroundedAudio.status}, ${ungroundedBody.code || "no code"})`);
  }
  console.log("Article single-source, unreadable URL, and audio evidence gates passed");
}

async function testTenantScopedWorkspaceSearch() {
  const headers = {
    Authorization: "Bearer local-bootstrap-token",
    "X-Workspace-Id": "ws_localbootstrapuser",
  };
  const response = await fetch(`${backendBase}/api/knowledge?action=search&q=Bootstrap&limit=12`, { headers });
  const body = await response.json();
  const payload = workspaceSearchPayloads.find((item) => item.p_query_text === "Bootstrap");
  if (response.status !== 200 || body.scope !== "workspace" || body.results?.[0]?.matchField !== "node_title") {
    throw new Error(`Workspace search contract failed (HTTP ${response.status})`);
  }
  if (payload?.p_workspace_id !== "ws_localbootstrapuser" || payload?.p_match_count !== 12) {
    throw new Error("Workspace search did not bind the authenticated workspace to the RPC");
  }
  console.log("Tenant-scoped workspace search and hit explanation passed");
}

async function testTenantScopedFeedbackLoop() {
  const headers = {
    Authorization: "Bearer local-bootstrap-token",
    "Content-Type": "application/json",
    "X-Workspace-Id": "ws_localbootstrapuser",
  };
  const response = await fetch(`${backendBase}/api/knowledge`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "submitFeedback",
      workspaceId: "ws_attacker_controlled",
      userId: "attacker-controlled",
      category: "retrieval",
      severity: "high",
      message: "Workspace search returned the wrong article for a precise query.",
      locale: "en",
      productArea: "article",
      allowContact: false,
      clientVersion: "10.17.0",
      context: { route: "/", mode: "article", mapId: "map_ws_localbootstrapuser_default", deviceClass: "desktop", leakedContent: "must not persist" },
    }),
  });
  const body = await response.json();
  const stored = feedbackRows.find((item) => item.id === body.feedback?.id);
  if (response.status !== 201 || !stored || stored.workspace_id !== "ws_localbootstrapuser" || stored.user_id !== "local-bootstrap-user") {
    throw new Error(`Tenant-scoped feedback submission failed (HTTP ${response.status})`);
  }
  if (stored.context?.leakedContent || stored.contact_email || !stored.issue_tags?.includes("category:retrieval")) {
    throw new Error("Feedback minimization, contact consent, or issue tagging failed");
  }
  const listResponse = await fetch(`${backendBase}/api/knowledge?action=feedback`, { headers });
  const listBody = await listResponse.json();
  if (listResponse.status !== 200 || listBody.feedback?.[0]?.id !== stored.id || Object.prototype.hasOwnProperty.call(listBody.feedback[0], "contactEmail")) {
    throw new Error(`Feedback status list failed (HTTP ${listResponse.status})`);
  }
  console.log("Tenant-scoped feedback, issue tags, and data minimization passed");
}

function runLocalSmoke() {
  return new Promise((resolve, reject) => {
    const smoke = spawn(process.execPath, [path.join(__dirname, "backend-smoke.js")], {
      cwd: projectRoot,
      env: {
        ...process.env,
        MINDGROW_API_BASE: backendBase,
        MINDGROW_ACCESS_TOKEN: "local-bootstrap-token",
        MINDGROW_BOOTSTRAP_ONLY: "true",
        MINDGROW_EXPECTED_API_GIT_SHA: localApiGitSha,
      },
      stdio: "inherit",
    });
    smoke.once("error", reject);
    smoke.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Local backend smoke was terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(backendProcess.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }

  backendProcess.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => backendProcess.once("exit", () => resolve(true))),
    delay(2000).then(() => false),
  ]);
  if (exited || backendProcess.exitCode !== null) return;

  backendProcess.kill("SIGKILL");
}

function cleanup() {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      await stopBackend();
      await closeServer(supabaseStub);
    })();
  }
  return cleanupPromise;
}

async function main() {
  let exitCode = 1;
  try {
    await assertBackendPortAvailable();
    const stub = await startSupabaseStub();
    supabaseStub = stub.server;
    backendProcess = startBackend(stub.url);
    backendProcess.once("error", (error) => {
      console.error(`Local backend failed to start: ${error.message}`);
    });

    await waitForHealthyBackend();
    console.log(`Local backend is healthy at ${backendBase}`);
    await testUnifiedUniverseAndMeetingGate();
    await testArticleSourceAndAudioGate();
    await testTenantScopedWorkspaceSearch();
    await testTenantScopedFeedbackLoop();
    exitCode = await runLocalSmoke();
  } catch (error) {
    console.error(`Local backend test failed: ${error.message}`);
  } finally {
    await cleanup();
  }

  process.exitCode = exitCode;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

main();
