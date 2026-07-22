import { apiFetch } from "@/lib/client-api";
import type { UniverseLibrarySnapshot } from "@/lib/tenant-cache";
import type { EntityGraph, KnowledgeEdge, KnowledgeNode, MindMap } from "@/types";

export type LibraryGraph = UniverseLibrarySnapshot;
export type UniverseFetcher = (path: string, init?: RequestInit) => Promise<Response>;

export interface UniverseLoadResult {
  libraries: LibraryGraph[];
  usedFallback: boolean;
  failedGraphs: number;
  totalGraphs: number;
}

export const UNIVERSE_REQUEST_TIMEOUT_MS = 12_000;

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

export async function fetchUniverseJson<T>(
  path: string,
  signal: AbortSignal,
  attempts = 2,
  fetcher: UniverseFetcher = apiFetch,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw abortError();
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    signal.addEventListener("abort", abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(), UNIVERSE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(path, { signal: controller.signal });
      if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
      return await response.json() as T;
    } catch (error) {
      if (signal.aborted) throw abortError();
      lastError = error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortFromParent);
    }
  }
  if (lastError instanceof Error && lastError.name !== "AbortError") throw lastError;
  throw new Error(`连接超时（已自动重试，单次上限 ${UNIVERSE_REQUEST_TIMEOUT_MS / 1000} 秒）`);
}

export async function fetchUniverseLibraries(
  signal: AbortSignal,
  fetcher: UniverseFetcher = apiFetch,
): Promise<UniverseLoadResult> {
  try {
    const data = await fetchUniverseJson<{ libraries?: LibraryGraph[] }>(
      "/api/knowledge?action=universe",
      signal,
      1,
      fetcher,
    );
    if (Array.isArray(data.libraries)) {
      return { libraries: data.libraries, usedFallback: false, failedGraphs: 0, totalGraphs: data.libraries.length };
    }
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    // Continue with the legacy maps + per-map graph endpoints.
  }

  const data = await fetchUniverseJson<{ maps?: MindMap[] }>(
    "/api/knowledge?action=maps",
    signal,
    2,
    fetcher,
  );
  const maps = (data.maps || []) as MindMap[];
  let failedGraphs = 0;
  const libraries = await Promise.all(maps.map(async (map) => {
    try {
      const graph = await fetchUniverseJson<{
        nodes?: KnowledgeNode[];
        edges?: KnowledgeEdge[];
        entityGraph?: EntityGraph;
      }>(`/api/knowledge?mapId=${encodeURIComponent(map.id)}`, signal, 2, fetcher);
      return {
        map,
        nodes: graph.nodes || [],
        edges: graph.edges || [],
        entityGraph: graph.entityGraph || { entities: [], relations: [] },
        layouts: [],
        whiteboardGroups: [],
      } as LibraryGraph;
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      failedGraphs += 1;
      return { map, nodes: [], edges: [], entityGraph: { entities: [], relations: [] }, layouts: [], whiteboardGroups: [] } as LibraryGraph;
    }
  }));
  if (failedGraphs === libraries.length && libraries.length > 0) {
    throw new Error(`知识宇宙加载失败（${failedGraphs}/${libraries.length} 个知识库图谱失败）`);
  }
  return {
    libraries,
    usedFallback: true,
    failedGraphs,
    totalGraphs: libraries.length,
  };
}

export function universeFallbackWarning(result: UniverseLoadResult): string {
  if (!result.usedFallback) return "";
  return `聚合接口暂不可用，已使用兼容模式；${result.failedGraphs}/${result.totalGraphs} 个知识库图谱加载失败。`;
}
