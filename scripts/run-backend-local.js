const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const backendEntry = process.env.MINDGROW_LOCAL_BACKEND_ENTRY
  ? path.resolve(projectRoot, process.env.MINDGROW_LOCAL_BACKEND_ENTRY)
  : path.join(projectRoot, "fc-proxy", "index.js");
const backendPort = 9000;
const backendBase = `http://127.0.0.1:${backendPort}`;
const localApiVersion = process.env.MINDGROW_LOCAL_API_VERSION || "10.5.2";
const allowedHealthTables = new Set([
  "maps",
  "document_chunks",
  "graph_entities",
  "graph_relations",
  "graph_evidence",
]);

let backendProcess;
let supabaseStub;
let cleanupPromise;

function startSupabaseStub() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const match = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
      const table = match?.[1];

      if (request.method === "GET" && allowedHealthTables.has(table)) {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end("[]");
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

function runLocalSmoke() {
  return new Promise((resolve, reject) => {
    const smoke = spawn(process.execPath, [path.join(__dirname, "backend-smoke.js")], {
      cwd: projectRoot,
      env: {
        ...process.env,
        MINDGROW_API_BASE: backendBase,
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
