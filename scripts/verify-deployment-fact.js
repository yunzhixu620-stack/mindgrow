const fs = require("fs");
const path = require("path");
const {
  outputFactPath,
  projectRoot,
  readApiVersion,
  validateDeploymentFact,
} = require("./deployment-fact");

const mode = process.argv.includes("--production") ? "production" : "artifact";
const frontendBaseUrl = (process.env.MINDGROW_FRONTEND_BASE_URL || "https://yunzhixu620-stack.github.io/mindgrow").replace(/\/$/, "");
const apiBaseUrl = (process.env.MINDGROW_API_BASE || "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run").replace(/\/$/, "");
const expectedFrontendSha = (process.env.MINDGROW_EXPECTED_FRONTEND_SHA || "").trim().toLowerCase();
const expectedApiGitSha = (process.env.MINDGROW_EXPECTED_API_GIT_SHA || "").trim().toLowerCase();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateExpectedSha(fact) {
  if (!expectedFrontendSha) return;
  assert(/^[0-9a-f]{40}$/.test(expectedFrontendSha), "MINDGROW_EXPECTED_FRONTEND_SHA must be a full 40-character Git SHA");
  assert(fact.frontend.gitSha === expectedFrontendSha, `frontend SHA ${fact.frontend.gitSha} does not match expected ${expectedFrontendSha}`);
}

function validateApiGitSha(health) {
  const gitSha = String(health?.gitSha || "").trim().toLowerCase();
  assert(/^[0-9a-f]{40}$/.test(gitSha), "API health.gitSha must be a full 40-character Git SHA");
  assert(health?.checks?.deploymentIdentity === "ready", "API health.checks.deploymentIdentity must be ready");
  if (expectedApiGitSha) {
    assert(/^[0-9a-f]{40}$/.test(expectedApiGitSha), "MINDGROW_EXPECTED_API_GIT_SHA must be a full 40-character Git SHA");
    assert(gitSha === expectedApiGitSha, `API git SHA ${gitSha} does not match expected ${expectedApiGitSha}`);
  }
  return gitSha;
}

function verifyFact(fact) {
  const errors = validateDeploymentFact(fact);
  assert(errors.length === 0, errors.join("; "));
  validateExpectedSha(fact);
}

async function fetchJson(name, url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `${name} returned HTTP ${response.status}`);
  return response.json();
}

async function verifyProduction() {
  const cacheBust = Date.now();
  const [fact, health] = await Promise.all([
    fetchJson("frontend deployment fact", `${frontendBaseUrl}/deployment.json?v=${cacheBust}`),
    fetchJson("API health", `${apiBaseUrl}/health`),
  ]);
  verifyFact(fact);
  const expectedApiVersion = readApiVersion();
  assert(health.status === "ok", `API health status is ${health.status || "missing"}`);
  assert(health.authRequired === true, "API health.authRequired must be true");
  assert(health.version === expectedApiVersion, `API health version ${health.version || "missing"} does not match ${expectedApiVersion}`);
  assert(fact.api.expectedVersion === health.version, "frontend deployment fact and API health versions do not match");
  const apiGitSha = validateApiGitSha(health);

  const report = {
    checkedAt: new Date().toISOString(),
    frontendBaseUrl,
    apiBaseUrl,
    frontendGitSha: fact.frontend.gitSha,
    apiVersion: health.version,
    apiGitSha,
    authRequired: health.authRequired,
    passed: true,
  };
  const artifactDir = path.join(projectRoot, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "deployment-fact-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Production deployment fact passed: frontend ${fact.frontend.gitSha.slice(0, 7)}, API ${health.version} @ ${apiGitSha.slice(0, 7)}, auth required`);
}

async function main() {
  if (mode === "production") {
    await verifyProduction();
    return;
  }
  assert(fs.existsSync(outputFactPath), "out/deployment.json is missing; run npm run build first");
  const fact = JSON.parse(fs.readFileSync(outputFactPath, "utf8"));
  verifyFact(fact);
  console.log(`Static deployment artifact passed: frontend ${fact.frontend.gitSha.slice(0, 7)}, API ${fact.api.expectedVersion}`);
}

main().catch((error) => {
  console.error(`Deployment fact check failed: ${error.message}`);
  process.exitCode = 1;
});
