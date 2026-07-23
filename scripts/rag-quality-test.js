const fs = require("fs");
const path = require("path");
const assert = require("assert");
const acorn = require("acorn");
const {
  buildDocumentChunks,
  buildMeetingCitations,
  fallbackMeetingAnalysis,
  bestCitationIndexes,
  citationAudit,
  normalizeCitationIndexes,
  normalizedEntityGraph,
  ENTITY_DESCRIPTION_COVERAGE_THRESHOLD,
  entityDescriptionGroundingStats,
  deterministicEvidenceEntityGraph,
  sourcePages,
  classifyInput,
  classifyArticleRequest,
  selectArticleDocument,
  selectAbstractTranslationChunks,
  articleTaskSystemPrompt,
  resolveUsedEvidenceIds,
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
  safeBase64Url,
  queryAnchors,
  anchorCoverage,
  retrieveEvidence,
  sourceCriticalFacts,
  ensureMindMapSourceCoverage,
  sanitizeGroundedAnswer,
  compactGroundedEvidence,
  supabaseHeaders,
  entityGraphQueryPlan,
  rankEntityGraphSeeds,
  relationStatusPenalty,
  graphRagRecencyScore,
  graphRagEvidenceSignals,
  rankGraphRagEvidence,
  __citationInternal,
  __entityGraphInternal,
} = require("../fc-proxy/index.js");
const { verifiedIndexes, verifiedCitationPayload } = __citationInternal;
const { canonicalGraphEntityIdentity, normalizedEntityGraphForWrite } = __entityGraphInternal;

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
  assert(!source.includes(".flatMap("), "Aliyun's legacy Node runtime does not implement Array.prototype.flatMap");
});

check("public article fetching stays on supported IPv4 egress", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert(source.includes("family: 4"), "public URL fetches can fall onto unavailable IPv6 egress");
  assert(source.includes("MindGrowArticleBot/1.0"), "article fetches need an identifiable browser-compatible user agent");
});

check("public source ids remain URL-safe on legacy Node runtimes", () => {
  const encoded = safeBase64Url("https://例子.example/path?a=1&b=2");
  assert(encoded.length > 0);
  assert(!/[+/=]/.test(encoded));
});

check("Supabase new API keys are not sent as invalid Bearer JWTs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert.match(source, /!key\.startsWith\('sb_'\)/);
  assert(!Object.prototype.hasOwnProperty.call(supabaseHeaders(undefined, "sb_secret_example"), "Authorization"));
  assert.strictEqual(supabaseHeaders(undefined, "legacy.jwt.value").Authorization, "Bearer legacy.jwt.value");
});

check("LLM Wiki entities and relations require direct source evidence", () => {
  const citations = [
    { index: 1, quote: "RAG combines parametric memory with a non-parametric Wikipedia index.", content: "RAG combines parametric memory with a non-parametric Wikipedia index.", locator: "page 1", sourceType: "pdf" },
    { index: 2, quote: "DPR is used by RAG as the dense retriever in the documented architecture.", content: "DPR is used by RAG as the dense retriever in the documented architecture.", locator: "page 2", sourceType: "pdf" },
  ];
  const graph = normalizedEntityGraph({
    entities: [
      {
        tempId: "E1", name: "RAG", type: "model",
        description: "RAG combines parametric memory with a non-parametric Wikipedia index.",
        descriptionEvidence: [1], citationIndexes: [1], confidence: 0.95,
      },
      {
        tempId: "E2", name: "DPR", type: "method",
        description: "DPR is used by RAG as the dense retriever in the documented architecture.",
        descriptionEvidence: [2], citationIndexes: [2], confidence: 0.9,
      },
      {
        tempId: "E3", name: "Unsupported Entity", type: "model",
        description: "Unsupported Entity is mentioned but has no dedicated description evidence here.",
        citationIndexes: [1], confidence: 0.9,
      },
    ],
    relations: [
      {
        source: "E1", target: "E2", type: "uses", shortLabel: "使用",
        explanation: "RAG uses DPR as the dense retriever for document retrieval.",
        citationIndexes: [2], confidence: 0.9,
      },
      {
        source: "E2", target: "E1", type: "uses", shortLabel: "使用",
        explanation: "DPR uses RAG as its generator for document retrieval.",
        citationIndexes: [2], confidence: 0.9,
      },
      { source: "E2", target: "E3", type: "related_to", explanation: "DPR is related to the unsupported entity in this source passage.", citationIndexes: [2], confidence: 0.9 },
    ],
  }, new Set([1, 2]), citations);
  assert.deepStrictEqual(graph.entities.map((item) => item.tempId), ["E1", "E2"]);
  assert.strictEqual(graph.relations.length, 1);
  assert.strictEqual(graph.relations[0].type, "uses");
  assert.strictEqual(graph.relations[0].shortLabel, "使用");
  assert.match(graph.relations[0].explanation, /^RAG uses DPR/);
  assert.deepStrictEqual(graph.entities[0].descriptionEvidence, [1]);
  assert.deepStrictEqual(graph.relations[0].citationIndexes, [2]);
});

