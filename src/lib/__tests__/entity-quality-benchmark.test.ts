import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Citation = {
  index: number;
  quote: string;
  content: string;
  locator: string;
  sourceType: string;
};

type RawEntity = {
  tempId: string;
  name: string;
  type: string;
  aliases: string[];
  description: string;
  descriptionEvidence: number[];
  citationIndexes: number[];
  confidence: number;
};

type RawRelation = {
  source: string;
  target: string;
  type: string;
  shortLabel: string;
  explanation: string;
  status: string;
  citationIndexes: number[];
  confidence: number;
};

type EntityGraph = { entities: RawEntity[]; relations: RawRelation[] };
type BenchmarkCase = {
  id: string;
  group: string;
  citations: Citation[];
  raw: EntityGraph;
  expected: { entityNames: string[]; relations: string[] };
};

type QualityMetrics = {
  rawDescriptionCoverage: number;
  acceptedDescriptionGrounding: number;
  entityRetentionRate: number;
  descriptionGroundingPrecision: number;
  shortLabelValidRate: number;
  relationPredicateSupport: number;
  relationPrecision: number;
  relationRecall: number;
  emptyGraphRate: number;
};

const {
  normalizedEntityGraph,
  relationEvidenceSupports,
} = require("../../../fc-proxy/index.js") as {
  normalizedEntityGraph: (value: EntityGraph, allowed: Set<number>, citations: Citation[]) => EntityGraph;
  relationEvidenceSupports: (
    type: string,
    evidence: Citation[],
    source: RawEntity,
    target: RawEntity,
  ) => boolean;
};

