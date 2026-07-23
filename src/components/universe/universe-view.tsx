"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { IS_LOCAL_MODE } from "@/lib/client-api";
import { isMapForMode, MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";
import { tenantCache, tenantScopeKey, type TenantScope } from "@/lib/tenant-cache";
import { useMindGrowStore, type AppMode } from "@/store/mindgrow-store";
import { EntityDetailPanel } from "@/components/entity/entity-detail-panel";
import type { Citation } from "@/types";
import { graphEdgeFocusOpacity, graphNodeFocusOpacity, oneHopNodeIds } from "@/lib/graph-hover";
import { THEME_CHANGE_EVENT } from "@/lib/theme";
import { groupWorkspaceEntities } from "@/lib/unified-entity-graph";
import {
  fetchUniverseLibraries,
  universeFallbackWarning,
  type LibraryGraph,
} from "@/components/universe/universe-loader";
import { useLocale } from "@/components/i18n/locale-provider";

const UNIVERSE_CACHE_TTL_MS = 60_000;
const LOCAL_TENANT_SCOPE: TenantScope = { userId: "local-user", workspaceId: "local-workspace" };

export type UniverseRefKind = "library" | "knowledge-node" | "entity";

export interface GraphNode {
  id: string;
  mapId: string;
  mapName: string;
  label: string;
  type: string;
  refKind: UniverseRefKind;
  refId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  sourceMapCount?: number;
  sourceMapIds?: string[];
  entityOccurrences?: { mapId: string; entityId: string }[];
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  strength: number;
  kind: "hierarchy" | "relation" | "cross-library";
  label: string;
  relationId?: string;
  explanation?: string;
  citations?: Citation[];
}

const TYPE_COLORS: Record<string, string> = {
  topic: "#22d3a7",
  concept: "#38bdf8",
  detail: "#818cf8",
  question: "#f472b6",
};

const GENERIC_TERMS = new Set(["研究", "方法", "模型", "数据", "系统", "结果", "分析", "文章", "知识", "内容", "问题", "应用", "the", "and", "for", "with", "from"]);

function hashNumber(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function normalizedLabel(value: string) {
  return value.toLocaleLowerCase().replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？；：、“”‘’（）【】《》·…—]+/g, "").slice(0, 80);
}

function topicTerms(value: string) {
  const lower = value.toLocaleLowerCase();
  const terms = new Set<string>();
  for (const word of lower.match(/[a-z][a-z0-9-]{2,}/g) || []) {
    if (!GENERIC_TERMS.has(word)) terms.add(word);
  }
  for (const run of lower.match(/[\u3400-\u9fff]{2,}/g) || []) {
    for (let index = 0; index < Math.min(run.length - 1, 18); index += 1) {
      const term = run.slice(index, index + 2);
      if (!GENERIC_TERMS.has(term)) terms.add(term);
    }
  }
  return terms;
}