check("entity descriptions reject copied ids, weak anchors and fabricated numbers", () => {
  const citations = [{
    index: 1,
    quote: "LayoutLMv3 uses Word-Patch Alignment to improve document understanding accuracy by 5%.",
    content: "LayoutLMv3 uses Word-Patch Alignment to improve document understanding accuracy by 5%.",
    locator: "page 3",
    sourceType: "pdf",
  }];
  const base = {
    tempId: "E1",
    name: "LayoutLMv3",
    type: "model",
    citationIndexes: [1],
    confidence: 0.95,
  };
  const missingDedicatedEvidence = normalizedEntityGraph({
    entities: [{ ...base, description: "LayoutLMv3 uses Word-Patch Alignment to improve document understanding accuracy by 5%." }],
    relations: [],
  }, new Set([1]), citations);
  assert.strictEqual(missingDedicatedEvidence.entities.length, 0);

  const fabricatedNumber = normalizedEntityGraph({
    entities: [{
      ...base,
      description: "LayoutLMv3 uses Word-Patch Alignment to improve document understanding accuracy by 50%.",
      descriptionEvidence: [1],
    }],
    relations: [],
  }, new Set([1]), citations);
  assert.strictEqual(fabricatedNumber.entities.length, 0);

  const stats = entityDescriptionGroundingStats(
    "LayoutLMv3 is a completely unrelated cooking assistant for home kitchens.",
    citations,
  );
  assert(stats.matchedAnchors.length < 2);
});

check("confirmed description coverage threshold accepts 0.5 and rejects 0.333", () => {
  assert.strictEqual(ENTITY_DESCRIPTION_COVERAGE_THRESHOLD, 0.34);
  const citation = {
    index: 1,
    quote: "This paper presents the RAG model for this research.",
    content: "This paper presents the RAG model for this research.",
    locator: "page 1",
    sourceType: "pdf",
  };
  const normalize = (description) => normalizedEntityGraph({
    entities: [{
      tempId: "E1",
      name: "RAG",
      type: "model",
      description,
      descriptionEvidence: [1],
      citationIndexes: [1],
      confidence: 0.9,
    }],
    relations: [],
  }, new Set([1]), [citation]);

  const acceptedDescription = "RAG is the model in this paper and this research.";
  const rejectedDescription = "RAG is the core model in this paper and research.";
  const acceptedStats = entityDescriptionGroundingStats(acceptedDescription, [citation]);
  const rejectedStats = entityDescriptionGroundingStats(rejectedDescription, [citation]);
  assert.strictEqual(acceptedStats.matchedAnchors.length, 1);
  assert.strictEqual(acceptedStats.coverage, 0.5);
  assert.strictEqual(normalize(acceptedDescription).entities.length, 1);
  assert.strictEqual(rejectedStats.matchedAnchors.length, 1);
  assert(Math.abs(rejectedStats.coverage - (1 / 3)) < 0.0001);
  assert.strictEqual(normalize(rejectedDescription).entities.length, 0);
});

check("relations require predicate direction and use safe labels and complete explanations", () => {
  const citations = [
    {
      index: 1,
      quote: "RAG combines retrieved evidence with generation for knowledge-intensive tasks.",
      content: "RAG combines retrieved evidence with generation for knowledge-intensive tasks.",
      locator: "page 1",
      sourceType: "pdf",
    },
    {
      index: 2,
      quote: "BART is a sequence-to-sequence model, and RAG is discussed in the same section.",
      content: "BART is a sequence-to-sequence model, and RAG is discussed in the same section.",
      locator: "page 2",
      sourceType: "pdf",
    },
    {
      index: 3,
      quote: "RAG uses BART as the generator for knowledge-intensive tasks.",
      content: "RAG uses BART as the generator for knowledge-intensive tasks.",
      locator: "page 3",
      sourceType: "pdf",
    },
  ];
  const graph = normalizedEntityGraph({
    entities: [
      {
        tempId: "E1", name: "RAG", type: "model",
        description: "RAG combines retrieved evidence with generation for knowledge-intensive tasks.",
        descriptionEvidence: [1], citationIndexes: [1, 2, 3], confidence: 0.95,
      },
      {
        tempId: "E2", name: "BART", type: "model",
        description: "BART is a sequence-to-sequence model used as a generator in this document.",
        descriptionEvidence: [2, 3], citationIndexes: [2, 3], confidence: 0.9,
      },
    ],
    relations: [
      {
        source: "E1", target: "E2", type: "uses", shortLabel: "使用（asserted）· 1 证据",
        explanation: "RAG and BART merely appear together in this section without a stated usage relation.",
        citationIndexes: [2], confidence: 0.9,
      },
      {
        source: "E1", target: "E2", type: "uses", shortLabel: "使用（asserted）· 1 证据",
        explanation: "RAG uses BART as its generator for knowledge tasks. This unsupported second sentence must be removed.",
        citationIndexes: [3], confidence: 0.9,
      },
    ],
  }, new Set([1, 2, 3]), citations);
  assert.strictEqual(graph.relations.length, 1);
  assert.strictEqual(graph.relations[0].shortLabel, "使用");
  assert.strictEqual(graph.relations[0].explanation, "RAG uses BART as its generator for knowledge tasks.");
});

