"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { isMapForMode, MODE_LIBRARY_CONFIG } from "@/lib/mode-libraries";
import { useMindGrowStore, type AppMode } from "@/store/mindgrow-store";
import type { EntityGraph, KnowledgeEdge, KnowledgeNode, MindMap } from "@/types";

interface LibraryGraph {
  map: MindMap;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  entityGraph: EntityGraph;
}

const UNIVERSE_REQUEST_TIMEOUT_MS = 12000;
const UNIVERSE_CACHE_TTL_MS = 60_000;
let universeCache: { libraries: LibraryGraph[]; storedAt: number } | null = null;

async function fetchUniverseJson<T>(path: string, attempts = 2): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), UNIVERSE_REQUEST_TIMEOUT_MS);
    try {
      const response = await apiFetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timer);
    }
  }
  if (lastError instanceof Error && lastError.name !== "AbortError") throw lastError;
  throw new Error(`连接超时（已自动重试，单次上限 ${UNIVERSE_REQUEST_TIMEOUT_MS / 1000} 秒）`);
}

async function fetchUniverseLibraries(): Promise<LibraryGraph[]> {
  try {
    const data = await fetchUniverseJson<{ libraries?: LibraryGraph[] }>("/api/knowledge?action=universe", 1);
    if (Array.isArray(data.libraries)) return data.libraries;
  } catch {
    // Older backend versions are still readable while the aggregate endpoint
    // rolls out, so production deployment can remain backward compatible.
  }
  const data = await fetchUniverseJson<{ maps?: MindMap[] }>("/api/knowledge?action=maps");
  let failedGraphs = 0;
  const graphs = await Promise.all(((data.maps || []) as MindMap[]).map(async (map) => {
    try {
      const graph = await fetchUniverseJson<{ nodes?: KnowledgeNode[]; edges?: KnowledgeEdge[]; entityGraph?: EntityGraph }>(`/api/knowledge?mapId=${encodeURIComponent(map.id)}`);
      return { map, nodes: graph.nodes || [], edges: graph.edges || [], entityGraph: graph.entityGraph || { entities: [], relations: [] } } as LibraryGraph;
    } catch {
      failedGraphs += 1;
      return { map, nodes: [], edges: [], entityGraph: { entities: [], relations: [] } } as LibraryGraph;
    }
  }));
  if (failedGraphs === graphs.length && graphs.length > 0) throw new Error("知识宇宙加载失败");
  return graphs;
}

interface GraphNode {
  id: string;
  mapId: string;
  mapName: string;
  label: string;
  type: string;
  kind: "library" | "knowledge";
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

interface GraphLink {
  source: string;
  target: string;
  strength: number;
  kind: "hierarchy" | "relation" | "cross-library";
  label: string;
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

function buildUniverseData(libraries: LibraryGraph[]): { nodes: GraphNode[]; links: GraphLink[]; crossLibraryCount: number } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const libraryTerms = new Map<string, Set<string>>();
  const exactConcepts = new Map<string, GraphNode[]>();
  const libraryCount = Math.max(1, libraries.length);

