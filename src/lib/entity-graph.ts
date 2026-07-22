import type {
  AIEntityGraph,
  Citation,
  EntityGroundingStatus,
  EntityGraph,
  GraphEntity,
  GraphRelation,
  KnowledgeEdge,
  KnowledgeNode,
} from "@/types";

const ENTITY_PREFIX = "__mindgrow_entity__:";

export const ENTITY_DESCRIPTION_MIN_LENGTH = 8;
export const LEGACY_ENTITY_DESCRIPTION = "原文未直接说明";

export function entityViewNodeId(entityId: string) {
  return `${ENTITY_PREFIX}${entityId}`;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "人物",
  organization: "组织",
  model: "模型",
  method: "方法",
  dataset: "数据集",
  metric: "指标",
  task: "任务",
  event: "事件",
  decision: "决策",
  time: "时间",
  concept: "概念",
  claim: "声明",
  other: "实体",
};

const RELATION_TYPE_LABELS: Record<string, string> = {
  uses: "使用",
  proposes: "提出",
  evaluated_on: "评测于",
  achieves: "达到",
  depends_on: "依赖于",
  retrieves_from: "检索自",
  has_metric: "使用指标",
  part_of: "属于",
  contains: "包含",
  contains_concept: "包含概念",
  contradicts: "矛盾于",
  responsible_for: "负责",
  due_on: "截止于",
  is: "定义为",
  related_to: "相关于",
};

function citationsFor(indexes: number[] | undefined, citations: Citation[]) {
  const indexSet = new Set(indexes || []);
  return citations.filter((citation) => indexSet.has(citation.index));
}

export function isGroundedGraphEntity(entity: GraphEntity): boolean {
  return String(entity.canonicalName || "").trim().length > 0
    && String(entity.description || "").trim().length >= ENTITY_DESCRIPTION_MIN_LENGTH
    && Array.isArray(entity.descriptionCitations)
    && entity.descriptionCitations.length > 0;
}

export function graphEntityGroundingStatus(entity: GraphEntity): EntityGroundingStatus {
  return isGroundedGraphEntity(entity) ? "grounded" : "legacy";
}

export function entityDescriptionForReadOnlyDetail(entity: GraphEntity): string {
  return String(entity.description || "").trim() || LEGACY_ENTITY_DESCRIPTION;
}

/**
 * Keeps historical entities available to callers while ensuring only v4-grounded
 * entities and their evidence-backed relations enter the formal graph.
 */
export function formalEntityGraph(graph: EntityGraph): EntityGraph {
  const entities = (graph.entities || [])
    .filter(isGroundedGraphEntity)
    .map((entity) => ({
      ...entity,
      canonicalName: String(entity.canonicalName || "").trim(),
      description: String(entity.description || "").trim(),
      groundingStatus: "grounded" as const,
    }));
  const entityIds = new Set(entities.map((entity) => entity.id));
  const relations = (graph.relations || [])
    .filter((relation) => (
      entityIds.has(relation.sourceId)
      && entityIds.has(relation.targetId)
      && relation.sourceId !== relation.targetId
      && Array.isArray(relation.citations)
      && relation.citations.length > 0
    ))
    .map((relation) => {
      const shortLabel = [
        relation.shortLabel,
        relation.label,
        RELATION_TYPE_LABELS[relation.relationType],
        RELATION_TYPE_LABELS.related_to,
      ].map((candidate) => String(candidate || "").trim()).find(Boolean) || RELATION_TYPE_LABELS.related_to;
      return { ...relation, shortLabel, label: shortLabel };
    });
  return { entities, relations };
}

