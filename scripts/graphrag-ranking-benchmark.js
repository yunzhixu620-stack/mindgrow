const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  entityGraphQueryPlan,
  rankEntityGraphSeeds,
  rankGraphRagEvidence,
} = require("../fc-proxy/index.js");

const fixturePath = path.join(__dirname, "..", "tests", "fixtures", "graphrag-ranking-cases.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const nowMs = Date.parse("2026-07-23T00:00:00Z");

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const rankingResults = fixture.rankingCases.map((testCase) => {
  const ranked = rankGraphRagEvidence(testCase.question, testCase.candidates, { nowMs });
  const ids = ranked.map((item) => item.id);
  const topFive = ids.slice(0, 5);
  const relevant = new Set(testCase.relevantIds);
  const recovered = topFive.filter((id) => relevant.has(id)).length;
  const firstRank = ids.findIndex((id) => relevant.has(id)) + 1;
  return {
    id: testCase.id,
    board: testCase.board,
    recallAt5: recovered / Math.max(relevant.size, 1),
    reciprocalRank: firstRank > 0 ? 1 / firstRank : 0,
    topFive,
    scores: ranked.slice(0, 5).map((item) => ({ id: item.id, score: Number(item.retrievalScore.toFixed(4)) })),
  };
});

const entityResults = fixture.entityLinkingCases.map((testCase) => {
  const ranked = rankEntityGraphSeeds(testCase.question, testCase.entities);
  const topFive = ranked.seeds.slice(0, 5).map((item) => item.entity.id);
  const expected = new Set(testCase.expectedSeedIds);
  return {
    id: testCase.id,
    hitAt5: topFive.some((id) => expected.has(id)) ? 1 : 0,
    firstSeedCorrect: expected.has(topFive[0]) ? 1 : 0,
    ambiguityCorrect: ranked.ambiguous === testCase.expectAmbiguous ? 1 : 0,
    topFive,
    ambiguous: ranked.ambiguous,
  };
});

const routingResults = fixture.routingCases.map((testCase) => {
  const actualRoute = entityGraphQueryPlan(testCase.question).route;
  return {
    question: testCase.question,
    expectedRoute: testCase.expectedRoute,
    actualRoute,
    correct: actualRoute === testCase.expectedRoute ? 1 : 0,
  };
});

const boardCounts = fixture.rankingCases.reduce((counts, testCase) => {
  counts[testCase.board] = Number(counts[testCase.board] || 0) + 1;
  return counts;
}, {});
const metrics = {
  rankingCaseCount: rankingResults.length,
  entityLinkingCaseCount: entityResults.length,
  routingCaseCount: routingResults.length,
  boardCounts,
  recallAt5: mean(rankingResults.map((item) => item.recallAt5)),
  mrr: mean(rankingResults.map((item) => item.reciprocalRank)),
  entityHitAt5: mean(entityResults.map((item) => item.hitAt5)),
  entityTop1Accuracy: mean(entityResults.map((item) => item.firstSeedCorrect)),
  ambiguityAccuracy: mean(entityResults.map((item) => item.ambiguityCorrect)),
  routingAccuracy: mean(routingResults.map((item) => item.correct)),
};

const report = {
  schemaVersion: fixture.schemaVersion,
  frozenAt: fixture.frozenAt,
  checkedAt: new Date().toISOString(),
  metrics,
  rankingResults,
  entityResults,
  routingResults,
};
const artifactDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "graphrag-ranking-benchmark.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(metrics, null, 2));

assert(metrics.rankingCaseCount >= 12, "frozen ranking set must contain at least 12 cases");
assert(Object.values(boardCounts).every((count) => count >= 3), "each product board must begin S2.20 case collection");
assert(metrics.recallAt5 >= 0.95, `Recall@5 ${metrics.recallAt5.toFixed(3)} is below 0.95`);
assert(metrics.mrr >= 0.8, `MRR ${metrics.mrr.toFixed(3)} is below 0.80`);
assert(metrics.entityHitAt5 >= 0.95, `Entity Hit@5 ${metrics.entityHitAt5.toFixed(3)} is below 0.95`);
assert(metrics.entityTop1Accuracy >= 0.95, `entity top-1 accuracy ${metrics.entityTop1Accuracy.toFixed(3)} is below 0.95`);
assert.strictEqual(metrics.ambiguityAccuracy, 1, "entity ambiguity policy regressed");
assert.strictEqual(metrics.routingAccuracy, 1, "query routing policy regressed");

console.log("GraphRAG ranking benchmark passed");
