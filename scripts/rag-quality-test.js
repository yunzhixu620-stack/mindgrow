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
  classifyInput,
  needsConversationalContext,
  normalizeDocumentLayout,
  isTableQuestion,
  hasReliableTableLayout,
  canonicalDocumentHash,
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

check("table rows keep line and column boundaries inside evidence chunks", () => {
  const table = normalizeDocumentLayout("Task\tMetric A\tMetric B\nModel\t21.4\t44.2");
  assert(table.includes("\t") && table.includes("\n"));
  const [chunk] = buildDocumentChunks("[PAGE 1]\nTask\tMetric A\tMetric B\nModel\t21.4\t44.2", "pdf", "table.pdf");
  assert(chunk.quote.includes("\t") && chunk.quote.includes("\n"));
});

check("every stored citation is a verbatim source span", () => {
  all.forEach((paper) => {
    const normalized = paper.content.replace(/\s+/g, " ").trim();
    assert(paper.chunks.every((chunk) => normalized.includes(chunk.quote.replace(/\s+/g, " ").trim())), paper.key);
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

check("Chinese questions remain retrieval questions when punctuation follows the question mark", () => {
  assert.strictEqual(classifyInput("哪种双编码器方法报告了提升？请给出论文名和数值。"), "question");
  assert.strictEqual(classifyInput("请给出 DPR 相对 BM25 的 top-20 accuracy"), "question");
});

check("conversation context is used only for real follow-up references", () => {
  assert.strictEqual(needsConversationalContext("它使用的图像编码结构是什么？"), true);
  assert.strictEqual(needsConversationalContext("RAG-Sequence 在 MS-MARCO 的 Bleu-1 是多少？"), false);
});

check("numeric table questions route to table-aware answer verification", () => {
  assert.strictEqual(isTableQuestion("RAG-Sequence 的 MS-MARCO Bleu-1 分数是多少？"), true);
  assert.strictEqual(isTableQuestion("Word-Patch Alignment 起什么作用？"), false);
});

check("flattened tables abstain while column-preserving evidence remains answerable", () => {
  assert.strictEqual(hasReliableTableLayout([{ sourceKind: "document_chunk", content: "Model 21.4 44.2" }]), false);
  assert.strictEqual(hasReliableTableLayout([{ sourceKind: "document_chunk", content: "Model\t21.4\t44.2" }]), true);
});

check("document deduplication ignores layout-only whitespace changes", () => {
  assert.strictEqual(
    canonicalDocumentHash([{ index: 1, content: "Header  A B\nRow  1 2" }]),
    canonicalDocumentHash([{ index: 1, content: "Header A B Row 1 2" }]),
  );
});

const artifactDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "rag-quality-unit-report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} RAG unit checks passed`);
if (failed.length) process.exit(1);
