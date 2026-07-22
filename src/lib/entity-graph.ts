import type {
  AIEntityGraph,
  Citation,
  EntityGraph,
  GraphEntity,
  GraphRelation,
  KnowledgeEdge,
  KnowledgeNode,
} from "@/types";

const ENTITY_PREFIX = "__mindgrow_entity__:";

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

export function aiEntityGraphToEntityGraph(
  graph: AIEntityGraph | null | undefined,
  citations: Citation[],
  scope: string,
): EntityGraph {
  const entities: GraphEntity[] = (graph?.entities || []).map((entity, index) => ({
    id: `${scope}:${entity.tempId || `E${index + 1}`}`,
    canonicalName: entity.name,
    entityType: entity.type || "other",
    aliases: entity.aliases || [],
    description: entity.description || "",
    confidence: entity.confidence ?? 0.75,
    citations: citationsFor(entity.citationIndexes, citations),
    descriptionCitations: citationsFor(entity.descriptionEvidence, citations),
  })).filter((entity) => entity.canonicalName && entity.citations.length > 0);
  const byTempId = new Map((graph?.entities || []).map((entity, index) => [
    entity.tempId || `E${index + 1}`,
    `${scope}:${entity.tempId || `E${index + 1}`}`,
  ]));
  const entityIds = new Set(entities.map((entity) => entity.id));
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
      citations: citationsFor(relation.citationIndexes, citations),
    };
  }).filter((relation) => entityIds.has(relation.sourceId) && entityIds.has(relation.targetId)
    && relation.sourceId !== relation.targetId && relation.citations.length > 0);
  return { entities, relations };
}

export function entityGraphToKnowledgeGraph(graph: EntityGraph): {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
} {
  const createdAt = "1970-01-01T00:00:00.000Z";
  const ids = new Map(graph.entities.map((entity) => [entity.id, entityViewNodeId(entity.id)]));
  const nodeType = (entityType: string): KnowledgeNode["type"] => {
    if (["person", "organization", "event"].includes(entityType)) return "topic";
    if (["metric", "time"].includes(entityType)) return "detail";
    if (["claim", "decision"].includes(entityType)) return "question";
    return "concept";
  };
  const nodes: KnowledgeNode[] = graph.entities.map((entity) => ({
    id: ids.get(entity.id) || `${ENTITY_PREFIX}${entity.id}`,
    content: entity.canonicalName,
    desc: `${ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}${entity.description ? ` · ${entity.description}` : ""}${entity.aliases.length ? ` · 别名：${entity.aliases.join("、")}` : ""}`,
    type: nodeType(entity.entityType),
    status: "active",
    source: "ai_generated",
    confidence: entity.confidence,
    createdAt,
    updatedAt: createdAt,
    citations: entity.citations,
  }));
  const edges: KnowledgeEdge[] = graph.relations.map((relation) => ({
    id: `${ENTITY_PREFIX}${relation.id}`,
    sourceId: ids.get(relation.sourceId) || `${ENTITY_PREFIX}${relation.sourceId}`,
    targetId: ids.get(relation.targetId) || `${ENTITY_PREFIX}${relation.targetId}`,
    relation: (relation.status === "negated" ? "contradicts" : "relates_to") as KnowledgeEdge["relation"],
    relationLabel: `${relation.label}${relation.status === "historical" ? "（历史）" : relation.status === "proposed" ? "（待确认）" : relation.status === "negated" ? "（否定）" : ""} · ${relation.citations.length} 证据`,
    relationId: relation.id,
    relationStatus: relation.status,
    relationExplanation: relation.explanation,
    citations: relation.citations,
    weight: relation.confidence,
    createdAt,
  })).filter((edge) => ids.has(edge.sourceId.replace(ENTITY_PREFIX, "")) && ids.has(edge.targetId.replace(ENTITY_PREFIX, "")));
  return { nodes, edges };
}

export function isEntityViewNode(nodeId: string) {
  return nodeId.startsWith(ENTITY_PREFIX);
}
