"use client";

import React, { useEffect, useState } from "react";

export const GRAPH_SLOW_HINT_DELAY_MS = 1_500;

export function scheduleGraphSlowHint(
  onSlow: () => void,
  delayMs = GRAPH_SLOW_HINT_DELAY_MS,
) {
  const timer = globalThis.setTimeout(onSlow, delayMs);
  return () => globalThis.clearTimeout(timer);
}

export function MindMapSkeleton() {
  const [slowHint, setSlowHint] = useState(false);

  useEffect(() => scheduleGraphSlowHint(() => setSlowHint(true)), []);

  return (
    <div
      className="relative flex h-full min-h-[320px] w-full flex-col items-center justify-center overflow-hidden bg-[var(--background)]"
      data-testid="mind-map-skeleton"
      role="status"
      aria-live="polite"
    >
      <div className="relative h-[min(54vw,430px)] min-h-[260px] w-[min(82vw,720px)] max-w-full animate-pulse" aria-hidden="true">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 720 430" fill="none">
          <g className="stroke-[var(--primary)] opacity-25" strokeWidth="2" strokeDasharray="7 9">
            <path data-testid="skeleton-edge" d="M360 215 C288 174 235 135 160 112" />
            <path data-testid="skeleton-edge" d="M360 215 C442 170 498 137 566 108" />
            <path data-testid="skeleton-edge" d="M360 215 C286 259 232 298 150 322" />
            <path data-testid="skeleton-edge" d="M360 215 C440 263 500 296 575 326" />
          </g>
          <g className="fill-[var(--card)] stroke-[var(--primary)]">
            <circle data-testid="skeleton-node" cx="360" cy="215" r="34" strokeWidth="3" />
            <circle data-testid="skeleton-node" cx="160" cy="112" r="25" strokeWidth="2" opacity="0.8" />
            <circle data-testid="skeleton-node" cx="566" cy="108" r="25" strokeWidth="2" opacity="0.8" />
            <circle data-testid="skeleton-node" cx="150" cy="322" r="25" strokeWidth="2" opacity="0.65" />
            <circle data-testid="skeleton-node" cx="575" cy="326" r="25" strokeWidth="2" opacity="0.65" />
          </g>
        </svg>
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)] opacity-[0.08] blur-2xl" />
      </div>

      {slowHint && (
        <p className="absolute bottom-[14%] animate-fade-in text-sm text-[var(--muted-foreground)]" data-testid="graph-slow-hint">
          网络较慢，正在唤醒服务
        </p>
      )}
      <span className="sr-only">{slowHint ? "网络较慢，正在唤醒服务" : "正在加载知识图谱"}</span>
    </div>
  );
}
