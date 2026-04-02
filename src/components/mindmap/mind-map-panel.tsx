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

// ============================================================
// Branch color palette
// ============================================================
const BRANCH_COLORS = [
  "#22d3a7", "#6366f1", "#06b6d4", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#ec4899", "#14b8a6",
];

// ============================================================
// Custom Node Component
// ============================================================
function MindGrowNode({ data, selected, id }: NodeProps) {
  const collapsed = useMindGrowStore((s) => s.collapsedNodes.has(id));
  const doToggle = useMindGrowStore((s) => s.toggleCollapse);
  const nodeType = data.nodeType as string;
  const source = data.source as string;
  const desc = data.nodeDesc as string;
  const highlighted = data.highlighted as boolean;
  const childCount = (data.childCount as number) || 0;
  const branchIndex = data.branchIndex as number || 0;
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
      className={`
        relative rounded-xl px-4 py-2.5 min-w-[100px] max-w-[240px]
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
        position={Position.Top}
        className="!bg-transparent !w-2 !h-2 !border-2 !border-[#22d3a7]"
      />
      <div className="text-[13px] font-medium leading-snug break-words">
        {data.label as string}
      </div>
      {desc && (
        <div className="text-[10px] leading-relaxed mt-0.5 opacity-50 line-clamp-2 break-words">
          {desc}
        </div>
      )}
      {(childCount > 0 || source === "ai_generated") && (
        <div className="flex items-center justify-center gap-1 mt-1">
          {source === "ai_generated" && (
            <span className="text-[9px] opacity-40 bg-[#22d3a720] text-[#22d3a7] px-1.5 py-0.5 rounded-full">
              AI
            </span>
          )}
          {childCount > 0 && (
            <span className="text-[10px] opacity-30">+{childCount}</span>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-transparent !w-2 !h-2 !border-2 !border-[#22d3a7]"
      />
    </div>
  );
}

const nodeTypes = { mindGrowNode: MindGrowNode };

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

  const treeSpacing = direction === "vertical" ? options.tree : 0;
  const treeHSpacing = direction === "horizontal" ? options.tree : 0;
  let offset = 0;
  for (const root of rootNodes) {
    const size = getSubtreeSize(root.id);
    if (direction === "vertical") {
      placeNode(root.id, offset, 0);
      offset += size.w + treeSpacing;
    } else {
      placeNode(root.id, 0, offset);
      offset += size.h + treeHSpacing;
    }
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
): { nodes: Node[]; edges: Edge[]; branchMap: Map<string, number> } {
  const childCountMap = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();

  for (const edge of dbEdges) {
    if (edge.relation === "contains") {
      childCountMap.set(edge.sourceId, (childCountMap.get(edge.sourceId) || 0) + 1);
      const list = childrenOf.get(edge.sourceId) || [];
      list.push(edge.targetId);
      childrenOf.set(edge.sourceId, list);
    }
  }

  const childSet = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation === "contains") childSet.add(edge.targetId);
  }
  const roots = dbNodes.filter((n) => !childSet.has(n.id));
  const branchMap = new Map<string, number>();
  let branchIdx = 0;

  for (const root of roots) {
    branchMap.set(root.id, branchIdx);
    branchIdx++;
    const kids = childrenOf.get(root.id) || [];
    for (const kid of kids) {
      branchMap.set(kid, branchIdx);
      branchIdx++;
    }
  }

  const positions = layoutTree(dbNodes, dbEdges, {
    direction, nodeWidth: 180, nodeHeight: 60, hGap: spacing.h, vGap: spacing.v, tree: spacing.tree,
  }, collapsed);

  // Collect all visible IDs (respecting collapse)
  const childrenOfAll = new Map<string, string[]>();
  const childSetAll = new Set<string>();
  for (const edge of dbEdges) {
    if (edge.relation === "contains") { childSetAll.add(edge.targetId); const l = childrenOfAll.get(edge.sourceId) || []; l.push(edge.targetId); childrenOfAll.set(edge.sourceId, l); }
  }
  const visibleIds = new Set<string>();
  function collectVisible(nid: string) { visibleIds.add(nid); if (collapsed.has(nid)) return; for (const c of childrenOfAll.get(nid) || []) collectVisible(c); }
  for (const root of roots) collectVisible(root.id);

  const nodes: Node[] = dbNodes.filter(n => visibleIds.has(n.id)).map((dbNode) => {
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
        branchIndex: branchMap.get(dbNode.id) || 0,
        collapsed: collapsed.has(dbNode.id),
      },
    };
  });

  const edges: Edge[] = dbEdges
    .filter(e => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId))
    .map((dbEdge) => {
    const isRelation = dbEdge.relation !== "contains";
    const bi = branchMap.get(dbEdge.sourceId);
    const edgeColor = bi !== undefined ? BRANCH_COLORS[bi % BRANCH_COLORS.length] : "#ffffff10";
    return {
      id: dbEdge.id,
      source: dbEdge.sourceId,
      target: dbEdge.targetId,
      type: "default",
      animated: isRelation,
      style: {
        stroke: isRelation ? "#f472b688" : `${edgeColor}44`,
        strokeWidth: 1.5,
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
    { keys: "Shift+拖拽", desc: "框选节点" },
    { keys: "右键拖拽", desc: "平移画布" },
    { keys: "滚轮", desc: "缩放" },
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
    toggleCollapse,
    pushHistory, undo, redo,
    showHelp, setShowHelp,
  } = useMindGrowStore();

  const [direction, setDirection] = useState<"vertical" | "horizontal">("vertical");
  const [spacing, setSpacing] = useState<"compact" | "normal" | "wide">("compact");
  const [showSearch, setShowSearch] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [editingNode, setEditingNode] = useState<{ id: string; content: string } | null>(null);
  const [showSpacing, setShowSpacing] = useState(false);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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

  const sv = useMemo(() => ({ compact: { h: 12, v: 22, tree: 80 }, normal: { h: 30, v: 40, tree: 150 }, wide: { h: 55, v: 70, tree: 300 } }[spacing]), [spacing]);

  const graph = useMemo(
    () => buildGraph(storeNodes, storeEdges, highlightedNodeId, searchResults, direction, sv, collapsedNodes),
    [storeNodes, storeEdges, highlightedNodeId, searchResults, direction, sv, collapsedNodes],
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(graph.nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setFlowNodes(graph.nodes);
    setFlowEdges(graph.edges);
  }, [graph.nodes, graph.edges, setFlowNodes, setFlowEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setFlowEdges((eds) =>
        addEdge({ ...connection, type: "smoothstep", style: { stroke: "#ffffff10" } }, eds)
      );
    },
    [setFlowEdges]
  );

  // Node changes (position persistence, delete sync)
  const onNodesChangeHandler = useCallback(
    async (changes: NodeChange[]) => {
      onNodesChange(changes);
      for (const change of changes) {
        if (change.type === "remove") {
          try { await fetch("/api/knowledge?nodeId=" + change.id, { method: "DELETE" }); }
          catch (e) { console.error("Failed to delete node:", e); }
        } else if (change.type === "position" && change.position && !change.dragging) {
          fetch("/api/knowledge", {
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
        const selected = flowNodes.filter((n) => n.selected);
        if (selected.length === 0) return;
        e.preventDefault();
        pushHistory();
        for (const node of selected) {
          removeNode(node.id);
          fetch("/api/knowledge?nodeId=" + node.id, { method: "DELETE" })
            .then((r) => r.json())
            .then((d) => {
              if (d.success) {
                fetch(`/api/knowledge?mapId=${currentMapId}`)
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
        setShowSearch(false);
        setLocalSearch("");
        setSearchResults([]);
        setContextMenu(null);
        setShowHelp(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flowNodes, removeNode, currentMapId, setStoreNodes, setStoreEdges, setSearchResults, editingNode, pushHistory, undo, redo, setContextMenu]);

  // Reload after edit/delete from context menu
  const reloadMap = useCallback(() => {
    fetch(`/api/knowledge?mapId=${currentMapId}`)
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
      if (node) setEditingNode({ id: nodeId, content: node.content });
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
      await fetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: editingNode.id, content: editingNode.content.trim() }),
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

  // Context menu: edit
  const handleCtxEdit = useCallback(() => {
    if (!contextMenu) return;
    const node = storeNodes.find((n) => n.id === contextMenu.nodeId);
    if (node) setEditingNode({ id: node.id, content: node.content });
    setContextMenu(null);
  }, [contextMenu, storeNodes]);

  // Context menu: delete
  const handleCtxDelete = useCallback(() => {
    if (!contextMenu) return;
    pushHistory();
    removeNode(contextMenu.nodeId);
    fetch("/api/knowledge?nodeId=" + contextMenu.nodeId, { method: "DELETE" })
      .then((r) => r.json())
      .then((d) => { if (d.success) reloadMap(); })
      .catch(console.error);
    setContextMenu(null);
  }, [contextMenu, removeNode, reloadMap, pushHistory, setContextMenu]);

  // Export PNG
  const handleExportPng = useCallback(() => {
    const svgEl = document.querySelector('.react-flow__viewport');
    if (!svgEl) return;
    const canvas = document.createElement("canvas");
    const rect = svgEl.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, rect.width, rect.height);
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `mindgrow-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.src = url;
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

  // Empty state
  if (storeNodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--background)]">
        <div className="text-center space-y-6 max-w-[360px]">
          <div className="text-6xl animate-pulse">🌱</div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-1">知识树还是一片空地</h2>
            <p className="text-sm text-[var(--muted-foreground)]">在左侧输入知识碎片，我来帮你整理</p>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider font-medium">或者试试这些话题</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTED_TOPICS.map((t) => (
                <button key={t} onClick={() => { const el = document.querySelector('textarea'); if (el) { (el as any).value = t; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); } }} className="text-xs text-[var(--muted-foreground)] bg-[var(--bg-hover)] hover:text-[var(--primary)] hover:bg-[var(--primary-subtle)] border border-[var(--border)] px-3 py-1.5 rounded-full transition-all cursor-pointer">{t}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isVertical = direction === "vertical";

  return (
    <div className="flex-1 bg-[var(--background)] relative">
      {/* Top toolbar */}
      <div className="absolute top-3 left-3 z-50 flex gap-1.5">
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

        <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
          <button onClick={handleExportPng} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer" title="导出 PNG">📷 PNG</button>
          <button onClick={handleExportMarkdown} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all cursor-pointer" title="导出 Markdown">📝 MD</button>
        </div>

        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
            showSearch ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent" : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"
          }`}
          title="搜索 (Ctrl+F)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </button>

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

        <button
          onClick={() => setShowHelp(true)}
          className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)] hover:text-[var(--foreground)] transition-all cursor-pointer"
          title="快捷键 (?)"
        >
          <span className="text-xs font-mono font-bold">?</span>
        </button>
      </div>

      {/* Spacing control */}
      {showSpacing && (
        <div className="absolute top-12 left-3 z-50 animate-fade-in-up">
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
          <button onClick={handleCtxEdit} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            编辑内容
          </button>
          <button onClick={() => { if (contextMenu) { toggleCollapse(contextMenu.nodeId); setContextMenu(null); } }} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
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
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 shadow-xl min-w-[320px] animate-fade-in-up">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">编辑节点</h3>
            <input
              ref={editInputRef}
              value={editingNode.content}
              onChange={(e) => setEditingNode({ ...editingNode, content: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditingNode(null);
              }}
              className="w-full bg-[var(--background)] rounded-xl px-4 py-2.5 text-sm text-[var(--foreground)] outline-none border border-[var(--border)] focus:border-[var(--primary)]"
            />
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

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChangeHandler}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
        selectionKeyCode="Shift"
        selectNodesOnDrag={true}
        panOnDrag={[2]}
        defaultEdgeOptions={{ type: "default", style: { stroke: "#ffffff10" } }}
        proOptions={{ hideAttribution: true }}
        className="!bg-[var(--background)]"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#151520" />
        <Controls
          className="!bg-[var(--card)] !border !border-[var(--border)] !rounded-xl !shadow-lg !bottom-4 !left-auto !right-4"
          showInteractive={false}
        />
        <MiniMap
          className="!bg-[var(--card)] !border !border-[var(--border)] !rounded-xl"
          nodeColor={(n) => {
            const type = n.data?.nodeType as string;
            const bi = n.data?.branchIndex as number;
            if (bi && bi > 0) return BRANCH_COLORS[bi % BRANCH_COLORS.length];
            const colorMap: Record<string, string> = {
              topic: "#22d3a7", concept: "#38bdf8", detail: "#818cf8", question: "#f472b6",
            };
            return colorMap[type] || "#818cf8";
          }}
          maskColor="rgba(10, 10, 15, 0.85)"
        />
      </ReactFlow>
    </div>
  );
}
