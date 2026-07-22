const fs = require("fs");
const path = require("path");
const { readApiVersion } = require("./deployment-fact");

const baseUrl = (process.env.MINDGROW_API_BASE || process.env.MINDGROW_API_BASE_URL || "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run").replace(/\/$/, "");
const expectedApiVersion = process.env.MINDGROW_EXPECTED_API_VERSION || readApiVersion();
const accessToken = process.env.MINDGROW_ACCESS_TOKEN || "";
const bootstrapOnly = process.env.MINDGROW_BOOTSTRAP_ONLY === "true";
let workspaceId = process.env.MINDGROW_WORKSPACE_ID || "";
const results = [];

async function request(name, pathname, options = {}) {
  const startedAt = Date.now();
  const authenticated = options.authenticated !== false && Boolean(accessToken);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: {
        Origin: "https://yunzhixu620-stack.github.io",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(authenticated ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(authenticated && workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const result = { name, ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt, cors: response.headers.get("access-control-allow-origin"), body };
    results.push(result);
    console.log(`${response.ok ? "PASS" : "CHECK"} ${name}: ${response.status} (${result.latencyMs}ms)`);
    return result;
  } catch (error) {
    const result = { name, ok: false, status: 0, latencyMs: Date.now() - startedAt, error: error.message };
    results.push(result);
    console.error(`FAIL ${name}: ${error.message}`);
    return result;
  }
}

function expectStatus(result, status) {
  result.ok = result.status === status;
  if (!result.ok) result.expectation = `Expected HTTP ${status}`;
}

(async () => {
  const preflight = await request("CORS preflight", "/api/chat", { method: "OPTIONS", authenticated: false });
  preflight.ok = preflight.status === 204 && preflight.cors === "https://yunzhixu620-stack.github.io";

  const health = await request("Dependency health and API version", "/health", { authenticated: false });
  health.ok = health.status === 200 && health.body?.status === "ok" && health.body?.version === expectedApiVersion
    && health.body?.authRequired === true && health.body?.allowAnonLocal === false
    && typeof health.body?.nodeEnv === "string" && health.body?.checks?.authConfiguration === "ok"
    && health.body?.checks?.modelConfigured === true && health.body?.checks?.knowledgeStore === "ok"
    && health.body?.checks?.hybridRetrieval === "ready" && health.body?.checks?.entityGraph === "ready"
    && health.body?.checks?.nodeTimeline === "ready" && health.body?.checks?.whiteboardLayout === "ready";
  if (!health.ok) {
    health.expectation = "Expected healthy authenticated API " + expectedApiVersion + " with knowledge, hybrid retrieval, and entity graph ready";
    console.error("FAIL Dependency health gate: received " + (health.body?.version || "unknown"));
  }

  for (const [name, pathname, options] of [
    ["Anonymous bootstrap is denied", "/api/bootstrap", { authenticated: false }],
    ["Anonymous knowledge is denied", "/api/knowledge?action=maps", { authenticated: false }],
    ["Anonymous node PATCH reaches application auth", "/api/knowledge", {
      method: "PATCH",
      body: JSON.stringify({ nodeId: "trigger-method-probe", content: "trigger-method-probe" }),
      authenticated: false,
    }],
    ["Anonymous workspace access is denied", "/api/workspaces", { authenticated: false }],
    ["Anonymous Audio Overview is denied", "/api/tools/audio-overview", { method: "POST", body: "{}", authenticated: false }],
  ]) {
    const result = await request(name, pathname, options);
    expectStatus(result, 401);
  }

  if (accessToken) {
    const bootstrap = await request("Load authenticated bootstrap", "/api/bootstrap");
    if (!workspaceId && bootstrap.body?.workspace?.id) {
      workspaceId = bootstrap.body.workspace.id;
    }
    if (!workspaceId || !Array.isArray(bootstrap.body?.workspaces) || !Array.isArray(bootstrap.body?.maps)
      || !Array.isArray(bootstrap.body?.categories) || !bootstrap.body?.defaultMap?.map?.id
      || !Array.isArray(bootstrap.body?.defaultMap?.nodes) || !Array.isArray(bootstrap.body?.defaultMap?.edges)
      || !Array.isArray(bootstrap.body?.defaultMap?.layouts) || !Array.isArray(bootstrap.body?.defaultMap?.whiteboardGroups)
      || !Array.isArray(bootstrap.body?.defaultMap?.entityGraph?.entities)
      || bootstrap.body.defaultMap.map.id !== bootstrap.body.workspace?.defaultMapId) bootstrap.ok = false;
    if (bootstrap.body?.defaultMap?.nodes?.[0]?.id) {
      const context = await request("Load node backlinks and timeline", `/api/knowledge?action=nodeContext&nodeId=${encodeURIComponent(bootstrap.body.defaultMap.nodes[0].id)}`);
      if (!context.body?.node?.id || !Array.isArray(context.body?.sources)
        || !Array.isArray(context.body?.backlinks) || !Array.isArray(context.body?.timeline)) context.ok = false;
    }

    if (!bootstrapOnly) {
      const maps = await request("List tenant maps", "/api/knowledge?action=maps");
      await request("List tenant categories", "/api/knowledge?action=categories");
      if (maps.ok && Array.isArray(maps.body?.maps)) {
        let mapId;
        const temporaryMapIds = [];
        try {
          for (const mode of ["knowledge", "meeting", "article"]) {
            const created = await request(`Create temporary ${mode} map`, "/api/knowledge", {
              method: "POST",
              body: JSON.stringify({ action: "createMap", name: `Backend smoke ${mode} ${Date.now()}`, mode, description: `${mode} smoke` }),
            });
            const createdMap = created.body?.map;
            if (!createdMap?.id) throw new Error(`Backend did not return a ${mode} map id`);
            temporaryMapIds.push(createdMap.id);
            if (createdMap.mode !== mode || String(createdMap.description || "").includes("[MindGrow:")) {
              created.ok = false;
              throw new Error(`Backend did not persist clean explicit mode ${mode}`);
            }
            if (mode === "knowledge") mapId = createdMap.id;
          }
          const graph = await request("Create cited temporary graph", "/api/knowledge", {
            method: "POST",
            body: JSON.stringify({
              mapId, source: "article",
              mindMap: { root: "Smoke citation root", rootCitationIndexes: [1], children: [{ topic: "Smoke child", citationIndexes: [1], items: [], itemCitationIndexes: [] }] },
              document: { title: "Smoke source", sourceType: "text" },
              citations: [{ index: 1, quote: "Smoke test source evidence", locator: "paragraph 1" }],
            }),
          });
          const nodeId = graph.body?.node?.id;
          if (!nodeId || graph.body?.totalCitations < 1) graph.ok = false;
          const canvasView = await request("Enable temporary whiteboard view", "/api/knowledge", {
            method: "POST",
            body: JSON.stringify({ action: "setMapCanvasView", mapId, canvasView: "whiteboard" }),
          });
          if (canvasView.body?.canvasView !== "whiteboard") canvasView.ok = false;
          const createdGroup = await request("Create temporary whiteboard group", "/api/knowledge", {
            method: "POST",
            body: JSON.stringify({ action: "createWhiteboardGroup", mapId, name: "Smoke evidence", color: "#38bdf8", positionX: 120, positionY: 80, width: 720, height: 480 }),
          });
          const groupId = createdGroup.body?.group?.id;
          if (!groupId) createdGroup.ok = false;
          const savedLayout = await request("Save temporary whiteboard card layout", "/api/knowledge", {
            method: "PUT",
            body: JSON.stringify({ mapId, nodeId, groupId, positionX: 160, positionY: 120, cardWidth: 320, cardHeight: 180, zoomLevel: 1 }),
          });
          if (savedLayout.body?.layout?.groupId !== groupId || savedLayout.body?.layout?.cardWidth !== 320) savedLayout.ok = false;
          const reloaded = await request("Verify cited graph reload", `/api/knowledge?mapId=${encodeURIComponent(mapId)}`);
          if (!reloaded.body?.nodes?.some((node) => node.id === nodeId && node.citations?.length)
            || !reloaded.body?.layouts?.some((layout) => layout.nodeId === nodeId && layout.groupId === groupId)
            || !reloaded.body?.whiteboardGroups?.some((group) => group.id === groupId)) reloaded.ok = false;
          const secondNodeId = reloaded.body?.nodes?.find((node) => node.id !== nodeId)?.id;
          if (secondNodeId) {
            const batchLayout = await request("Save temporary whiteboard layout batch", "/api/knowledge", {
              method: "PUT",
              body: JSON.stringify({
                mapId,
                layouts: [
                  { nodeId, groupId, positionX: 160, positionY: 120, cardWidth: 320, cardHeight: 180, zoomLevel: 1 },
                  { nodeId: secondNodeId, groupId: null, positionX: 40, positionY: 60, cardWidth: 280, cardHeight: 168, zoomLevel: 1 },
                ],
              }),
            });
            if (batchLayout.body?.layouts?.length !== 2) batchLayout.ok = false;
          }
          const updatedGroup = await request("Update temporary whiteboard group", "/api/knowledge", {
            method: "POST",
            body: JSON.stringify({ action: "updateWhiteboardGroup", mapId, groupId, width: 840, collapsed: true }),
          });
          if (updatedGroup.body?.group?.width !== 840 || updatedGroup.body?.group?.collapsed !== true) updatedGroup.ok = false;
          await request("Delete temporary whiteboard group", "/api/knowledge", {
            method: "POST",
            body: JSON.stringify({ action: "deleteWhiteboardGroup", mapId, groupId }),
          });
          const ungrouped = await request("Verify cards survive group deletion", `/api/knowledge?mapId=${encodeURIComponent(mapId)}`);
          if (!ungrouped.body?.layouts?.some((layout) => layout.nodeId === nodeId && layout.groupId === null && layout.positionX === 280 && layout.positionY === 200)
            || ungrouped.body?.whiteboardGroups?.some((group) => group.id === groupId)) ungrouped.ok = false;
        } finally {
          for (const temporaryMapId of temporaryMapIds) {
            await request("Delete temporary map", "/api/knowledge", { method: "POST", body: JSON.stringify({ action: "deleteMap", mapId: temporaryMapId }) });
          }
        }
      }
    } else {
      console.log("SKIP authenticated CRUD: bootstrap-only integration mode");
    }
  } else {
    console.log("SKIP authenticated CRUD: set MINDGROW_ACCESS_TOKEN (and optionally MINDGROW_WORKSPACE_ID) to run tenant-scoped write tests");
  }

  const artifactDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const report = { checkedAt: new Date().toISOString(), baseUrl, authenticatedChecksRun: Boolean(accessToken), summary: { passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length }, results };
  fs.writeFileSync(path.join(artifactDir, "backend-smoke-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.summary.passed}/${results.length} backend checks passed`);
  if (report.summary.failed) process.exitCode = 1;
})();
