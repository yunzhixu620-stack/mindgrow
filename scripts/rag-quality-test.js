const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  buildDocumentChunks,
  buildMeetingCitations,
  bestCitationIndexes,
  citationAudit,
  normalizeCitationIndexes,
  sourcePages,
} = require("../fc-proxy/index.js");

const root = path.join(__dirname, "..", "tests", "fixtures", "papers");
const fixtures = [
  { key: "rag", file: "rag-2005.11401.txt", query: "non-parametric memory uses a dense vector index of Wikipedia", expected: /dense vector index|non-parametric memory/i },
  { key: "dpr", file: "dpr-2004.04906.txt", query: "dual encoder dense passage retrieval compared with BM25", expected: /dual-encoder|BM25|dense representations/i },
  { key: "layoutlmv3", file: "layoutlmv3-2204.08387.txt", query: "Word-Patch Alignment learns cross-modal alignment", expected: /Word-Patch Alignment|cross-modal alignment|WPA/i },
];

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

const all = fixtures.map((fixture) => {
  const content = fs.readFileSync(path.join(root, fixture.file), "utf8");
  return { ...fixture, content, chunks: buildDocumentChunks(content, "pdf", fixture.file.replace(".txt", ".pdf")) };
});

check("page markers remain addressable", () => {
  assert.strictEqual(sourcePages(all[0].content).length, 19);
  assert(all[0].chunks.some((chunk) => chunk.locator === "第 6 页"));
});

check("long papers use bounded non-empty chunks", () => {
  all.forEach((paper) => {
    assert(paper.chunks.length >= 25 && paper.chunks.length <= 120, `${paper.key}: ${paper.chunks.length}`);
    assert(paper.chunks.every((chunk) => chunk.quote.length >= 8 && chunk.quote.length <= 1400));
  });
});

check("every stored citation is a verbatim source span", () => {
  all.forEach((paper) => {
    const normalized = paper.content.replace(/\s+/g, " ").trim();
    assert(paper.chunks.every((chunk) => normalized.includes(chunk.quote)), paper.key);
  });
});

all.forEach((paper) => check(`${paper.key} lexical recovery finds supporting evidence`, () => {
  const indexes = bestCitationIndexes(paper.query, paper.chunks, 5);
  assert(indexes.length > 0);
  const evidence = indexes.map((index) => paper.chunks.find((chunk) => chunk.index === index).quote).join(" ");
  assert(paper.expected.test(evidence), evidence.slice(0, 300));
}));

check("cross-document lexical recovery distinguishes the target paper", () => {
  const merged = all.flatMap((paper) => paper.chunks.map((chunk) => ({ ...chunk, document: paper.key })))
    .map((chunk, index) => ({ ...chunk, index: index + 1 }));
  const indexes = bestCitationIndexes("LayoutLMv3 masked image modeling and word patch alignment", merged, 6);
  const selected = indexes.map((index) => merged.find((chunk) => chunk.index === index));
  assert(selected.some((chunk) => chunk && chunk.document === "layoutlmv3"));
});

check("invalid citation ids are rejected", () => {
  assert.deepStrictEqual(normalizeCitationIndexes([1, 1, 999, -1, "2"], new Set([1, 2])), [1, 2]);
});

check("citation audit exposes unsupported claims instead of force-citing", () => {
  const audit = citationAudit([
    { text: "supported", citationIndexes: [1] },
    { text: "unsupported", citationIndexes: [] },
  ], all[0].chunks.slice(0, 2));
  assert.strictEqual(audit.coverage, 0.5);
  assert.strictEqual(audit.warnings.length, 1);
});

check("meeting evidence keeps corrected dates and negative decisions traceable", () => {
  const transcript = "Chen：原定7月19日完成。Chen：更正为7月21日。Lina：预算2000元没有批准。";
  const citations = buildMeetingCitations(transcript);
  assert(citations.some((item) => item.quote.includes("7月21日")));
  assert(citations.some((item) => item.quote.includes("没有批准")));
});

const artifactDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "rag-quality-unit-report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} RAG unit checks passed`);
if (failed.length) process.exit(1);
