"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeChange,
  BackgroundVariant,
  Position,
  NodeProps,
  Handle,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { KnowledgeNode, KnowledgeEdge } from "@/types";
import { apiFetch } from "@/lib/client-api";
import { MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";

// ============================================================
// Branch color palette
// ============================================================
const BRANCH_COLORS = [
  "#22d3a7", "#6366f1", "#06b6d4", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#ec4899", "#14b8a6",
];

const DISPLAY_OVERVIEW_PREFIX = "__mindgrow_overview__";
const MAX_UNGROUPED_ROOTS = 5;

function isDisplayOverviewNode(nodeId: string) {
  return nodeId.startsWith(DISPLAY_OVERVIEW_PREFIX);
}

/**
 * A knowledge map can accumulate many independent source roots over time. They
 * are valid retrieval entities, so rewriting the stored GraphRAG topology just
 * to improve the canvas would add false semantic relationships. Instead, add a
 * display-only overview parent once the root count becomes hard to scan. The
 * original roots become visual children while stored nodes, citations and
 * retrieval edges remain untouched.
 */
function buildDisplayHierarchy(
  dbNodes: KnowledgeNode[],
  dbEdges: KnowledgeEdge[],
  mapId: string | null,
  overviewLabel: string,
) {
  const childIds = new Set(
    dbEdges.filter((edge) => edge.relation === "contains").map((edge) => edge.targetId),
  );
  const roots = dbNodes.filter((node) => !childIds.has(node.id));
  if (roots.length <= MAX_UNGROUPED_ROOTS) {
    return { nodes: dbNodes, edges: dbEdges, syntheticNodeCount: 0 };
  }

  const overviewId = `${DISPLAY_OVERVIEW_PREFIX}:${mapId || "current"}`;
  const timestamps = roots.map((node) => node.createdAt).filter(Boolean).sort();
  const createdAt = timestamps[0] || "1970-01-01T00:00:00.000Z";
  const updatedAt = roots.map((node) => node.updatedAt).filter(Boolean).sort().at(-1) || createdAt;
  const overviewNode: KnowledgeNode = {
    id: overviewId,
    content: overviewLabel,
    desc: `已将 ${roots.length} 个一级主题收纳为二级主题；展开任一分支可继续查看原始内容。`,
    type: "topic",
    status: "active",
    source: "template",
    confidence: 1,
    createdAt,
    updatedAt,
  };
  const overviewEdges: KnowledgeEdge[] = roots.map((root, index) => ({
    id: `${overviewId}:edge:${index}`,
    sourceId: overviewId,
    targetId: root.id,
    relation: "contains",
    weight: 1,
    createdAt,
  }));

  return {
    nodes: [overviewNode, ...dbNodes],
    edges: [...overviewEdges, ...dbEdges],
    syntheticNodeCount: 1,
  };
}

// ============================================================
// Custom Node Component
// ============================================================
function MindGrowNode({ data, selected }: NodeProps) {
  const nodeType = data.nodeType as string;
  const source = data.source as string;
  const desc = data.nodeDesc as string;
  const highlighted = data.highlighted as boolean;
  const childCount = (data.childCount as number) || 0;
  const descendantCount = (data.descendantCount as number) || childCount;
  const collapsed = data.collapsed as boolean;
  const showDetails = data.showDetails as boolean;
  const compact = data.compact as boolean;
  const horizontal = data.direction === "horizontal";
  const branchIndex = data.branchIndex as number || 0;
  const citations = (data.citations || []) as KnowledgeNode["citations"];
  const borderColor = branchIndex > 0
    ? BRANCH_COLORS[branchIndex % BRANCH_COLORS.length]
    : (highlighted ? "#22d3a7" : undefined);

  const colorMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    topic: { bg: "#0f2922", border: "#22d3a7", text: "#e2fff5", glow: "rgba(34,211,167,0.15)" },
    concept: { bg: "#0f1f2d", border: "#38bdf8", text: "#e0f2fe", glow: "rgba(56,189,248,0.15)" },
    detail: { bg: "#14141f", border: "#818cf8", text: "#e0e7ff", glow: "rgba(129,140,248,0.15)" },
    question: { bg: "#1f0f1f", border: "#f472b6", text: "#fce7f3", glow: "rgba(244,114,182,0.15)" },
  };

  const colors = colorMap[nodeType] || colorMap.concept;
  const finalBorder = borderColor || colors.border;

  return (
    <div
      data-display-overview={isDisplayOverviewNode(data.nodeId as string) ? "true" : undefined}
      className={`
        relative rounded-xl ${compact ? "min-w-[132px] max-w-[172px] px-2.5 py-2" : "min-w-[150px] max-w-[220px] px-3.5 py-2.5"}
        text-center transition-all duration-200 cursor-grab active:cursor-grabbing
        ${selected ? "ring-2 ring-offset-1 ring-offset-[#0a0a0f]" : ""}
        ${highlighted ? "animate-pulse ring-2 ring-[#22d3a7] ring-offset-1 ring-offset-[#0a0a0f]" : ""}
      `}
      style={{
        backgroundColor: colors.bg,
        border: `1.5px solid ${highlighted ? "#22d3a7" : selected ? finalBorder : `${finalBorder}88`}`,
        color: colors.text,
        boxShadow: highlighted || selected ? `0 0 20px ${colors.glow}` : undefined,
      }}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="!bg-transparent !w-2 !h-2 !border-2 !border-[#22d3a7]"
      />
      <div className="line-clamp-3 text-[13px] font-medium leading-snug break-words" title={data.label as string}>
        {data.label as string}
      </div>
      {showDetails && desc && (
        <div className="text-[10px] leading-relaxed mt-0.5 opacity-50 line-clamp-2 break-words">
          {desc}
        </div>
      )}
      {showDetails && citations && citations.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-1" aria-label="节点引用">
          {citations.slice(0, 4).map((citation) => (
            <span key={`${citation.documentId || "source"}-${citation.index}`} title={`${citation.locator || "原文"}：${citation.quote}`} className="rounded bg-[#22d3a720] px-1.5 py-0.5 text-[9px] font-semibold text-[#7de8c9]">[{citation.index}]</span>
          ))}
          {citations.length > 4 && <span className="text-[9px] opacity-50">+{citations.length - 4}</span>}
        </div>
      )}
      {(childCount > 0 || source === "ai_generated") && (
        <div className="flex items-center justify-center gap-1 mt-1">
          {source === "ai_generated" && (
            <span className="text-[9px] opacity-40 bg-[#22d3a720] text-[#22d3a7] px-1.5 py-0.5 rounded-full">
              AI
            </span>
          )}
          {childCount > 0 && <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); (data.onToggleCollapse as ((id: string) => void) | undefined)?.(data.nodeId as string); }}
            className={`nodrag rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-colors ${collapsed ? "border-[#22d3a755] bg-[#22d3a722] text-[#7de8c9]" : "border-white/10 bg-white/5 text-white/50 hover:text-white"}`}
            aria-label={collapsed ? `展开 ${descendantCount} 个子节点` : `收起 ${descendantCount} 个子节点`}
            title={collapsed ? `展开 ${descendantCount} 个子节点` : `收起 ${descendantCount} 个子节点`}
          >{collapsed ? `＋${descendantCount}` : `−${descendantCount}`}</button>}
        </div>
      )}
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className="!bg-transparent !w-2 !h-2 !border-2 !border-[#22d3a7]"
      />
    </div>
  );
}