check("entity extraction prompt requires explainable descriptions and concise relations", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert.match(source, /"descriptionEvidence":\[1\]/);
  assert.match(source, /descriptionEvidence 与证明实体出现或其他事实的 citationIndexes 职责不同/);
  assert.match(source, /原文不能支持解释时，description 输出空字符串且 descriptionEvidence 输出空数组/);
  assert.match(source, /不强制生成中英文双别名/);
  assert.match(source, /"shortLabel":"中文 2-10 字关系词"/);
  assert.match(source, /"explanation":"20-60 字说明关系方向和具体含义"/);
  assert.match(source, /证据必须同时支持 source、target 以及关系谓词和方向/);
  assert.match(source, /shortLabel 中文为 2-10 字，其他语言为 2-20 字/);
  assert.match(source, /不得包含状态、证据数或实体名称/);
  assert.match(source, /label 仅用于旧数据兼容，新输出以 shortLabel 为准/);
});

check("article and meeting tools retry evidence-only entity extraction when the primary model omits relations", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert.match(source, /async function ensureEvidenceEntityGraph/);
  assert.match(source, /只做证据约束实体关系抽取的 GraphRAG 索引器/);
  assert.match(source, /await ensureEvidenceEntityGraph\(parsed\.entityGraph, allowedIndexes, citations, 'meeting'\)/);
  assert.match(source, /await ensureEvidenceEntityGraph\(parsed\.entityGraph, allowedIndexes, citations, sourceType\)/);
});

check("deterministic entity fallback extracts only explicit article and meeting relations", () => {
  const articleQuote = "RAG（Retrieval-Augmented Generation）由 Patrick Lewis 等人在 2020 年提出。RAG 使用 DPR 作为稠密检索器，并从 Wikipedia 索引检索证据。DPR 使用双编码器分别编码问题与段落。实验在 Natural Questions 数据集上评估 Recall@5，结果为 85%。RAG 的生成器采用 BART。BM25 不是该实验的稠密检索器。";
  const meetingQuote = "张三负责完成检索评测";
  const graph = deterministicEvidenceEntityGraph([
    { index: 1, quote: articleQuote, content: articleQuote },
    { index: 2, quote: meetingQuote, content: meetingQuote },
  ], new Set([1, 2]));
  const names = new Set(graph.entities.map((item) => item.name));
  ["RAG", "DPR", "Wikipedia", "BART", "BM25", "张三", "完成检索评测"].forEach((name) => assert(names.has(name), `missing ${name}`));
  assert(graph.relations.some((item) => item.type === "uses"));
  assert(graph.relations.some((item) => item.type === "retrieves_from"));
  assert(graph.relations.some((item) => item.type === "proposes"));
  assert(graph.relations.some((item) => item.status === "negated"));
  assert(graph.relations.some((item) => item.type === "responsible_for"));
  graph.entities.forEach((item) => {
    assert(item.description.length >= 8);
    assert(item.descriptionEvidence.length > 0);
    assert(item.citationIndexes.length > 0);
  });
  graph.relations.forEach((item) => {
    assert(item.shortLabel.length >= 2 && item.shortLabel.length <= 10);
    assert(!/(?:证据|asserted|historical|negated|proposed)/i.test(item.shortLabel));
    assert(item.explanation.length >= 8 && item.explanation.length <= 60);
    assert(item.citationIndexes.length > 0);
  });
});

check("deterministic definitions cover Chinese and English forms without admitting noise", () => {
  const samples = [
    ["GraphRAG", "GraphRAG 是一种结合实体关系与检索路径的知识检索方法。"],
    ["DPR", "DPR 指使用双编码器进行稠密段落检索的方法。"],
    ["BM25", "BM25 意为一种基于词项匹配的稀疏检索方法。"],
    ["实体链接", "实体链接定义为把文本提及映射到规范实体的过程。"],
    ["RAG", "RAG refers to retrieval-augmented generation for knowledge-intensive tasks."],
    ["NLP", "NLP stands for Natural Language Processing in this document."],
  ];
  const citations = samples.map((sample, index) => ({
    index: index + 1,
    quote: sample[1],
    content: sample[1],
    locator: `sample ${index + 1}`,
    sourceType: "text",
  }));
  const allowed = new Set(citations.map((item) => item.index));
  const raw = deterministicEvidenceEntityGraph(citations, allowed);
  const accepted = normalizedEntityGraph(raw, allowed, citations, { trustedDeterministic: true });
  const acceptedNames = new Set(accepted.entities.map((item) => item.name));
  samples.forEach(([name]) => assert(acceptedNames.has(name), `missing definition entity ${name}`));
  const expectedUniqueNames = new Set(samples.map(([name]) => name)).size;
  const retention = accepted.entities.length / expectedUniqueNames;
  assert(retention >= 1, `definition retention ${retention.toFixed(2)} fell below baseline`);

  const noise = "本段只讨论一般背景，没有定义、本文角色或实体关系。";
  const empty = deterministicEvidenceEntityGraph([
    { index: 99, quote: noise, content: noise, locator: "noise", sourceType: "text" },
  ], new Set([99]));
  assert.strictEqual(empty.entities.length, 0);
  assert.strictEqual(empty.relations.length, 0);
});