export function buildUniverseData(libraries: LibraryGraph[]): { nodes: GraphNode[]; links: GraphLink[]; crossLibraryCount: number } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const libraryTerms = new Map<string, Set<string>>();
  const exactConcepts = new Map<string, GraphNode[]>();
  const libraryCount = Math.max(1, libraries.length);
  const clusterPositions = new Map(libraries.map((library, libraryIndex) => {
    const clusterAngle = (libraryIndex / libraryCount) * Math.PI * 2 - Math.PI / 2;
    const clusterDistance = libraryCount === 1 ? 0 : 340 + libraryCount * 28;
    return [library.map.id, {
      x: Math.cos(clusterAngle) * clusterDistance,
      y: Math.sin(clusterAngle) * clusterDistance,
    }] as const;
  }));
  const workspaceEntityGroups = groupWorkspaceEntities(libraries);
  const groupByOccurrence = new Map(workspaceEntityGroups.flatMap((group) => (
    group.occurrences.map((occurrence) => [`${occurrence.mapId}:${occurrence.entity.id}`, group] as const)
  )));
  const addedWorkspaceEntityIds = new Set<string>();

  libraries.forEach((library) => {
    const cluster = clusterPositions.get(library.map.id) || { x: 0, y: 0 };
    const clusterX = cluster.x;
    const clusterY = cluster.y;
    const hubId = `library:${library.map.id}`;
    nodes.push({
      id: hubId,
      mapId: library.map.id,
      mapName: library.map.name,
      label: library.map.name,
      type: "library",
      refKind: "library",
      refId: library.map.id,
      x: clusterX,
      y: clusterY,
      vx: 0,
      vy: 0,
      radius: 18 + Math.min(18, Math.sqrt(library.nodes.length) * 2),
      color: library.map.color || "#22d3a7",
    });

    const scopedNodes = library.nodes.slice(0, 90);
    const scopedIds = new Set(scopedNodes.map((node) => node.id));
    const incomingContains = new Set(library.edges.filter((edge) => edge.relation === "contains").map((edge) => edge.targetId));
    const terms = new Set<string>();
    libraryTerms.set(library.map.id, terms);

    scopedNodes.forEach((node, nodeIndex) => {
      const seed = hashNumber(`${library.map.id}:${node.id}`);
      const angle = (nodeIndex / Math.max(1, scopedNodes.length)) * Math.PI * 2 + (seed % 37) / 37;
      const distance = 95 + (seed % 170);
      const graphNode: GraphNode = {
        id: `${library.map.id}:${node.id}`,
        mapId: library.map.id,
        mapName: library.map.name,
        label: node.content,
        type: node.type,
        refKind: "knowledge-node",
        refId: node.id,
        x: clusterX + Math.cos(angle) * distance,
        y: clusterY + Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        radius: node.type === "topic" ? 10 : node.type === "concept" ? 7 : 5,
        color: TYPE_COLORS[node.type] || "#818cf8",
      };
      nodes.push(graphNode);
      topicTerms(node.content).forEach((term) => terms.add(term));
      const exact = normalizedLabel(node.content);
      if (exact.length >= 2 && node.type !== "detail") {
        const entries = exactConcepts.get(exact) || [];
        entries.push(graphNode);
        exactConcepts.set(exact, entries);
      }
      if (!incomingContains.has(node.id)) {
        links.push({ id: `hierarchy:${hubId}:${graphNode.id}`, source: hubId, target: graphNode.id, strength: 0.85, kind: "hierarchy", label: "知识库主干" });
      }
    });

    const entityNodeIds = new Map<string, string>();
    library.entityGraph.entities.slice(0, 60).forEach((entity) => {
      const workspaceGroup = groupByOccurrence.get(`${library.map.id}:${entity.id}`);
      if (!workspaceGroup) return;
      const graphId = `entity:${workspaceGroup.id}`;
      entityNodeIds.set(entity.id, graphId);
      if (addedWorkspaceEntityIds.has(graphId)) return;
      addedWorkspaceEntityIds.add(graphId);
      const centers = workspaceGroup.sourceMapIds
        .map((mapId) => clusterPositions.get(mapId))
        .filter((value): value is { x: number; y: number } => Boolean(value));
      const center = centers.reduce((sum, value) => ({ x: sum.x + value.x, y: sum.y + value.y }), { x: 0, y: 0 });
      const baseX = center.x / Math.max(1, centers.length);
      const baseY = center.y / Math.max(1, centers.length);
      const seed = hashNumber(graphId);
      const angle = ((seed % 360) / 360) * Math.PI * 2;
      const sharedAcrossMaps = workspaceGroup.sourceMapIds.length > 1;
      const distance = sharedAcrossMaps ? 35 + (seed % 80) : 120 + (seed % 190);
      const primary = workspaceGroup.primary;
      const graphNode: GraphNode = {
        id: graphId,
        mapId: primary.mapId,
        mapName: sharedAcrossMaps
          ? `${workspaceGroup.sourceMapIds.length} 个知识库：${workspaceGroup.sourceMapNames.join("、")}`
          : primary.mapName,
        label: workspaceGroup.canonicalName,
        type: "entity",
        refKind: "entity",
        refId: primary.entity.id,
        x: baseX + Math.cos(angle) * distance,
        y: baseY + Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        radius: sharedAcrossMaps ? 9 : 6.5,
        color: sharedAcrossMaps ? "#f59e0b" : "#a78bfa",
        sourceMapCount: workspaceGroup.sourceMapIds.length,
        sourceMapIds: workspaceGroup.sourceMapIds,
        entityOccurrences: workspaceGroup.occurrences.map((occurrence) => ({
          mapId: occurrence.mapId,
          entityId: occurrence.entity.id,
        })),
      };
      nodes.push(graphNode);
      workspaceGroup.occurrences.forEach((occurrence) => {
        const targetTerms = libraryTerms.get(occurrence.mapId);
        topicTerms(`${occurrence.entity.canonicalName} ${occurrence.entity.description}`).forEach((term) => targetTerms?.add(term));
      });
      const exact = normalizedLabel(workspaceGroup.canonicalName);
      if (exact.length >= 2) {
        const entries = exactConcepts.get(exact) || [];
        entries.push(graphNode);
        exactConcepts.set(exact, entries);
      }
    });
    library.entityGraph.relations.forEach((relation) => {
      const source = entityNodeIds.get(relation.sourceId);
      const target = entityNodeIds.get(relation.targetId);
      if (!source || !target) return;
      links.push({
        id: `entity-relation:${library.map.id}:${relation.id}`,
        source,
        target,
        strength: relation.confidence,
        kind: "relation",
        label: relation.shortLabel || relation.label,
        relationId: relation.id,
        explanation: relation.explanation,
        citations: relation.citations,
      });
    });

    library.edges.forEach((edge) => {
      if (!scopedIds.has(edge.sourceId) || !scopedIds.has(edge.targetId)) return;
      links.push({
        id: `knowledge-edge:${library.map.id}:${edge.id}`,
        source: `${library.map.id}:${edge.sourceId}`,
        target: `${library.map.id}:${edge.targetId}`,
        strength: edge.weight || 0.6,
        kind: edge.relation === "contains" ? "hierarchy" : "relation",
        label: edge.relation === "contains" ? "包含" : edge.relation === "contradicts" ? "观点冲突" : "概念关联",
        relationId: edge.relationId,
        explanation: edge.relationExplanation,
        citations: edge.citations,
      });
    });
  });

  const crossPairs = new Set<string>();
  exactConcepts.forEach((matches) => {
    const byLibrary = new Map<string, GraphNode>();
    matches.forEach((node) => { if (!byLibrary.has(node.mapId)) byLibrary.set(node.mapId, node); });
    const distinct = Array.from(byLibrary.values());
    for (let index = 1; index < distinct.length; index += 1) {
      const left = distinct[0];
      const right = distinct[index];
      const key = [left.id, right.id].sort().join("|");
      if (crossPairs.has(key)) continue;
      crossPairs.add(key);
      links.push({ id: `cross-concept:${key}`, source: left.id, target: right.id, strength: 0.9, kind: "cross-library", label: `共享概念：${left.label}` });
    }
  });

  // When two libraries have no exact duplicate concept, connect their hubs if
  // their topic vocabularies overlap. This is a derived navigation signal, not
  // a fabricated source citation, so the percentage is shown explicitly.
  for (let leftIndex = 0; leftIndex < libraries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < libraries.length; rightIndex += 1) {
      const left = libraries[leftIndex];
      const right = libraries[rightIndex];
      const leftTerms = libraryTerms.get(left.map.id) || new Set<string>();
      const rightTerms = libraryTerms.get(right.map.id) || new Set<string>();
      const shared = Array.from(leftTerms).filter((term) => rightTerms.has(term));
      const unionSize = new Set([...Array.from(leftTerms), ...Array.from(rightTerms)]).size || 1;
      const similarity = shared.length / unionSize;
      if (similarity < 0.06 || shared.length < 2) continue;
      links.push({
        id: `cross-library:${left.map.id}:${right.map.id}`,
        source: `library:${left.map.id}`,
        target: `library:${right.map.id}`,
        strength: Math.min(1, 0.45 + similarity * 2),
        kind: "cross-library",
        label: `主题相关 ${Math.round(similarity * 100)}%`,
      });
    }
  }

  const sharedEntityCount = workspaceEntityGroups.filter((group) => group.sourceMapIds.length > 1).length;
  return {
    nodes,
    links,
    crossLibraryCount: sharedEntityCount + links.filter((link) => link.kind === "cross-library").length,
  };
}

