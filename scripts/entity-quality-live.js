const fs = require("fs");
const path = require("path");

const manifestPath = path.join(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "entity-quality",
  "live-benchmark-sources.json",
);
const sources = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const strict = process.argv.includes("--strict");
const endpoint = String(process.env.MINDGROW_LIVE_BENCHMARK_ENDPOINT || "").replace(/\/+$/, "");
const token = String(process.env.MINDGROW_ACCESS_TOKEN || "").trim();
const workspaceId = String(process.env.MINDGROW_WORKSPACE_ID || "").trim();
const modelName = String(process.env.MINDGROW_LIVE_MODEL || "backend-configured-model");
const promptVersion = String(process.env.MINDGROW_ENTITY_PROMPT_VERSION || "v4-p2.1.1");
const limit = Math.max(1, Math.min(sources.length, Number(process.env.MINDGROW_LIVE_BENCHMARK_LIMIT) || sources.length));
const timeoutMs = Math.max(10_000, Number(process.env.MINDGROW_LIVE_BENCHMARK_TIMEOUT_MS) || 90_000);
const inputCostConfigured = process.env.MINDGROW_INPUT_COST_PER_1K_TOKENS !== undefined;
const outputCostConfigured = process.env.MINDGROW_OUTPUT_COST_PER_1K_TOKENS !== undefined;
const inputCostPerThousand = Number(process.env.MINDGROW_INPUT_COST_PER_1K_TOKENS);
const outputCostPerThousand = Number(process.env.MINDGROW_OUTPUT_COST_PER_1K_TOKENS);
const costRatesConfigured = inputCostConfigured && outputCostConfigured
  && Number.isFinite(inputCostPerThousand) && Number.isFinite(outputCostPerThousand);

function warning(message) {
  process.stderr.write(`WARNING entity-quality-live: ${message}\n`);
}

function articleEndpoint() {
  if (/\/api\/tools\/article$/i.test(endpoint)) return endpoint;
  return `${endpoint}/api/tools/article`;
}

function usageFrom(payload) {
  const usage = payload && payload.usage && typeof payload.usage === "object" ? payload.usage : {};
  const inputTokens = Number(usage.inputTokens || usage.input_tokens || usage.prompt_tokens) || null;
  const outputTokens = Number(usage.outputTokens || usage.output_tokens || usage.completion_tokens) || null;
  const totalTokens = Number(usage.totalTokens || usage.total_tokens)
    || (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const estimatedCost = inputTokens === null || outputTokens === null || !costRatesConfigured
    ? null
    : (inputTokens / 1000) * inputCostPerThousand + (outputTokens / 1000) * outputCostPerThousand;
  return { inputTokens, outputTokens, totalTokens, estimatedCost };
}

function graphMetrics(payload) {
  const graph = payload && payload.entityGraph && typeof payload.entityGraph === "object"
    ? payload.entityGraph : { entities: [], relations: [] };
  const entities = Array.isArray(graph.entities) ? graph.entities : [];
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const described = entities.filter((entity) => String(entity && entity.description || "").trim()).length;
  const grounded = entities.filter((entity) => (
    Array.isArray(entity && entity.descriptionEvidence) && entity.descriptionEvidence.length > 0
  )).length;
  const validLabels = relations.filter((relation) => {
    const label = String(relation && (relation.shortLabel || relation.label) || "").trim();
    const length = Array.from(label).length;
    const maximum = /[\u4e00-\u9fff]/.test(label) ? 10 : 20;
    return length >= 2 && length <= maximum
      && !/(?:证据|evidence|asserted|historical|negated|proposed)/i.test(label);
  }).length;
  return {
    entityCount: entities.length,
    relationCount: relations.length,
    descriptionCoverage: described / Math.max(entities.length, 1),
    descriptionEvidenceCoverage: grounded / Math.max(entities.length, 1),
    shortLabelValidRate: validLabels / Math.max(relations.length, 1),
    emptyGraph: entities.length === 0,
  };
}

async function runSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
    const response = await fetch(articleEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ url: source.url, sourceType: "url" }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    const result = {
      id: source.id,
      title: source.title,
      url: source.url,
      focus: source.focus,
      startedAt,
      latencyMs: Date.now() - started,
      httpStatus: response.status,
      ok: response.ok,
      model: modelName,
      promptVersion,
      usage: usageFrom(payload),
      graph: graphMetrics(payload),
      warning: response.ok ? null : String(payload.error || payload.code || `HTTP ${response.status}`),
    };
    if (result.usage.totalTokens === null) {
      result.warning = [result.warning, "backend response did not expose token usage; cost remains null"]
        .filter(Boolean).join("; ");
    }
    return result;
  } catch (error) {
    return {
      id: source.id,
      title: source.title,
      url: source.url,
      focus: source.focus,
      startedAt,
      latencyMs: Date.now() - started,
      httpStatus: null,
      ok: false,
      model: modelName,
      promptVersion,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null },
      graph: { entityCount: 0, relationCount: 0, descriptionCoverage: 0, descriptionEvidenceCoverage: 0, shortLabelValidRate: 0, emptyGraph: true },
      warning: error && error.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(error && error.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!endpoint || !token) {
    warning("skipped; set MINDGROW_LIVE_BENCHMARK_ENDPOINT and MINDGROW_ACCESS_TOKEN for a manual/nightly run");
    process.exitCode = 0;
    return;
  }

  const results = [];
  for (const source of sources.slice(0, limit)) {
    // Sequential execution keeps model cost and upstream rate limits bounded.
    // eslint-disable-next-line no-await-in-loop
    results.push(await runSource(source));
  }

  const failed = results.filter((result) => !result.ok);
  const report = {
    schemaVersion: 1,
    mode: strict ? "strict" : "warning-only",
    generatedAt: new Date().toISOString(),
    endpoint: articleEndpoint(),
    model: modelName,
    promptVersion,
    sourceCount: results.length,
    successCount: results.length - failed.length,
    failureCount: failed.length,
    tokenAndCostNote: "Token and cost fields remain null unless the backend exposes usage; configure per-1K rates to estimate cost.",
    results,
  };
  const artifactDir = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(artifactDir, `entity-quality-live-${stamp}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, successCount: report.successCount, failureCount: report.failureCount }, null, 2)}\n`);

  if (failed.length) {
    warning(`${failed.length}/${results.length} live cases failed; inspect ${outputPath}`);
    if (strict) process.exitCode = 1;
  }
}

main().catch((error) => {
  warning(String(error && error.stack || error));
  if (strict) process.exitCode = 1;
});