const nodeTypes = { mindGrowNode: MindGrowNode };

function getOutlineCollapsedNodes(dbNodes: KnowledgeNode[], dbEdges: KnowledgeEdge[]) {
  const childrenOf = new Map<string, string[]>();
  const childSet = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation !== "contains") continue;
    childSet.add(edge.targetId);
    const children = childrenOf.get(edge.sourceId) || [];
    children.push(edge.targetId);
    childrenOf.set(edge.sourceId, children);
  }
  const roots = dbNodes.filter((node) => !childSet.has(node.id));
  const collapsed = new Set<string>();

  // Dense multi-source maps open as one display-only overview card. Expanding
  // that card is handled as an explicit "show everything" action below, so no
  // original branch is silently downgraded or left partially folded.
  const displayOverview = roots.find((node) => isDisplayOverviewNode(node.id));
  if (displayOverview) {
    collapsed.add(displayOverview.id);
    return collapsed;
  }

  const firstLevelByRoot = new Map<string, string[]>();
  let outlineVisibleCount = roots.length;
  for (const root of roots) {
    const firstLevel = childrenOf.get(root.id) || [];
    firstLevelByRoot.set(root.id, firstLevel);
    outlineVisibleCount += firstLevel.length;
    for (const child of firstLevel) {
      if ((childrenOf.get(child) || []).length) collapsed.add(child);
    }
  }

  // As knowledge accumulates, keep recent trees expanded and compress older trees to root cards.
  // Expanding an older root reveals its first level while those branches remain safely folded.
  const MAX_OUTLINE_NODES = 12;
  if (roots.length > 1 && outlineVisibleCount > MAX_OUTLINE_NODES) {
    const oldestRoots = [...roots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const root of oldestRoots) {
      if (outlineVisibleCount <= MAX_OUTLINE_NODES) break;
      const firstLevel = firstLevelByRoot.get(root.id) || [];
      if (!firstLevel.length) continue;
      collapsed.add(root.id);
      outlineVisibleCount -= firstLevel.length;
    }
  }
  return collapsed;
}

// ============================================================
// Tree Layout
// ============================================================
interface LayoutOptions {
  direction: "vertical" | "horizontal";
  nodeWidth: number;
  nodeHeight: number;
  hGap: number;
  vGap: number;
  tree: number;
}

function layoutTree(
  dbNodes: KnowledgeNode[],
  dbEdges: KnowledgeEdge[],
  options: LayoutOptions,
  collapsed: Set<string>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const childrenOf = new Map<string, string[]>();

  for (const edge of dbEdges) {
    if (edge.relation === "contains") {
      const children = childrenOf.get(edge.sourceId) || [];
      children.push(edge.targetId);
      childrenOf.set(edge.sourceId, children);
    }
  }

  const childSet = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation === "contains") childSet.add(edge.targetId);
  }
  const rootNodes = dbNodes.filter((n) => !childSet.has(n.id));

  const { direction, nodeWidth, nodeHeight, hGap, vGap } = options;

  function getSubtreeSize(nodeId: string): { w: number; h: number } {
    if (collapsed.has(nodeId)) return { w: nodeWidth, h: nodeHeight };
    const children = childrenOf.get(nodeId) || [];
    if (children.length === 0) return { w: nodeWidth, h: nodeHeight };
    const sizes = children.map((c) => getSubtreeSize(c));
    if (direction === "vertical") {
      const totalW = sizes.reduce((sum, s) => sum + s.w, 0) + (children.length - 1) * hGap;
      const maxH = Math.max(...sizes.map((s) => s.h));
      return { w: Math.max(totalW, nodeWidth), h: maxH + vGap + nodeHeight };
    } else {
      const totalH = sizes.reduce((sum, s) => sum + s.h, 0) + (children.length - 1) * vGap;
      const maxW = Math.max(...sizes.map((s) => s.w));
      return { w: maxW + hGap + nodeWidth, h: Math.max(totalH, nodeHeight) };
    }
  }

  function placeNode(nodeId: string, x: number, y: number) {
    positions.set(nodeId, { x, y });
    if (collapsed.has(nodeId)) return;
    const children = childrenOf.get(nodeId) || [];
    if (children.length === 0) return;
    const childSizes = children.map((c) => getSubtreeSize(c));
    if (direction === "vertical") {
      const totalW = childSizes.reduce((sum, s) => sum + s.w, 0) + (children.length - 1) * hGap;
      let startX = x + (nodeWidth - totalW) / 2;
      for (let i = 0; i < children.length; i++) {
        const childW = childSizes[i].w;
        placeNode(children[i], startX + (childW - nodeWidth) / 2, y + nodeHeight + vGap);
        startX += childW + hGap;
      }
    } else {
      const totalH = childSizes.reduce((sum, s) => sum + s.h, 0) + (children.length - 1) * vGap;
      let startY = y + (nodeHeight - totalH) / 2;
      for (let i = 0; i < children.length; i++) {
        const childH = childSizes[i].h;
        placeNode(children[i], x + nodeWidth + hGap, startY + (childH - nodeHeight) / 2);
        startY += childH + vGap;
      }
    }
  }

  // Lay independent topics on bounded shelves instead of one unbounded line.
  // This keeps new keywords inside a predictable viewport and prevents trees
  // from overlapping while still leaving a clear gap between topic groups.
  const maxPrimarySpan = direction === "vertical" ? 1500 : 980;
  let primaryOffset = 0;
  let secondaryOffset = 0;
  let lineCrossSpan = 0;
  for (const root of rootNodes) {
    const size = getSubtreeSize(root.id);
    const primarySpan = direction === "vertical" ? size.w : size.h;
    const crossSpan = direction === "vertical" ? size.h : size.w;
    if (primaryOffset > 0 && primaryOffset + primarySpan > maxPrimarySpan) {
      primaryOffset = 0;
      secondaryOffset += lineCrossSpan + options.tree;
      lineCrossSpan = 0;
    }
    if (direction === "vertical") {
      placeNode(root.id, primaryOffset, secondaryOffset);
    } else {
      placeNode(root.id, secondaryOffset, primaryOffset);
    }
    primaryOffset += primarySpan + options.tree;
    lineCrossSpan = Math.max(lineCrossSpan, crossSpan);
  }

  if (rootNodes.length === 0) {
    dbNodes.forEach((n, idx) => {
      positions.set(n.id, direction === "vertical"
        ? { x: 0, y: idx * (nodeHeight + vGap) }
        : { x: idx * (nodeWidth + hGap), y: 0 });
    });
  }

  return positions;
}