check("GraphRAG query planning constrains relation types and hop counts", () => {
  const usage = entityGraphQueryPlan("RAG 使用什么检索器？");
  assert.deepStrictEqual(usage.relationTypes, ["uses", "depends_on", "retrieves_from"]);
  assert.strictEqual(usage.maxHops, 1);
  assert.strictEqual(usage.route, "local");
  const proposal = entityGraphQueryPlan("谁提出了 RAG？");
  assert.deepStrictEqual(proposal.relationTypes, ["proposes"]);
  assert(proposal.typeHints.includes("person"));
  const path = entityGraphQueryPlan("RAG 与 DPR 的两跳链路是什么？");
  assert.strictEqual(path.maxHops, 2);
  assert.strictEqual(path.route, "drift");
  assert(path.relationTypes.includes("related_to"));
  const membership = entityGraphQueryPlan("WPA 属于 LayoutLMv3 的哪个组件？");
  assert(membership.relationTypes.includes("part_of"));
  assert(membership.relationTypes.includes("contains"));
  assert.strictEqual(entityGraphQueryPlan("全库知识图谱概览").route, "global");
  assert.strictEqual(entityGraphQueryPlan("Recall@5 是多少？").route, "basic");
});

check("entity aliases are exact graph entries and ambiguous names require clarification", () => {
  const entities = [
    { id: "rag", canonicalName: "RAG", entityType: "method", aliases: ["Retrieval-Augmented Generation"], description: "检索增强生成", confidence: 0.95, citations: [{ title: "RAG 论文" }] },
    { id: "atlas-model", canonicalName: "Atlas", entityType: "model", aliases: ["ATLAS"], description: "语言模型", confidence: 0.9, citations: [{ title: "Atlas 模型论文" }] },
    { id: "atlas-org", canonicalName: "Atlas", entityType: "organization", aliases: ["ATLAS"], description: "研究组织", confidence: 0.9, citations: [{ title: "Atlas 组织记录" }] },
  ];
  const aliasHit = rankEntityGraphSeeds("Retrieval-Augmented Generation 使用什么？", entities);
  assert.strictEqual(aliasHit.seeds[0].entity.id, "rag");
  const ambiguous = rankEntityGraphSeeds("Atlas 是什么？", entities);
  assert.strictEqual(ambiguous.ambiguous, true);
  assert.deepStrictEqual(ambiguous.ambiguityCandidates.map((item) => item.entity.id), ["atlas-model", "atlas-org"]);
  const typed = rankEntityGraphSeeds("Atlas 模型是什么？", entities);
  assert.strictEqual(typed.ambiguous, false);
  assert.strictEqual(typed.seeds[0].entity.id, "atlas-model");
  const sourced = rankEntityGraphSeeds("Atlas 组织记录里的 Atlas 是什么？", entities);
  assert.strictEqual(sourced.ambiguous, false);
  assert.strictEqual(sourced.seeds[0].entity.id, "atlas-org");
});

check("negated and historical edges are penalized unless the question requests them", () => {
  assert(relationStatusPenalty("negated", "RAG 使用什么检索器？") > 0);
  assert.strictEqual(relationStatusPenalty("negated", "BM25 为什么不是唯一检索器？"), 0);
  assert(relationStatusPenalty("historical", "当前采用什么方案？") > 0);
  assert.strictEqual(relationStatusPenalty("historical", "原计划采用什么方案？"), 0);
});

check("entity graph evidence is connected to the formal answer retrieval path", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert.match(source, /retrieveEntityGraphEvidence\(question, mapId, workspaceId\)/);
  assert.match(source, /rankGraphRagEvidence\(question, rankingCandidates\)/);
  assert.match(source, /rankingVersion: 's2\.12-v1'/);
  assert.match(source, /needsDisambiguation/);
  assert.match(source, /entity_graph_evidence/);
});

check("GraphRAG reranking exposes bounded explainable signals", () => {
  const question = "RAG 使用什么稠密检索器？";
  const direct = {
    id: "direct", sourceKind: "entity_graph_evidence", content: "RAG uses DPR as its dense retriever.",
    anchorScore: 0.95, graphDepth: 1, graphRelationStatus: "asserted", documentCreatedAt: "2026-07-01",
  };
  const semanticDistractor = {
    id: "distractor", sourceKind: "document_chunk", content: "Retrieval overview", anchorScore: 0.2,
    semanticScore: 0.96, keywordRank: 12, documentCreatedAt: "2026-07-01",
  };
  const ranked = rankGraphRagEvidence(question, [semanticDistractor, direct], { nowMs: Date.parse("2026-07-23") });
  assert.strictEqual(ranked[0].id, "direct");
  const signals = graphRagEvidenceSignals(question, direct, 0, 2, Date.parse("2026-07-23"));
  ["entityAnchor", "semantic", "lexical", "path", "metadata", "recency", "statusPenalty", "score"].forEach((key) => {
    assert(Number.isFinite(signals[key]), `missing finite ${key} signal`);
  });
  assert(graphRagRecencyScore("2026-07-01", Date.parse("2026-07-23")) > graphRagRecencyScore("2020-01-01", Date.parse("2026-07-23")));
});