function simulateForceLayout(nodes: GraphNode[], links: GraphLink[], iterations = 72) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (left.refKind === "library" || right.refKind === "library" ? 3600 : 1500) / (distance * distance);
        const forceX = (dx / distance) * force;
        const forceY = (dy / distance) * force;
        left.vx -= forceX;
        left.vy -= forceY;
        right.vx += forceX;
        right.vy += forceY;
      }
    }
    links.forEach((link) => {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = link.kind === "cross-library" ? 300 : link.kind === "relation" ? 155 : 105;
      const force = (distance - ideal) * 0.0035 * link.strength;
      source.vx += (dx / distance) * force;
      source.vy += (dy / distance) * force;
      target.vx -= (dx / distance) * force;
      target.vy -= (dy / distance) * force;
    });
    nodes.forEach((node) => {
      node.vx += -node.x * 0.00025;
      node.vy += -node.y * 0.00025;
      node.vx *= 0.88;
      node.vy *= 0.88;
      node.x += node.vx;
      node.y += node.vy;
    });
  }
  return nodes;
}

export function pointToSegmentDistance(
  pointX: number,
  pointY: number,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  if (dx === 0 && dy === 0) return Math.hypot(pointX - sourceX, pointY - sourceY);
  const projection = Math.max(0, Math.min(1, ((pointX - sourceX) * dx + (pointY - sourceY) * dy) / (dx * dx + dy * dy)));
  const closestX = sourceX + projection * dx;
  const closestY = sourceY + projection * dy;
  return Math.hypot(pointX - closestX, pointY - closestY);
}

