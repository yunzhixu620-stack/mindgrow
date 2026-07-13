const fs = require("fs");
const path = require("path");

const baseUrl = (process.env.MINDGROW_API_BASE_URL || "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run").replace(/\/$/, "");
const results = [];

async function request(name, pathname, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: {
        Origin: "https://yunzhixu620-stack.github.io",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const result = {
      name,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      cors: response.headers.get("access-control-allow-origin"),
      body,
    };
    results.push(result);
    console.log(`${response.ok ? "PASS" : "FAIL"} ${name}: ${response.status} (${result.latencyMs}ms)`);
    return result;
  } catch (error) {
    const result = { name, ok: false, status: 0, latencyMs: Date.now() - startedAt, error: error.message };
    results.push(result);
    console.error(`FAIL ${name}: ${error.message}`);
    return result;
  }
}

(async () => {
  const preflight = await request("CORS preflight", "/api/chat", { method: "OPTIONS" });
  if (preflight.status === 204 && preflight.cors === "*") preflight.ok = true;

  await request("Dependency health", "/health");
  const maps = await request("List maps", "/api/knowledge?action=maps");
  await request("List categories", "/api/knowledge?action=categories");
  await request("Load default map", "/api/knowledge?mapId=map_default");
  await request("Greeting intent", "/api/chat", {
    method: "POST",
    body: JSON.stringify({ input: "你好", mapId: "map_default" }),
  });

  if (process.env.MINDGROW_RUN_BILLABLE_AI === "1") {
    await request("Knowledge generation", "/api/chat", {
      method: "POST",
      body: JSON.stringify({ input: "RAG 回答需要引用可追溯来源", mapId: "map_default" }),
    });
  }

  // Only run reversible CRUD if the storage read path is healthy.
  if (maps.ok && Array.isArray(maps.body?.maps)) {
    let mapId;
    try {
      const created = await request("Create temporary map", "/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ action: "createMap", name: `Backend smoke ${Date.now()}` }),
      });
      mapId = created.body?.map?.id;
      if (!mapId) {
        created.ok = false;
        throw new Error("Backend did not return a map id");
      }

      const graph = await request("Create temporary knowledge graph", "/api/knowledge", {
        method: "POST",
        body: JSON.stringify({
          mapId,
          source: "manual",
          mindMap: { root: "Smoke test root", children: [{ topic: "Smoke test child", items: [] }] },
        }),
      });
      const nodeId = graph.body?.node?.id;
      if (!nodeId) {
        graph.ok = false;
        throw new Error("Backend did not return a node id");
      }

      const updated = await request("Update temporary node", "/api/knowledge", {
        method: "PATCH",
        body: JSON.stringify({ nodeId, content: "Smoke test root updated", desc: "reversible test" }),
      });
      if (updated.body?.node?.content !== "Smoke test root updated") updated.ok = false;

      await request("Save temporary node layout", "/api/knowledge", {
        method: "PUT",
        body: JSON.stringify({ nodeId, mapId, positionX: 120, positionY: 80 }),
      });
      const reloaded = await request("Verify temporary graph", `/api/knowledge?mapId=${encodeURIComponent(mapId)}`);
      if (!reloaded.body?.nodes?.some((node) => node.id === nodeId && node.content === "Smoke test root updated")) reloaded.ok = false;

      await request("Delete temporary node", `/api/knowledge?nodeId=${encodeURIComponent(nodeId)}`, { method: "DELETE" });
    } finally {
      if (mapId) {
        await request("Delete temporary map", "/api/knowledge", {
          method: "POST",
          body: JSON.stringify({ action: "deleteMap", mapId }),
        });
      }
    }
  }

  const artifactDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const report = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    summary: {
      passed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    },
    results,
  };
  fs.writeFileSync(path.join(artifactDir, "backend-smoke-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.summary.passed}/${results.length} backend checks passed`);
  if (report.summary.failed) process.exit(1);
})();
