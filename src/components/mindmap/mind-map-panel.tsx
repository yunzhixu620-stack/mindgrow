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
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { useAuth } from "@/components/auth/auth-provider";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { EntityGraph, GraphEntity, KnowledgeNode, KnowledgeEdge, NodeContext, NodeLayout, WhiteboardGroup } from "@/types";
import { apiFetch, IS_LOCAL_MODE } from "@/lib/client-api";
import type { GraphSnapshot, TenantScope } from "@/lib/tenant-cache";
import { MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";
import { entityGraphToKnowledgeGraph, entityViewNodeId, formalEntityGraph, isEntityViewNode } from "@/lib/entity-graph";
import { MindMapSkeleton } from "@/components/mindmap/mind-map-skeleton";
import { shouldInitializeLargeMapOutline, type MindMapViewMode } from "@/components/mindmap/outline-initialization";
import { EntityDetailPanel } from "@/components/entity/entity-detail-panel";
import { NodeContextPanel } from "@/components/node/node-context-panel";
import { graphEdgeFocusOpacity, graphNodeFocusOpacity, oneHopNodeIds } from "@/lib/graph-hover";
import { COMMAND_ENTITY_FOCUS_EVENT } from "@/lib/command-search";
import { buildLocalNodeContext } from "@/lib/node-context";
import { searchEntityNetwork, selectEntityNetwork, type EntityNetworkMode } from "@/lib/entity-network";
import {
  buildWhiteboardCardGeometry,
  isWhiteboardGroupNode,
  whiteboardDetailLevel,
  whiteboardDropGeometry,
  whiteboardGroupHeight,
  whiteboardGroupIdFromNodeId,
  whiteboardGroupNodeId,
  WHITEBOARD_CARD_HEIGHT,
  WHITEBOARD_CARD_WIDTH,
  WHITEBOARD_LARGE_MAP_THRESHOLD,
} from "@/components/mindmap/whiteboard-layout";
import { WhiteboardGroupNode, type WhiteboardGroupNodeData } from "@/components/mindmap/whiteboard-group-node";
import {
  buildDisplayHierarchy,
  getOutlineCollapsedNodes,
  isDisplayOverviewNode,
  progressiveCollapseState,
  visibleHierarchyNodeIds,
} from "@/components/mindmap/progressive-outline";

// ============================================================
// Branch color palette
// ============================================================
const BRANCH_COLORS = [
  "#22d3a7", "#6366f1", "#06b6d4", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#ec4899", "#14b8a6",
];

const LOCAL_TENANT_SCOPE: TenantScope = { userId: "local-user", workspaceId: "local-workspace" };
const WHITEBOARD_GROUP_COLORS = ["#22d3a7", "#38bdf8", "#818cf8", "#a78bfa", "#f59e0b", "#f472b6"];

type WhiteboardGroupEditor = {
  mode: "create" | "rename";
  groupId: string | null;
  name: string;
  color: string;
  positionX: number;
  positionY: number;
};

type WhiteboardGroupDragSnapshot = {
  group: WhiteboardGroup;
  memberPositions: Map<string, { x: number; y: number }>;
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "人物", organization: "组织", model: "模型", method: "方法",
  dataset: "数据集", metric: "指标", task: "任务", event: "事件",
  decision: "决策", time: "时间", concept: "概念", claim: "声明", other: "实体",
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "#f59e0b", organization: "#f97316", model: "#38bdf8", method: "#22d3a7",
  dataset: "#a78bfa", metric: "#818cf8", task: "#06b6d4", event: "#fb7185",
  decision: "#f472b6", time: "#94a3b8", concept: "#60a5fa", claim: "#e879f9", other: "#64748b",
};

const RELATION_STATUS_LABELS: Record<NonNullable<KnowledgeEdge["relationStatus"]>, string> = {
  asserted: "已确认",
  historical: "历史",
  negated: "否定",
  proposed: "待确认",
};

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
  const whiteboard = data.whiteboard as boolean;
  const whiteboardGroupId = String(data.whiteboardGroupId || "");
  const whiteboardDetail = selected
    ? "full"
    : String(data.whiteboardDetailLevel || "full");
  const showDescription = showDetails && (!whiteboard || whiteboardDetail !== "title");
  const showCitations = showDetails && (!whiteboard || whiteboardDetail === "full");
  const isOverview = isDisplayOverviewNode(data.nodeId as string);
  const borderColor = branchIndex > 0
    ? BRANCH_COLORS[branchIndex % BRANCH_COLORS.length]
    : (highlighted ? "#22d3a7" : undefined);

  const colorMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    topic: { bg: "var(--node-topic-bg)", border: "#22d3a7", text: "var(--node-topic-text)", glow: "rgba(34,211,167,0.15)" },
    concept: { bg: "var(--node-concept-bg)", border: "#38bdf8", text: "var(--node-concept-text)", glow: "rgba(56,189,248,0.15)" },
    detail: { bg: "var(--node-detail-bg)", border: "#818cf8", text: "var(--node-detail-text)", glow: "rgba(129,140,248,0.15)" },
    question: { bg: "var(--node-question-bg)", border: "#f472b6", text: "var(--node-question-text)", glow: "rgba(244,114,182,0.15)" },
  };

  const colors = colorMap[nodeType] || colorMap.concept;
  const finalBorder = borderColor || colors.border;

  return (
    <div
      data-display-overview={isOverview ? "true" : undefined}
      data-whiteboard-card={whiteboard ? "true" : undefined}
      data-whiteboard-persisted={whiteboard ? String(Boolean(data.whiteboardPersisted)) : undefined}
      data-whiteboard-detail-level={whiteboard ? whiteboardDetail : undefined}
      className={`
        group relative rounded-xl ${whiteboard ? "h-full w-full min-w-0 max-w-none overflow-hidden px-4 py-3" : compact ? "min-w-[150px] max-w-[190px] px-3 py-2" : "min-w-[170px] max-w-[230px] px-3.5 py-3"}
        text-left transition-all duration-200 cursor-grab active:cursor-grabbing
        ${selected ? "ring-2 ring-offset-1 ring-offset-[var(--selection-ring-offset)]" : ""}
        ${highlighted ? "animate-pulse ring-2 ring-[#22d3a7] ring-offset-1 ring-offset-[var(--selection-ring-offset)]" : ""}
      `}
      style={{
        backgroundColor: colors.bg,
        border: `1.5px solid ${highlighted ? "#22d3a7" : selected ? finalBorder : `${finalBorder}88`}`,
        color: colors.text,
        boxShadow: highlighted || selected ? `0 0 20px ${colors.glow}` : undefined,
      }}
    >
      {whiteboard && whiteboardGroupId && (
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            (data.onLeaveWhiteboardGroup as ((nodeId: string) => void) | undefined)?.(data.nodeId as string);
          }}
          className="nodrag nopan absolute right-2 top-2 z-10 rounded-md border border-[var(--border-default)] bg-[var(--card)]/90 px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)] shadow-sm transition-colors hover:text-[var(--foreground)]"
          aria-label={`移出分组 ${data.label as string}`}
          data-testid="leave-whiteboard-group"
          title="移到当前分组旁边，知识内容不会改变"
        >移出</button>
      )}
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="!bg-transparent !w-2 !h-2 !border-2 !border-[#22d3a7]"
      />
      <div className="line-clamp-2 text-[13px] font-semibold leading-snug break-words" title={data.label as string}>
        {data.label as string}
      </div>
      {showDescription && desc && (
        <div className="mt-1 line-clamp-3 break-words text-[10px] leading-relaxed opacity-65">
          {desc}
        </div>
      )}
      {showCitations && citations && citations.length > 0 && (
        <div className="mt-1.5 flex flex-wrap justify-start gap-1" aria-label="节点引用">
          {citations.slice(0, 4).map((citation) => (
            <span key={`${citation.documentId || "source"}-${citation.index}`} title={`${citation.locator || "原文"}：${citation.quote}`} className="rounded bg-[#22d3a720] px-1.5 py-0.5 text-[9px] font-semibold text-[#7de8c9]">[{citation.index}]</span>
          ))}
          {citations.length > 4 && <span className="text-[9px] opacity-50">+{citations.length - 4}</span>}
        </div>
      )}
      {(childCount > 0 || source === "ai_generated") && (
        <div className="mt-1.5 flex min-h-5 items-center justify-between gap-1">
          <div>{source === "ai_generated" && (
            <span className="text-[9px] opacity-40 bg-[#22d3a720] text-[#22d3a7] px-1.5 py-0.5 rounded-full">
              AI
            </span>
          )}</div>
          {childCount > 0 && <div className="flex items-center gap-1">
            {!isOverview && <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); (data.onFocusBranch as ((id: string) => void) | undefined)?.(data.nodeId as string); }}
              className="nodrag rounded-full border border-[var(--border-default)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)] transition-colors hover:border-[#22d3a755] hover:text-[var(--primary-hover)]"
              aria-label={`聚焦分支 ${data.label as string}`}
              title="只看此分支，减少无关节点干扰"
            >◎</button>}
            <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); (data.onToggleCollapse as ((id: string) => void) | undefined)?.(data.nodeId as string); }}
            className={`nodrag rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-colors ${collapsed ? "border-[#22d3a755] bg-[#22d3a722] text-[var(--primary-hover)]" : "border-[var(--border-default)] bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
            aria-label={collapsed ? `展开下一层 ${childCount} 个直接子节点` : `收起当前分支 ${descendantCount} 个后代节点`}
            title={collapsed ? `仅展开下一层：${childCount} 个直接子节点；分支共 ${descendantCount} 个后代节点` : `收起当前分支的 ${descendantCount} 个后代节点`}
          >{collapsed ? `＋${childCount}` : `−${childCount}`}</button>
          </div>}
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

function EntityNode({ data, selected }: NodeProps) {
  const entity = data.entity as GraphEntity;
  const color = ENTITY_TYPE_COLORS[entity.entityType] || ENTITY_TYPE_COLORS.other;
  const neighborCount = data.neighborCount as number;
  const hovered = Boolean(data.hovered);
  const descriptionCitation = (entity.descriptionCitations || [])[0];
  return (
    <div
      className={`group relative flex h-[86px] w-[86px] cursor-pointer items-center justify-center rounded-full border text-center transition-all duration-200 ${selected ? "scale-110" : "hover:scale-105"}`}
      style={{
        color: "var(--entity-node-text)",
        borderColor: selected ? color : `${color}aa`,
        background: `radial-gradient(circle at 35% 30%, ${color}38, var(--entity-node-bg) 72%)`,
        boxShadow: selected ? `0 0 28px ${color}55` : `0 0 12px ${color}18`,
      }}
      data-testid="entity-network-node"
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
      <div className="px-2">
        <div className="line-clamp-2 break-words text-[11px] font-semibold leading-tight">{entity.canonicalName}</div>
        <div className="mt-1 text-[8px]" style={{ color }}>{ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}</div>
      </div>
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-base)] px-1 text-[8px] text-[var(--text-tertiary)]">{neighborCount}</span>
      <div className={`pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[120] w-72 -translate-y-1/2 rounded-2xl border border-violet-400/30 bg-[var(--tooltip-bg)] p-4 text-left shadow-2xl backdrop-blur-xl ${hovered ? "block" : "hidden group-hover:block"}`} data-testid="entity-hover-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">{entity.canonicalName}</div>
            <div className="mt-1 text-[10px] font-medium" style={{ color }}>{ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}</div>
          </div>
          <div className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[9px] text-[var(--text-tertiary)]">{Math.round(entity.confidence * 100)}%</div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[var(--text-secondary)]">{entity.description || "当前来源只识别到实体名称，尚未提供明确概念解释。"}</p>
        {entity.aliases.length > 0 && <p className="mt-2 text-[10px] text-[var(--text-muted)]">别名：{entity.aliases.join("、")}</p>}
        <div className="mt-3 border-t border-[var(--border-default)] pt-2 text-[10px] text-violet-500">{neighborCount} 个直接关系 · {entity.citations.length} 条原文引用</div>
        {descriptionCitation && <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-[var(--text-tertiary)]">[{descriptionCitation.index}] {descriptionCitation.locator || "原文"}：{descriptionCitation.quote}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
    </div>
  );
}

const nodeTypes = { mindGrowNode: MindGrowNode, entityNode: EntityNode, whiteboardGroup: WhiteboardGroupNode };

function entityForcePositions(entityIds: string[], relations: EntityGraph["relations"]) {
  const positions = new Map<string, { x: number; y: number }>();
  const count = Math.max(1, entityIds.length);
  const radius = Math.max(220, Math.min(620, count * 24));
  entityIds.forEach((id, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  for (let iteration = 0; iteration < 110; iteration += 1) {
    const movement = new Map(entityIds.map((id) => [id, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < entityIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entityIds.length; rightIndex += 1) {
        const leftId = entityIds[leftIndex];
        const rightId = entityIds[rightIndex];
        const left = positions.get(leftId)!;
        const right = positions.get(rightId)!;
        const dx = left.x - right.x || 0.1;
        const dy = left.y - right.y || 0.1;
        const distanceSquared = Math.max(2500, dx * dx + dy * dy);
        const force = 14500 / distanceSquared;
        const distance = Math.sqrt(distanceSquared);
        movement.get(leftId)!.x += (dx / distance) * force;
        movement.get(leftId)!.y += (dy / distance) * force;
        movement.get(rightId)!.x -= (dx / distance) * force;
        movement.get(rightId)!.y -= (dy / distance) * force;
      }
    }
    relations.forEach((relation) => {
      const source = positions.get(relation.sourceId);
      const target = positions.get(relation.targetId);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (distance - 210) * 0.0028;
      movement.get(relation.sourceId)!.x += (dx / distance) * force;
      movement.get(relation.sourceId)!.y += (dy / distance) * force;
      movement.get(relation.targetId)!.x -= (dx / distance) * force;
      movement.get(relation.targetId)!.y -= (dy / distance) * force;
    });
    entityIds.forEach((id) => {
      const position = positions.get(id)!;
      const delta = movement.get(id)!;
      position.x = (position.x + delta.x) * 0.994;
      position.y = (position.y + delta.y) * 0.994;
    });
  }
  return positions;
}

function buildEntityNetworkGraph(
  entityGraph: EntityGraph,
  mode: EntityNetworkMode,
  selectedEntityId: string | null,
  hoveredEntityId: string | null,
  hoveredRelationId: string | null,
  entityTypes: string[],
  showIsolated: boolean,
): { nodes: Node[]; edges: Edge[]; branchMap: Map<string, number> } {
  const selectedRawId = entityGraph.entities.find((entity) => entityViewNodeId(entity.id) === selectedEntityId)?.id || null;
  const selectedGraph = selectEntityNetwork(entityGraph, {
    mode,
    selectedEntityId: selectedRawId,
    entityTypes,
    showIsolated,
  });
  let relations = selectedGraph.relations;
  const entities = selectedGraph.entities;
  const visibleIds = new Set(entities.map((entity) => entity.id));
  relations = relations.filter((relation) => visibleIds.has(relation.sourceId) && visibleIds.has(relation.targetId));
  const positions = entityForcePositions(entities.map((entity) => entity.id), relations);
  if (mode === "local" && selectedRawId && positions.has(selectedRawId)) positions.set(selectedRawId, { x: 0, y: 0 });
  const neighbors = new Map<string, Set<string>>();
  relations.forEach((relation) => {
    const source = neighbors.get(relation.sourceId) || new Set<string>(); source.add(relation.targetId); neighbors.set(relation.sourceId, source);
    const target = neighbors.get(relation.targetId) || new Set<string>(); target.add(relation.sourceId); neighbors.set(relation.targetId, target);
  });
  const hoveredRawId = entityGraph.entities.find((entity) => entityViewNodeId(entity.id) === hoveredEntityId)?.id || null;
  const nodes: Node[] = entities.map((entity) => {
    const position = positions.get(entity.id) || { x: 0, y: 0 };
    return {
      id: entityViewNodeId(entity.id),
      type: "entityNode",
      position: { x: position.x - 43, y: position.y - 43 },
      selected: entityViewNodeId(entity.id) === selectedEntityId,
      data: {
        entity,
        neighborCount: neighbors.get(entity.id)?.size || 0,
        hovered: entityViewNodeId(entity.id) === hoveredEntityId,
      },
    };
  });
  const edges: Edge[] = relations.map((relation) => {
    const edgeId = entityViewNodeId(relation.id);
    const active = hoveredRelationId === edgeId || selectedEntityId === entityViewNodeId(relation.sourceId) || selectedEntityId === entityViewNodeId(relation.targetId) || hoveredRawId === relation.sourceId || hoveredRawId === relation.targetId;
    return {
      id: edgeId,
      source: entityViewNodeId(relation.sourceId),
      target: entityViewNodeId(relation.targetId),
      type: "default",
      label: active ? relation.label : undefined,
      labelStyle: active ? { fill: "var(--canvas-label-accent)", fontSize: 9, fontWeight: 600 } : undefined,
      labelBgStyle: active ? { fill: "var(--canvas-label-bg)", fillOpacity: 0.94 } : undefined,
      labelBgPadding: active ? [5, 3] as [number, number] : undefined,
      labelBgBorderRadius: active ? 6 : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: relation.status === "negated" ? "#ef4444" : "#a78bfa" },
      style: {
        stroke: relation.status === "negated" ? "#ef4444" : active ? "#c4b5fd" : "#8b5cf6",
        strokeWidth: active ? 1.8 : 0.9,
        strokeDasharray: relation.status === "proposed" ? "5 5" : undefined,
        opacity: active ? 0.95 : 0.32,
      },
    };
  });
  return { nodes, edges, branchMap: new Map<string, number>() };
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
  onFocusBranch: (nodeId: string) => void,
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
    direction, nodeWidth: compact ? 200 : 240, nodeHeight: compact ? 72 : 88, hGap: spacing.h, vGap: spacing.v, tree: spacing.tree,
  }, collapsed);

  // Collect all visible IDs (respecting collapse)
  const childrenOfAll = new Map<string, string[]>();
  for (const edge of scopedEdges) {
    if (edge.relation === "contains") { const l = childrenOfAll.get(edge.sourceId) || []; l.push(edge.targetId); childrenOfAll.set(edge.sourceId, l); }
  }
  const visibleIds = visibleHierarchyNodeIds(scopedNodes, scopedEdges, collapsed);

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
        onFocusBranch,
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
    const edgeColor = bi !== undefined ? BRANCH_COLORS[bi % BRANCH_COLORS.length] : "var(--canvas-edge-muted)";
    return {
      id: dbEdge.id,
      source: dbEdge.sourceId,
      target: dbEdge.targetId,
      // One continuous cubic curve is easier to follow than multi-turn elbows.
      type: "default",
      animated: isRelation,
      label: isRelation ? (dbEdge.relationLabel || (isContradiction ? "观点冲突" : "概念关联")) : undefined,
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
    { keys: "点击 +N", desc: "逐层展开/折叠" },
    { keys: "点击 ◎", desc: "聚焦单个分支" },
    { keys: "G", desc: "白板新建空间分组" },
    { keys: "0", desc: "白板适配全部内容" },
    { keys: "左键拖拽", desc: "平移画布" },
    { keys: "Shift+拖拽", desc: "框选节点" },
    { keys: "滚轮", desc: "缩放" },
    { keys: "右键拖拽", desc: "平移画布(备选)" },
  ];
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--overlay-bg)] backdrop-blur-sm" onClick={onClose}>
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
export function MindMapPanel({ showSkeleton = false }: { showSkeleton?: boolean }) {
  const { user, currentWorkspace } = useAuth();
  const tenantScope = useMemo<TenantScope | null>(() => {
    if (IS_LOCAL_MODE) return LOCAL_TENANT_SCOPE;
    return user?.id && currentWorkspace?.id
      ? { userId: user.id, workspaceId: currentWorkspace.id }
      : null;
  }, [currentWorkspace?.id, user?.id]);
  const {
    nodes: storeNodes,
    edges: storeEdges,
    entityGraph,
    maps,
    layouts,
    whiteboardGroups,
    highlightedNodeId,
    removeNode,
    setNodes: setStoreNodes,
    setEdges: setStoreEdges,
    setMaps,
    currentMapId,
    searchResults,
    setSearchResults,
    contextMenu, setContextMenu,
    collapsedNodes,
    setCollapsedNodes,
    pushHistory, undo, redo,
    showHelp, setShowHelp,
    currentMode,
    mutateGraphLocally,
    rollbackGraphLocally,
  } = useMindGrowStore();

  const [direction, setDirection] = useState<"vertical" | "horizontal">("vertical");
  const [spacing, setSpacing] = useState<"compact" | "normal" | "wide">("compact");
  const [showSearch, setShowSearch] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [editingNode, setEditingNode] = useState<{ id: string; mapId: string; content: string; desc: string } | null>(null);
  const [showSpacing, setShowSpacing] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState<MindMapViewMode>("all");
  const [graphLayer, setGraphLayer] = useState<"concept" | "entity">("concept");
  const [entityViewMode, setEntityViewMode] = useState<EntityNetworkMode>("global");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
  const [entitySearch, setEntitySearch] = useState("");
  const [entityTypeFilters, setEntityTypeFilters] = useState<string[]>([]);
  const [showIsolatedEntities, setShowIsolatedEntities] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [autoShowNodeDetails, setAutoShowNodeDetails] = useState(true);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [detailMode, setDetailMode] = useState<"auto" | "title" | "card">("auto");
  const [contextNode, setContextNode] = useState<KnowledgeNode | null>(null);
  const [nodeContext, setNodeContext] = useState<NodeContext | null>(null);
  const [nodeContextLoading, setNodeContextLoading] = useState(false);
  const [nodeContextError, setNodeContextError] = useState("");
  const [canvasViewError, setCanvasViewError] = useState("");
  const [groupEditor, setGroupEditor] = useState<WhiteboardGroupEditor | null>(null);
  const [groupDeleteId, setGroupDeleteId] = useState<string | null>(null);
  const [groupBusyId, setGroupBusyId] = useState<string | null>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const initializedLargeMapRef = useRef<string | null>(null);
  const selectedEntityIdRef = useRef<string | null>(null);
  const commandEntityFocusGenerationRef = useRef(0);
  const whiteboardFocusKeyRef = useRef("");
  const whiteboardGroupDragRef = useRef<WhiteboardGroupDragSnapshot | null>(null);
  const refitTimerRef = useRef<number | null>(null);
  selectedEntityIdRef.current = selectedEntityId;

  // Detect mobile
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setDirection("horizontal");
        setAutoShowNodeDetails(false);
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

  useEffect(() => {
    setContextNode(null);
    setNodeContext(null);
    setNodeContextLoading(false);
    setNodeContextError("");
    setCanvasViewError("");
    setGroupEditor(null);
    setGroupDeleteId(null);
    setGroupBusyId(null);
    whiteboardGroupDragRef.current = null;
  }, [currentMapId]);

  const officialEntityGraph = useMemo(() => formalEntityGraph(entityGraph), [entityGraph]);
  const entityDisplayGraph = useMemo(() => entityGraphToKnowledgeGraph(officialEntityGraph), [officialEntityGraph]);
  const availableEntityTypes = useMemo(() => Array.from(new Set(officialEntityGraph.entities.map((entity) => entity.entityType)))
    .sort((left, right) => (ENTITY_TYPE_LABELS[left] || left).localeCompare(ENTITY_TYPE_LABELS[right] || right, "zh-CN")), [officialEntityGraph.entities]);
  const entitySearchResults = useMemo(() => searchEntityNetwork(officialEntityGraph.entities, entitySearch), [officialEntityGraph.entities, entitySearch]);
  const currentMap = maps.find((map) => map.id === currentMapId);
  const canvasView = currentMap?.canvasView || "mindmap";
  const showingEntityGraph = graphLayer === "entity" && entityDisplayGraph.nodes.length > 0;
  const isWhiteboard = !showingEntityGraph && canvasView === "whiteboard";
  const activeWhiteboardGroups = useMemo(
    () => whiteboardGroups
      .filter((group) => group.mapId === currentMapId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)),
    [currentMapId, whiteboardGroups],
  );
  const activeNodes = showingEntityGraph ? entityDisplayGraph.nodes : storeNodes;
  const activeEdges = showingEntityGraph ? entityDisplayGraph.edges : storeEdges;
  const largeWhiteboard = isWhiteboard && activeNodes.length >= WHITEBOARD_LARGE_MAP_THRESHOLD;
  const whiteboardDisclosure = whiteboardDetailLevel(activeNodes.length, canvasZoom, isMobile);

  useEffect(() => {
    const handleCommandEntityFocus = (event: Event) => {
      const entityId = (event as CustomEvent<{ entityId?: string }>).detail?.entityId;
      if (!entityId || !officialEntityGraph.entities.some((entity) => entity.id === entityId)) return;
      const generation = commandEntityFocusGenerationRef.current + 1;
      commandEntityFocusGenerationRef.current = generation;
      setGraphLayer("entity");
      setSelectedRelationId(null);
      window.requestAnimationFrame(() => {
        if (generation !== commandEntityFocusGenerationRef.current) return;
        setEntityViewMode("local");
        setSelectedEntityId(entityViewNodeId(entityId));
      });
    };
    window.addEventListener(COMMAND_ENTITY_FOCUS_EVENT, handleCommandEntityFocus);
    return () => window.removeEventListener(COMMAND_ENTITY_FOCUS_EVENT, handleCommandEntityFocus);
  }, [officialEntityGraph.entities]);

  useEffect(() => {
    if (graphLayer === "entity" && entityDisplayGraph.nodes.length === 0) setGraphLayer("concept");
    if (graphLayer === "concept" && storeNodes.length === 0 && entityDisplayGraph.nodes.length > 0) setGraphLayer("entity");
    setSelectedRelationId(null);
    setSelectedEntityId(null);
    setHoveredEntityId(null);
    setHoveredRelationId(null);
    setEntitySearch("");
    setEntityTypeFilters([]);
    setShowIsolatedEntities(false);
  }, [currentMapId, entityDisplayGraph.nodes.length, graphLayer, storeNodes.length]);

  // Search handler
  const handleSearch = useCallback((query: string) => {
    setLocalSearch(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const q = query.toLowerCase();
    setSearchResults(activeNodes.filter((n) => n.content.toLowerCase().includes(q)).map((n) => n.id));
  }, [activeNodes, setSearchResults]);

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
    () => showingEntityGraph
      ? { nodes: activeNodes, edges: activeEdges, syntheticNodeCount: 0 }
      : buildDisplayHierarchy(activeNodes, activeEdges, currentMapId, overviewLabel),
    [activeNodes, activeEdges, currentMapId, overviewLabel, showingEntityGraph],
  );

  const refitGraph = useCallback(() => {
    if (refitTimerRef.current !== null) window.clearTimeout(refitTimerRef.current);
    refitTimerRef.current = window.setTimeout(() => {
      refitTimerRef.current = null;
      reactFlowInstance.current?.fitView({
        padding: isMobile ? 0.14 : 0.24,
        minZoom: isMobile ? 0.45 : 0.55,
        maxZoom: 1.05,
        duration: 320,
      });
    }, 80);
  }, [isMobile]);

  useEffect(() => () => {
    if (refitTimerRef.current !== null) window.clearTimeout(refitTimerRef.current);
  }, []);

  const focusEntityFromSearch = useCallback((entityId: string) => {
    setGraphLayer("entity");
    setSelectedRelationId(null);
    setSelectedEntityId(entityViewNodeId(entityId));
    setEntityViewMode("local");
    setShowSearch(false);
    refitGraph();
  }, [refitGraph]);

  const toggleEntityTypeFilter = useCallback((entityType: string) => {
    setEntityTypeFilters((current) => current.includes(entityType)
      ? current.filter((type) => type !== entityType)
      : [...current, entityType]);
    refitGraph();
  }, [refitGraph]);

  const handleToggleBranch = useCallback((nodeId: string) => {
    const expanding = collapsedNodes.has(nodeId);
    setCollapsedNodes(progressiveCollapseState(nodeId, collapsedNodes, displayHierarchy.edges));
    setViewMode(isDisplayOverviewNode(nodeId) && !expanding ? "outline" : "custom");
    refitGraph();
  }, [collapsedNodes, displayHierarchy.edges, setCollapsedNodes, refitGraph]);

  const handleFocusBranch = useCallback((nodeId: string) => {
    const nextCollapsed = collapsedNodes.has(nodeId)
      ? progressiveCollapseState(nodeId, collapsedNodes, displayHierarchy.edges)
      : new Set(collapsedNodes);
    setCollapsedNodes(nextCollapsed);
    setFocusedNodeId(nodeId);
    setDirection("horizontal");
    setViewMode("custom");
    refitGraph();
  }, [collapsedNodes, displayHierarchy.edges, setCollapsedNodes, refitGraph]);

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
    if (!currentMapId || activeNodes.length < outlineThreshold || showingEntityGraph || isWhiteboard) {
      const smallMapKey = currentMapId ? `${currentMapId}:${graphLayer}:small:${isMobile ? "mobile" : "desktop"}:${activeNodes[0]?.id || "empty"}` : null;
      if (currentMapId && initializedLargeMapRef.current !== smallMapKey) {
        initializedLargeMapRef.current = smallMapKey;
        setViewMode("all");
        setFocusedNodeId(null);
      }
      return;
    }
    const childIds = new Set(activeEdges.filter((edge) => edge.relation === "contains").map((edge) => edge.targetId));
    const rootSignature = activeNodes.filter((node) => !childIds.has(node.id)).map((node) => node.id).sort().join(",");
    const largeMapKey = `${currentMapId}:large:${isMobile ? "mobile" : "desktop"}:${rootSignature}`;
    if (!shouldInitializeLargeMapOutline({
      initializedKey: initializedLargeMapRef.current,
      largeMapKey,
      viewMode,
      collapsedNodeCount: collapsedNodes.size,
    })) return;
    initializedLargeMapRef.current = largeMapKey;
    setDirection("horizontal");
    setFocusedNodeId(null);
    setCollapsedNodes(getOutlineCollapsedNodes(displayHierarchy.nodes, displayHierarchy.edges));
    setViewMode("outline");
    refitGraph();
  }, [currentMapId, activeNodes, activeEdges, displayHierarchy, isMobile, showingEntityGraph, isWhiteboard, graphLayer, setCollapsedNodes, refitGraph, viewMode, collapsedNodes.size]);

  const runWhiteboardMutation = useCallback(async (
    recipe: (draft: GraphSnapshot) => void,
    request: () => Promise<Response>,
    failureMessage: string,
  ) => {
    if (!tenantScope || !currentMapId) return null;
    const state = useMindGrowStore.getState();
    const previous: GraphSnapshot = {
      nodes: state.nodes,
      edges: state.edges,
      entityGraph: state.entityGraph,
      layouts: state.layouts,
      whiteboardGroups: state.whiteboardGroups,
    };
    const overlay = mutateGraphLocally(currentMapId, tenantScope, recipe);
    if (!overlay) return null;
    try {
      const response = await request();
      if (!response.ok) throw new Error(`Whiteboard mutation failed (${response.status})`);
      setCanvasViewError("");
      return await response.json();
    } catch (error) {
      console.error("Whiteboard mutation failed:", error);
      rollbackGraphLocally(currentMapId, tenantScope, previous);
      setCanvasViewError(failureMessage);
      return null;
    }
  }, [currentMapId, mutateGraphLocally, rollbackGraphLocally, tenantScope]);

  const updateWhiteboardGroup = useCallback(async (
    groupId: string,
    patch: Partial<Pick<WhiteboardGroup, "name" | "color" | "positionX" | "positionY" | "width" | "height" | "collapsed" | "sortOrder">>,
    failureMessage: string,
  ) => {
    const current = useMindGrowStore.getState().whiteboardGroups.find((group) => group.mapId === currentMapId && group.id === groupId);
    if (!current) return false;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const result = await runWhiteboardMutation(
      (draft) => {
        draft.whiteboardGroups = draft.whiteboardGroups.map((group) => group.id === groupId ? next : group);
      },
      () => apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify({ action: "updateWhiteboardGroup", mapId: currentMapId, groupId, ...patch }),
      }),
      failureMessage,
    );
    return Boolean(result);
  }, [currentMapId, runWhiteboardMutation]);

  const openCreateWhiteboardGroup = useCallback(() => {
    const center = reactFlowInstance.current?.screenToFlowPosition({
      x: typeof window === "undefined" ? 640 : window.innerWidth * 0.64,
      y: typeof window === "undefined" ? 360 : window.innerHeight * 0.5,
    }) || { x: 160, y: 160 };
    setGroupEditor({
      mode: "create",
      groupId: null,
      name: `新分组 ${activeWhiteboardGroups.length + 1}`,
      color: WHITEBOARD_GROUP_COLORS[activeWhiteboardGroups.length % WHITEBOARD_GROUP_COLORS.length],
      positionX: Math.round(center.x - 360),
      positionY: Math.round(center.y - 240),
    });
  }, [activeWhiteboardGroups.length]);

  const openRenameWhiteboardGroup = useCallback((groupId: string) => {
    const group = useMindGrowStore.getState().whiteboardGroups.find((candidate) => candidate.id === groupId && candidate.mapId === currentMapId);
    if (!group) return;
    setGroupEditor({
      mode: "rename",
      groupId,
      name: group.name,
      color: group.color,
      positionX: group.positionX,
      positionY: group.positionY,
    });
  }, [currentMapId]);

  const submitWhiteboardGroupEditor = useCallback(async () => {
    if (!groupEditor || !groupEditor.name.trim()) return;
    if (groupEditor.mode === "rename" && groupEditor.groupId) {
      setGroupBusyId(groupEditor.groupId);
      const saved = await updateWhiteboardGroup(
        groupEditor.groupId,
        { name: groupEditor.name.trim().slice(0, 80), color: groupEditor.color },
        "分组名称暂未保存，已恢复原名称",
      );
      setGroupBusyId(null);
      if (saved) setGroupEditor(null);
      return;
    }

    const timestamp = new Date().toISOString();
    const group: WhiteboardGroup = {
      id: `wbg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mapId: currentMapId,
      name: groupEditor.name.trim().slice(0, 80),
      color: groupEditor.color,
      positionX: groupEditor.positionX,
      positionY: groupEditor.positionY,
      width: 720,
      height: 480,
      collapsed: false,
      sortOrder: activeWhiteboardGroups.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setGroupBusyId(group.id);
    const created = await runWhiteboardMutation(
      (draft) => { draft.whiteboardGroups.push(group); },
      () => apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify({ action: "createWhiteboardGroup", ...group }),
      }),
      "分组创建失败，画布已恢复",
    );
    setGroupBusyId(null);
    if (created) {
      setGroupEditor(null);
      window.setTimeout(() => reactFlowInstance.current?.setCenter(group.positionX + group.width / 2, group.positionY + group.height / 2, { zoom: 0.9, duration: 320 }), 80);
    }
  }, [activeWhiteboardGroups.length, currentMapId, groupEditor, runWhiteboardMutation, updateWhiteboardGroup]);

  const toggleWhiteboardGroup = useCallback(async (groupId: string) => {
    const group = useMindGrowStore.getState().whiteboardGroups.find((candidate) => candidate.id === groupId && candidate.mapId === currentMapId);
    if (!group) return;
    setGroupBusyId(groupId);
    await updateWhiteboardGroup(groupId, { collapsed: !group.collapsed }, "分组折叠状态暂未保存，已恢复原状态");
    setGroupBusyId(null);
  }, [currentMapId, updateWhiteboardGroup]);

  const resizeWhiteboardGroup = useCallback(async (
    groupId: string,
    geometry: { positionX: number; positionY: number; width: number; height: number },
  ) => {
    setGroupBusyId(groupId);
    await updateWhiteboardGroup(groupId, geometry, "分组尺寸暂未保存，已恢复原大小");
    setGroupBusyId(null);
  }, [updateWhiteboardGroup]);

  const deleteWhiteboardGroup = useCallback(async () => {
    const groupId = groupDeleteId;
    const group = useMindGrowStore.getState().whiteboardGroups.find((candidate) => candidate.id === groupId && candidate.mapId === currentMapId);
    if (!groupId || !group) return;
    setGroupBusyId(groupId);
    const deleted = await runWhiteboardMutation(
      (draft) => {
        draft.whiteboardGroups = draft.whiteboardGroups.filter((candidate) => candidate.id !== groupId);
        draft.layouts = draft.layouts.map((layout) => layout.mapId === currentMapId && layout.groupId === groupId
          ? {
            ...layout,
            positionX: group.positionX + layout.positionX,
            positionY: group.positionY + layout.positionY,
            groupId: null,
            updatedAt: new Date().toISOString(),
          }
          : layout);
      },
      () => apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify({ action: "deleteWhiteboardGroup", mapId: currentMapId, groupId }),
      }),
      "分组删除失败，卡片和分组已恢复",
    );
    setGroupBusyId(null);
    if (deleted) setGroupDeleteId(null);
  }, [currentMapId, groupDeleteId, runWhiteboardMutation]);

  const leaveWhiteboardGroup = useCallback(async (nodeId: string) => {
    const state = useMindGrowStore.getState();
    const layout = state.layouts.find((candidate) => candidate.mapId === currentMapId && candidate.nodeId === nodeId);
    const group = layout?.groupId
      ? state.whiteboardGroups.find((candidate) => candidate.mapId === currentMapId && candidate.id === layout.groupId)
      : null;
    if (!layout || !group) return;
    const nextLayout: NodeLayout = {
      ...layout,
      positionX: group.positionX - layout.cardWidth - 48,
      positionY: group.positionY + 96,
      groupId: null,
      updatedAt: new Date().toISOString(),
    };
    await runWhiteboardMutation(
      (draft) => {
        draft.layouts = draft.layouts.map((candidate) => (
          candidate.mapId === currentMapId && candidate.nodeId === nodeId ? nextLayout : candidate
        ));
      },
      () => apiFetch("/api/knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify(nextLayout),
      }),
      "卡片暂未移出分组，已恢复原位置",
    );
  }, [currentMapId, runWhiteboardMutation]);

  const whiteboardGraph = useMemo(() => {
    const conceptGraph = buildGraph(
      storeNodes,
      storeEdges,
      highlightedNodeId,
      searchResults,
      "horizontal",
      sv,
      new Set<string>(),
      null,
      true,
      false,
      handleToggleBranch,
      handleFocusBranch,
    );
    const geometry = buildWhiteboardCardGeometry(
      conceptGraph.nodes.map((node) => node.id),
      layouts,
      currentMapId,
      isMobile ? 1 : 2,
      activeWhiteboardGroups,
    );
    const collapsedGroupIds = new Set(activeWhiteboardGroups.filter((group) => group.collapsed).map((group) => group.id));
    const cardNodes = conceptGraph.nodes.map((node) => {
      const card = geometry.get(node.id);
      if (!card) return node;
      const detailLevel = node.data.highlighted ? "full" : whiteboardDisclosure;
      return {
        ...node,
        position: card.position,
        zIndex: 20,
        style: { ...node.style, width: card.width, height: card.height },
        data: {
          ...node.data,
          childCount: 0,
          collapsed: false,
          compact: false,
          direction: "horizontal",
          showDetails: true,
          whiteboard: true,
          whiteboardDetailLevel: detailLevel,
          whiteboardGroupId: card.groupId,
          whiteboardPersisted: card.persisted,
          onLeaveWhiteboardGroup: leaveWhiteboardGroup,
        },
      };
    }).filter((node) => !collapsedGroupIds.has(String(node.data.whiteboardGroupId || "")));
    const visibleCardIds = new Set(cardNodes.map((node) => node.id));
    const groupNodes: Node<WhiteboardGroupNodeData>[] = activeWhiteboardGroups.map((group) => ({
      id: whiteboardGroupNodeId(group.id),
      type: "whiteboardGroup",
      position: { x: group.positionX, y: group.positionY },
      draggable: groupBusyId !== group.id,
      selectable: true,
      connectable: false,
      dragHandle: ".whiteboard-group-drag",
      zIndex: 30,
      className: "pointer-events-none",
      style: { width: group.width, height: whiteboardGroupHeight(group), pointerEvents: "none" },
      data: {
        group,
        cardCount: layouts.filter((layout) => layout.mapId === currentMapId && layout.groupId === group.id).length,
        busy: groupBusyId === group.id,
        onRename: openRenameWhiteboardGroup,
        onToggleCollapsed: toggleWhiteboardGroup,
        onDelete: setGroupDeleteId,
        onResize: resizeWhiteboardGroup,
      },
    }));
    return {
      ...conceptGraph,
      nodes: [...groupNodes, ...cardNodes],
      edges: conceptGraph.edges.filter((edge) => visibleCardIds.has(edge.source) && visibleCardIds.has(edge.target)),
    };
  }, [activeWhiteboardGroups, currentMapId, groupBusyId, handleFocusBranch, handleToggleBranch, highlightedNodeId, isMobile, layouts, leaveWhiteboardGroup, openRenameWhiteboardGroup, resizeWhiteboardGroup, searchResults, storeEdges, storeNodes, sv, toggleWhiteboardGroup, whiteboardDisclosure]);

  const baseGraph = useMemo(
    () => showingEntityGraph
      ? buildEntityNetworkGraph(
        officialEntityGraph,
        entityViewMode,
        selectedEntityId,
        hoveredEntityId,
        hoveredRelationId,
        entityTypeFilters,
        showIsolatedEntities,
      )
      : isWhiteboard
        ? whiteboardGraph
      : buildGraph(
        displayHierarchy.nodes, displayHierarchy.edges, highlightedNodeId, searchResults, direction, sv,
        collapsedNodes, focusedNodeId,
        detailMode === "card" || (detailMode === "auto" && autoShowNodeDetails),
        isMobile, handleToggleBranch, handleFocusBranch,
      ),
    [showingEntityGraph, officialEntityGraph, entityViewMode, selectedEntityId, hoveredEntityId, hoveredRelationId, entityTypeFilters, showIsolatedEntities, isWhiteboard, whiteboardGraph, displayHierarchy, highlightedNodeId, searchResults, direction, sv, collapsedNodes, focusedNodeId, detailMode, autoShowNodeDetails, isMobile, handleToggleBranch, handleFocusBranch],
  );

  const graph = useMemo(() => {
    const neighbors = oneHopNodeIds(hoveredEntityId, baseGraph.edges);
    return {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity: hoveredEntityId ? graphNodeFocusOpacity(node.id, neighbors) : node.style?.opacity,
          transition: "opacity 200ms ease",
        },
      })),
      edges: baseGraph.edges.map((edge) => ({
        ...edge,
        style: {
          ...edge.style,
          opacity: hoveredEntityId ? graphEdgeFocusOpacity(edge, hoveredEntityId) : edge.style?.opacity,
          transition: "opacity 200ms ease",
        },
      })),
    };
  }, [baseGraph, hoveredEntityId]);

  const visibleStoredNodeCount = isWhiteboard
    ? graph.nodes.filter((node) => !isWhiteboardGroupNode(node.id)).length
    : Math.max(0, graph.nodes.length - displayHierarchy.syntheticNodeCount);
  const hiddenNodeCount = isWhiteboard ? 0 : Math.max(0, activeNodes.length - visibleStoredNodeCount);
  const overviewNodeId = displayHierarchy.syntheticNodeCount
    ? displayHierarchy.nodes.find((node) => isDisplayOverviewNode(node.id))?.id || null
    : null;
  const isOverviewCollapsed = Boolean(overviewNodeId && collapsedNodes.has(overviewNodeId));
  const relationCount = activeEdges.filter((edge) => edge.relation !== "contains").length;
  const citedNodeCount = activeNodes.filter((node) => (node.citations || []).length > 0).length;
  const selectedRelation = selectedRelationId
    ? officialEntityGraph.relations.find((relation) => entityViewNodeId(relation.id) === selectedRelationId) || null
    : null;
  const selectedRelationSource = selectedRelation
    ? officialEntityGraph.entities.find((entity) => entity.id === selectedRelation.sourceId) || null
    : null;
  const selectedRelationTarget = selectedRelation
    ? officialEntityGraph.entities.find((entity) => entity.id === selectedRelation.targetId) || null
    : null;
  const selectedEntity = selectedEntityId
    ? officialEntityGraph.entities.find((entity) => entityViewNodeId(entity.id) === selectedEntityId) || null
    : null;
  const currentMapName = currentMap?.name;
  const groupPendingDelete = activeWhiteboardGroups.find((group) => group.id === groupDeleteId) || null;
  const groupPendingDeleteCardCount = groupPendingDelete
    ? layouts.filter((layout) => layout.mapId === currentMapId && layout.groupId === groupPendingDelete.id).length
    : 0;

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(graph.nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setFlowNodes(graph.nodes);
    setFlowEdges(graph.edges);
  }, [graph.nodes, graph.edges, setFlowNodes, setFlowEdges]);

  useEffect(() => {
    if (!isWhiteboard || activeNodes.length === 0) {
      whiteboardFocusKeyRef.current = "";
      return;
    }
    const focusKey = `${currentMapId}:${activeNodes.length}:${isMobile ? "mobile" : "desktop"}`;
    if (whiteboardFocusKeyRef.current === focusKey) return;
    whiteboardFocusKeyRef.current = focusKey;
    const firstCard = whiteboardGraph.nodes[0];
    if (!firstCard) return;
    const timeout = window.setTimeout(() => {
      const zoom = isMobile ? 0.72 : 0.88;
      setCanvasZoom(zoom);
      reactFlowInstance.current?.setViewport({
        x: (isMobile ? 24 : 40) - firstCard.position.x * zoom,
        y: (isMobile ? 118 : 150) - firstCard.position.y * zoom,
        zoom,
      }, { duration: 320 });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [activeNodes.length, currentMapId, isMobile, isWhiteboard, whiteboardGraph.nodes]);

  const closeEntityDetail = useCallback(() => {
    commandEntityFocusGenerationRef.current += 1;
    selectedEntityIdRef.current = null;
    setSelectedEntityId(null);
    setEntityViewMode("global");
    refitGraph();
  }, [refitGraph]);

  const locateSelectedEntity = useCallback(() => {
    if (!selectedEntityId) return;
    setEntityViewMode("local");
    const node = flowNodes.find((item) => item.id === selectedEntityId);
    if (node) {
      reactFlowInstance.current?.setCenter(node.position.x + 43, node.position.y + 43, { zoom: 1.1, duration: 320 });
    } else {
      refitGraph();
    }
  }, [flowNodes, refitGraph, selectedEntityId]);

  const openCurrentLibrary = useCallback(() => {
    setGraphLayer("concept");
    setSelectedEntityId(null);
    setSelectedRelationId(null);
    setEntityViewMode("global");
    refitGraph();
  }, [refitGraph]);

  const switchCanvasView = useCallback(async (nextView: "mindmap" | "whiteboard") => {
    if (!currentMapId || showingEntityGraph || nextView === canvasView) return;
    const previousView = canvasView;
    if (nextView === "whiteboard" && refitTimerRef.current !== null) {
      window.clearTimeout(refitTimerRef.current);
      refitTimerRef.current = null;
    }
    setCanvasViewError("");
    setMaps(maps.map((map) => map.id === currentMapId ? { ...map, canvasView: nextView } : map));
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify({ action: "setMapCanvasView", mapId: currentMapId, canvasView: nextView }),
      });
      if (!response.ok) throw new Error("Canvas view update failed");
      if (nextView === "mindmap") refitGraph();
    } catch (error) {
      console.error("Failed to update canvas view:", error);
      const latestMaps = useMindGrowStore.getState().maps;
      setMaps(latestMaps.map((map) => map.id === currentMapId && map.canvasView === nextView
        ? { ...map, canvasView: previousView }
        : map));
      setCanvasViewError("视图切换保存失败，已恢复原视图");
      refitGraph();
    }
  }, [canvasView, currentMapId, maps, refitGraph, setMaps, showingEntityGraph]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setFlowEdges((eds) =>
        addEdge({ ...connection, type: "bezier", style: { stroke: "var(--canvas-edge)", strokeWidth: 1.8 } }, eds)
      );
    },
    [setFlowEdges]
  );

  const persistWhiteboardNodePosition = useCallback(async (node: Node) => {
    if (!isWhiteboard || isWhiteboardGroupNode(node.id)) return;
    const currentLayout = layouts.find((layout) => layout.mapId === currentMapId && layout.nodeId === node.id);
    const width = Number(node.width || node.style?.width || currentLayout?.cardWidth || WHITEBOARD_CARD_WIDTH);
    const height = Number(node.height || node.style?.height || currentLayout?.cardHeight || WHITEBOARD_CARD_HEIGHT);
    const drop = whiteboardDropGeometry(node.position, width, height, activeWhiteboardGroups, currentMapId);
    const nextLayout = {
      nodeId: node.id,
      mapId: currentMapId,
      positionX: drop.positionX,
      positionY: drop.positionY,
      zoomLevel: currentLayout?.zoomLevel || 1,
      groupId: drop.groupId,
      cardWidth: width,
      cardHeight: height,
      updatedAt: new Date().toISOString(),
    };
    await runWhiteboardMutation(
      (draft) => {
        draft.layouts = [
          ...draft.layouts.filter((layout) => layout.nodeId !== node.id),
          nextLayout,
        ];
      },
      () => apiFetch("/api/knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify(nextLayout),
      }),
      "卡片位置或分组暂未保存，已恢复原位置",
    );
  }, [activeWhiteboardGroups, currentMapId, isWhiteboard, layouts, runWhiteboardMutation]);

  const onWhiteboardNodeDragStart = useCallback((_: React.MouseEvent, node: Node) => {
    const groupId = whiteboardGroupIdFromNodeId(node.id);
    if (!isWhiteboard || !groupId) return;
    const group = activeWhiteboardGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    whiteboardGroupDragRef.current = {
      group,
      memberPositions: new Map(flowNodes
        .filter((candidate) => String(candidate.data?.whiteboardGroupId || "") === groupId)
        .map((candidate) => [candidate.id, { ...candidate.position }])),
    };
  }, [activeWhiteboardGroups, flowNodes, isWhiteboard]);

  const onWhiteboardNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
    const groupId = whiteboardGroupIdFromNodeId(node.id);
    const snapshot = whiteboardGroupDragRef.current;
    if (!isWhiteboard || !groupId || !snapshot || snapshot.group.id !== groupId) return;
    const deltaX = node.position.x - snapshot.group.positionX;
    const deltaY = node.position.y - snapshot.group.positionY;
    setFlowNodes((current) => current.map((candidate) => {
      const start = snapshot.memberPositions.get(candidate.id);
      return start ? { ...candidate, position: { x: start.x + deltaX, y: start.y + deltaY } } : candidate;
    }));
  }, [isWhiteboard, setFlowNodes]);

  const onWhiteboardNodeDragStop = useCallback(async (_: React.MouseEvent, node: Node) => {
    const groupId = whiteboardGroupIdFromNodeId(node.id);
    if (!groupId) {
      await persistWhiteboardNodePosition(node);
      return;
    }
    whiteboardGroupDragRef.current = null;
    setGroupBusyId(groupId);
    await updateWhiteboardGroup(
      groupId,
      { positionX: node.position.x, positionY: node.position.y },
      "分组位置暂未保存，整组已恢复原位置",
    );
    setGroupBusyId(null);
  }, [persistWhiteboardNodePosition, updateWhiteboardGroup]);

  // Node changes keep the canvas responsive; whiteboard persistence is tied
  // to the explicit drag-stop event so pointer implementations behave alike.
  const onNodesChangeHandler = useCallback(
    async (changes: NodeChange[]) => {
      onNodesChange(changes);
      if (showingEntityGraph) return;
      for (const change of changes) {
        if ("id" in change && (isDisplayOverviewNode(change.id) || isWhiteboardGroupNode(change.id))) continue;
        if (change.type === "remove") {
          try { await apiFetch("/api/knowledge?nodeId=" + change.id, { method: "DELETE", writeForMapId: currentMapId }); }
          catch (e) { console.error("Failed to delete node:", e); }
        }
      }
    },
    [currentMapId, onNodesChange, showingEntityGraph]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const editingText = Boolean(active && (
        active.tagName === "INPUT"
        || active.tagName === "TEXTAREA"
        || active.tagName === "SELECT"
        || active.isContentEditable
      ));
      if (e.key === "Delete" || e.key === "Backspace") {
        if (editingText) return;
        const selected = flowNodes.filter((n) => n.selected && !isDisplayOverviewNode(n.id) && !isEntityViewNode(n.id) && !isWhiteboardGroupNode(n.id));
        if (selected.length === 0) return;
        e.preventDefault();
        pushHistory();
        for (const node of selected) {
          removeNode(node.id);
          apiFetch("/api/knowledge?nodeId=" + node.id, { method: "DELETE", writeForMapId: currentMapId })
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
      if (!editingText && isWhiteboard && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        openCreateWhiteboardGroup();
      }
      if (!editingText && isWhiteboard && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === "0") {
        e.preventDefault();
        reactFlowInstance.current?.fitView({ padding: isMobile ? 0.12 : 0.18, duration: 320 });
      }
      if (e.key === "Escape") {
        if (groupEditor) { setGroupEditor(null); return; }
        if (groupDeleteId) { setGroupDeleteId(null); return; }
        if (contextNode) { setContextNode(null); setNodeContext(null); return; }
        if (selectedRelationId) { setSelectedRelationId(null); return; }
        if (selectedEntityIdRef.current) { closeEntityDetail(); return; }
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
  }, [flowNodes, removeNode, currentMapId, setStoreNodes, setStoreEdges, setSearchResults, editingNode, focusedNodeId, selectedRelationId, contextNode, closeEntityDetail, refitGraph, pushHistory, undo, redo, setContextMenu, setShowHelp, groupDeleteId, groupEditor, isMobile, isWhiteboard, openCreateWhiteboardGroup]);

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
      if (isEntityViewNode(nodeId)) return;
      const node = storeNodes.find((n) => n.id === nodeId);
      if (node) setEditingNode({ id: nodeId, mapId: currentMapId, content: node.content, desc: node.desc || "" });
    };
    document.addEventListener("dblclick", handler);
    return () => document.removeEventListener("dblclick", handler);
  }, [currentMapId, storeNodes]);

  // Commit node edit
  const commitEdit = useCallback(async () => {
    if (!editingNode || editingNode.mapId !== currentMapId || !editingNode.content.trim()) {
      setEditingNode(null);
      return;
    }
    pushHistory();
    const content = editingNode.content.trim();
    const desc = editingNode.desc.trim();
    if (tenantScope) {
      mutateGraphLocally(currentMapId, tenantScope, (draft) => {
        const node = draft.nodes.find((candidate) => candidate.id === editingNode.id);
        if (!node) return;
        node.content = content;
        node.desc = desc;
        node.updatedAt = new Date().toISOString();
      });
    }
    try {
      const response = await apiFetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        writeForMapId: currentMapId,
        body: JSON.stringify({ nodeId: editingNode.id, content, desc }),
      });
      if (!response.ok) throw new Error(`Failed to update node (HTTP ${response.status})`);
      reloadMap();
    } catch (e) {
      console.error("Failed to update node:", e);
    }
    setEditingNode(null);
  }, [currentMapId, editingNode, mutateGraphLocally, reloadMap, pushHistory, tenantScope]);

  // Right-click context menu on nodes
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const nodeEl = (e.target as HTMLElement).closest('.react-flow__node');
      if (!nodeEl) return;
      const nodeId = nodeEl.getAttribute('data-id');
      if (!nodeId) return;
      if (isDisplayOverviewNode(nodeId) || isEntityViewNode(nodeId) || isWhiteboardGroupNode(nodeId)) return;
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
    handleFocusBranch(contextMenu.nodeId);
    setContextMenu(null);
  }, [contextMenu, handleFocusBranch, setContextMenu]);

  // Context menu: edit
  const handleCtxEdit = useCallback(() => {
    if (!contextMenu) return;
    const node = storeNodes.find((n) => n.id === contextMenu.nodeId);
    if (node) setEditingNode({ id: node.id, mapId: currentMapId, content: node.content, desc: node.desc || "" });
    setContextMenu(null);
  }, [contextMenu, currentMapId, storeNodes, setContextMenu]);

  const openNodeContext = useCallback(async (nodeId: string) => {
    const node = storeNodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    setContextNode(node);
    setNodeContext(null);
    setNodeContextError("");
    setNodeContextLoading(true);
    try {
      if (IS_LOCAL_MODE) {
        setNodeContext(buildLocalNodeContext(node, storeNodes, storeEdges));
      } else {
        const response = await apiFetch(`/api/knowledge?action=nodeContext&nodeId=${encodeURIComponent(nodeId)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as NodeContext;
        if (!data?.node?.id || !Array.isArray(data.sources) || !Array.isArray(data.backlinks) || !Array.isArray(data.timeline)) {
          throw new Error("invalid response");
        }
        setContextNode(data.node);
        setNodeContext(data);
      }
    } catch (error) {
      console.error("Failed to load node context:", error);
      setNodeContextError("引用与时间轴加载失败，请稍后重试；现有节点内容没有受到影响。");
    } finally {
      setNodeContextLoading(false);
    }
  }, [storeEdges, storeNodes]);

  const handleCtxNodeContext = useCallback(() => {
    if (!contextMenu) return;
    const nodeId = contextMenu.nodeId;
    setContextMenu(null);
    void openNodeContext(nodeId);
  }, [contextMenu, openNodeContext, setContextMenu]);

  const locateContextBacklink = useCallback((nodeId: string) => {
    setContextNode(null);
    setNodeContext(null);
    const node = flowNodes.find((candidate) => candidate.id === nodeId);
    if (node) reactFlowInstance.current?.setCenter(node.position.x, node.position.y, { zoom: 1.35, duration: 320 });
  }, [flowNodes]);

  // Context menu: delete
  const handleCtxDelete = useCallback(() => {
    if (!contextMenu) return;
    pushHistory();
    removeNode(contextMenu.nodeId);
    apiFetch("/api/knowledge?nodeId=" + contextMenu.nodeId, { method: "DELETE", writeForMapId: currentMapId })
      .then((r) => r.json())
      .then((d) => { if (d.success) reloadMap(); })
      .catch(console.error);
    setContextMenu(null);
  }, [contextMenu, currentMapId, removeNode, reloadMap, pushHistory, setContextMenu]);

  // Export PNG
  const handleExportPng = useCallback(() => {
    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewportEl) return;
    import('html-to-image').then(({ toPng }) => {
      return toPng(viewportEl, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#09090b',
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
    const md = exportToMarkdown(activeNodes, activeEdges);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mindgrow-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [activeNodes, activeEdges]);

  // Export PDF
  const handleExportPdf = useCallback(() => {
    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewportEl) return;
    import('html-to-image').then(({ toPng }) => {
      return toPng(viewportEl, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#09090b',
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

  if (showSkeleton) return <MindMapSkeleton />;

  // Empty state
  if (activeNodes.length === 0) {
    return (
      <div className="animate-fade-in flex-1 min-w-0 flex items-center justify-center bg-[var(--background)]" data-testid="knowledge-graph-workspace" data-graph-mode={currentMode} data-graph-revealed="true">
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
  const focusedNode = focusedNodeId ? activeNodes.find((node) => node.id === focusedNodeId) : null;

  return (
    <div
      className="animate-fade-in flex-1 min-w-0 bg-[var(--background)] relative"
      data-testid="knowledge-graph-workspace"
      data-graph-mode={currentMode}
      data-graph-revealed="true"
      data-graph-view-mode={viewMode}
      data-canvas-view={canvasView}
      data-visible-node-count={visibleStoredNodeCount}
      data-whiteboard-group-count={activeWhiteboardGroups.length}
      data-whiteboard-detail-level={isWhiteboard ? whiteboardDisclosure : undefined}
      data-whiteboard-viewport-culling={largeWhiteboard ? "true" : "false"}
    >
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
            <div className="rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2 text-xs font-semibold text-[var(--primary-hover)]">{MODE_LIBRARY_CONFIG[currentMode].emoji} {showingEntityGraph ? "实体知识图谱" : `${MODE_LIBRARY_CONFIG[currentMode].shortLabel}知识图谱`}</div>
            <div className="flex gap-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1" data-testid="graph-layer-switch">
              <button
                type="button"
                onClick={() => {
                  const conceptHierarchy = buildDisplayHierarchy(storeNodes, storeEdges, currentMapId, overviewLabel);
                  const useOutline = storeNodes.length >= (isMobile ? 8 : 14);
                  setGraphLayer("concept");
                  setSelectedRelationId(null);
                  setSelectedEntityId(null);
                  setCollapsedNodes(useOutline ? getOutlineCollapsedNodes(conceptHierarchy.nodes, conceptHierarchy.edges) : new Set<string>());
                  setViewMode(useOutline ? "outline" : "all");
                  refitGraph();
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${graphLayer === "concept" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >概念图 {storeNodes.length}</button>
              <button
                type="button"
                disabled={officialEntityGraph.entities.length === 0}
                onClick={() => { setGraphLayer("entity"); setEntityViewMode("global"); setSelectedEntityId(null); setSelectedRelationId(null); setCollapsedNodes(new Set<string>()); setViewMode("all"); refitGraph(); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35 ${graphLayer === "entity" ? "bg-violet-400 text-black" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                title={officialEntityGraph.entities.length ? "按实体与有向关系查看，可点击关系核对原文" : "当前知识库还没有可溯源实体；重新解析并保存文章或会议后生成"}
              >实体图 {officialEntityGraph.entities.length}</button>
            </div>
            {!showingEntityGraph && (
              <div className="flex gap-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1" data-testid="canvas-view-switch">
                <button
                  type="button"
                  aria-pressed={!isWhiteboard}
                  data-testid="canvas-view-mindmap"
                  onClick={() => switchCanvasView("mindmap")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${!isWhiteboard ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                >思维导图</button>
                <button
                  type="button"
                  aria-pressed={isWhiteboard}
                  data-testid="canvas-view-whiteboard"
                  onClick={() => switchCanvasView("whiteboard")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isWhiteboard ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                >白板</button>
              </div>
            )}
            {isWhiteboard && (
              <button
                type="button"
                onClick={openCreateWhiteboardGroup}
                className="rounded-xl border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-3 py-2 text-xs font-semibold text-[var(--primary-hover)] transition-colors hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)]"
                data-testid="create-whiteboard-group"
              >＋ 空间分组{activeWhiteboardGroups.length ? ` ${activeWhiteboardGroups.length}` : ""}</button>
            )}
            <div className="rounded-xl border border-[var(--status-growth-border)] bg-[var(--status-growth-bg)] px-3 py-2 text-[10px] font-semibold text-[var(--status-growth-text)]" title="新增内容会成为节点；层级、关联与冲突关系会持续连接旧知识">
              🌱 生长中 · {activeNodes.length} 节点 · {activeEdges.length} 条连接{relationCount > 0 ? ` · ${relationCount} 条${showingEntityGraph ? "有向" : "语义"}关系` : ""}{citedNodeCount > 0 ? ` · ${citedNodeCount} 个可追溯节点` : ""}
            </div>
            {showingEntityGraph && <div className="flex gap-0 rounded-xl border border-violet-400/20 bg-[var(--card)] p-1" data-testid="entity-view-modes">
              {(["global", "local", "evidence"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={mode === "local" && !selectedEntityId}
                  onClick={() => { setEntityViewMode(mode); if (mode === "global") setSelectedEntityId(null); refitGraph(); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35 ${entityViewMode === mode ? "bg-violet-400 text-black" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                  title={mode === "global" ? "显示高置信度强关系" : mode === "local" ? "只看选中实体的一跳关系" : "只看带原文引用的关系"}
                >{mode === "global" ? "全局强关系" : mode === "local" ? "一跳关系" : "证据链"}</button>
              ))}
            </div>}
            {showingEntityGraph && (
              <div className="rounded-xl border border-violet-400/15 bg-violet-400/5 px-3 py-2 text-[10px] text-violet-200" data-testid="entity-network-summary">
                {entityViewMode === "global" ? "强关系" : entityViewMode === "local" ? "一跳关系" : "证据关系"} {graph.edges.length} 条 · 显示 {graph.nodes.length}/{officialEntityGraph.entities.length} 个实体
                {!showIsolatedEntities && entityViewMode !== "local" ? " · 无强关系实体已隐藏" : ""}
                {entityTypeFilters.length ? ` · 已筛选 ${entityTypeFilters.length} 种类型` : ""}
              </div>
            )}
            {!showingEntityGraph && !isWhiteboard && <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
              <button
                onClick={showOutline}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "outline" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                title="只显示主题和主要分支"
              >{isOverviewCollapsed ? `概览 1 · 共 ${activeNodes.length}` : `主干 ${visibleStoredNodeCount}/${activeNodes.length}`}</button>
              <button
                onClick={showAllNodes}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "all" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
                title="展开全部节点，可拖动画布浏览"
              >全部 {activeNodes.length}</button>
            </div>}

            {!isWhiteboard && focusedNode && (
              <button
                onClick={() => { setFocusedNodeId(null); setViewMode("custom"); refitGraph(); }}
                className="max-w-[190px] truncate rounded-xl border border-[#22d3a755] bg-[#22d3a715] px-3 py-2 text-xs font-medium text-[#7de8c9] transition-colors hover:bg-[#22d3a725] cursor-pointer"
                title={`返回全图：${focusedNode.content}`}
              >← 返回全图 · {focusedNode.content}</button>
            )}

            {!isWhiteboard && <div className="flex gap-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
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
            </div>}

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
              title={showingEntityGraph ? "搜索与过滤实体" : "搜索 (Ctrl+F)"}
              aria-label={showingEntityGraph ? "搜索与过滤实体" : "搜索节点"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            </button>

            {!isMobile && !isWhiteboard && (
              <button
                onClick={() => setShowSpacing(!showSpacing)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
                  showSpacing ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent" : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"
                }`}
                title="显示与间距"
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
      {showSpacing && !isWhiteboard && (
        <div className={`absolute top-12 z-50 animate-fade-in-up ${isMobile ? "right-3" : "left-3"}`}>
          <div className="min-w-[250px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg" data-testid="graph-display-settings">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">卡片信息</div>
            <div className="mb-3 flex gap-1">
              {(["auto", "title", "card"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDetailMode(mode)}
                  className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${detailMode === mode ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--bg-hover)] hover:text-[var(--foreground)]"}`}
                  title={mode === "auto" ? "随缩放自动显示摘要" : mode === "title" ? "只显示标题，提高节点显示率" : "始终显示摘要与引用，提高可读性"}
                >{mode === "auto" ? "智能" : mode === "title" ? "仅标题" : "阅读卡"}</button>
              ))}
            </div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">节点间距</div>
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
          <div
            className="min-w-[280px] max-w-[min(88vw,360px)] rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg"
            data-testid={showingEntityGraph ? "entity-network-tools" : undefined}
          >
            <input
              value={showingEntityGraph ? entitySearch : localSearch}
              onChange={(event) => showingEntityGraph ? setEntitySearch(event.target.value) : handleSearch(event.target.value)}
              placeholder={showingEntityGraph ? "搜索实体、别名或解释..." : "搜索节点..."}
              aria-label={showingEntityGraph ? "搜索实体" : "搜索节点"}
              data-testid={showingEntityGraph ? "entity-network-search" : undefined}
              className="w-full bg-[var(--background)] rounded-lg px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none border border-[var(--border)] focus:border-[var(--primary)]"
              autoFocus
            />
            {showingEntityGraph && entitySearch.trim() && (
              <div className="mt-2 space-y-1" data-testid="entity-network-search-results">
                {entitySearchResults.map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => focusEntityFromSearch(entity.id)}
                    className="flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-violet-400/10"
                    data-testid="entity-network-search-result"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-[var(--foreground)]">{entity.canonicalName}</span>
                      <span className="mt-0.5 block line-clamp-1 text-[10px] text-[var(--muted-foreground)]">{entity.description}</span>
                    </span>
                    <span className="shrink-0 rounded-full border border-violet-400/20 px-2 py-0.5 text-[9px] text-violet-300">{ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}</span>
                  </button>
                ))}
                {entitySearchResults.length === 0 && <div className="px-2 py-2 text-xs text-[var(--muted-foreground)]">没有匹配实体</div>}
              </div>
            )}
            {showingEntityGraph && (
              <div className="mt-2 border-t border-[var(--border)] pt-2">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">实体类型</span>
                  {entityTypeFilters.length > 0 && (
                    <button type="button" onClick={() => { setEntityTypeFilters([]); refitGraph(); }} className="text-[10px] text-violet-300 hover:text-violet-200">清除筛选</button>
                  )}
                </div>
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" data-testid="entity-network-type-filters">
                  {availableEntityTypes.map((entityType) => {
                    const active = entityTypeFilters.includes(entityType);
                    const count = officialEntityGraph.entities.filter((entity) => entity.entityType === entityType).length;
                    return (
                      <button
                        key={entityType}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleEntityTypeFilter(entityType)}
                        className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${active ? "border-violet-300 bg-violet-400 text-black" : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-violet-400/50 hover:text-[var(--foreground)]"}`}
                        data-entity-type={entityType}
                      >{ENTITY_TYPE_LABELS[entityType] || entityType} {count}</button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  aria-pressed={showIsolatedEntities}
                  onClick={() => { setShowIsolatedEntities((current) => !current); refitGraph(); }}
                  className={`mt-2 flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors ${showIsolatedEntities ? "border-violet-300/60 bg-violet-400/10 text-violet-200" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                  data-testid="entity-network-show-isolated"
                >
                  <span>显示无强关系实体</span>
                  <span>{showIsolatedEntities ? "已开启" : "默认隐藏"}</span>
                </button>
              </div>
            )}
            {!showingEntityGraph && localSearch && (
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
          <button onClick={handleCtxNodeContext} className="w-full px-3 py-2 text-xs text-left text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            引用与时间轴
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

      {groupEditor && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[var(--overlay-bg)] p-4 backdrop-blur-sm" data-testid="whiteboard-group-editor">
          <div className="w-[min(92vw,420px)] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{groupEditor.mode === "create" ? "新建空间分组" : "编辑空间分组"}</h3>
                <p className="mt-1 text-[11px] leading-5 text-[var(--muted-foreground)]">分组只改变白板布局，不会改写知识关系或 Citation。</p>
              </div>
              <button type="button" onClick={() => setGroupEditor(null)} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="关闭分组编辑">×</button>
            </div>
            <label className="mt-4 block text-[11px] font-medium text-[var(--muted-foreground)]" htmlFor="whiteboard-group-name">分组名称</label>
            <input
              id="whiteboard-group-name"
              value={groupEditor.name}
              onChange={(event) => setGroupEditor((current) => current ? { ...current, name: event.target.value } : current)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && groupEditor.name.trim()) void submitWhiteboardGroupEditor();
                if (event.key === "Escape") setGroupEditor(null);
              }}
              maxLength={80}
              autoFocus
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              data-testid="whiteboard-group-name"
            />
            <div className="mt-4 text-[11px] font-medium text-[var(--muted-foreground)]">识别颜色</div>
            <div className="mt-2 flex flex-wrap gap-2" data-testid="whiteboard-group-colors">
              {WHITEBOARD_GROUP_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`选择颜色 ${color}`}
                  aria-pressed={groupEditor.color === color}
                  onClick={() => setGroupEditor((current) => current ? { ...current, color } : current)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-105 ${groupEditor.color === color ? "scale-110 border-white" : "border-transparent"}`}
                  style={{ backgroundColor: color }}
                  data-group-color={color}
                />
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setGroupEditor(null)} className="rounded-xl px-4 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--bg-hover)] hover:text-[var(--foreground)]">取消</button>
              <button
                type="button"
                onClick={() => { void submitWhiteboardGroupEditor(); }}
                disabled={!groupEditor.name.trim() || Boolean(groupBusyId)}
                className="rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="save-whiteboard-group"
              >{groupBusyId ? "保存中…" : groupEditor.mode === "create" ? "创建分组" : "保存修改"}</button>
            </div>
          </div>
        </div>
      )}

      {groupPendingDelete && (
        <div className="fixed inset-0 z-[225] flex items-center justify-center bg-[var(--overlay-bg)] p-4 backdrop-blur-sm" data-testid="whiteboard-group-delete-confirm">
          <div className="w-[min(92vw,420px)] rounded-2xl border border-red-400/25 bg-[var(--card)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">删除空间分组“{groupPendingDelete.name}”？</h3>
            <p className="mt-2 text-[11px] leading-5 text-[var(--muted-foreground)]">
              分组框会删除，{groupPendingDeleteCardCount} 张卡片会保留在当前位置并移出分组；知识节点、关系和引用不会删除。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setGroupDeleteId(null)} className="rounded-xl px-4 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--bg-hover)] hover:text-[var(--foreground)]">取消</button>
              <button
                type="button"
                onClick={() => { void deleteWhiteboardGroup(); }}
                disabled={groupBusyId === groupPendingDelete.id}
                className="rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                data-testid="confirm-delete-whiteboard-group"
              >{groupBusyId === groupPendingDelete.id ? "处理中…" : "仅删除分组"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Inline edit overlay */}
      {editingNode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[var(--overlay-bg)] backdrop-blur-sm">
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

      {!showingEntityGraph && contextNode && (
        <NodeContextPanel
          node={contextNode}
          context={nodeContext}
          loading={nodeContextLoading}
          error={nodeContextError}
          onClose={() => { setContextNode(null); setNodeContext(null); }}
          onLocate={locateContextBacklink}
        />
      )}

      {!showingEntityGraph && hiddenNodeCount > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-3 z-40 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 px-3 py-2 text-[11px] text-[var(--muted-foreground)] shadow-lg backdrop-blur">
          {isOverviewCollapsed
            ? `概览模式 · ${activeNodes.length} 个原节点完整保留 · 点击 ＋N 仅展开下一层`
            : `当前显示 ${visibleStoredNodeCount}/${activeNodes.length} 个节点 · ＋N 逐层展开 · ◎ 聚焦分支`}
        </div>
      )}

      {isWhiteboard && (
        <div className="pointer-events-none absolute bottom-4 left-3 z-40 rounded-xl border border-[var(--primary-border)] bg-[var(--card)]/95 px-3 py-2 text-[11px] text-[var(--primary-hover)] shadow-lg backdrop-blur" data-testid="whiteboard-status">
          白板模式 · {activeWhiteboardGroups.length} 个空间分组 · {largeWhiteboard ? `大图性能模式 · ${whiteboardDisclosure === "title" ? "标题层" : whiteboardDisclosure === "summary" ? "摘要层" : "引用层"}` : "完整阅读卡"} · 内容与引用保持完整
        </div>
      )}

      {isWhiteboard && isMobile && !showToolbar && (
        <button
          type="button"
          onClick={openCreateWhiteboardGroup}
          className="absolute left-3 z-40 rounded-xl border border-[var(--primary-border)] bg-[var(--card)]/95 px-3 py-2 text-xs font-semibold text-[var(--primary-hover)] shadow-lg backdrop-blur"
          style={{ top: "max(calc(env(safe-area-inset-top) + 12px), 32px)" }}
          data-testid="mobile-create-whiteboard-group"
          aria-label="白板新建空间分组"
        >＋ 分组</button>
      )}

      {canvasViewError && (
        <div className="absolute bottom-16 left-3 z-[60] rounded-xl border border-red-400/30 bg-red-950/90 px-3 py-2 text-[11px] text-red-200 shadow-lg" role="status" data-testid="canvas-view-error">
          {canvasViewError}
        </div>
      )}

      {showingEntityGraph && selectedEntity && (
        <EntityDetailPanel
          entity={selectedEntity}
          entities={officialEntityGraph.entities}
          relations={officialEntityGraph.relations}
          mapName={currentMapName}
          onClose={closeEntityDetail}
          onLocate={locateSelectedEntity}
          onOpenLibrary={openCurrentLibrary}
        />
      )}

      {showingEntityGraph && selectedRelation && (
        <aside className="absolute bottom-4 left-3 z-[70] w-[min(440px,calc(100%-24px))] rounded-2xl border border-violet-400/30 bg-[var(--card)]/95 p-4 shadow-2xl backdrop-blur" data-testid="relation-evidence-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--canvas-label-accent)]">关系原文证据</div>
              <div className="mt-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{selectedRelation.shortLabel}</h3>
                <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[9px] font-semibold text-[var(--canvas-label-accent)]" data-testid="relation-status-chip">
                  {RELATION_STATUS_LABELS[selectedRelation.status]}
                </span>
              </div>
            </div>
            <button type="button" onClick={() => setSelectedRelationId(null)} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="关闭关系证据">×</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-secondary)]">
            <span className="rounded-lg bg-[var(--bg-hover)] px-2 py-1">{selectedRelationSource?.canonicalName || "未知实体"}</span>
            <span className="text-[var(--canvas-label-accent)]">{selectedRelation.shortLabel} →</span>
            <span className="rounded-lg bg-[var(--bg-hover)] px-2 py-1">{selectedRelationTarget?.canonicalName || "未知实体"}</span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[var(--text-secondary)]">{selectedRelation.explanation || "原文仅确认该关系，暂无补充解释。"}</p>
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
            {(selectedRelation.citations || []).map((citation) => (
              <div key={`${citation.documentId || "source"}-${citation.index}`} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 text-[11px] leading-5 text-[var(--text-secondary)]" data-testid="relation-evidence-citation">
                <div className="mb-1 font-semibold text-[var(--canvas-label-accent)]" data-testid="relation-evidence-locator">[{citation.index}] {citation.title || "来源文档"} · {citation.locator || "原文"}</div>
                <blockquote>“{citation.quote}”</blockquote>
              </div>
            ))}
          </div>
        </aside>
      )}

      {showingEntityGraph && graph.nodes.length === 0 && (
        <div className="absolute left-1/2 top-1/2 z-30 w-[min(88%,360px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-violet-400/25 bg-[var(--card)]/95 p-5 text-center shadow-2xl backdrop-blur" data-testid="entity-network-empty">
          <div className="text-sm font-semibold text-[var(--foreground)]">当前筛选下没有可显示的强关系</div>
          <p className="mt-2 text-[11px] leading-5 text-[var(--muted-foreground)]">强关系必须同时满足置信度和原文证据。你可以清除类型筛选，或主动查看无强关系实体。</p>
          <button
            type="button"
            onClick={() => { setEntityTypeFilters([]); setShowIsolatedEntities(true); refitGraph(); }}
            className="mt-3 rounded-lg bg-violet-400 px-3 py-2 text-xs font-semibold text-black hover:bg-violet-300"
          >显示全部有证据实体</button>
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChangeHandler}
        onNodeDragStart={onWhiteboardNodeDragStart}
        onNodeDrag={onWhiteboardNodeDrag}
        onNodeDragStop={(event, node) => { void onWhiteboardNodeDragStop(event, node); }}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={(_, edge) => {
          if (!showingEntityGraph) return;
          setSelectedEntityId(null);
          setSelectedRelationId(edge.id);
        }}
        onNodeClick={(_, node) => {
          if (isWhiteboard && !isWhiteboardGroupNode(node.id)) {
            setFlowNodes((current) => current.map((candidate) => ({
              ...candidate,
              selected: candidate.id === node.id,
            })));
            return;
          }
          if (!showingEntityGraph || !isEntityViewNode(node.id)) return;
          setSelectedEntityId(node.id);
          setEntityViewMode("local");
          setSelectedRelationId(null);
          refitGraph();
        }}
        onNodeMouseEnter={(_, node) => setHoveredEntityId(node.id)}
        onNodeMouseLeave={() => setHoveredEntityId(null)}
        onEdgeMouseEnter={(_, edge) => { if (showingEntityGraph) setHoveredRelationId(edge.id); }}
        onEdgeMouseLeave={() => setHoveredRelationId(null)}
        nodeTypes={nodeTypes}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        onlyRenderVisibleElements={largeWhiteboard}
        fitView={!isWhiteboard}
        fitViewOptions={{ padding: isMobile ? 0.14 : 0.24, minZoom: isMobile ? 0.45 : 0.55, maxZoom: 1.05 }}
        minZoom={isMobile ? 0.15 : 0.2}
        maxZoom={2}
        onMoveEnd={(_, viewport) => {
          setAutoShowNodeDetails(viewport.zoom >= 0.72);
          setCanvasZoom(viewport.zoom);
        }}
        selectionOnDrag={false}
        panOnDrag={[0, 2]}
        panOnScroll={false}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ type: "default", style: { stroke: "var(--canvas-edge)", strokeWidth: 1.8 } }}
        proOptions={{ hideAttribution: true }}
        className={`!bg-[var(--background)] ${isMobile ? "!touch-none" : ""}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--canvas-dot)" />
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
            const groupId = whiteboardGroupIdFromNodeId(n.id);
            if (groupId) return activeWhiteboardGroups.find((group) => group.id === groupId)?.color || "#22d3a7";
            const type = n.data?.nodeType as string;
            const bi = n.data?.branchIndex as number;
            if (bi && bi > 0) return BRANCH_COLORS[bi % BRANCH_COLORS.length];
            const colorMap: Record<string, string> = {
              topic: "#22d3a7", concept: "#38bdf8", detail: "#818cf8", question: "#f472b6",
            };
            return colorMap[type] || "#818cf8";
          }}
          maskColor="var(--canvas-minimap-mask)"
        />
      </ReactFlow>
    </div>
  );
}