  libraries.forEach((library, libraryIndex) => {
    const clusterAngle = (libraryIndex / libraryCount) * Math.PI * 2 - Math.PI / 2;
    const clusterDistance = libraryCount === 1 ? 0 : 340 + libraryCount * 28;
    const clusterX = Math.cos(clusterAngle) * clusterDistance;
    const clusterY = Math.sin(clusterAngle) * clusterDistance;
    const hubId = `library:${library.map.id}`;
    nodes.push({
      id: hubId,
      mapId: library.map.id,
      mapName: library.map.name,
      label: library.map.name,
      type: "library",
      kind: "library",
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
        kind: "knowledge",
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
        links.push({ source: hubId, target: graphNode.id, strength: 0.85, kind: "hierarchy", label: "知识库主干" });
      }
    });

    const entityNodeIds = new Map<string, string>();
    library.entityGraph.entities.slice(0, 60).forEach((entity, entityIndex) => {
      const graphId = `${library.map.id}:entity:${entity.id}`;
      entityNodeIds.set(entity.id, graphId);
      const seed = hashNumber(graphId);
      const angle = ((scopedNodes.length + entityIndex) / Math.max(1, scopedNodes.length + library.entityGraph.entities.length)) * Math.PI * 2 + (seed % 31) / 31;
      const distance = 120 + (seed % 190);
      const graphNode: GraphNode = {
        id: graphId, mapId: library.map.id, mapName: library.map.name, label: entity.canonicalName,
        type: "entity", kind: "knowledge", x: clusterX + Math.cos(angle) * distance,
        y: clusterY + Math.sin(angle) * distance, vx: 0, vy: 0, radius: 6.5, color: "#a78bfa",
      };
      nodes.push(graphNode);
      topicTerms(`${entity.canonicalName} ${entity.description}`).forEach((term) => terms.add(term));
      const exact = normalizedLabel(entity.canonicalName);
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
      links.push({ source, target, strength: relation.confidence, kind: "relation", label: relation.label });
    });

    library.edges.forEach((edge) => {
      if (!scopedIds.has(edge.sourceId) || !scopedIds.has(edge.targetId)) return;
      links.push({
        source: `${library.map.id}:${edge.sourceId}`,
        target: `${library.map.id}:${edge.targetId}`,
        strength: edge.weight || 0.6,
        kind: edge.relation === "contains" ? "hierarchy" : "relation",
        label: edge.relation === "contains" ? "包含" : edge.relation === "contradicts" ? "观点冲突" : "概念关联",
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
      links.push({ source: left.id, target: right.id, strength: 0.9, kind: "cross-library", label: `共享概念：${left.label}` });
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
        source: `library:${left.map.id}`,
        target: `library:${right.map.id}`,
        strength: Math.min(1, 0.45 + similarity * 2),
        kind: "cross-library",
        label: `主题相关 ${Math.round(similarity * 100)}%`,
      });
    }
  }

  return { nodes, links, crossLibraryCount: links.filter((link) => link.kind === "cross-library").length };
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
        const force = (left.kind === "library" || right.kind === "library" ? 3600 : 1500) / (distance * distance);
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

export function UniverseView() {
  const router = useRouter();
  const currentMode = useMindGrowStore((state) => state.currentMode);
  const setCurrentMode = useMindGrowStore((state) => state.setCurrentMode);
  const setCurrentMapId = useMindGrowStore((state) => state.setCurrentMapId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadRequestRef = useRef(0);
  const [libraries, setLibraries] = useState<LibraryGraph[]>(() => universeCache?.libraries || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.82);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scope, setScope] = useState<"all" | AppMode>(currentMode);

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
    const cached = universeCache && Date.now() - universeCache.storedAt < UNIVERSE_CACHE_TTL_MS
      ? universeCache.libraries
      : null;
    if (cached) setLibraries(cached);
    setLoading(!cached);
    setError("");
    setWarning("");
    if (!cached) setLibraries([]);
    setHoveredNode(null);
    setOffset({ x: 0, y: 0 });
    setZoom(0.82);
    void fetchUniverseLibraries()
      .then((graphs) => {
        if (requestId === loadRequestRef.current) {
          universeCache = { libraries: graphs, storedAt: Date.now() };
          setLibraries(graphs);
        }
      })
      .catch((reason) => {
        if (requestId === loadRequestRef.current) setError(reason instanceof Error ? reason.message : "知识宇宙加载失败");
      })
      .finally(() => {
        if (requestId === loadRequestRef.current) setLoading(false);
      });
  }, [reloadToken]);