check("long knowledge and meeting structures preserve critical facts without unsupported features", () => {
  const source = [
    "赵敏：每周完成 20 份用户访谈，覆盖 A 公司和 B 公司。",
    "Recall@5 从 72.4% 提升到 81.9%，样本量从 420 增加到 760。",
    "因为索引未刷新，系统召回了旧文档，导致答案错误；团队已经修复索引刷新任务。",
    "尚未批准云同步功能，也没有按需订阅计划。",
  ].join("\n");
  const citations = buildMeetingCitations(source);
  const result = ensureMindMapSourceCoverage({
    root: "用户访谈与检索复盘",
    rootDesc: "讨论访谈和检索效果",
    children: [{
      topic: "执行结果",
      desc: "指标有所提升",
      items: ["增加云同步和按需订阅"],
      citationIndexes: [1],
      itemCitationIndexes: [[1]],
    }],
  }, source, citations, new Set(citations.map((item) => item.index)));
  const rendered = JSON.stringify(result.mindMap);
  ["20", "A 公司", "B 公司", "72.4%", "81.9%", "420", "760", "索引未刷新", "旧文档", "尚未批准"].forEach((fact) => {
    assert(rendered.includes(fact), "missing critical fact " + fact);
  });
  assert(!rendered.includes("增加云同步和按需订阅"));
  assert(result.mindMap.children.length <= 6);
  const appendedCitations = result.mindMap.children.flatMap((child) => child.itemCitationIndexes || []).filter((indexes) => indexes.length > 0);
  assert(appendedCitations.length > 0);
  assert(sourceCriticalFacts(source).length >= 4);
});

check("knowledge structures reject causal claims that are only semantic co-occurrences", () => {
  const source = [
    "本轮 Recall@5 从 72.4% 提升到 81.9%，样本量从 420 增加到 760。",
    "因为索引未刷新，系统召回了旧文档，导致答案错误。",
  ].join("\n");
  const result = ensureMindMapSourceCoverage({
    root: "检索复盘",
    rootDesc: "通过增加样本量优化了 Recall@5",
    children: [
      { topic: "指标", desc: "Recall@5 因样本量增加而提升", items: [] },
      { topic: "根因", desc: "因为索引未刷新，所以召回旧文档并导致答案错误", items: [] },
      { topic: "访谈", desc: "每周进行用户访谈以支持产品优化", items: [] },
      { topic: "共现", desc: "召回率指标在样本量增加下的改进", items: [] },
    ],
  }, source, [], null);
  assert.strictEqual(result.mindMap.rootDesc, "");
  assert.strictEqual(result.mindMap.children[0].desc, "");
  assert(result.mindMap.children[1].desc.includes("索引未刷新"));
  assert.strictEqual(result.mindMap.children[2].desc, "");
  assert.strictEqual(result.mindMap.children[3].desc, "");
});

check("meeting timeout fallback stays usable, cited, compact and faithful", () => {
  const transcript = [
    "赵敏：每周完成 20 份用户访谈，覆盖 A 公司和 B 公司。",
    "本轮 Recall@5 从 72.4% 提升到 81.9%，样本量从 420 增加到 760。",
    "因为索引未刷新，系统召回了旧文档，导致答案错误；团队已经修复索引刷新任务。",
    "李雷负责复测，截止 2026-07-27。",
    "尚未批准云同步功能，也没有按需订阅计划。",
  ].join("\n");
  const citations = buildMeetingCitations(transcript);
  const result = fallbackMeetingAnalysis(
    "检索质量与用户访谈复盘", transcript, citations, new Set(citations.map((item) => item.index)),
  );
  const rendered = JSON.stringify(result);
  ["20", "A 公司", "B 公司", "72.4%", "81.9%", "420", "760", "索引未刷新", "旧文档", "李雷", "2026-07-27", "尚未批准"].forEach((fact) => {
    assert(rendered.includes(fact), "missing fallback fact " + fact);
  });
  assert(result.mindMap.children.length <= 5);
  assert(result.mindMap.children.every((child) => child.items.length > 0));
  assert(result.mindMap.children.flatMap((child) => child.itemCitationIndexes).every((indexes) => indexes.length > 0));
  assert(result.actionItems.some((item) => item.owner === "李雷" && item.due === "2026-07-27"));
  assert(result.openQuestions.some((item) => item.text.includes("尚未批准")));
  assert(!result.decisions.some((item) => item.text.includes("尚未批准")));
});

check("grounded answer audit removes unsupported explanatory claims after citation selection", () => {
  const quote = "RAG 使用 DPR 作为稠密检索器，并从 Wikipedia 索引检索证据。DPR 使用双编码器分别编码问题与段落。RAG 的生成器采用 BART。";
  const audited = sanitizeGroundedAnswer([
    "## 结论",
    "RAG 使用 **DPR** 作为稠密检索器，并从 **Wikipedia 索引**检索证据。",
    "## 关键依据",
    "- DPR 使用双编码器分别编码问题与段落。",
    "## 详细说明",
    "RAG 将 BART 与 DPR 结合，因此提升了事实准确性。",
    "## 局限与待核验",
    "当前证据没有说明商业部署成本。",
  ].join("\n"), [{ content: quote, citations: [{ quote }] }]);
  assert(audited.answer.includes("RAG 使用 **DPR**"));
  assert(audited.answer.includes("DPR 使用双编码器"));
  assert(!audited.answer.includes("提升了事实准确性"));
  assert(!audited.answer.includes("商业部署成本"));
  assert(!audited.answer.includes("## 详细说明"));
  assert(audited.removedLines >= 2);
});

