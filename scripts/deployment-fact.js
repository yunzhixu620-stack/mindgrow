const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const apiVersionPath = path.join(projectRoot, "docs", "api-version.txt");
const publicFactPath = path.join(projectRoot, "public", "deployment.json");
const outputFactPath = path.join(projectRoot, "out", "deployment.json");

function readApiVersion() {
  const value = fs.readFileSync(apiVersionPath, "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error("docs/api-version.txt must contain exactly one semantic version");
  }
  return value;
}

function resolveGitSha() {
  const value = process.env.MINDGROW_GIT_SHA || process.env.GITHUB_SHA || execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: projectRoot, encoding: "utf8" },
  ).trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error("deployment gitSha must be a full 40-character Git SHA");
  }
  return value.toLowerCase();
}

function createDeploymentFact({ builtAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: 1,
    product: "mindgrow",
    frontend: {
      gitSha: resolveGitSha(),
      builtAt,
    },
    api: {
      expectedVersion: readApiVersion(),
      healthUrl: "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run/health",
    },
  };
}

function validateDeploymentFact(fact) {
  const errors = [];
  if (fact?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (fact?.product !== "mindgrow") errors.push("product must be mindgrow");
  if (!/^[0-9a-f]{40}$/i.test(fact?.frontend?.gitSha || "")) errors.push("frontend.gitSha must be a full Git SHA");
  if (!Number.isFinite(Date.parse(fact?.frontend?.builtAt || ""))) errors.push("frontend.builtAt must be an ISO timestamp");
  if (fact?.api?.expectedVersion !== readApiVersion()) errors.push("api.expectedVersion must match docs/api-version.txt");
  if (fact?.api?.healthUrl !== "https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run/health") errors.push("api.healthUrl is not the production health endpoint");
  return errors;
}

module.exports = {
  apiVersionPath,
  createDeploymentFact,
  outputFactPath,
  projectRoot,
  publicFactPath,
  readApiVersion,
  resolveGitSha,
  validateDeploymentFact,
};