// ============================================================
// Build Graph
// ============================================================
function buildGraph(
  dbNodes: KnowledgeNode[],
  dbEdges: KnowledgeEdge[],
  highlightedNodeId: string | null,
  searchResults: string[],
  direction: "vertical" | "horizontal",
  spacing: { h: number; v: number; tree: number },
  collapsed: Set<string>,
  focusRootId: string | null,
  showDetails: boolean,
  compact: boolean,
  onToggleCollapse: (nodeId: string) => void,
): { nodes: Node[]; edges: Edge[]; branchMap: Map<string, number> } {
  const allChildrenOf = new Map<string, string[]>();
  for (const edge of dbEdges) {
    if (edge.relation !== "contains") continue;
    const list = allChildrenOf.get(edge.sourceId) || [];
    list.push(edge.targetId);
    allChildrenOf.set(edge.sourceId, list);
  }
  const scopedIds = new Set<string>();
  const collectSubtree = (nodeId: string) => {
    if (scopedIds.has(nodeId)) return;
    scopedIds.add(nodeId);
    for (const child of allChildrenOf.get(nodeId) || []) collectSubtree(child);
  };
  if (focusRootId && dbNodes.some((node) => node.id === focusRootId)) collectSubtree(focusRootId);
  else dbNodes.forEach((node) => scopedIds.add(node.id));
  const scopedNodes = dbNodes.filter((node) => scopedIds.has(node.id));
  const scopedEdges = dbEdges.filter((edge) => scopedIds.has(edge.sourceId) && scopedIds.has(edge.targetId));

  const childCountMap = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();

  for (const edge of scopedEdges) {
    if (edge.relation === "contains") {
      childCountMap.set(edge.sourceId, (childCountMap.get(edge.sourceId) || 0) + 1);
      const list = childrenOf.get(edge.sourceId) || [];
      list.push(edge.targetId);
      childrenOf.set(edge.sourceId, list);
    }
  }

  const childSet = new Set<string>();
  for (const edge of scopedEdges) {
    if (edge.relation === "contains") childSet.add(edge.targetId);
  }
  const roots = scopedNodes.filter((n) => !childSet.has(n.id));
  const branchMap = new Map<string, number>();
  let branchIdx = 0;

  const paintBranch = (nodeId: string, colorIndex: number) => {
    branchMap.set(nodeId, colorIndex);
    for (const child of childrenOf.get(nodeId) || []) paintBranch(child, colorIndex);
  };
  for (const root of roots) {
    branchMap.set(root.id, 0);
    const kids = childrenOf.get(root.id) || [];
    for (const kid of kids) {
      paintBranch(kid, ++branchIdx);
    }
  }

  const positions = layoutTree(scopedNodes, scopedEdges, {
    direction, nodeWidth: compact ? 170 : 210, nodeHeight: compact ? 72 : 84, hGap: spacing.h, vGap: spacing.v, tree: spacing.tree,
  }, collapsed);

  // Collect all visible IDs (respecting collapse)
  const childrenOfAll = new Map<string, string[]>();
  const childSetAll = new Set<string>();
  for (const edge of scopedEdges) {
    if (edge.relation === "contains") { childSetAll.add(edge.targetId); const l = childrenOfAll.get(edge.sourceId) || []; l.push(edge.targetId); childrenOfAll.set(edge.sourceId, l); }
  }
  const visibleIds = new Set<string>();
  function collectVisible(nid: string) { visibleIds.add(nid); if (collapsed.has(nid)) return; for (const c of childrenOfAll.get(nid) || []) collectVisible(c); }
  for (const root of roots) collectVisible(root.id);

  const descendantCount = new Map<string, number>();
  const countDescendants = (nodeId: string): number => {
    if (descendantCount.has(nodeId)) return descendantCount.get(nodeId) || 0;
    const count = (childrenOfAll.get(nodeId) || []).reduce((sum, child) => sum + 1 + countDescendants(child), 0);
    descendantCount.set(nodeId, count);
    return count;
  };

  const nodes: Node[] = scopedNodes.filter(n => visibleIds.has(n.id)).map((dbNode) => {
    const pos = positions.get(dbNode.id) || { x: 0, y: 0 };
    return {
      id: dbNode.id,
      type: "mindGrowNode",
      position: pos,
      data: {
        label: dbNode.content,
        nodeDesc: dbNode.desc || "",
        nodeType: dbNode.type,
        source: dbNode.source,
        confidence: dbNode.confidence,
        highlighted: dbNode.id === highlightedNodeId || searchResults.includes(dbNode.id),
        childCount: childCountMap.get(dbNode.id) || 0,
        descendantCount: countDescendants(dbNode.id),
        branchIndex: branchMap.get(dbNode.id) || 0,
        collapsed: collapsed.has(dbNode.id),
        direction,
        showDetails,
        compact,
        nodeId: dbNode.id,
        onToggleCollapse,
        citations: dbNode.citations || [],
      },
    };
  });

  const edges: Edge[] = scopedEdges
    .filter(e => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId))
    .map((dbEdge) => {
    const isRelation = dbEdge.relation !== "contains";
    const isContradiction = dbEdge.relation === "contradicts";
    const bi = branchMap.get(dbEdge.sourceId);
    const edgeColor = bi !== undefined ? BRANCH_COLORS[bi % BRANCH_COLORS.length] : "#ffffff10";
    return {
      id: dbEdge.id,
      source: dbEdge.sourceId,
      target: dbEdge.targetId,
      // One continuous cubic curve is easier to follow than multi-turn elbows.
      type: "default",
      animated: isRelation,
      label: isRelation ? (isContradiction ? "观点冲突" : "概念关联") : undefined,
      labelStyle: isRelation ? { fill: isContradiction ? "#fca5a5" : "#f9a8d4", fontSize: 10, fontWeight: 600 } : undefined,
      labelBgStyle: isRelation ? { fill: "#111113", fillOpacity: 0.92 } : undefined,
      labelBgPadding: isRelation ? [5, 3] as [number, number] : undefined,
      labelBgBorderRadius: isRelation ? 6 : undefined,
      style: {
        stroke: isContradiction ? "#ef4444aa" : isRelation ? "#f472b688" : `${edgeColor}44`,
        strokeWidth: isRelation ? 1.4 : 1.8,
        strokeDasharray: isRelation ? "5 5" : undefined,
      },
    };
  });

  return { nodes, edges, branchMap };
}

