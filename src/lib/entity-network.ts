import type { EntityGraph, GraphEntity, GraphRelation } from "@/types";

export type EntityNetworkMode = "global" | "local" | "evidence";

export interface EntityNetworkSelectionOptions {
  mode: EntityNetworkMode;
  selectedEntityId?: string | null;
  entityTypes?: string[];
  showIsolated?: boolean;
}

export const STRONG_RELATION_CONFIDENCE = 0.68;
export const EVIDENCE_RELATION_CONFIDENCE = 0.55;
export const DEFAULT_ENTITY_DEGREE_LIMIT = 3;
export const DEFAULT_CORE_ENTITY_LIMIT = 20;
export const DEFAULT_CORE_RELATION_LIMIT = 15;

const normalize = (value: string) => String(value || "").trim().toLocaleLowerCase();

export function selectStrongEntityRelations(
  relations: GraphRelation[],
  limit = DEFAULT_ENTITY_DEGREE_LIMIT,
): GraphRelation[] {
  const degree = new Map<string, number>();
  const visibleEntities = new Set<string>();
  const evidenceBacked = [...relations]
    .filter((relation) => relation.confidence >= EVIDENCE_RELATION_CONFIDENCE && relation.citations.length > 0)
    .sort((left, right) => right.confidence - left.confidence);
  const strong = evidenceBacked.filter((relation) => relation.confidence >= STRONG_RELATION_CONFIDENCE);
  const visiblePool = strong.length > 0 ? strong : evidenceBacked;
  return visiblePool
    .filter((relation) => {
      const nextEntityCount = visibleEntities.size
        + (visibleEntities.has(relation.sourceId) ? 0 : 1)
        + (visibleEntities.has(relation.targetId) ? 0 : 1);
      if (nextEntityCount > DEFAULT_CORE_ENTITY_LIMIT) return false;
      const sourceDegree = degree.get(relation.sourceId) || 0;
      const targetDegree = degree.get(relation.targetId) || 0;
      if (sourceDegree >= limit || targetDegree >= limit) return false;
      degree.set(relation.sourceId, sourceDegree + 1);
      degree.set(relation.targetId, targetDegree + 1);
      visibleEntities.add(relation.sourceId);
      visibleEntities.add(relation.targetId);
      return true;
    })
    .slice(0, DEFAULT_CORE_RELATION_LIMIT);
}

function entityMatchesTypes(entity: GraphEntity, entityTypes: Set<string>) {
  return entityTypes.size === 0 || entityTypes.has(entity.entityType);
}

export function selectEntityNetwork(
  graph: EntityGraph,
  options: EntityNetworkSelectionOptions,
): EntityGraph {
  const selectedEntityId = options.selectedEntityId || null;
  const entityTypes = new Set((options.entityTypes || []).filter(Boolean));
  const allowedEntityIds = new Set(
    graph.entities
      .filter((entity) => entityMatchesTypes(entity, entityTypes) || (options.mode === "local" && entity.id === selectedEntityId))
      .map((entity) => entity.id),
  );

  let relations: GraphRelation[];
  if (options.mode === "local" && selectedEntityId) {
    relations = graph.relations.filter((relation) => {
      if (relation.sourceId !== selectedEntityId && relation.targetId !== selectedEntityId) return false;
      const neighborId = relation.sourceId === selectedEntityId ? relation.targetId : relation.sourceId;
      return allowedEntityIds.has(neighborId) && relation.citations.length > 0;
    });
  } else if (options.mode === "evidence") {
    relations = graph.relations.filter((relation) => (
      relation.citations.length > 0
      && relation.confidence >= EVIDENCE_RELATION_CONFIDENCE
      && allowedEntityIds.has(relation.sourceId)
      && allowedEntityIds.has(relation.targetId)
    ));
  } else {
    relations = selectStrongEntityRelations(graph.relations).filter((relation) => (
      allowedEntityIds.has(relation.sourceId) && allowedEntityIds.has(relation.targetId)
    ));
  }

  const visibleEntityIds = new Set<string>();
  if (options.mode === "local" && selectedEntityId && graph.entities.some((entity) => entity.id === selectedEntityId)) {
    visibleEntityIds.add(selectedEntityId);
  }
  relations.forEach((relation) => {
    visibleEntityIds.add(relation.sourceId);
    visibleEntityIds.add(relation.targetId);
  });
  if (options.showIsolated && options.mode !== "local") {
    allowedEntityIds.forEach((entityId) => visibleEntityIds.add(entityId));
  }

  return {
    entities: graph.entities.filter((entity) => visibleEntityIds.has(entity.id)),
    relations,
  };
}

function entitySearchScore(entity: GraphEntity, query: string) {
  const canonicalName = normalize(entity.canonicalName);
  if (canonicalName === query) return 500;
  if (canonicalName.startsWith(query)) return 440;
  const nameIndex = canonicalName.indexOf(query);
  if (nameIndex >= 0) return 380 - Math.min(nameIndex, 80);

  const aliasIndex = (entity.aliases || []).map(normalize).findIndex((alias) => alias.includes(query));
  if (aliasIndex >= 0) return 300 - Math.min(aliasIndex, 80);

  const descriptionIndex = normalize(entity.description).indexOf(query);
  if (descriptionIndex >= 0) return 200 - Math.min(descriptionIndex, 120);

  const typeIndex = normalize(entity.entityType).indexOf(query);
  if (typeIndex >= 0) return 120 - Math.min(typeIndex, 60);
  return 0;
}

export function searchEntityNetwork(entities: GraphEntity[], rawQuery: string, limit = 8): GraphEntity[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  return entities
    .map((entity) => ({ entity, score: entitySearchScore(entity, query) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || right.entity.confidence - left.entity.confidence)
    .slice(0, limit)
    .map((result) => result.entity);
}