export function aiEntityGraphToEntityGraph(
  graph: AIEntityGraph | null | undefined,
  citations: Citation[],
  scope: string,
  generatedAt = new Date().toISOString(),
): EntityGraph {
  const entities: GraphEntity[] = (graph?.entities || []).map((entity, index) => ({
    id: `${scope}:${entity.tempId || `E${index + 1}`}`,
    canonicalName: String(entity.name || "").trim(),
    entityType: entity.type || "other",
    aliases: entity.aliases || [],
    description: (entity.description || "").trim(),
    groundingStatus: "grounded",
    confidence: entity.confidence ?? 0.75,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    citations: citationsFor(entity.citationIndexes, citations),
    descriptionCitations: citationsFor(entity.descriptionEvidence, citations),
  }));
  const byTempId = new Map((graph?.entities || []).map((entity, index) => [
    entity.tempId || `E${index + 1}`,
    `${scope}:${entity.tempId || `E${index + 1}`}`,
  ]));
  const relations: GraphRelation[] = (graph?.relations || []).map((relation, index) => {
    const relationType = relation.type || "related_to";
    const shortLabel = relation.shortLabel || relation.label || RELATION_TYPE_LABELS[relationType] || RELATION_TYPE_LABELS.related_to;
    return {
      id: `${scope}:R${index + 1}`,
      sourceId: byTempId.get(relation.source) || "",
      targetId: byTempId.get(relation.target) || "",
      relationType,
      shortLabel,
      label: shortLabel,
      explanation: relation.explanation || "",
      status: relation.status || "asserted",
      confidence: relation.confidence ?? 0.7,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      citations: citationsFor(relation.citationIndexes, citations),
    };
  });
  return formalEntityGraph({ entities, relations });
}

export function entityGraphToKnowledgeGraph(graph: EntityGraph): {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
} {
  const officialGraph = formalEntityGraph(graph);
  const fallbackCreatedAt = new Date().toISOString();
  const ids = new Map(officialGraph.entities.map((entity) => [entity.id, entityViewNodeId(entity.id)]));
  const entitiesById = new Map(officialGraph.entities.map((entity) => [entity.id, entity]));
  const nodeType = (entityType: string): KnowledgeNode["type"] => {
    if (["person", "organization", "event"].includes(entityType)) return "topic";
    if (["metric", "time"].includes(entityType)) return "detail";
    if (["claim", "decision"].includes(entityType)) return "question";
    return "concept";
  };
  const nodes: KnowledgeNode[] = officialGraph.entities.map((entity) => ({
    id: ids.get(entity.id) || `${ENTITY_PREFIX}${entity.id}`,
    content: entity.canonicalName,
    desc: `${ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}${entity.description ? ` · ${entity.description}` : ""}${entity.aliases.length ? ` · 别名：${entity.aliases.join("、")}` : ""}`,
    type: nodeType(entity.entityType),
    status: "active",
    source: "ai_generated",
    confidence: entity.confidence,
    createdAt: entity.createdAt || entity.updatedAt || fallbackCreatedAt,
    updatedAt: entity.updatedAt || entity.createdAt || fallbackCreatedAt,
    citations: entity.citations,
  }));
  const edges: KnowledgeEdge[] = officialGraph.relations.map((relation) => ({
    id: `${ENTITY_PREFIX}${relation.id}`,
    sourceId: ids.get(relation.sourceId) || `${ENTITY_PREFIX}${relation.sourceId}`,
    targetId: ids.get(relation.targetId) || `${ENTITY_PREFIX}${relation.targetId}`,
    relation: (relation.status === "negated" ? "contradicts" : "relates_to") as KnowledgeEdge["relation"],
    relationLabel: relation.shortLabel,
    relationId: relation.id,
    relationStatus: relation.status,
    relationExplanation: relation.explanation,
    citations: relation.citations,
    weight: relation.confidence,
    createdAt: relation.createdAt
      || entitiesById.get(relation.sourceId)?.createdAt
      || entitiesById.get(relation.targetId)?.createdAt
      || fallbackCreatedAt,
  })).filter((edge) => ids.has(edge.sourceId.replace(ENTITY_PREFIX, "")) && ids.has(edge.targetId.replace(ENTITY_PREFIX, "")));
  return { nodes, edges };
}

export function isEntityViewNode(nodeId: string) {
  return nodeId.startsWith(ENTITY_PREFIX);
}
