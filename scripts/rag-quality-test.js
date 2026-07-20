const fs = require("fs");
const path = require("path");
const assert = require("assert");
const acorn = require("acorn");
const {
  buildDocumentChunks,
  buildMeetingCitations,
  bestCitationIndexes,
  citationAudit,
  normalizeCitationIndexes,
  sourcePages,
  classifyInput,
  classifyArticleRequest,
  selectArticleDocument,
  selectAbstractTranslationChunks,
  articleTaskSystemPrompt,
  articleOutputNeedsChinese,
  articleTranslationTargets,
  applyArticleFieldTranslations,
  applyDeterministicChineseArticleFallback,
  recoveredChineseArticleResponse,
  mergeArticleChineseTranslation,
  needsConversationalContext,
  normalizeDocumentLayout,
  isTableQuestion,
  hasReliableTableLayout,
  canonicalDocumentHash,
  queryAnchors,
  anchorCoverage,
  retrieveEvidence,
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

check("Aliyun custom runtime syntax stays ECMAScript 2018 compatible", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  acorn.parse(source, { ecmaVersion: 2018, sourceType: "script", allowHashBang: true });
});

check("public article fetching stays on supported IPv4 egress", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert(source.includes("family: 4"), "public URL fetches can fall onto unavailable IPv6 egress");
  assert(source.includes("MindGrowArticleBot/1.0"), "article fetches need an identifiable browser-compatible user agent");
});

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

check("GraphRAG anchors preserve discriminative paper and metric terms", () => {
  const anchors = queryAnchors("DPR 在 Natural Questions 的 top-20 accuracy 数值");
  assert(anchors.includes("dpr"));
  assert(anchors.some((item) => item.includes("top-20") || item.includes("accuracy")));
  assert(anchorCoverage(anchors, "Dense Passage Retrieval DPR Natural Questions top-20 accuracy") > anchorCoverage(anchors, "RAG Wikipedia generation model"));
});