check("grounded answer sources prioritize direct graph evidence and stay within the reading budget", () => {
  const evidence = [
    { id: "concept-1", sourceKind: "concept_node", content: "RAG", score: 0.99, citations: [{ documentId: "doc-1", quote: "RAG combines retrieval and generation." }] },
    { id: "chunk-1", sourceKind: "document_chunk", content: "chunk", score: 0.7, citations: [{ documentId: "doc-1", quote: "DPR retrieves passages from Wikipedia." }] },
    { id: "edge-1", sourceKind: "entity_graph_evidence", content: "RAG uses DPR", score: 0.8, citations: [{ documentId: "doc-1", quote: "RAG uses DPR as its dense retriever." }] },
    { id: "edge-duplicate", sourceKind: "entity_graph_evidence", content: "RAG uses DPR", score: 0.75, citations: [{ documentId: "doc-1", quote: "RAG uses DPR as its dense retriever." }] },
    { id: "other-1", sourceKind: "concept_node", content: "BART", score: 0.5, citations: [{ documentId: "doc-1", quote: "The generator is BART." }] },
    { id: "other-2", sourceKind: "concept_node", content: "Atlas", score: 0.4, citations: [{ documentId: "doc-2", quote: "Atlas uses retrieval." }] },
    { id: "other-3", sourceKind: "concept_node", content: "BM25", score: 0.3, citations: [{ documentId: "doc-3", quote: "BM25 is a baseline." }] },
  ];
  const selected = compactGroundedEvidence(evidence, 5);
  assert.strictEqual(selected.length, 5);
  assert.strictEqual(selected[0].id, "edge-1");
  assert(!selected.some((item) => item.id === "edge-duplicate"));
});

check("entity graph migration is tenant-scoped and service-role only", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase-v10-entity-graph-migration.sql"), "utf8");
  const groundingMigration = fs.readFileSync(path.join(__dirname, "..", "supabase-v11-entity-grounding-migration.sql"), "utf8");
  ["graph_entities", "graph_relations", "graph_evidence"].forEach((table) => {
    assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert(migration.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  });
  assert(migration.includes("REVOKE ALL ON TABLE graph_entities, graph_relations, graph_evidence FROM PUBLIC, anon, authenticated"));
  assert(migration.includes("description_citation_indexes JSONB NOT NULL DEFAULT '[]'::jsonb"));
  assert(migration.includes("explanation TEXT NOT NULL DEFAULT ''"));
  assert(groundingMigration.includes("ADD COLUMN IF NOT EXISTS description_citation_indexes JSONB NOT NULL DEFAULT '[]'::jsonb"));
  assert(groundingMigration.includes("ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT ''"));
  assert(groundingMigration.includes("DROP COLUMN IF EXISTS description_citation_indexes"));
  assert(groundingMigration.includes("DROP COLUMN IF EXISTS explanation"));
});

check("GraphRAG ranking migration keeps RRF and exposes independent sparse and semantic signals", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase-v15-graphrag-ranking-migration.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(__dirname, "..", "supabase-v15-graphrag-ranking-rollback.sql"), "utf8");
  assert(migration.includes("hybrid_search_document_chunks_v2"));
  ["rrf_score", "semantic_rank", "keyword_rank", "semantic_score", "keyword_score", "document_created_at"].forEach((field) => {
    assert(migration.includes(field), `ranking RPC is missing ${field}`);
  });
  assert(migration.includes("REVOKE ALL ON FUNCTION hybrid_search_document_chunks_v2"));
  assert(migration.includes("GRANT EXECUTE ON FUNCTION hybrid_search_document_chunks_v2"));
  assert(migration.includes("TO service_role"));
  assert(rollback.includes("DROP FUNCTION IF EXISTS hybrid_search_document_chunks_v2"));
});

check("workspace search migration indexes every knowledge surface and enforces tenant scope", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase-v16-workspace-search-migration.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(__dirname, "..", "supabase-v16-workspace-search-rollback.sql"), "utf8");
  assert(migration.includes("search_workspace_knowledge"));
  ["idx_maps_name_trgm", "idx_graph_entities_name_trgm", "idx_source_documents_title_trgm", "idx_document_chunks_content_trgm"].forEach((indexName) => {
    assert(migration.includes(indexName), `workspace search is missing ${indexName}`);
  });
  assert((migration.match(/workspace_id = p_workspace_id/g) || []).length >= 8, "workspace search branches are not fully tenant scoped");
  assert(migration.includes("REVOKE ALL ON FUNCTION search_workspace_knowledge"));
  assert(migration.includes("FROM PUBLIC, anon, authenticated"));
  assert(migration.includes("TO service_role"));
  assert(rollback.includes("DROP FUNCTION IF EXISTS search_workspace_knowledge"));
});