export function UniverseView() {
  const { locale } = useLocale();
  const english = locale === "en";
  const router = useRouter();
  const { user, currentWorkspace } = useAuth();
  const tenantScope = useMemo<TenantScope | null>(() => {
    if (IS_LOCAL_MODE) return LOCAL_TENANT_SCOPE;
    if (!user?.id || !currentWorkspace?.id) return null;
    return { userId: user.id, workspaceId: currentWorkspace.id };
  }, [currentWorkspace?.id, user?.id]);
  const activeTenantScopeKey = tenantScope ? tenantScopeKey(tenantScope) : null;
  const currentMode = useMindGrowStore((state) => state.currentMode);
  const setCurrentMode = useMindGrowStore((state) => state.setCurrentMode);
  const setCurrentMapId = useMindGrowStore((state) => state.setCurrentMapId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusAnimationFrameRef = useRef<number | null>(null);
  const focusNodeRef = useRef<string | null>(null);
  const focusProgressRef = useRef(0);
  const loadRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const activeTenantScopeKeyRef = useRef<string | null>(activeTenantScopeKey);
  activeTenantScopeKeyRef.current = activeTenantScopeKey;
  const [libraries, setLibraries] = useState<LibraryGraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
  const [selectedEntityNodeId, setSelectedEntityNodeId] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.82);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scope, setScope] = useState<"all" | AppMode>(currentMode);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const handleThemeChange = () => setThemeRevision((value) => value + 1);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested === "knowledge" || requested === "meeting" || requested === "article") {
      setCurrentMode(requested as AppMode);
      setScope(requested as AppMode);
    }
  }, [setCurrentMode]);

  useEffect(() => {
    setScope(currentMode);
  }, [currentMode]);

  useEffect(() => {
    const requestId = ++loadRequestRef.current;
    loadAbortRef.current?.abort();
    if (!tenantScope) {
      setLibraries([]);
      setLoading(true);
      setError("");
      setWarning("");
      return;
    }
    const requestedScopeKey = tenantScopeKey(tenantScope);
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const cacheReadToken = tenantCache.beginUniverseRead(tenantScope);
    const cachedEntry = tenantCache.getUniverseSnapshot(tenantScope);
    const cached = cachedEntry && Date.now() - cachedEntry.storedAt < UNIVERSE_CACHE_TTL_MS
      ? cachedEntry.snapshot.libraries
      : null;
    if (cached) setLibraries(cached);
    setLoading(!cached);
    setError("");
    setWarning("");
    if (!cached) setLibraries([]);
    setHoveredNode(null);
    setHoveredLinkId(null);
    setSelectedEntityNodeId(null);
    setOffset({ x: 0, y: 0 });
    setZoom(0.82);
    void fetchUniverseLibraries(controller.signal)
      .then((result) => {
        if (requestId !== loadRequestRef.current || activeTenantScopeKeyRef.current !== requestedScopeKey) return;
        if (!tenantCache.commitUniverseSnapshot(cacheReadToken, { libraries: result.libraries })) return;
        const committed = tenantCache.getUniverseSnapshot(tenantScope);
        if (committed) setLibraries(committed.snapshot.libraries);
        setWarning(universeFallbackWarning(result));
      })
      .catch((reason) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        if (requestId === loadRequestRef.current && activeTenantScopeKeyRef.current === requestedScopeKey) {
          setError(reason instanceof Error ? reason.message : "知识宇宙加载失败");
        }
      })
      .finally(() => {
        if (requestId === loadRequestRef.current && activeTenantScopeKeyRef.current === requestedScopeKey) setLoading(false);
      });
    return () => {
      controller.abort();
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
    };
  }, [reloadToken, tenantScope]);

  useEffect(() => {
    setHoveredNode(null);
    setHoveredLinkId(null);
    setSelectedEntityNodeId(null);
    setOffset({ x: 0, y: 0 });
    setZoom(0.82);
  }, [scope]);

  const visibleLibraries = useMemo(
    () => libraries.filter((library) => scope === "all" || isMapForMode(library.map, scope)),
    [libraries, scope],
  );

  const universeData = useMemo(() => buildUniverseData(visibleLibraries), [visibleLibraries]);
  const positionedNodes = useMemo(
    () => simulateForceLayout(universeData.nodes.map((node) => ({ ...node })), universeData.links),
    [universeData],
  );
  const activeFocusNodeId = hoveredNode || selectedEntityNodeId;
  const activeFocusNeighbors = useMemo(
    () => oneHopNodeIds(activeFocusNodeId, universeData.links),
    [activeFocusNodeId, universeData.links],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.canvasThemeRevision = String(themeRevision);
    const context = canvas.getContext("2d");
    if (!context) return;
    const computedStyle = getComputedStyle(canvas);
    const themeColor = (name: string, fallback: string) => computedStyle.getPropertyValue(name).trim() || fallback;
    const canvasColors = {
      background: themeColor("--bg-base", "#0a0a0f"),
      star: themeColor("--canvas-star", "rgba(255,255,255,0.12)"),
      edge: themeColor("--canvas-edge-muted", "rgba(255,255,255,0.075)"),
      relation: themeColor("--canvas-relation", "rgba(244,114,182,0.34)"),
      crossLibrary: themeColor("--canvas-cross-library", "rgba(250,204,21,0.58)"),
      edgeHover: themeColor("--canvas-edge-hover", "rgba(221,214,254,0.95)"),
      nodeStroke: themeColor("--canvas-node-stroke", "rgba(255,255,255,0.69)"),
      label: themeColor("--canvas-label", "#d4d4d8"),
      labelStrong: themeColor("--canvas-label-strong", "#fafafa"),
      labelMuted: themeColor("--canvas-label-muted", "#a1a1aa"),
      labelAccent: themeColor("--canvas-label-accent", "#ddd6fe"),
      crossLabel: themeColor("--canvas-cross-label", "#fde68a"),
    };
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
    const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = canvasColors.background;
    context.fillRect(0, 0, rect.width, rect.height);
    for (let index = 0; index < 120; index += 1) {
      const x = (index * 137.5) % Math.max(1, rect.width);
      const y = (index * 73.3) % Math.max(1, rect.height);
      context.globalAlpha = 0.65 + (index % 5) * 0.08;
      context.fillStyle = canvasColors.star;
      context.fillRect(x, y, 1, 1);
    }
    context.globalAlpha = 1;
    const centerX = rect.width / 2 + offset.x;
    const centerY = rect.height / 2 + offset.y;
    const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    const focusNodeId = focusNodeRef.current;
    const focusNeighbors = oneHopNodeIds(focusNodeId, universeData.links);
    const focusProgress = focusProgressRef.current;
    universeData.links.forEach((link) => {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) return;
      const isHoveredLink = link.id === hoveredLinkId;
      const sourceX = centerX + source.x * zoom;
      const sourceY = centerY + source.y * zoom;
      const targetX = centerX + target.x * zoom;
      const targetY = centerY + target.y * zoom;
      context.save();
      context.globalAlpha = graphEdgeFocusOpacity(link, focusNodeId, focusProgress);
      context.beginPath();
      context.moveTo(sourceX, sourceY);
      context.lineTo(targetX, targetY);
      context.setLineDash(link.kind === "cross-library" ? [7, 5] : link.kind === "relation" ? [4, 4] : []);
      context.strokeStyle = isHoveredLink ? canvasColors.edgeHover : link.kind === "cross-library" ? canvasColors.crossLibrary : link.kind === "relation" ? canvasColors.relation : canvasColors.edge;
      context.lineWidth = isHoveredLink ? 2.4 : link.kind === "cross-library" ? 1.4 : link.kind === "relation" ? 1 : 0.65;
      context.stroke();
      context.setLineDash([]);
      if (isHoveredLink) {
        context.font = "11px sans-serif";
        context.textAlign = "center";
        context.fillStyle = link.kind === "cross-library" ? canvasColors.crossLabel : canvasColors.labelAccent;
        const linkLabel = link.label.length > 34 ? `${link.label.slice(0, 33)}…` : link.label;
        context.fillText(linkLabel, (sourceX + targetX) / 2, (sourceY + targetY) / 2 - 7);
      }
      context.restore();
    });
    positionedNodes.forEach((node) => {
      const isHovered = node.id === hoveredNode;
      const x = centerX + node.x * zoom;
      const y = centerY + node.y * zoom;
      const radius = Math.max(3, node.radius * Math.sqrt(zoom)) * (isHovered ? 1.3 : 1);
      context.save();
      context.globalAlpha = graphNodeFocusOpacity(node.id, focusNeighbors, focusProgress);
      if (isHovered || node.refKind === "library") {
        const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3);
        glow.addColorStop(0, `${node.color}45`);
        glow.addColorStop(1, "transparent");
        context.fillStyle = glow;
        context.beginPath();
        context.arc(x, y, radius * 3, 0, Math.PI * 2);
        context.fill();
      }
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `${node.color}${node.refKind === "library" ? "e8" : isHovered ? "ff" : "88"}`;
      context.fill();
      context.strokeStyle = node.refKind === "library" ? canvasColors.nodeStroke : node.color;
      context.lineWidth = node.refKind === "library" ? 1.6 : isHovered ? 1.5 : 0.5;
      context.stroke();
      if (node.refKind === "library" || isHovered || (node.type === "topic" && zoom >= 0.75)) {
        context.font = node.refKind === "library" ? "600 13px sans-serif" : isHovered ? "12px sans-serif" : "10px sans-serif";
        context.fillStyle = node.refKind === "library" ? canvasColors.labelStrong : canvasColors.label;
        context.textAlign = "center";
        const label = node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label;
        context.fillText(label, x, y + radius + 15);
        if (isHovered && node.refKind !== "library") {
          context.font = "10px sans-serif";
          context.fillStyle = canvasColors.labelMuted;
          context.fillText(node.mapName, x, y + radius + 29);
        }
      }
      context.restore();
    });
  }, [hoveredLinkId, hoveredNode, offset, positionedNodes, themeRevision, universeData.links, zoom]);

  useEffect(() => {
    if (activeFocusNodeId) focusNodeRef.current = activeFocusNodeId;
    const target = activeFocusNodeId ? 1 : 0;
    const initial = focusProgressRef.current;
    const startedAt = performance.now();
    if (focusAnimationFrameRef.current !== null) cancelAnimationFrame(focusAnimationFrameRef.current);

    const animateFocus = (timestamp: number) => {
      const elapsed = Math.min(1, (timestamp - startedAt) / 200);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      focusProgressRef.current = initial + (target - initial) * eased;
      draw();
      if (elapsed < 1) {
        focusAnimationFrameRef.current = requestAnimationFrame(animateFocus);
      } else {
        focusAnimationFrameRef.current = null;
        if (!activeFocusNodeId) focusNodeRef.current = null;
      }
    };
    focusAnimationFrameRef.current = requestAnimationFrame(animateFocus);
    return () => {
      if (focusAnimationFrameRef.current !== null) cancelAnimationFrame(focusAnimationFrameRef.current);
      focusAnimationFrameRef.current = null;
    };
  }, [activeFocusNodeId, draw]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  const locateNode = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const worldX = (clientX - rect.left - rect.width / 2 - offset.x) / zoom;
    const worldY = (clientY - rect.top - rect.height / 2 - offset.y) / zoom;
    return positionedNodes.find((node) => {
      const dx = worldX - node.x;
      const dy = worldY - node.y;
      const hitRadius = Math.max(node.radius, 8) / Math.sqrt(zoom);
      return dx * dx + dy * dy <= hitRadius * hitRadius;
    }) || null;
  }, [offset, positionedNodes, zoom]);

  const locateLink = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2 + offset.x;
    const centerY = rect.top + rect.height / 2 + offset.y;
    const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    let closest: { link: GraphLink; distance: number } | null = null;
    for (const link of universeData.links) {
      if (link.kind === "hierarchy") continue;
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) continue;
      const distance = pointToSegmentDistance(
        clientX,
        clientY,
        centerX + source.x * zoom,
        centerY + source.y * zoom,
        centerX + target.x * zoom,
        centerY + target.y * zoom,
      );
      if (distance <= 7 && (!closest || distance < closest.distance)) closest = { link, distance };
    }
    return closest?.link || null;
  }, [offset, positionedNodes, universeData.links, zoom]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragging) {
      setOffset((current) => ({ x: current.x + event.clientX - dragStart.x, y: current.y + event.clientY - dragStart.y }));
      setDragStart({ x: event.clientX, y: event.clientY });
      return;
    }
    const node = locateNode(event.clientX, event.clientY);
    setHoveredNode(node?.id || null);
    setHoveredLinkId(node ? null : locateLink(event.clientX, event.clientY)?.id || null);
  }, [dragStart, dragging, locateLink, locateNode]);

  const changeZoom = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const bounded = Math.min(2.5, Math.max(0.28, nextZoom));
    const canvas = canvasRef.current;
    if (canvas && clientX !== undefined && clientY !== undefined) {
      const rect = canvas.getBoundingClientRect();
      const relativeX = clientX - rect.left - rect.width / 2 - offset.x;
      const relativeY = clientY - rect.top - rect.height / 2 - offset.y;
      const ratio = bounded / zoom;
      setOffset((current) => ({ x: current.x + relativeX * (1 - ratio), y: current.y + relativeY * (1 - ratio) }));
    }
    setZoom(bounded);
  }, [offset, zoom]);

  const openNodeLibrary = useCallback((node: GraphNode) => {
    const library = visibleLibraries.find((item) => item.map.id === node.mapId);
    if (library) {
      const mode: AppMode = isMapForMode(library.map, "article") ? "article" : isMapForMode(library.map, "meeting") ? "meeting" : "knowledge";
      setCurrentMode(mode);
    }
    setCurrentMapId(node.mapId);
    router.push("/");
  }, [visibleLibraries, router, setCurrentMapId, setCurrentMode]);

  const selectedEntityNode = selectedEntityNodeId
    ? positionedNodes.find((node) => node.id === selectedEntityNodeId && node.refKind === "entity") || null
    : null;
  const selectedEntityContext = useMemo(() => {
    if (!selectedEntityNode) return null;
    const occurrences = selectedEntityNode.entityOccurrences || [{ mapId: selectedEntityNode.mapId, entityId: selectedEntityNode.refId }];
    const occurrenceIds = new Set(occurrences.map((item) => item.entityId));
    const sourceLibraries = visibleLibraries.filter((library) => occurrences.some((item) => item.mapId === library.map.id));
    const records = occurrences.flatMap((occurrence) => {
      const library = sourceLibraries.find((item) => item.map.id === occurrence.mapId);
      const entity = library?.entityGraph.entities.find((item) => item.id === occurrence.entityId);
      return entity ? [{ library, entity }] : [];
    });
    const primary = records.find((record) => (
      record.library?.map.id === selectedEntityNode.mapId && record.entity.id === selectedEntityNode.refId
    )) || records[0];
    if (!primary?.library) return null;
    const citationKey = (citation: Citation) => `${citation.documentId || "source"}:${citation.index}:${citation.quote}`;
    const mergeCitations = (items: Citation[][]) => Array.from(new Map(items.flat().map((citation) => [citationKey(citation), citation])).values());
    const mergedEntity = {
      ...primary.entity,
      aliases: Array.from(new Set(records.flatMap((record) => [record.entity.canonicalName, ...(record.entity.aliases || [])])))
        .filter((alias) => alias && alias !== primary.entity.canonicalName),
      citations: mergeCitations(records.map((record) => record.entity.citations || [])),
      descriptionCitations: mergeCitations(records.map((record) => record.entity.descriptionCitations || [])),
    };
    const relations = sourceLibraries.flatMap((library) => library.entityGraph.relations)
      .filter((relation) => occurrenceIds.has(relation.sourceId) || occurrenceIds.has(relation.targetId))
      .map((relation) => ({
        ...relation,
        sourceId: occurrenceIds.has(relation.sourceId) ? mergedEntity.id : relation.sourceId,
        targetId: occurrenceIds.has(relation.targetId) ? mergedEntity.id : relation.targetId,
      }))
      .filter((relation) => relation.sourceId !== relation.targetId);
    const entities = [
      mergedEntity,
      ...sourceLibraries.flatMap((library) => library.entityGraph.entities).filter((entity) => !occurrenceIds.has(entity.id)),
    ];
    return { entity: mergedEntity, entities, relations, library: primary.library };
  }, [selectedEntityNode, visibleLibraries]);
  const hoveredLink = hoveredLinkId ? universeData.links.find((link) => link.id === hoveredLinkId) || null : null;

  const closeUniverseEntity = useCallback(() => setSelectedEntityNodeId(null), []);
  const locateUniverseEntity = useCallback(() => {
    if (!selectedEntityNode) return;
    const targetZoom = Math.max(1.05, zoom);
    setZoom(targetZoom);
    setOffset({ x: -selectedEntityNode.x * targetZoom, y: -selectedEntityNode.y * targetZoom });
    setHoveredNode(selectedEntityNode.id);
    setHoveredLinkId(null);
  }, [selectedEntityNode, zoom]);
  const openSelectedEntityLibrary = useCallback(() => {
    if (selectedEntityNode) openNodeLibrary(selectedEntityNode);
  }, [openNodeLibrary, selectedEntityNode]);

  const totalNodes = visibleLibraries.reduce((sum, library) => sum + library.nodes.length, 0);
  const modeConfig = english
    ? ({ all: { label: "Unified Knowledge", shortLabel: "All" }, knowledge: { label: "Knowledge", shortLabel: "Knowledge" }, article: { label: "Article", shortLabel: "Articles" }, meeting: { label: "Meeting", shortLabel: "Meetings" } } as const)[scope]
    : scope === "all" ? { label: "统一知识", shortLabel: "全部" } : MODE_LIBRARY_CONFIG[scope];

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[var(--bg-base)]"
      data-testid="universe-view"
      data-universe-mode={scope}
      data-universe-library-ids={visibleLibraries.map((library) => library.map.id).sort().join(",")}
    >
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${dragging ? "cursor-grabbing" : hoveredNode ? "cursor-pointer" : hoveredLinkId ? "cursor-help" : "cursor-grab"}`}
        onMouseMove={handleMouseMove}
        onMouseDown={(event) => { setDragging(true); setDragStart({ x: event.clientX, y: event.clientY }); }}
        onMouseUp={(event) => {
          const moved = Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y);
          setDragging(false);
          const node = locateNode(event.clientX, event.clientY);
          if (moved >= 5 || !node) return;
          if (node.refKind === "entity") {
            setSelectedEntityNodeId(node.id);
            setHoveredLinkId(null);
          } else {
            openNodeLibrary(node);
          }
        }}
        onMouseLeave={() => { setDragging(false); setHoveredNode(null); setHoveredLinkId(null); }}
        onWheel={(event) => { event.preventDefault(); changeZoom(zoom * (event.deltaY < 0 ? 1.12 : 0.89), event.clientX, event.clientY); }}
        aria-label={english ? `${modeConfig.label} universe, draggable and zoomable` : `${modeConfig.label}知识宇宙，可拖动和缩放`}
        data-focus-node-id={activeFocusNodeId || ""}
        data-focus-neighbor-count={activeFocusNeighbors?.size || 0}
        data-canvas-theme-revision={themeRevision}
      />

      <div className="absolute left-4 top-16 z-30 max-w-[min(620px,calc(100%-2rem))] rounded-2xl border border-[var(--border-default)] bg-[var(--tooltip-bg)] p-4 shadow-[var(--shadow-md)] backdrop-blur-xl">
        <div className="text-sm font-semibold text-[var(--text-primary)]">🌌 {modeConfig.label}{english ? " Universe" : "宇宙"}</div>
        <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{english ? `${visibleLibraries.length} libraries · ${totalNodes} nodes · ` : `${visibleLibraries.length} 个知识库 · ${totalNodes} 个节点 · `}<span data-testid="universe-cross-library-count" data-count={universeData.crossLibraryCount}>{universeData.crossLibraryCount}</span>{english ? " shared entities and cross-library relations" : " 个共享实体与跨库关系"}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--text-secondary)]">
          <span><i className="mr-1 inline-block h-px w-4 bg-[var(--canvas-edge)] align-middle" />{english ? "Library hierarchy" : "库内层级"}</span>
          <span><i className="mr-1 inline-block h-px w-4 border-t border-dashed border-pink-300/70 align-middle" />{english ? "Concept link" : "概念关联"}</span>
          <span><i className="mr-1 inline-block h-px w-4 border-t border-dashed border-yellow-300/80 align-middle" />{english ? "Cross-library growth" : "跨库生长关系"}</span>
        </div>
        <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">{english ? "Hover a node for one-hop relations, hover an edge for evidence, or click an entity to keep focus and read its explanation." : "悬停节点突出一跳关系；悬停连线查看证据；点击实体保留一跳焦点并查看解释。"}</div>
        <div className="mt-3 flex flex-wrap gap-1" data-testid="universe-scope-switch">
          {(["all", "knowledge", "article", "meeting"] as const).map((item) => <button key={item} type="button" onClick={() => setScope(item)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${scope === item ? "bg-violet-600 text-white" : "border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>{english ? ({ all: "All knowledge", knowledge: "Knowledge", article: "Articles", meeting: "Meetings" } as const)[item] : item === "all" ? "全部知识" : item === "knowledge" ? "知识碎片" : item === "article" ? "文章" : "会议"}</button>)}
        </div>
      </div>

      <div className="absolute right-4 top-4 z-40 flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--tooltip-bg)] p-1 shadow-xl backdrop-blur">
        <button type="button" onClick={() => changeZoom(zoom / 1.18)} aria-label="缩小知识宇宙" title="缩小" className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">−</button>
        <button type="button" onClick={() => { setZoom(0.82); setOffset({ x: 0, y: 0 }); }} aria-label="重置知识宇宙视图" title="适应画布" className="min-w-14 rounded-lg px-2 py-2 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => changeZoom(zoom * 1.18)} aria-label="放大知识宇宙" title="放大" className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">＋</button>
      </div>

      {hoveredLink && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-violet-400/30 bg-[var(--tooltip-bg)] px-4 py-3 text-xs text-[var(--text-primary)] shadow-2xl backdrop-blur" data-testid="universe-link-hover" data-link-id={hoveredLink.id}>
          <div className="font-semibold text-violet-500">{hoveredLink.label}</div>
          {hoveredLink.explanation && <p className="mt-1 line-clamp-2 text-[10px] leading-5 text-[var(--text-secondary)]">{hoveredLink.explanation}</p>}
          {(hoveredLink.citations || []).length > 0 && <div className="mt-1 text-[9px] text-[var(--text-tertiary)]">{hoveredLink.citations?.length} 条可核验引用</div>}
        </div>
      )}

      {selectedEntityContext && selectedEntityNode && (
        <EntityDetailPanel
          entity={selectedEntityContext.entity}
          entities={selectedEntityContext.entities}
          relations={selectedEntityContext.relations}
          mapName={selectedEntityNode.mapName}
          onClose={closeUniverseEntity}
          onLocate={locateUniverseEntity}
          onOpenLibrary={openSelectedEntityLibrary}
          className="md:top-20"
        />
      )}

      {warning && <div role="status" className="absolute bottom-4 left-1/2 z-40 flex max-w-[min(620px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-300/25 bg-amber-950/90 px-4 py-2 text-xs text-amber-100 shadow-xl backdrop-blur">
        <span>{warning}</span>
        <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="shrink-0 rounded-lg border border-amber-200/30 px-2 py-1 font-semibold hover:bg-white/10">重新加载</button>
      </div>}

      {(loading || error || (!loading && visibleLibraries.length === 0)) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--overlay-bg)] px-6">
          <div className="max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--tooltip-bg)] p-6 text-center shadow-2xl">
            <div className="text-4xl">{error ? "⚠️" : loading ? "🪐" : "🌱"}</div>
            <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{error ? (english ? "Could not load the knowledge universe" : "知识宇宙加载失败") : loading ? (english ? `Connecting ${modeConfig.label} libraries…` : `正在连接${modeConfig.label}知识库…`) : (english ? `${modeConfig.label} Universe is empty` : `${modeConfig.label}宇宙还是一片空地`)}</h2>
            <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">{error || (loading ? (english ? "Collecting in-library relations and shared concepts. Slow requests retry with a bounded wait." : "正在汇总库内关系与跨库共享概念；慢请求会自动重试，不会无限等待。") : (english ? "Create a library and save content; new nodes will grow here." : "先创建知识库并保存内容，新增节点会在这里继续生长。"))}</p>
            {error && <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">重新连接</button>}
          </div>
        </div>
      )}
    </div>
  );
}
