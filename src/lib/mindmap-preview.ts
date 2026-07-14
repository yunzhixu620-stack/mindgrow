import type { AIMindMap, Citation, KnowledgeEdge, KnowledgeNode } from "@/types";

function citationList(indexes: number[] | undefined, citations: Citation[]) {
  const wanted = new Set(indexes || []);
  return citations.filter((citation) => wanted.has(citation.index));
}

/**
 * Converts a freshly generated meeting/article outline into the same graph
 * shape used by the persistent knowledge-map canvas. The ids are deliberately
 * scoped to a preview so they can never collide with saved Supabase rows.
 */
export function mindMapToPreviewGraph(
  mindMap: AIMindMap,
  source: "article" | "meeting",
  citations: Citation[] = [],
): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const now = new Date().toISOString();
  const scope = `preview_${source}_${Date.now()}`;
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const rootId = `${scope}_root`;

  nodes.push({
    id: rootId,
    content: mindMap.root || (source === "article" ? "文章解析" : "会议纪要"),
    desc: mindMap.rootDesc || "",
    type: "topic",
    status: "active",
    source,
    confidence: 1,
    createdAt: now,
    updatedAt: now,
    citations: citationList(mindMap.rootCitationIndexes, citations),
  });

  (mindMap.children || []).forEach((child, childIndex) => {
    const childId = `${scope}_branch_${childIndex}`;
    nodes.push({
      id: childId,
      content: child.topic,
      desc: child.desc || "",
      type: "concept",
      status: "active",
      source,
      confidence: 0.9,
      createdAt: now,
      updatedAt: now,
      citations: citationList(child.citationIndexes, citations),
    });
    edges.push({
      id: `${scope}_edge_${childIndex}`,
      sourceId: rootId,
      targetId: childId,
      relation: "contains",
      weight: 1,
      createdAt: now,
    });

    (child.items || []).forEach((item, itemIndex) => {
      const itemId = `${scope}_branch_${childIndex}_item_${itemIndex}`;
      nodes.push({
        id: itemId,
        content: item,
        desc: "",
        type: "detail",
        status: "active",
        source,
        confidence: 0.82,
        createdAt: now,
        updatedAt: now,
        citations: citationList(child.itemCitationIndexes?.[itemIndex] || child.citationIndexes, citations),
      });
      edges.push({
        id: `${scope}_edge_${childIndex}_${itemIndex}`,
        sourceId: childId,
        targetId: itemId,
        relation: "contains",
        weight: 0.85,
        createdAt: now,
      });
    });
  });

  return { nodes, edges };
}