check("feedback migration is service-role only and supports tagged release follow-up", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase-v17-feedback-loop-migration.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(__dirname, "..", "supabase-v17-feedback-loop-rollback.sql"), "utf8");
  assert(migration.includes("CREATE TABLE IF NOT EXISTS product_feedback"));
  ["workspace_id", "user_id", "issue_tags", "resolved_version", "follow_up_acknowledged_at"].forEach((field) => {
    assert(migration.includes(field), `feedback loop is missing ${field}`);
  });
  assert(migration.includes("ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY"));
  assert(migration.includes("REVOKE ALL ON TABLE product_feedback FROM PUBLIC, anon, authenticated"));
  assert(migration.includes("GRANT ALL ON TABLE product_feedback TO service_role"));
  assert(rollback.includes("DROP TABLE IF EXISTS product_feedback"));
});

check("health readiness verifies required entity-grounding columns", () => {
  const healthSource = fs.readFileSync(path.join(__dirname, "..", "fc-proxy", "index.js"), "utf8");
  assert(healthSource.includes("graph_entities?select=id,description_citation_indexes&limit=1"));
  assert(healthSource.includes("graph_relations?select=id,explanation&limit=1"));
  assert(healthSource.includes("rpc/hybrid_search_document_chunks_v2"));
  assert(healthSource.includes("checks.graphRagRanking === 'ready'"));
  assert(healthSource.includes("product_feedback?select=id,status,resolved_version&limit=1"));
  assert(healthSource.includes("checks.feedbackLoop === 'ready'"));
});

check("canonical entity ids are stable inside one library and isolated across libraries", () => {
  const first = canonicalGraphEntityIdentity("workspace-a", "article-library", "model", "Graph RAG");
  const same = canonicalGraphEntityIdentity("workspace-a", "article-library", "model", "graph rag");
  const otherLibrary = canonicalGraphEntityIdentity("workspace-a", "other-library", "model", "Graph RAG");
  const otherType = canonicalGraphEntityIdentity("workspace-a", "article-library", "method", "Graph RAG");
  assert.strictEqual(first.id, same.id);
  assert.strictEqual(first.normalizedName, "graph rag");
  assert.notStrictEqual(first.id, otherLibrary.id);
  assert.notStrictEqual(first.id, otherType.id);
});