// ============================================================
// Export to Markdown
// ============================================================
function exportToMarkdown(dbNodes: KnowledgeNode[], dbEdges: KnowledgeEdge[]): string {
  const childrenOf = new Map<string, string[]>();
  const childSet = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation === "contains") {
      childSet.add(edge.targetId);
      const list = childrenOf.get(edge.sourceId) || [];
      list.push(edge.targetId);
      childrenOf.set(edge.sourceId, list);
    }
  }
  const roots = dbNodes.filter((n) => !childSet.has(n.id));
  const nodeMap = new Map(dbNodes.map((n) => [n.id, n]));

  function renderNode(nodeId: string, depth: number): string {
    const node = nodeMap.get(nodeId);
    if (!node) return "";
    const indent = "  ".repeat(depth);
    const prefix = depth === 0 ? "# " : depth === 1 ? "## " : depth === 2 ? "- " : "  - ";
    let result = `${indent}${prefix}${node.content}\n`;
    if (node.desc) {
      result += `${indent}  > ${node.desc}\n`;
    }
    for (const childId of childrenOf.get(nodeId) || []) {
      result += renderNode(childId, depth + 1);
    }
    return result;
  }

  let md = `# MindGrow 知识导图\n\n> 导出时间: ${new Date().toLocaleString("zh-CN")}\n\n`;
  for (const root of roots) {
    md += `---\n\n${renderNode(root.id, 0)}\n`;
  }
  return md;
}

const SUGGESTED_TOPICS = ["深度学习","产品设计原则","React 核心概念","商业模式画布","项目管理方法论","认知偏差"];