  useEffect(() => {
    setHoveredNode(null);
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#0a0a0f";
    context.fillRect(0, 0, rect.width, rect.height);
    for (let index = 0; index < 120; index += 1) {
      const x = (index * 137.5) % Math.max(1, rect.width);
      const y = (index * 73.3) % Math.max(1, rect.height);
      context.fillStyle = `rgba(255,255,255,${0.08 + (index % 5) * 0.025})`;
      context.fillRect(x, y, 1, 1);
    }
    const centerX = rect.width / 2 + offset.x;
    const centerY = rect.height / 2 + offset.y;
    const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    universeData.links.forEach((link) => {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) return;
      const sourceX = centerX + source.x * zoom;
      const sourceY = centerY + source.y * zoom;
      const targetX = centerX + target.x * zoom;
      const targetY = centerY + target.y * zoom;
      context.beginPath();
      context.moveTo(sourceX, sourceY);
      context.lineTo(targetX, targetY);
      context.setLineDash(link.kind === "cross-library" ? [7, 5] : link.kind === "relation" ? [4, 4] : []);
      context.strokeStyle = link.kind === "cross-library" ? "rgba(250,204,21,0.5)" : link.kind === "relation" ? "rgba(244,114,182,0.28)" : "rgba(255,255,255,0.075)";
      context.lineWidth = link.kind === "cross-library" ? 1.4 : link.kind === "relation" ? 1 : 0.65;
      context.stroke();
      context.setLineDash([]);
      if (link.kind === "cross-library" && (source.id === hoveredNode || target.id === hoveredNode)) {
        context.font = "11px sans-serif";
        context.textAlign = "center";
        context.fillStyle = "#fde68a";
        context.fillText(link.label, (sourceX + targetX) / 2, (sourceY + targetY) / 2 - 6);
      }
    });
    positionedNodes.forEach((node) => {
      const isHovered = node.id === hoveredNode;
      const x = centerX + node.x * zoom;
      const y = centerY + node.y * zoom;
      const radius = Math.max(3, node.radius * Math.sqrt(zoom)) * (isHovered ? 1.3 : 1);
      if (isHovered || node.kind === "library") {
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
      context.fillStyle = `${node.color}${node.kind === "library" ? "e8" : isHovered ? "ff" : "88"}`;
      context.fill();
      context.strokeStyle = node.kind === "library" ? "#ffffffb0" : node.color;
      context.lineWidth = node.kind === "library" ? 1.6 : isHovered ? 1.5 : 0.5;
      context.stroke();
      if (node.kind === "library" || isHovered || (node.type === "topic" && zoom >= 0.75)) {
        context.font = node.kind === "library" ? "600 13px sans-serif" : isHovered ? "12px sans-serif" : "10px sans-serif";
        context.fillStyle = node.kind === "library" ? "#fafafa" : "#d4d4d8";
        context.textAlign = "center";
        const label = node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label;
        context.fillText(label, x, y + radius + 15);
        if (isHovered && node.kind === "knowledge") {
          context.font = "10px sans-serif";
          context.fillStyle = "#a1a1aa";
          context.fillText(node.mapName, x, y + radius + 29);
        }
      }
    });
  }, [hoveredNode, offset, positionedNodes, universeData.links, zoom]);

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

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragging) {
      setOffset((current) => ({ x: current.x + event.clientX - dragStart.x, y: current.y + event.clientY - dragStart.y }));
      setDragStart({ x: event.clientX, y: event.clientY });
      return;
    }
    setHoveredNode(locateNode(event.clientX, event.clientY)?.id || null);
  }, [dragStart, dragging, locateNode]);

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

  const openHoveredLibrary = useCallback(() => {
    const node = positionedNodes.find((item) => item.id === hoveredNode);
    if (!node) return;
    const library = visibleLibraries.find((item) => item.map.id === node.mapId);
    if (library) {
      const mode: AppMode = isMapForMode(library.map, "article") ? "article" : isMapForMode(library.map, "meeting") ? "meeting" : "knowledge";
      setCurrentMode(mode);
    }
    setCurrentMapId(node.mapId);
    router.push("/");
  }, [hoveredNode, positionedNodes, visibleLibraries, router, setCurrentMapId, setCurrentMode]);

  const totalNodes = visibleLibraries.reduce((sum, library) => sum + library.nodes.length, 0);
  const modeConfig = scope === "all" ? { label: "统一知识", shortLabel: "全部" } : MODE_LIBRARY_CONFIG[scope];

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0a0f]" data-testid="universe-view" data-universe-mode={scope}>
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${dragging ? "cursor-grabbing" : hoveredNode ? "cursor-pointer" : "cursor-grab"}`}
        onMouseMove={handleMouseMove}
        onMouseDown={(event) => { setDragging(true); setDragStart({ x: event.clientX, y: event.clientY }); }}
        onMouseUp={(event) => {
          const moved = Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y);
          setDragging(false);
          if (moved < 5 && locateNode(event.clientX, event.clientY)) openHoveredLibrary();
        }}
        onMouseLeave={() => { setDragging(false); setHoveredNode(null); }}
        onWheel={(event) => { event.preventDefault(); changeZoom(zoom * (event.deltaY < 0 ? 1.12 : 0.89), event.clientX, event.clientY); }}
        aria-label={`${modeConfig.label}知识宇宙，可拖动和缩放`}
      />

      <div className="absolute left-4 top-16 z-30 max-w-[min(620px,calc(100%-2rem))] rounded-2xl border border-white/10 bg-black/55 p-4 backdrop-blur-xl">
        <div className="text-sm font-semibold text-white">🌌 {modeConfig.label}宇宙</div>
        <div className="mt-1 text-xs leading-5 text-zinc-400">{visibleLibraries.length} 个知识库 · {totalNodes} 个节点 · <span data-testid="universe-cross-library-count" data-count={universeData.crossLibraryCount}>{universeData.crossLibraryCount}</span> 条跨库关系</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-400">
          <span><i className="mr-1 inline-block h-px w-4 bg-white/25 align-middle" />库内层级</span>
          <span><i className="mr-1 inline-block h-px w-4 border-t border-dashed border-pink-300/70 align-middle" />概念关联</span>
          <span><i className="mr-1 inline-block h-px w-4 border-t border-dashed border-yellow-300/80 align-middle" />跨库生长关系</span>
        </div>
        <div className="mt-2 text-[10px] text-zinc-500">悬停查看关系，点击节点进入所属知识库。</div>
        <div className="mt-3 flex flex-wrap gap-1" data-testid="universe-scope-switch">
          {(["all", "knowledge", "article", "meeting"] as const).map((item) => <button key={item} type="button" onClick={() => setScope(item)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${scope === item ? "bg-violet-400 text-black" : "border border-white/10 text-zinc-300 hover:bg-white/10"}`}>{item === "all" ? "全部知识" : item === "knowledge" ? "知识碎片" : item === "article" ? "文章" : "会议"}</button>)}
        </div>
      </div>

      <div className="absolute right-4 top-4 z-40 flex items-center gap-1 rounded-xl border border-white/10 bg-black/60 p-1 shadow-xl backdrop-blur">
        <button type="button" onClick={() => changeZoom(zoom / 1.18)} aria-label="缩小知识宇宙" title="缩小" className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-zinc-300 hover:bg-white/10">−</button>
        <button type="button" onClick={() => { setZoom(0.82); setOffset({ x: 0, y: 0 }); }} aria-label="重置知识宇宙视图" title="适应画布" className="min-w-14 rounded-lg px-2 py-2 text-[10px] font-medium text-zinc-300 hover:bg-white/10">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => changeZoom(zoom * 1.18)} aria-label="放大知识宇宙" title="放大" className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-zinc-300 hover:bg-white/10">＋</button>
      </div>

      {warning && <div role="status" className="absolute bottom-4 left-1/2 z-40 flex max-w-[min(620px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-300/25 bg-amber-950/90 px-4 py-2 text-xs text-amber-100 shadow-xl backdrop-blur">
        <span>{warning}</span>
        <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="shrink-0 rounded-lg border border-amber-200/30 px-2 py-1 font-semibold hover:bg-white/10">重新加载</button>
      </div>}

      {(loading || error || (!loading && visibleLibraries.length === 0)) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0a0f]/80 px-6">
          <div className="max-w-sm rounded-2xl border border-white/10 bg-zinc-950/90 p-6 text-center shadow-2xl">
            <div className="text-4xl">{error ? "⚠️" : loading ? "🪐" : "🌱"}</div>
            <h2 className="mt-4 text-base font-semibold text-white">{error ? "知识宇宙加载失败" : loading ? `正在连接${modeConfig.label}知识库…` : `${modeConfig.label}宇宙还是一片空地`}</h2>
            <p className="mt-2 text-xs leading-6 text-zinc-400">{error || (loading ? "正在汇总库内关系与跨库共享概念；慢请求会自动重试，不会无限等待。" : "先创建知识库并保存内容，新增节点会在这里继续生长。")}</p>
            {error && <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="mt-4 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">重新连接</button>}
          </div>
        </div>
      )}
    </div>
  );
}
