import { describe, expect, it } from "vitest";
import {
  fetchUniverseLibraries,
  universeFallbackWarning,
  type UniverseFetcher,
} from "@/components/universe/universe-loader";
import type { MindMap } from "@/types";

const createdAt = "2026-07-21T00:00:00.000Z";

function map(id: string): MindMap {
  return {
    id,
    name: id,
    description: "",
    color: "#14b8a6",
    isDefault: false,
    categoryId: null,
    nodeCount: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Universe loader", () => {
  it("uses the aggregate endpoint and forwards a cancellable signal", async () => {
    const library = { map: map("map-a"), nodes: [], edges: [], entityGraph: { entities: [], relations: [] } };
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    const fetcher: UniverseFetcher = async (path, init) => {
      seenSignals.push(init?.signal);
      expect(path).toBe("/api/knowledge?action=universe");
      return json({ libraries: [library] });
    };
    const controller = new AbortController();

    const result = await fetchUniverseLibraries(controller.signal, fetcher);

    expect(result).toEqual({ libraries: [library], usedFallback: false, failedGraphs: 0, totalGraphs: 1 });
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it("falls back to legacy endpoints and reports partial graph failures", async () => {
    const calls = new Map<string, number>();
    const fetcher: UniverseFetcher = async (path) => {
      calls.set(path, (calls.get(path) || 0) + 1);
      if (path.endsWith("action=universe")) return json({ error: "missing" }, 404);
      if (path.endsWith("action=maps")) return json({ maps: [map("map-a"), map("map-b")] });
      if (path.includes("mapId=map-a")) {
        return json({
          nodes: [{
            id: "node-a", content: "A", type: "topic", status: "active", source: "manual",
            confidence: 1, createdAt, updatedAt: createdAt,
          }],
          edges: [],
          entityGraph: { entities: [], relations: [] },
        });
      }
      return json({ error: "graph unavailable" }, 503);
    };

    const result = await fetchUniverseLibraries(new AbortController().signal, fetcher);

    expect(result.usedFallback).toBe(true);
    expect(result.failedGraphs).toBe(1);
    expect(result.totalGraphs).toBe(2);
    expect(result.libraries[0].nodes[0].content).toBe("A");
    expect(result.libraries[1].nodes).toEqual([]);
    expect(calls.get("/api/knowledge?mapId=map-b")).toBe(2);
    expect(universeFallbackWarning(result)).toContain("1/2 个知识库图谱加载失败");
  });

  it("throws an error with the failed count when every legacy graph fails", async () => {
    const fetcher: UniverseFetcher = async (path) => {
      if (path.endsWith("action=universe")) return json({}, 404);
      if (path.endsWith("action=maps")) return json({ maps: [map("map-a"), map("map-b")] });
      return json({}, 503);
    };

    await expect(fetchUniverseLibraries(new AbortController().signal, fetcher))
      .rejects.toThrow("2/2 个知识库图谱失败");
  });

  it("stops immediately when the parent request is already aborted", async () => {
    let calls = 0;
    const fetcher: UniverseFetcher = async () => {
      calls += 1;
      return json({ libraries: [] });
    };
    const controller = new AbortController();
    controller.abort();

    await expect(fetchUniverseLibraries(controller.signal, fetcher)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("propagates cleanup cancellation instead of falling back or retrying", async () => {
    let calls = 0;
    const fetcher: UniverseFetcher = async (_path, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    };
    const controller = new AbortController();
    const pending = fetchUniverseLibraries(controller.signal, fetcher);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
