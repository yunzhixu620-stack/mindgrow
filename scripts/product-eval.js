const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const {
  classifyInput,
  retrieveEvidence,
  queryAnchors,
  standaloneHttpUrl,
  citationAudit,
  buildMeetingCitations,
  fallbackMeetingAnalysis,
  classifyArticleRequest,
  selectArticleDocument,
  selectAbstractTranslationChunks,
  isTableQuestion,
  hasReliableTableLayout,
  canonicalDocumentHash,
  articleTaskSystemPrompt,
} = require("../fc-proxy/index.js");

const fixturePath = path.join(__dirname, "..", "tests", "evaluation", "product-eval-v4.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsFragment(rows, fragment) {
  return JSON.stringify(rows).toLocaleLowerCase().includes(String(fragment).toLocaleLowerCase());
}

function runCase(testCase) {
  switch (testCase.operation) {
    case "classify-input":
      assert(classifyInput(testCase.input) === testCase.expected, `expected ${testCase.expected}`);
      return {};
    case "retrieve-top5": { 
      const ids = retrieveEvidence(testCase.query, testCase.nodes).map((item) => item.node.id);
      const hits = testCase.expectedIds.filter((id) => ids.includes(id)).length;
      const recallAt5 = hits / testCase.expectedIds.length;
      assert(recallAt5 === 1, `Recall@5=${recallAt5}; got ${ids.join(",")}`);
      return { recallAt5 };
    }
    case "query-anchors": { 
      const anchors = queryAnchors(testCase.input);
      testCase.includes.forEach((term) => assert(anchors.includes(term), `missing anchor ${term}`));
      return {};
    }
    case "standalone-url":
      assert(standaloneHttpUrl(testCase.input) === testCase.expected, "standalone URL routing mismatch");
      return {};
    case "citation-audit": { 
      const audit = citationAudit(testCase.claims, testCase.citations);
      assert(audit.coverage === testCase.expectedCoverage, `coverage=${audit.coverage}`);
      assert(audit.refusalReason === testCase.expectedRefusal, `refusal=${audit.refusalReason}`);
      return { citationCoverage: audit.coverage };
    }
    case "meeting-citations": { 
      const citations = buildMeetingCitations(testCase.transcript);
      testCase.expectedFragments.forEach((fragment) => assert(containsFragment(citations, fragment), `missing ${fragment}`));
      return { citationCoverage: 1 };
    }
    case "meeting-fallback": { 
      const citations = buildMeetingCitations(testCase.transcript);
      const output = fallbackMeetingAnalysis(testCase.title, testCase.transcript, citations, new Set(citations.map((item) => item.index)));
      assert(containsFragment(output[testCase.bucket], testCase.expectedFragment), `${testCase.bucket} missing ${testCase.expectedFragment}`);
      return { citationCoverage: 1 };
    }
    case "article-intent": { 
      const actual = classifyArticleRequest(testCase.input);
      Object.entries(testCase.expected).forEach(([key, value]) => assert(actual[key] === value, `${key}=${actual[key]}`));
      return {};
    }
    case "article-selection": { 
      const selected = selectArticleDocument(testCase.documents, testCase.input, testCase.history);
      assert((selected && selected.id) === testCase.expectedId, `selected=${selected && selected.id}`);
      return {};
    }
    case "abstract-selection": { 
      const ids = selectAbstractTranslationChunks(testCase.chunks).map((item) => item.id);
      assert(JSON.stringify(ids) === JSON.stringify(testCase.expectedIds), `selected=${ids.join(",")}`);
      return {};
    }
    case "table-question":
      assert(isTableQuestion(testCase.input) === testCase.expected, "table routing mismatch");
      return {};
    case "table-layout":
      assert(hasReliableTableLayout([{ sourceKind: "document_chunk", content: testCase.content }]) === testCase.expected, "table layout mismatch");
      return {};
    case "document-dedup":
      assert((canonicalDocumentHash([{ index: 1, content: testCase.left }]) === canonicalDocumentHash([{ index: 1, content: testCase.right }])) === testCase.expected, "dedup mismatch");
      return {};
    case "article-prompt": { 
      const prompt = articleTaskSystemPrompt(classifyArticleRequest(testCase.input));
      testCase.includes.forEach((fragment) => assert(prompt.includes(fragment), `prompt missing ${fragment}`));
      return {};
    }
    default:
      throw new Error(`Unknown operation ${testCase.operation}`);
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

const counts = fixture.cases.reduce((acc, testCase) => {
  acc[testCase.module] = (acc[testCase.module] || 0) + 1;
  return acc;
}, {});
for (const moduleName of ["knowledge", "meeting", "article"]) {
  assert(counts[moduleName] >= 20, `${moduleName} has only ${counts[moduleName]} cases`);
}

const results = fixture.cases.map((testCase) => {
  const startedAt = performance.now();
  try {
    const metrics = runCase(testCase);
    return { id: testCase.id, module: testCase.module, dimension: testCase.dimension, ok: true, latencyMs: Number((performance.now() - startedAt).toFixed(3)), ...metrics };
  } catch (error) {
    return { id: testCase.id, module: testCase.module, dimension: testCase.dimension, ok: false, latencyMs: Number((performance.now() - startedAt).toFixed(3)), error: error.message };
  }
});

const modules = Object.fromEntries(["knowledge", "meeting", "article"].map((moduleName) => {
  const rows = results.filter((item) => item.module === moduleName);
  const recallRows = rows.filter((item) => Number.isFinite(item.recallAt5));
  const citationRows = rows.filter((item) => Number.isFinite(item.citationCoverage));
  return [moduleName, {
    cases: rows.length,
    passed: rows.filter((item) => item.ok).length,
    passRate: Number((rows.filter((item) => item.ok).length / rows.length).toFixed(3)),
    recallAt5: recallRows.length ? Number((recallRows.reduce((sum, item) => sum + item.recallAt5, 0) / recallRows.length).toFixed(3)) : null,
    citationCoverage: citationRows.length ? Number((citationRows.reduce((sum, item) => sum + item.citationCoverage, 0) / citationRows.length).toFixed(3)) : null,
    deterministicLatencyP50Ms: percentile(rows.map((item) => item.latencyMs), 0.5),
    deterministicLatencyP95Ms: percentile(rows.map((item) => item.latencyMs), 0.95),
  }];
}));

const dimensions = Object.fromEntries([...new Set(results.map((item) => item.dimension))].sort().map((dimension) => {
  const rows = results.filter((item) => item.dimension === dimension);
  return [dimension, { cases: rows.length, passed: rows.filter((item) => item.ok).length, passRate: Number((rows.filter((item) => item.ok).length / rows.length).toFixed(3)) }];
}));

const report = {
  name: fixture.name,
  checkedAt: new Date().toISOString(),
  summary: { cases: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length },
  modules,
  dimensions,
  limitations: [
    "Deterministic latency measures routing, retrieval and evidence validation only; it is not cloud model response latency.",
    "UI navigation, persistence, responsive layout and module switching are covered separately by test:e2e:local.",
    "Authenticated production generation latency needs an owner-provided test account or token and is not inferred from anonymous health checks."
  ],
  results,
};

const artifactDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "product-eval-v4-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const [moduleName, summary] of Object.entries(modules)) {
  console.log(`${moduleName}: ${summary.passed}/${summary.cases}; Recall@5=${summary.recallAt5 == null ? "n/a" : summary.recallAt5}; citation=${summary.citationCoverage == null ? "n/a" : summary.citationCoverage}; p95=${summary.deterministicLatencyP95Ms}ms`);
}
console.log(`\n${report.summary.passed}/${report.summary.cases} product evaluation cases passed`);
if (report.summary.failed) process.exitCode = 1;