function HelpPanel({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { keys: "Ctrl+Z", desc: "撤销" },
    { keys: "Ctrl+Y", desc: "重做" },
    { keys: "Ctrl+F", desc: "搜索节点" },
    { keys: "Delete", desc: "删除选中" },
    { keys: "?", desc: "快捷键帮助" },
    { keys: "双击节点", desc: "编辑内容" },
    { keys: "右键节点", desc: "操作菜单" },
    { keys: "点击 +N", desc: "折叠/展开" },
    { keys: "左键拖拽", desc: "平移画布" },
    { keys: "Shift+拖拽", desc: "框选节点" },
    { keys: "滚轮", desc: "缩放" },
    { keys: "右键拖拽", desc: "平移画布(备选)" },
  ];
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 shadow-xl min-w-[300px] animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">⌨️ 快捷键</h3>
          <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer text-lg leading-none">✕</button>
        </div>
        <div className="space-y-2">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-[var(--foreground)]">{s.desc}</span>
              <kbd className="text-[10px] font-mono text-[var(--muted-foreground)] bg-[var(--bg-hover)] px-1.5 py-0.5 rounded border border-[var(--border)]">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
export function MindMapPanel() {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    highlightedNodeId,
    removeNode,
    setNodes: setStoreNodes,
    setEdges: setStoreEdges,
    currentMapId,
    searchResults,
    setSearchResults,
    contextMenu, setContextMenu,
    collapsedNodes,
    toggleCollapse, setCollapsedNodes,
    pushHistory, undo, redo,
    showHelp, setShowHelp,
    currentMode,
  } = useMindGrowStore();

  const [direction, setDirection] = useState<"vertical" | "horizontal">("vertical");
  const [spacing, setSpacing] = useState<"compact" | "normal" | "wide">("compact");
  const [showSearch, setShowSearch] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [editingNode, setEditingNode] = useState<{ id: string; content: string; desc: string } | null>(null);
  const [showSpacing, setShowSpacing] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState<"outline" | "all" | "custom">("all");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [showNodeDetails, setShowNodeDetails] = useState(true);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const initializedLargeMapRef = useRef<string | null>(null);

  // Detect mobile
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setDirection("horizontal");
        setShowNodeDetails(false);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Focus edit input
  useEffect(() => {
    if (editingNode && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingNode]);

  // Search handler
  const handleSearch = useCallback((query: string) => {
    setLocalSearch(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const q = query.toLowerCase();
    setSearchResults(storeNodes.filter((n) => n.content.toLowerCase().includes(q)).map((n) => n.id));
  }, [storeNodes, setSearchResults]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [setContextMenu]);

  const sv = useMemo(() => ({ compact: { h: 16, v: 30, tree: 100 }, normal: { h: 30, v: 50, tree: 200 }, wide: { h: 55, v: 80, tree: 400 } }[spacing]), [spacing]);
  const overviewLabel = currentMode === "article"
    ? "论文主题总览"
    : currentMode === "meeting"
      ? "会议主题总览"
      : "知识主题总览";
  const displayHierarchy = useMemo(
    () => buildDisplayHierarchy(storeNodes, storeEdges, currentMapId, overviewLabel),
    [storeNodes, storeEdges, currentMapId, overviewLabel],
  );

  const refitGraph = useCallback(() => {
    window.setTimeout(() => {
      reactFlowInstance.current?.fitView({
        padding: isMobile ? 0.14 : 0.24,
        minZoom: isMobile ? 0.45 : 0.55,
        maxZoom: 1.05,
        duration: 320,
      });
    }, 80);
  }, [isMobile]);

  const handleToggleBranch = useCallback((nodeId: string) => {
    if (isDisplayOverviewNode(nodeId)) {
      setCollapsedNodes(collapsedNodes.has(nodeId) ? new Set<string>() : new Set<string>([nodeId]));
      setViewMode(collapsedNodes.has(nodeId) ? "all" : "outline");
      refitGraph();
      return;
    }
    toggleCollapse(nodeId);
    setViewMode("custom");
    refitGraph();
  }, [collapsedNodes, setCollapsedNodes, toggleCollapse, refitGraph]);

  const showOutline = useCallback(() => {
    setFocusedNodeId(null);
    setDirection("horizontal");
    setCollapsedNodes(getOutlineCollapsedNodes(displayHierarchy.nodes, displayHierarchy.edges));
    setViewMode("outline");
    refitGraph();
  }, [setCollapsedNodes, displayHierarchy, refitGraph]);

  const showAllNodes = useCallback(() => {
    setFocusedNodeId(null);
    setCollapsedNodes(new Set<string>());
    setViewMode("all");
    refitGraph();
  }, [setCollapsedNodes, refitGraph]);

  // Large maps open as a readable outline instead of shrinking every node into one viewport.
  useEffect(() => {
    const outlineThreshold = isMobile ? 8 : 14;
    if (!currentMapId || storeNodes.length < outlineThreshold) {
      const smallMapKey = currentMapId ? `${currentMapId}:small:${isMobile ? "mobile" : "desktop"}:${storeNodes[0]?.id || "empty"}` : null;
      if (currentMapId && initializedLargeMapRef.current !== smallMapKey) {
        initializedLargeMapRef.current = smallMapKey;
        setViewMode("all");
        setFocusedNodeId(null);
      }
      return;
    }
    const childIds = new Set(storeEdges.filter((edge) => edge.relation === "contains").map((edge) => edge.targetId));
    const rootSignature = storeNodes.filter((node) => !childIds.has(node.id)).map((node) => node.id).sort().join(",");
    const largeMapKey = `${currentMapId}:large:${isMobile ? "mobile" : "desktop"}:${rootSignature}`;
    if (initializedLargeMapRef.current === largeMapKey) return;
    initializedLargeMapRef.current = largeMapKey;
    setDirection("horizontal");
    setFocusedNodeId(null);
    setCollapsedNodes(getOutlineCollapsedNodes(displayHierarchy.nodes, displayHierarchy.edges));
    setViewMode("outline");
    refitGraph();
  }, [currentMapId, storeNodes, storeEdges, displayHierarchy, isMobile, setCollapsedNodes, refitGraph]);

  const graph = useMemo(
    () => buildGraph(
      displayHierarchy.nodes, displayHierarchy.edges, highlightedNodeId, searchResults, direction, sv,
      collapsedNodes, focusedNodeId, showNodeDetails, isMobile, handleToggleBranch,
    ),
    [displayHierarchy, highlightedNodeId, searchResults, direction, sv, collapsedNodes, focusedNodeId, showNodeDetails, isMobile, handleToggleBranch],
  );

  const visibleStoredNodeCount = Math.max(0, graph.nodes.length - displayHierarchy.syntheticNodeCount);
  const hiddenNodeCount = Math.max(0, storeNodes.length - visibleStoredNodeCount);
  const relationCount = storeEdges.filter((edge) => edge.relation !== "contains").length;
  const citedNodeCount = storeNodes.filter((node) => (node.citations || []).length > 0).length;

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(graph.nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setFlowNodes(graph.nodes);
    setFlowEdges(graph.edges);
  }, [graph.nodes, graph.edges, setFlowNodes, setFlowEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setFlowEdges((eds) =>
        addEdge({ ...connection, type: "bezier", style: { stroke: "#ffffff24", strokeWidth: 1.8 } }, eds)
      );
    },
    [setFlowEdges]
  );

  // Node changes (position persistence, delete sync)
  const onNodesChangeHandler = useCallback(
    async (changes: NodeChange[]) => {
      onNodesChange(changes);
      for (const change of changes) {
        if ("id" in change && isDisplayOverviewNode(change.id)) continue;
        if (change.type === "remove") {
          try { await apiFetch("/api/knowledge?nodeId=" + change.id, { method: "DELETE" }); }
          catch (e) { console.error("Failed to delete node:", e); }
        } else if (change.type === "position" && change.position && !change.dragging) {
          apiFetch("/api/knowledge", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nodeId: change.id, positionX: change.position.x, positionY: change.position.y }),
          }).catch(console.error);
        }
      }
    },
    [onNodesChange]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        const selected = flowNodes.filter((n) => n.selected && !isDisplayOverviewNode(n.id));
        if (selected.length === 0) return;
        e.preventDefault();
        pushHistory();
        for (const node of selected) {
          removeNode(node.id);
          apiFetch("/api/knowledge?nodeId=" + node.id, { method: "DELETE" })
            .then((r) => r.json())
            .then((d) => {
              if (d.success) {
                apiFetch(`/api/knowledge?mapId=${currentMapId}`)
                  .then((r) => r.json())
                  .then((d) => { setStoreNodes(d.nodes); setStoreEdges(d.edges); })
                  .catch(console.error);
              }
            })
            .catch(console.error);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) { e.preventDefault(); redo(); }
      if (e.key === "?") { e.preventDefault(); setShowHelp(true); }
      if (e.key === "Escape") {
        if (editingNode) { setEditingNode(null); return; }
        if (focusedNodeId) {
          setFocusedNodeId(null);
          setViewMode("custom");
          refitGraph();
          return;
        }
        setShowSearch(false);
        setLocalSearch("");
        setSearchResults([]);
        setContextMenu(null);
        setShowHelp(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flowNodes, removeNode, currentMapId, setStoreNodes, setStoreEdges, setSearchResults, editingNode, focusedNodeId, refitGraph, pushHistory, undo, redo, setContextMenu, setShowHelp]);

  // Reload after edit/delete from context menu
  const reloadMap = useCallback(() => {
    apiFetch(`/api/knowledge?mapId=${currentMapId}`)
      .then((r) => r.json())
      .then((d) => { setStoreNodes(d.nodes); setStoreEdges(d.edges); })
      .catch(console.error);
  }, [currentMapId, setStoreNodes, setStoreEdges]);

  // Double-click to edit node
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Find the closest node element
      const nodeEl = target.closest('.react-flow__node');
      if (!nodeEl) return;
      // Don't open edit if clicking on handles
      if (target.closest('.react-flow__handle')) return;
      const nodeId = nodeEl.getAttribute('data-id');
      if (!nodeId) return;
      const node = storeNodes.find((n) => n.id === nodeId);
      if (node) setEditingNode({ id: nodeId, content: node.content, desc: node.desc || "" });
    };
    document.addEventListener("dblclick", handler);
    return () => document.removeEventListener("dblclick", handler);
  }, [storeNodes]);

  // Commit node edit
  const commitEdit = useCallback(async () => {
    if (!editingNode || !editingNode.content.trim()) {
      setEditingNode(null);
      return;
    }
    pushHistory();
    try {
      await apiFetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: editingNode.id, content: editingNode.content.trim(), desc: editingNode.desc.trim() }),
      });
      reloadMap();
    } catch (e) {
      console.error("Failed to update node:", e);
    }
    setEditingNode(null);
  }, [editingNode, reloadMap, pushHistory]);

  // Right-click context menu on nodes
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const nodeEl = (e.target as HTMLElement).closest('.react-flow__node');
      if (!nodeEl) return;
      const nodeId = nodeEl.getAttribute('data-id');
      if (!nodeId) return;
      if (isDisplayOverviewNode(nodeId)) return;
      e.preventDefault();
      setContextMenu({ nodeId, x: e.clientX, y: e.clientY });
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, [setContextMenu]);

  // Context menu: focus
  const handleCtxFocus = useCallback(() => {
    if (!contextMenu || !reactFlowInstance.current) return;
    const node = flowNodes.find((n) => n.id === contextMenu.nodeId);
    if (node) {
      reactFlowInstance.current.setCenter(node.position.x, node.position.y, { zoom: 1.5, duration: 300 });
    }
    setContextMenu(null);
  }, [contextMenu, flowNodes, setContextMenu]);

  // Context menu: isolate one branch so dense maps can be read without unrelated nodes.
  const handleCtxSubtreeFocus = useCallback(() => {
    if (!contextMenu) return;
    const nextCollapsed = new Set(collapsedNodes);
    nextCollapsed.delete(contextMenu.nodeId);
    setCollapsedNodes(nextCollapsed);
    setFocusedNodeId(contextMenu.nodeId);
    setDirection("horizontal");
    setViewMode("custom");
    setContextMenu(null);
    refitGraph();
  }, [contextMenu, collapsedNodes, setCollapsedNodes, setContextMenu, refitGraph]);

  // Context menu: edit
  const handleCtxEdit = useCallback(() => {
    if (!contextMenu) return;
    const node = storeNodes.find((n) => n.id === contextMenu.nodeId);
    if (node) setEditingNode({ id: node.id, content: node.content, desc: node.desc || "" });
    setContextMenu(null);
  }, [contextMenu, storeNodes, setContextMenu]);

  // Context menu: delete
  const handleCtxDelete = useCallback(() => {
    if (!contextMenu) return;
    pushHistory();
    removeNode(contextMenu.nodeId);
    apiFetch("/api/knowledge?nodeId=" + contextMenu.nodeId, { method: "DELETE" })
      .then((r) => r.json())
      .then((d) => { if (d.success) reloadMap(); })
      .catch(console.error);
    setContextMenu(null);
  }, [contextMenu, removeNode, reloadMap, pushHistory, setContextMenu]);

  // Export PNG
  const handleExportPng = useCallback(() => {
    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewportEl) return;
    import('html-to-image').then(({ toPng }) => {
      return toPng(viewportEl, {
        backgroundColor: '#09090b',
        pixelRatio: 2,
        width: viewportEl.scrollWidth,
        height: viewportEl.scrollHeight,
        style: {
          transform: 'none',
        },
      });
    }).then((dataUrl: string) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `mindgrow-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    }).catch((err: Error) => {
      console.error('Export PNG failed:', err);
    });
  }, []);

  // Export Markdown
  const handleExportMarkdown = useCallback(() => {
    const md = exportToMarkdown(storeNodes, storeEdges);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mindgrow-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [storeNodes, storeEdges]);

  // Export PDF
  const handleExportPdf = useCallback(() => {
    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewportEl) return;
    import('html-to-image').then(({ toPng }) => {
      return toPng(viewportEl, {
        backgroundColor: '#09090b',
        pixelRatio: 2,
        width: viewportEl.scrollWidth,
        height: viewportEl.scrollHeight,
        style: { transform: 'none' },
      });
    }).then((dataUrl: string) => {
      import('jspdf').then(({ default: jsPDF }) => {
        const imgW = viewportEl.scrollWidth;
        const imgH = viewportEl.scrollHeight;
        // A4 landscape: 297 x 210 mm
        const pdf = new jsPDF({ orientation: imgW > imgH ? 'l' : 'p', unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const usableW = pageW - margin * 2;
        const usableH = pageH - margin * 2;
        const scale = Math.min(usableW / imgW, usableH / imgH);
        const scaledW = imgW * scale;
        const scaledH = imgH * scale;
        pdf.addImage(dataUrl, 'PNG', margin, margin, scaledW, scaledH);
        pdf.save(`mindgrow-${new Date().toISOString().slice(0, 10)}.pdf`);
      });
    }).catch((err: Error) => {
      console.error('Export PDF failed:', err);
    });
  }, []);

  // Empty state
  if (storeNodes.length === 0) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-[var(--background)]" data-testid="knowledge-graph-workspace" data-graph-mode={currentMode}>
        <div className="text-center space-y-6 max-w-[360px] px-4">
          <div className="text-6xl animate-pulse">🌱</div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-1">{MODE_LIBRARY_CONFIG[currentMode].shortLabel}图谱还是一片空地</h2>
            <p className="text-sm text-[var(--muted-foreground)]">{currentMode === "knowledge" ? "在中间输入知识碎片，我来帮你整理" : currentMode === "article" ? "解析文章后，这里会立即生成论文知识图谱" : "生成会议纪要后，这里会立即生成会议知识图谱"}</p>
          </div>
          {currentMode === "knowledge" && <div className="space-y-2">
            <p className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider font-medium">或者试试这些话题</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTED_TOPICS.map((t) => (
                <button key={t} onClick={() => { const el = document.querySelector('textarea'); if (el) { (el as any).value = t; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); } }} className="text-xs text-[var(--muted-foreground)] bg-[var(--bg-hover)] hover:text-[var(--primary)] hover:bg-[var(--primary-subtle)] border border-[var(--border)] px-3 py-1.5 rounded-full transition-all cursor-pointer">{t}</button>
              ))}
            </div>
          </div>}
        </div>
      </div>
    );
  }

  const isVertical = direction === "vertical";
  const focusedNode = focusedNodeId ? storeNodes.find((node) => node.id === focusedNodeId) : null;

  return (
    <div className="flex-1 min-w-0 bg-[var(--background)] relative" data-testid="knowledge-graph-workspace" data-graph-mode={currentMode}>
      {/* Top toolbar */}
      <div className={`absolute z-50 flex gap-1.5 ${isMobile ? 'right-3 flex-col items-end' : 'left-3 right-3 flex-wrap'}`} style={{ top: isMobile ? "max(calc(env(safe-area-inset-top) + 12px), 32px)" : "12px" }}>
        {/* Mobile: toggle toolbar */}
        {isMobile && (
          <button
            onClick={() => setShowToolbar(!showToolbar)}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)] hover:text-[var(--foreground)] transition-all cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
            </svg>
          </button>
        )}

        {(!isMobile || showToolbar) && (
          <>
            <div className="rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2 text-xs font-semibold text-[var(--primary-hover)]">{MODE_LIBRARY_CONFIG[currentMode].emoji} {MODE_LIBRARY_CONFIG[currentMode].shortLabel}知识图谱</div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[10px] font-medium text-emerald-200" title="新增内容会成为节点；层级、关联与冲突关系会持续连接旧知识">
              🌱 生长中 · {storeNodes.length} 节点 · {storeEdges.length} 条连接{relationCount > 0 ? ` · ${relationCount} 条语义关系` : ""}{citedNodeCount > 0 ? ` · ${citedNodeCount} 个可追溯节点` : ""}
            </div>
            <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
              <button
                onClick={showOutline}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "outline" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                title="只显示主题和主要分支"
              >主干 {visibleStoredNodeCount}/{storeNodes.length}</button>
              <button
                onClick={showAllNodes}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "all" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                title="展开全部节点，可拖动画布浏览"
              >全部 {storeNodes.length}</button>
            </div>

            {focusedNode && (
              <button
                onClick={() => { setFocusedNodeId(null); setViewMode("custom"); refitGraph(); }}
                className="max-w-[190px] truncate rounded-xl border border-[#22d3a755] bg-[#22d3a715] px-3 py-2 text-xs font-medium text-[#7de8c9] transition-colors hover:bg-[#22d3a725] cursor-pointer"
                title={`返回全图：${focusedNode.content}`}
              >← 返回全图 · {focusedNode.content}</button>
            )}

            <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
              <button
                onClick={() => setDirection("vertical")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isVertical ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >↓ 纵向</button>
              <button
                onClick={() => setDirection("horizontal")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  !isVertical ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >→ 横向</button>
            </div>

            {!isMobile && (
              <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
                <button onClick={handleExportPng} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer" title="导出 PNG">📷 PNG</button>
                <button onClick={handleExportPdf} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer" title="导出 PDF">📄 PDF</button>
                <button onClick={handleExportMarkdown} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer" title="导出 Markdown">📝 MD</button>
              </div>
            )}

            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
                showSearch ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent" : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"
              }`}
              title="搜索 (Ctrl+F)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            </button>

            {!isMobile && (
              <button
                onClick={() => setShowSpacing(!showSpacing)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
                  showSpacing ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent" : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"
                }`}
                title="间距调节"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 3H3" /><path d="M21 12H3" /><path d="M21 21H3" />
                  <circle cx="9" cy="3" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="9" cy="21" r="2" fill="currentColor" />
                </svg>
              </button>
            )}

            <button
              onClick={() => setShowHelp(!showHelp)}
              className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)] hover:text-[var(--foreground)] transition-all cursor-pointer"
              title="快捷键 (?)"
            >
              <span className="text-xs font-mono font-bold">?</span>
            </button>

            {isMobile && (
              <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
                <button onClick={handleExportPng} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer">📷</button>
                <button onClick={handleExportPdf} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer">📄</button>
                <button onClick={handleExportMarkdown} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer">📝</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Spacing control */}
      {showSpacing && (
        <div className={`absolute top-12 z-50 animate-fade-in-up ${isMobile ? "right-3" : "left-3"}`}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 shadow-lg">
            <div className="text-[10px] text-[var(--muted-foreground)] mb-2">间距调节</div>
            <div className="flex gap-1">
              {(["compact", "normal", "wide"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSpacing(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    spacing === s
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {s === "compact" ? "紧凑" : s === "normal" ? "标准" : "宽松"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      {showSearch && (
        <div className="absolute top-12 left-3 z-50 animate-fade-in-up">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-2 shadow-lg min-w-[240px]">
            <input
              value={localSearch}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索节点..."
              className="w-full bg-[var(--background)] rounded-lg px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none border border-[var(--border)] focus:border-[var(--primary)]"
              autoFocus
            />
            {localSearch && (
              <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                {searchResults.length > 0 ? `找到 ${searchResults.length} 个匹配` : "未找到匹配"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[200] bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl py-1 min-w-[160px] animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={handleCtxFocus} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            定位此节点
          </button>
          <button onClick={handleCtxSubtreeFocus} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h6v6H4zM14 14h6v6h-6z" /><path d="M10 7h4a3 3 0 0 1 3 3v4" /></svg>
            聚焦此分支
          </button>
          <button onClick={handleCtxEdit} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            编辑内容
          </button>
          <button onClick={() => { if (contextMenu) { handleToggleBranch(contextMenu.nodeId); setContextMenu(null); } }} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            {contextMenu && collapsedNodes.has(contextMenu.nodeId) ? "展开子节点" : "折叠子节点"}
          </button>
          <div className="mx-2 my-1 border-t border-[var(--border)]" />
          <button onClick={handleCtxDelete} className="w-full px-3 py-2 text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            删除节点
          </button>
        </div>
      )}

      {/* Inline edit overlay */}
      {editingNode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 shadow-xl w-[min(92vw,480px)] animate-fade-in-up">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">编辑节点内容</h3>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted-foreground)]" htmlFor="node-title-editor">大标题</label>
            <input
              id="node-title-editor"
              ref={editInputRef}
              value={editingNode.content}
              onChange={(e) => {
                const content = e.target.value;
                setEditingNode((current) => current ? { ...current, content } : current);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitEdit();
                if (e.key === "Escape") setEditingNode(null);
              }}
              className="w-full bg-[var(--background)] rounded-xl px-4 py-2.5 text-sm text-[var(--foreground)] outline-none border border-[var(--border)] focus:border-[var(--primary)]"
            />
            <label className="mb-1.5 mt-4 block text-[11px] font-medium text-[var(--muted-foreground)]" htmlFor="node-description-editor">详细解释</label>
            <textarea
              id="node-description-editor"
              value={editingNode.desc}
              onChange={(e) => {
                const desc = e.target.value;
                setEditingNode((current) => current ? { ...current, desc } : current);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitEdit();
                if (e.key === "Escape") setEditingNode(null);
              }}
              rows={5}
              placeholder="补充定义、背景、边界、例子或来源说明…"
              className="w-full resize-y bg-[var(--background)] rounded-xl px-4 py-2.5 text-sm leading-6 text-[var(--foreground)] outline-none border border-[var(--border)] focus:border-[var(--primary)]"
            />
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">Ctrl / ⌘ + Enter 保存</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditingNode(null)} className="px-4 py-2 rounded-xl text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer">
                取消
              </button>
              <button onClick={commitEdit} className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity cursor-pointer">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      {hiddenNodeCount > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-3 z-40 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 px-3 py-2 text-[11px] text-[var(--muted-foreground)] shadow-lg backdrop-blur">
          当前显示 {visibleStoredNodeCount}/{storeNodes.length} 个节点 · 点击节点上的 ＋N 展开
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChangeHandler}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        fitView
        fitViewOptions={{ padding: isMobile ? 0.14 : 0.24, minZoom: isMobile ? 0.45 : 0.55, maxZoom: 1.05 }}
        minZoom={isMobile ? 0.15 : 0.2}
        maxZoom={2}
        onMoveEnd={(_, viewport) => setShowNodeDetails(viewport.zoom >= 0.72)}
        selectionOnDrag={false}
        panOnDrag={[0, 2]}
        panOnScroll={false}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ type: "default", style: { stroke: "#ffffff24", strokeWidth: 1.8 } }}
        proOptions={{ hideAttribution: true }}
        className={`!bg-[var(--background)] ${isMobile ? "!touch-none" : ""}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#151520" />
        <Controls
          className={`!bg-[var(--card)] !border !border-[var(--border)] !rounded-xl !shadow-lg !bottom-4 ${isMobile ? "!left-3 !right-auto" : "!left-auto !right-4"}`}
          showInteractive={false}
        />
        <MiniMap
          className={`mindgrow-minimap !bg-[var(--card)] !border !border-[var(--border)] !rounded-xl ${isMobile ? "!bottom-3 !right-3" : ""}`}
          style={isMobile ? { width: 126, height: 78 } : undefined}
          pannable
          zoomable
          nodeColor={(n) => {
            const type = n.data?.nodeType as string;
            const bi = n.data?.branchIndex as number;
            if (bi && bi > 0) return BRANCH_COLORS[bi % BRANCH_COLORS.length];
            const colorMap: Record<string, string> = {
              topic: "#22d3a7", concept: "#38bdf8", detail: "#818cf8", question: "#f472b6",
            };
            return colorMap[type] || "#818cf8";
          }}
          maskColor="rgba(10, 10, 15, 0.82)"
        />
      </ReactFlow>
    </div>
  );
}
