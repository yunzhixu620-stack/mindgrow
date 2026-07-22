const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const backendEntry = path.join(projectRoot, "fc-proxy", "index.js");
const validGitSha = "1111111111111111111111111111111111111111";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
}

async function probeIdentity({ port, gitSha, expectedIdentity, expectedGitSha }) {
  const child = spawn(process.execPath, [backendEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AUTH_REQUIRED: "true",
      FC_SERVER_PORT: String(port),
      MINDGROW_API_KEY: "deployment-identity-test",
      MINDGROW_GIT_SHA: gitSha,
      NODE_ENV: "production",
      SUPABASE_KEY: "",
      SUPABASE_URL: "",
    },
    stdio: "ignore",
  });

  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`backend exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        const body = await response.json();
        if (response.status !== 503 || body.status !== "degraded") {
          throw new Error(`expected degraded HTTP 503, received ${response.status} ${body.status}`);
        }
        if (body.checks?.deploymentIdentity !== expectedIdentity || body.gitSha !== expectedGitSha) {
          throw new Error(`unexpected deployment identity ${body.checks?.deploymentIdentity} / ${body.gitSha}`);
        }
        return;
      } catch (error) {
        if (!/fetch failed|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT/i.test(String(error.message))) throw error;
      }
      await delay(100);
    }
    throw new Error("timed out waiting for deployment identity probe");
  } finally {
    await stopProcess(child);
  }
}

(async () => {
  await probeIdentity({ port: 9011, gitSha: "", expectedIdentity: "missing", expectedGitSha: null });
  await probeIdentity({ port: 9012, gitSha: validGitSha, expectedIdentity: "ready", expectedGitSha: validGitSha });
  console.log("Deployment identity gate passed: missing SHA fails closed and a valid SHA is exposed exactly");
})().catch((error) => {
  console.error(`Deployment identity test failed: ${error.message}`);
  process.exitCode = 1;
});
