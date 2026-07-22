import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRAPH_SLOW_HINT_DELAY_MS,
  MindMapSkeleton,
  scheduleGraphSlowHint,
} from "@/components/mindmap/mind-map-skeleton";

afterEach(() => {
  vi.useRealTimers();
});

describe("MindMapSkeleton", () => {
  it("renders a graph-shaped first frame without the slow-network hint", () => {
    const html = renderToStaticMarkup(<MindMapSkeleton />);

    expect(html.match(/data-testid="skeleton-node"/g)).toHaveLength(5);
    expect(html.match(/data-testid="skeleton-edge"/g)).toHaveLength(4);
    expect(html).toContain("正在加载知识图谱");
    expect(html).not.toContain("data-testid=\"graph-slow-hint\"");
  });

  it("shows the slow hint only after 1.5 seconds", () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();

    scheduleGraphSlowHint(onSlow);
    vi.advanceTimersByTime(GRAPH_SLOW_HINT_DELAY_MS - 1);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledOnce();
  });

  it("cancels the hint timer when loading finishes or the view unmounts", () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();

    const cleanup = scheduleGraphSlowHint(onSlow);
    cleanup();
    vi.advanceTimersByTime(GRAPH_SLOW_HINT_DELAY_MS);

    expect(onSlow).not.toHaveBeenCalled();
  });
});