check("deterministic evidence entities remain persistable after the analysis response round-trip", () => {
  const citation = {
    index: 1,
    quote: "GraphRAG 是一种结合知识图谱与检索增强生成的检索方法。GraphRAG 使用知识图谱。",
    content: "GraphRAG 是一种结合知识图谱与检索增强生成的检索方法。GraphRAG 使用知识图谱。",
    locator: "第 1 段",
    sourceType: "text",
  };
  const graph = normalizedEntityGraphForWrite({
    entities: [{
      tempId: "E1",
      name: "GraphRAG",
      type: "method",
      aliases: [],
      description: "GraphRAG 使用知识图谱",
      descriptionEvidence: [1],
      citationIndexes: [1],
      confidence: 0.8,
    }],
    relations: [],
  }, new Set([1]), [citation]);
  assert(graph.entities.some((entity) => entity.name === "GraphRAG"));
  assert(graph.entities.some((entity) => entity.name === "知识图谱"));
  assert(graph.relations.some((relation) => relation.type === "uses"));
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

check("modified citation quotes are rejected before claims or graph rows can persist", () => {
  const sourceChunks = [{
    index: 1,
    content: "DPR retrieves passages from Wikipedia.",
    sourceType: "pdf",
  }];
  const modified = [{
    index: 1,
    quote: "DPR retrieves documents from Wikipedia.",
    locator: "page 3",
    sourceType: "pdf",
  }];
  const indexes = verifiedIndexes([1], new Set([1]), "DPR retrieval", modified, sourceChunks);
  assert.deepStrictEqual(indexes, []);
  assert.deepStrictEqual(verifiedCitationPayload(modified, sourceChunks, "pdf").citations, []);
  const audit = citationAudit([{ text: "DPR retrieval", citationIndexes: indexes }], modified);
  assert.strictEqual(audit.coverage, 0);
  assert.strictEqual(audit.perClaim[0].status, "unsupported");
  assert.strictEqual(audit.refusalReason, "ALL_KEY_CLAIMS_UNSUPPORTED");
});

check("citation audit reports a fully supported answer", () => {
  const audit = citationAudit([
    { id: "summary", section: "conclusion", text: "supported summary", citationIndexes: [1] },
    { id: "point", section: "conclusion", text: "supported point", citationIndexes: [2] },
  ], all[0].chunks.slice(0, 2));
  assert.strictEqual(audit.coverage, 1);
  assert.deepStrictEqual(audit.perClaim.map((item) => item.status), ["supported", "supported"]);
  assert.strictEqual(audit.refusalReason, null);
});

check("citation audit marks one unsupported claim without refusing the supported answer", () => {
  const audit = citationAudit([
    { id: "supported", section: "conclusion", text: "supported", citationIndexes: [1] },
    { id: "unsupported", section: "evidence", text: "unsupported", citationIndexes: [] },
  ], all[0].chunks.slice(0, 2));
  assert.strictEqual(audit.coverage, 0.5);
  assert.strictEqual(audit.warnings.length, 1);
  assert.strictEqual(audit.perClaim[1].supported, false);
  assert.strictEqual(audit.unsupportedCriticalClaimCount, 1);
  assert.strictEqual(audit.refusalReason, null);
});

check("citation audit refuses when every key claim is unsupported", () => {
  const audit = citationAudit([
    { id: "summary", section: "conclusion", text: "unsupported summary", citationIndexes: [] },
    { id: "point", section: "conclusion", text: "unsupported point", citationIndexes: [] },
    { id: "question", section: "extension", critical: false, text: "open question", citationIndexes: [1] },
  ], all[0].chunks.slice(0, 2));
  assert.strictEqual(audit.supportedCriticalClaimCount, 0);
  assert.strictEqual(audit.unsupportedCriticalClaimCount, 2);
  assert.strictEqual(audit.perClaim[2].critical, false);
  assert.strictEqual(audit.refusalReason, "ALL_KEY_CLAIMS_UNSUPPORTED");
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

const translationEvidenceIds = [
  { id: "chunk:chunk_a" },
  { id: "chunk:chunk_b" },
  { id: "chunk:chunk_c" },
];

check("partial translation keeps only explicitly reported string evidence ids", () => {
  const resolved = resolveUsedEvidenceIds(
    ["chunk:chunk_b", "chunk:forged", "chunk:chunk_b"],
    translationEvidenceIds,
    "partial",
    { requireAllForComplete: true },
  );
  assert.deepStrictEqual(resolved.usedIds, ["chunk:chunk_b"]);
  assert.strictEqual(resolved.coverage, "partial");
  assert.deepStrictEqual(resolved.missingInformation, []);
});

check("numeric citation indexes never enter the string evidence id namespace", () => {
  const resolved = resolveUsedEvidenceIds([1, 2], translationEvidenceIds, "partial", { requireAllForComplete: true });
  assert.deepStrictEqual(resolved.usedIds, []);
  assert.strictEqual(resolved.coverage, "partial");
});

check("complete translation downgrades when an evidence id is missing", () => {
  const resolved = resolveUsedEvidenceIds(
    ["chunk:chunk_a", "chunk:chunk_c"], translationEvidenceIds, "complete", { requireAllForComplete: true },
  );
  assert.deepStrictEqual(resolved.usedIds, ["chunk:chunk_a", "chunk:chunk_c"]);
  assert.strictEqual(resolved.coverage, "partial");
  assert(resolved.missingInformation.some((item) => item.includes("来源声明不完整")));
});

check("complete translation remains complete only for the full evidence id set", () => {
  const resolved = resolveUsedEvidenceIds(
    ["chunk:chunk_c", "chunk:chunk_a", "chunk:chunk_b", "chunk:chunk_a"],
    translationEvidenceIds,
    "complete",
    { requireAllForComplete: true },
  );
  assert.deepStrictEqual(resolved.usedIds, ["chunk:chunk_c", "chunk:chunk_a", "chunk:chunk_b"]);
  assert.strictEqual(resolved.coverage, "complete");
  assert.deepStrictEqual(resolved.missingInformation, []);
});

check("forged string evidence ids are removed by the allowed id set", () => {
  const resolved = resolveUsedEvidenceIds(["chunk:not-allowed"], translationEvidenceIds, "complete", { requireAllForComplete: true });
  assert.deepStrictEqual(resolved.usedIds, []);
  assert.strictEqual(resolved.coverage, "partial");
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

check("handler-boundary article recovery admits only grounded deterministic entities", () => {
  const content = "[PAGE 1]\nRetrieval-Augmented Generation for Knowledge-Intensive NLP Tasks\nAbstract\nLarge language models have limited access to explicit knowledge. Retrieval-augmented generation combines parametric and non-parametric memory. RAG uses DPR. DPR uses Wikipedia.\n1 Introduction\nThe retriever accesses Wikipedia passages.";
  const response = recoveredChineseArticleResponse({ content, sourceType: "pdf", fileName: "rag.pdf" }, { content, sourceType: "pdf", fileName: "rag.pdf" });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.data.degraded, true);
  assert.strictEqual(response.data.warningCode, "ARTICLE_CHINESE_LOCALIZATION_RECOVERED");
  assert.strictEqual(articleOutputNeedsChinese(response.data), false);
  assert(response.data.citations.length > 0);
  assert(content.replace(/\s+/g, " ").includes(response.data.citations[0].quote.replace(/\s+/g, " ")));
  assert(response.data.mindMap.children.every((child) => child.citationIndexes.length > 0));
  assert(response.data.entityGraph.entities.length >= 2);
  assert(response.data.entityGraph.relations.length >= 1);
  response.data.entityGraph.entities.forEach((entity) => {
    assert(entity.description.length >= 8);
    assert(entity.descriptionEvidence.length > 0);
  });
  response.data.entityGraph.relations.forEach((relation) => {
    assert(relation.shortLabel.length >= 2);
    assert(relation.explanation.length >= 8);
    assert(relation.citationIndexes.length > 0);
  });
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
