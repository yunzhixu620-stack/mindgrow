const fs = require("fs");
const path = require("path");
const { entityDescriptionGroundingStats } = require("../fc-proxy/index.js");

const fixturePath = path.join(__dirname, "..", "tests", "fixtures", "entity-quality", "description-grounding-calibration.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const thresholds = [0.25, 0.34, 0.4, 0.5, 0.6];

const rows = fixtures.map((fixture) => {
  const stats = entityDescriptionGroundingStats(fixture.description, [{ quote: fixture.quote }]);
  const entityMentionSupported = !fixture.name
    || fixture.quote.toLocaleLowerCase().includes(fixture.name.toLocaleLowerCase());
  return { ...fixture, ...stats, entityMentionSupported };
});

function score(predicate) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  rows.forEach((row) => {
    const predicted = row.entityMentionSupported && row.numbersSupported && row.polaritySupported && predicate(row);
    if (predicted && row.expectedSupported) truePositive += 1;
    else if (predicted) falsePositive += 1;
    else if (row.expectedSupported) falseNegative += 1;
    else trueNegative += 1;
  });
  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision: truePositive / Math.max(truePositive + falsePositive, 1),
    retention: truePositive / Math.max(rows.filter((row) => row.expectedSupported).length, 1),
  };
}

const output = {
  sampleCount: rows.length,
  supported: rows.filter((row) => row.expectedSupported).length,
  unsupported: rows.filter((row) => !row.expectedSupported).length,
  baseline: score((row) => row.matchedAnchors.length >= 2),
  thresholds: thresholds.map((threshold) => ({
    threshold,
    ...score((row) => row.matchedAnchors.length >= 2
      || (row.matchedAnchors.length >= 1 && row.coverage >= threshold)),
  })),
  coverageOnly: thresholds.map((threshold) => ({
    threshold,
    ...score((row) => row.coverage >= threshold),
  })),
  samples: rows.map((row) => ({
    id: row.id,
    group: row.group,
    expectedSupported: row.expectedSupported,
    anchorCount: row.anchors.length,
    matchedAnchorCount: row.matchedAnchors.length,
    coverage: Number(row.coverage.toFixed(3)),
    numbersSupported: row.numbersSupported,
    polaritySupported: row.polaritySupported,
    entityMentionSupported: row.entityMentionSupported,
  })),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