check("GraphRAG acronym fallback finds the correct entity node", () => {
  const nodes = [
    { id: "rag", content: "Retrieval-Augmented Generation", desc: "Uses DPR as a retriever" },
    { id: "dpr", content: "Dense Passage Retriever (DPR)", desc: "Dual BERT query and passage encoders" },
    { id: "layout", content: "LayoutLMv3", desc: "Document AI" },
  ];
  const matches = retrieveEvidence("DPR 的双编码器由哪些部分组成", nodes);
  assert(matches.length > 0);
  assert.strictEqual(matches[0].node.id, "dpr");
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

check("article intent routing distinguishes translation from factual QA", () => {
  assert.deepStrictEqual(
    classifyArticleRequest("把这篇论文翻译成中文"),
    { task: "translate", targetLanguage: "zh-CN", scope: "full", pageNumber: null, confidence: 0.98 },
  );
  assert.strictEqual(classifyArticleRequest("Translate page 3 into English").task, "translate");
  assert.strictEqual(classifyArticleRequest("Translate page 3 into English").targetLanguage, "en");
  assert.strictEqual(classifyArticleRequest("Translate page 3 into English").pageNumber, 3);
  assert.strictEqual(classifyArticleRequest("这篇论文用了什么编码器？").task, "qa");
});

check("article intent routing covers summary comparison extraction and explanation", () => {
  assert.strictEqual(classifyArticleRequest("总结这篇论文的主要贡献").task, "summarize");
  assert.strictEqual(classifyArticleRequest("比较 RAG 与 DPR 的检索方法").task, "compare");
  assert.strictEqual(classifyArticleRequest("提取所有实验指标").task, "extract");
  assert.strictEqual(classifyArticleRequest("通俗解释这个损失函数").task, "explain");
  assert.strictEqual(classifyArticleRequest("解释 RAG-Token 与 RAG-Sequence 的区别").task, "explain");
  assert.strictEqual(classifyArticleRequest("比较 RAG-Token 与 RAG-Sequence 的区别").task, "compare");
});

check("article translation selects the title in the current user request", () => {
  const documents = [
    { id: "layout", title: "LayoutLMv3: Pre-training for Document AI with Unified Text and Image Masking" },
    { id: "dpr", title: "Dense Passage Retrieval for Open-Domain Question Answering" },
    { id: "rag", title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" },
  ];
  const assistantChoices = [{
    role: "assistant",
    content: documents.map((document) => document.title).join("\n"),
  }];
  assert.strictEqual(
    selectArticleDocument(documents, "翻译《Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks》的摘要", assistantChoices).id,
    "rag",
  );
  assert.strictEqual(selectArticleDocument(documents, "翻译这篇论文的摘要", assistantChoices), null);
  assert.strictEqual(
    selectArticleDocument(documents, "翻译它的摘要", [{ role: "user", content: "我想看 Dense Passage Retrieval for Open-Domain Question Answering" }]).id,
    "dpr",
  );
});

check("abstract translation spans chunk boundaries and stops before introduction", () => {
  const selected = selectAbstractTranslationChunks([
    { id: "meta", content: "Paper title and authors Abstract" },
    { id: "a1", content: "We introduce a retriever and com-" },
    { id: "a2", content: "pare two model variants. Results improve factuality. 1 Introduction This must not be translated." },
    { id: "intro", content: "More introduction text." },
  ]);
  assert.deepStrictEqual(selected.map((item) => item.id), ["a1", "a2"]);
  assert(selected[1].content.endsWith("Results improve factuality."));
  assert(!selected.some((item) => item.content.includes("This must not be translated")));
});

check("translation prompt executes translation instead of falling back to citation QA", () => {
  const prompt = articleTaskSystemPrompt(classifyArticleRequest("翻译这篇论文的摘要"));
  assert(prompt.includes("论文翻译任务"));
  assert(prompt.includes("不是 Citation 问答"));
  assert(prompt.includes("简体中文"));
  assert(prompt.includes("完整翻译全部证据块"));
  assert(prompt.includes("## 翻译结果"));
});

check("article answer prompts put the conclusion first and use readable structures", () => {
  const qaPrompt = articleTaskSystemPrompt(classifyArticleRequest("这篇论文的核心结论是什么？"));
  const comparePrompt = articleTaskSystemPrompt(classifyArticleRequest("比较 RAG 与 DPR 的检索方法"));
  assert(qaPrompt.includes("## 结论"));
  assert(qaPrompt.includes("## 关键依据"));
  assert(qaPrompt.includes("700 个汉字以内"));
  assert(comparePrompt.includes("标准 Markdown 表格"));
  assert(comparePrompt.includes("总列数最多 5 列"));
  assert(comparePrompt.includes("不得自行加入基线、变体、参照模型或相关论文"));
});

check("English-heavy paper nodes trigger localization while technical acronyms remain valid", () => {
  assert.strictEqual(articleOutputNeedsChinese({
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    summary: "A retrieval model improves factual generation.",
    mindMap: { root: "Retrieval-Augmented Generation", rootDesc: "Combines retrieval and generation", children: [{ topic: "Model Architecture", desc: "Dense retriever", items: ["Sequence Generator"] }] },
  }), true);
  assert.strictEqual(articleOutputNeedsChinese({
    title: "检索增强生成（RAG）",
    summary: "通过检索外部知识增强生成。",
    mindMap: { root: "RAG", rootDesc: "检索与生成结合", children: [{ topic: "DPR", desc: "稠密段落检索器", items: ["BERT 编码器"] }] },
  }), false);
});

check("field-level localization changes only English natural-language fields", () => {
  const original = {
    title: "Retrieval-Augmented Generation",
    summary: "通过检索外部知识增强生成。",
    keyPoints: [{ text: "Dense vector index", citationIndexes: [2] }],
    mindMap: { root: "RAG", rootDesc: "Combines retrieval and generation", children: [] },
  };
  const targets = articleTranslationTargets(original);
  assert.deepStrictEqual(targets.map((item) => item.path.join(".")), ["title", "keyPoints.0.text", "mindMap.rootDesc"]);
  const localized = applyArticleFieldTranslations(original, targets, [
    { index: 0, text: "检索增强生成（Retrieval-Augmented Generation）" },
    { index: 1, text: "稠密向量索引（Dense vector index）" },
    { index: 2, text: "结合检索与生成" },
  ]);
  assert.strictEqual(localized.title, "检索增强生成（Retrieval-Augmented Generation）");
  assert.strictEqual(localized.keyPoints[0].citationIndexes[0], 2);
  assert.strictEqual(localized.mindMap.root, "RAG");
  assert.strictEqual(original.title, "Retrieval-Augmented Generation");
  assert.strictEqual(articleOutputNeedsChinese(localized), false);
});

check("Chinese localization preserves citation indexes and graph shape", () => {
  const original = {
    title: "Retrieval-Augmented Generation",
    summary: "A method for knowledge-intensive tasks.",
    keyPoints: [{ text: "Uses a dense retriever", citationIndexes: [1] }],
    arguments: [{ claim: "Retrieval improves generation", evidence: "Reported in experiments", citationIndexes: [2] }],
    questions: ["What are the limitations?"],
    mindMap: {
      root: "Retrieval-Augmented Generation",
      rootDesc: "Combines retrieval and generation",
      rootCitationIndexes: [1],
      children: [{ topic: "Architecture", desc: "Two components", citationIndexes: [2], items: ["Dense retriever"], itemCitationIndexes: [[2]] }],
    },
  };
  const localized = mergeArticleChineseTranslation(original, {
    title: "检索增强生成",
    summary: "面向知识密集型任务的方法。",
    keyPoints: [{ text: "使用稠密检索器" }],
    arguments: [{ claim: "检索能够改进生成", evidence: "实验结果支持这一结论" }],
    questions: ["有哪些局限？"],
    mindMap: { root: "检索增强生成", rootDesc: "结合检索与生成", children: [{ topic: "系统架构", desc: "包含两个组件", items: ["稠密检索器"] }] },
  });
  assert.strictEqual(articleOutputNeedsChinese(localized), false);
  assert.deepStrictEqual(localized.mindMap.rootCitationIndexes, [1]);
  assert.deepStrictEqual(localized.mindMap.children[0].itemCitationIndexes, [[2]]);
  assert.strictEqual(localized.mindMap.children.length, 1);
});

check("deterministic Chinese fallback keeps parsing available when localization times out", () => {
  const original = {
    title: "Retrieval-Augmented Generation",
    summary: "A method for knowledge-intensive tasks.",
    keyPoints: [{ text: "Dense vector index", citationIndexes: [3] }],
    questions: ["What are the limitations?"],
    mindMap: {
      root: "RAG Framework",
      rootDesc: "Combines retrieval and generation",
      rootCitationIndexes: [1],
      children: [{ topic: "Architecture", desc: "Two components", citationIndexes: [2], items: ["Dense retriever"], itemCitationIndexes: [[2]] }],
    },
  };
  const fallback = applyDeterministicChineseArticleFallback(original);
  assert.strictEqual(articleOutputNeedsChinese(fallback), false);
  assert.deepStrictEqual(fallback.keyPoints[0].citationIndexes, [3]);
  assert.deepStrictEqual(fallback.mindMap.rootCitationIndexes, [1]);
  assert.deepStrictEqual(fallback.mindMap.children[0].itemCitationIndexes, [[2]]);
  assert.strictEqual(fallback.mindMap.children.length, 1);
});

check("handler-boundary article recovery returns a usable Chinese graph with verbatim citations", () => {
  const content = "[PAGE 1]\nRetrieval-Augmented Generation for Knowledge-Intensive NLP Tasks\nAbstract\nLarge language models have limited access to explicit knowledge. Retrieval-augmented generation combines parametric and non-parametric memory.\n1 Introduction\nThe retriever accesses Wikipedia passages.";
  const response = recoveredChineseArticleResponse({ content, sourceType: "pdf", fileName: "rag.pdf" }, { content, sourceType: "pdf", fileName: "rag.pdf" });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.data.degraded, true);
  assert.strictEqual(response.data.warningCode, "ARTICLE_CHINESE_LOCALIZATION_RECOVERED");
  assert.strictEqual(articleOutputNeedsChinese(response.data), false);
  assert(response.data.citations.length > 0);
  assert(content.replace(/\s+/g, " ").includes(response.data.citations[0].quote.replace(/\s+/g, " ")));
  assert(response.data.mindMap.children.every((child) => child.citationIndexes.length > 0));
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