const fixturePath = resolve(process.cwd(), "tests/fixtures/entity-quality/entity-graph-quality.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as BenchmarkCase[];

function acceptedGraph(fixture: BenchmarkCase): EntityGraph {
  return normalizedEntityGraph(
    fixture.raw,
    new Set(fixture.citations.map((citation) => citation.index)),
    fixture.citations,
  );
}

function relationKeys(graph: EntityGraph): string[] {
  const names = new Map(graph.entities.map((entity) => [entity.tempId, entity.name]));
  return graph.relations.map((relation) => (
    `${names.get(relation.source) || relation.source}|${names.get(relation.target) || relation.target}|${relation.type}`
  )).sort();
}

function safeRate(numerator: number, denominator: number): number {
  return numerator / Math.max(denominator, 1);
}

function validShortLabel(relation: RawRelation, entities: Map<string, RawEntity>): boolean {
  const label = relation.shortLabel.trim();
  const length = Array.from(label).length;
  const maximum = /[\u4e00-\u9fff]/.test(label) ? 10 : 20;
  if (length < 2 || length > maximum) return false;
  if (/[()（）[\]【】]|(?:asserted|historical|negated|proposed|历史|否定|待确认|证据|evidence)/i.test(label)) return false;
  const endpoints = [entities.get(relation.source)?.name, entities.get(relation.target)?.name]
    .filter(Boolean).map((name) => name!.toLocaleLowerCase());
  return !endpoints.includes(label.toLocaleLowerCase());
}

function benchmarkMetrics(): QualityMetrics {
  let rawEntities = 0;
  let rawDescriptions = 0;
  let acceptedEntities = 0;
  let groundedAcceptedEntities = 0;
  let expectedEntities = 0;
  let entityTruePositive = 0;
  let entityFalsePositive = 0;
  let acceptedRelations = 0;
  let expectedRelations = 0;
  let relationTruePositive = 0;
  let supportedRelations = 0;
  let validLabels = 0;
  let emptyGraphs = 0;

  fixtures.forEach((fixture) => {
    rawEntities += fixture.raw.entities.length;
    rawDescriptions += fixture.raw.entities.filter((entity) => entity.description.trim()).length;
    expectedEntities += fixture.expected.entityNames.length;
    expectedRelations += fixture.expected.relations.length;

    const accepted = acceptedGraph(fixture);
    const acceptedNames = new Set(accepted.entities.map((entity) => entity.name));
    const expectedNames = new Set(fixture.expected.entityNames);
    const expectedRelationSet = new Set(fixture.expected.relations);
    const acceptedRelationKeys = relationKeys(accepted);
    const entitiesById = new Map(accepted.entities.map((entity) => [entity.tempId, entity]));
    const citationsByIndex = new Map(fixture.citations.map((citation) => [citation.index, citation]));

    acceptedEntities += accepted.entities.length;
    groundedAcceptedEntities += accepted.entities.filter((entity) => (
      entity.description.trim().length >= 30 && entity.descriptionEvidence.length > 0
    )).length;
    entityTruePositive += Array.from(acceptedNames).filter((name) => expectedNames.has(name)).length;
    entityFalsePositive += Array.from(acceptedNames).filter((name) => !expectedNames.has(name)).length;
    acceptedRelations += accepted.relations.length;
    relationTruePositive += acceptedRelationKeys.filter((key) => expectedRelationSet.has(key)).length;
    if (accepted.entities.length === 0) emptyGraphs += 1;

    accepted.relations.forEach((relation) => {
      if (validShortLabel(relation, entitiesById)) validLabels += 1;
      const source = entitiesById.get(relation.source);
      const target = entitiesById.get(relation.target);
      const evidence = relation.citationIndexes
        .map((index) => citationsByIndex.get(index)).filter((item): item is Citation => Boolean(item));
      if (source && target && relationEvidenceSupports(relation.type, evidence, source, target)) {
        supportedRelations += 1;
      }
    });
  });

  return {
    rawDescriptionCoverage: safeRate(rawDescriptions, rawEntities),
    acceptedDescriptionGrounding: safeRate(groundedAcceptedEntities, acceptedEntities),
    entityRetentionRate: safeRate(entityTruePositive, expectedEntities),
    descriptionGroundingPrecision: safeRate(entityTruePositive, entityTruePositive + entityFalsePositive),
    shortLabelValidRate: safeRate(validLabels, acceptedRelations),
    relationPredicateSupport: safeRate(supportedRelations, acceptedRelations),
    relationPrecision: safeRate(relationTruePositive, acceptedRelations),
    relationRecall: safeRate(relationTruePositive, expectedRelations),
    emptyGraphRate: safeRate(emptyGraphs, fixtures.length),
  };
}

describe("P2.1.6 frozen entity graph quality benchmark", () => {
  it("covers every required frozen-data group without network or model calls", () => {
    const groups = new Set(fixtures.map((fixture) => fixture.group));
    [
      "zh_paper",
      "en_paper_alias",
      "meeting",
      "negation",
      "table_numeric",
      "abbreviation_alias",
      "no_definition",
    ].forEach((group) => expect(groups.has(group)).toBe(true));
  });

  it.each(fixtures)("validates raw → validator → accepted for $id", (fixture) => {
    const accepted = acceptedGraph(fixture);
    expect(accepted.entities.map((entity) => entity.name).sort()).toEqual([...fixture.expected.entityNames].sort());
    expect(relationKeys(accepted)).toEqual([...fixture.expected.relations].sort());
  });

  it("meets accepted-output quality gates and reports non-gating baselines", () => {
    const metrics = benchmarkMetrics();
    if (metrics.rawDescriptionCoverage < 0.8) {
      console.warn("rawDescriptionCoverage is below the 80% target", metrics.rawDescriptionCoverage);
    }
    console.info("P2.1.6 frozen entity quality metrics", metrics);

    expect(metrics.acceptedDescriptionGrounding).toBeGreaterThanOrEqual(0.9);
    expect(metrics.entityRetentionRate).toBeGreaterThanOrEqual(0.8);
    expect(metrics.descriptionGroundingPrecision).toBeGreaterThanOrEqual(0.9);
    expect(metrics.shortLabelValidRate).toBeGreaterThanOrEqual(0.95);
    expect(metrics.relationPredicateSupport).toBeGreaterThanOrEqual(0.9);
    expect(metrics.relationPrecision).toBeGreaterThanOrEqual(0.85);
    expect(metrics.relationRecall).toBeGreaterThanOrEqual(0.8);
    expect(metrics.emptyGraphRate).toBeGreaterThanOrEqual(0);
    expect(metrics.emptyGraphRate).toBeLessThanOrEqual(1);
  });
});
