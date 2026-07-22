import type { KnowledgeEdge, KnowledgeNode, NodeBacklink, NodeContext, NodeRevision } from "@/types";

export function buildLocalNodeContext(
  node: KnowledgeNode,
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
): NodeContext {
  const targetDocumentIds = new Set((node.citations || []).map((citation) => citation.documentId).filter(Boolean));
  const kindsByNode = new Map<string, Set<NodeBacklink["kinds"][number]>>();
  const incomingByNode = new Map<string, KnowledgeEdge>();

  edges.filter((edge) => edge.targetId === node.id).forEach((edge) => {
    if (edge.sourceId === node.id) return;
    const kinds = kindsByNode.get(edge.sourceId) || new Set();
    kinds.add("incoming_edge");
    kindsByNode.set(edge.sourceId, kinds);
    incomingByNode.set(edge.sourceId, edge);
  });

  nodes.forEach((candidate) => {
    if (candidate.id === node.id) return;
    if (!(candidate.citations || []).some((citation) => citation.documentId && targetDocumentIds.has(citation.documentId))) return;
    const kinds = kindsByNode.get(candidate.id) || new Set();
    kinds.add("shared_source");
    kindsByNode.set(candidate.id, kinds);
  });

  const backlinks = nodes.filter((candidate) => kindsByNode.has(candidate.id)).map((candidate) => {
    const incoming = incomingByNode.get(candidate.id);
    return {
      node: candidate,
      kinds: Array.from(kindsByNode.get(candidate.id) || []),
      relation: incoming?.relation || null,
      relationCreatedAt: incoming?.createdAt || null,
      sharedCitations: (candidate.citations || []).filter((citation) => citation.documentId && targetDocumentIds.has(citation.documentId)),
    } satisfies NodeBacklink;
  });

  const timeline: NodeRevision[] = [{
    id: `local-created:${node.id}`,
    eventType: "created",
    content: node.content,
    desc: node.desc || "",
    changedFields: ["content", "desc"],
    createdAt: node.createdAt,
  }];
  if (node.updatedAt !== node.createdAt) timeline.unshift({
    id: `local-updated:${node.id}`,
    eventType: "updated",
    content: node.content,
    desc: node.desc || "",
    changedFields: [],
    createdAt: node.updatedAt,
  });

  return { node, sources: node.citations || [], backlinks, timeline };
}
