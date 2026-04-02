"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMindGrowStore } from "@/store/mindgrow-store";
import { KnowledgeNode, KnowledgeEdge } from "@/types";

// ============================================================
// Simple force-directed layout for the universe view
// ============================================================
interface GraphNode {
  id: string;
  label: string;
  type: string;
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
  isRelation: boolean;
}

function buildUniverseData(
  dbNodes: KnowledgeNode[],
  dbEdges: KnowledgeEdge[]
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Count connections for each node
  const connectionCount = new Map<string, number>();
  for (const node of dbNodes) {
    connectionCount.set(node.id, 0);
  }
  for (const edge of dbEdges) {
    connectionCount.set(
      edge.sourceId,
      (connectionCount.get(edge.sourceId) || 0) + 1
    );
    connectionCount.set(
      edge.targetId,
      (connectionCount.get(edge.targetId) || 0) + 1
    );
  }

  const colorMap: Record<string, string> = {
    topic: "#22d3a7",
    concept: "#38bdf8",
    detail: "#818cf8",
    question: "#f472b6",
  };

  // Count total nodes for sizing
  const totalChildren = new Map<string, number>();
  for (const edge of dbEdges) {
    if (edge.relation === "contains") {
      totalChildren.set(
        edge.sourceId,
        (totalChildren.get(edge.sourceId) || 0) + 1
      );
    }
  }

  const nodes: GraphNode[] = dbNodes.map((n, idx) => {
    const angle = (idx / dbNodes.length) * Math.PI * 2;
    const baseRadius = 200 + Math.random() * 150;
    const connections = connectionCount.get(n.id) || 0;
    const children = totalChildren.get(n.id) || 0;

    return {
      id: n.id,
      label: n.content,
      type: n.type,
      x: Math.cos(angle) * baseRadius,
      y: Math.sin(angle) * baseRadius,
      vx: 0,
      vy: 0,
      radius: Math.max(6, 6 + children * 2 + connections),
      color: colorMap[n.type] || "#818cf8",
    };
  });

  const links: GraphLink[] = dbEdges.map((e) => ({
    source: e.sourceId,
    target: e.targetId,
    strength: e.weight,
    isRelation: e.relation !== "contains",
  }));

  return { nodes, links };
}

function simulateForceLayout(
  nodes: GraphNode[],
  links: GraphLink[],
  iterations: number = 80
) {
  const centerX = 0;
  const centerY = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 3000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Attraction along links
    for (const link of links) {
      const source = nodes.find((n) => n.id === link.source);
      const target = nodes.find((n) => n.id === link.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = link.isRelation ? 200 : 120;
      const force = (dist - idealDist) * 0.005 * link.strength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.001;
      node.vy += (centerY - node.y) * 0.001;
    }

    // Update positions
    const damping = 0.9;
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return nodes;
}

export function UniverseView() {
  const { nodes: dbNodes, edges: dbEdges } = useMindGrowStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const universeData = useMemo(
    () => buildUniverseData(dbNodes, dbEdges),
    [dbNodes, dbEdges]
  );

  const positionedNodes = useMemo(
    () => simulateForceLayout(
      universeData.nodes.map((n) => ({ ...n })),
      universeData.links
    ),
    [universeData]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const centerX = rect.width / 2 + offset.x;
    const centerY = rect.height / 2 + offset.y;

    // Clear
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw stars background
    for (let i = 0; i < 100; i++) {
      const sx = ((i * 137.5) % rect.width);
      const sy = ((i * 73.3) % rect.height);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + Math.random() * 0.15})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const nodeMap = new Map(positionedNodes.map((n) => [n.id, n]));

    // Draw links
    for (const link of universeData.links) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) continue;

      ctx.beginPath();
      ctx.moveTo(centerX + source.x, centerY + source.y);
      ctx.lineTo(centerX + target.x, centerY + target.y);
      ctx.strokeStyle = link.isRelation
        ? "rgba(244, 114, 182, 0.2)"
        : "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = link.isRelation ? 1 : 0.5;
      if (link.isRelation) {
        ctx.setLineDash([4, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    for (const node of positionedNodes) {
      const isHovered = node.id === hoveredNode;
      const x = centerX + node.x;
      const y = centerY + node.y;
      const r = isHovered ? node.radius * 1.5 : node.radius;

      // Glow
      if (isHovered) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        gradient.addColorStop(0, node.color + "40");
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color + (isHovered ? "ff" : "80");
      ctx.fill();

      // Border
      ctx.strokeStyle = node.color;
      ctx.lineWidth = isHovered ? 2 : 0.5;
      ctx.stroke();

      // Label
      if (isHovered || node.type === "topic") {
        ctx.font = isHovered ? "13px sans-serif" : "11px sans-serif";
        ctx.fillStyle = "#e4e4e7";
        ctx.textAlign = "center";
        ctx.fillText(node.label, x, y + r + 16);
      }
    }

    // Title
    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = "#a1a1aa";
    ctx.textAlign = "left";
    ctx.fillText(
      `🌌 你的知识宇宙 · ${dbNodes.length} 个知识节点`,
      20,
      30
    );
  }, [positionedNodes, universeData.links, dbNodes.length, hoveredNode, offset]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragging) {
        setOffset({
          x: offset.x + (e.clientX - dragStart.x),
          y: offset.y + (e.clientY - dragStart.y),
        });
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2 - offset.x;
      const my = e.clientY - rect.top - rect.height / 2 - offset.y;

      let found = null;
      for (const node of positionedNodes) {
        const dx = mx - node.x;
        const dy = my - node.y;
        if (dx * dx + dy * dy < node.radius * node.radius * 2) {
          found = node.id;
          break;
        }
      }
      setHoveredNode(found);
    },
    [dragging, dragStart, offset, positionedNodes]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  if (dbNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--background)]">
        <div className="text-center space-y-4">
          <div className="text-6xl">🌌</div>
          <h2 className="text-xl text-[var(--muted-foreground)]">
            知识宇宙还是一片虚空
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            先去添加一些知识点，这里会自动生成你的知识星图
          </p>
        </div>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
