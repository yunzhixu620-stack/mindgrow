import { freeze } from "immer";
import type { EntityGraph, KnowledgeEdge, KnowledgeNode, MindMap, NodeLayout, WhiteboardGroup } from "@/types";

export interface TenantScope {
  userId: string;
  workspaceId: string;
}

export interface GraphSnapshot {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  entityGraph: EntityGraph;
  layouts: NodeLayout[];
  whiteboardGroups: WhiteboardGroup[];
}

export interface CachedMapGraph {
  serverSnapshot?: GraphSnapshot;
  localOverlay?: GraphSnapshot;
  storedAt: number;
  serverEpoch: number;
  localBaseEpoch?: number;
  localRevision?: number;
}

export interface UniverseLibrarySnapshot extends GraphSnapshot {
  map: MindMap;
}

export interface UniverseSnapshot {
  libraries: UniverseLibrarySnapshot[];
}

export interface CachedUniverseSnapshot {
  snapshot: UniverseSnapshot;
  storedAt: number;
  serverEpoch: number;
}

export interface CacheReadToken {
  readonly key: string;
  readonly tenantKey: string;
  readonly tenantGeneration: number;
  readonly baseEpoch: number;
}

export interface LocalOverlayToken {
  readonly key: string;
  readonly tenantKey: string;
  readonly revision: number;
  readonly baseEpoch: number;
}

export interface MapCacheRead {
  snapshot: GraphSnapshot;
  source: "local" | "server";
  storedAt: number;
  serverEpoch: number;
  localRevision?: number;
}

export type TenantCacheEvent = {
  type: "map-updated" | "map-cleared" | "universe-updated" | "tenant-cleared";
  tenantKey: string;
  key?: string;
  changed: boolean;
};

export type TenantCacheListener = (event: TenantCacheEvent) => void;

function requiredId(value: string, name: string): string {
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

export function tenantScopeKey(scope: TenantScope): string {
  return `tenant:${keyPart(requiredId(scope.userId, "userId"))}:${keyPart(requiredId(scope.workspaceId, "workspaceId"))}`;
}

export function tenantMapKey(scope: TenantScope, mapId: string): string {
  return `${tenantScopeKey(scope)}:map:${keyPart(requiredId(mapId, "mapId"))}`;
}

function cloneGraphSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  return freeze({
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      citations: node.citations?.map((citation) => ({ ...citation })),
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      citations: edge.citations?.map((citation) => ({ ...citation })),
    })),
    entityGraph: {
      entities: snapshot.entityGraph.entities.map((entity) => ({
        ...entity,
        aliases: [...entity.aliases],
        citations: entity.citations.map((citation) => ({ ...citation })),
      })),
      relations: snapshot.entityGraph.relations.map((relation) => ({
        ...relation,
        citations: relation.citations.map((citation) => ({ ...citation })),
      })),
    },
    layouts: snapshot.layouts.map((layout) => ({ ...layout })),
    whiteboardGroups: snapshot.whiteboardGroups.map((group) => ({ ...group })),
  }, true);
}

function cloneUniverseSnapshot(snapshot: UniverseSnapshot): UniverseSnapshot {
  return freeze({
    libraries: snapshot.libraries.map((library) => ({
      map: { ...library.map },
      ...cloneGraphSnapshot(library),
    })),
  }, true);
}

export class TenantCache {
  private readonly maps = new Map<string, CachedMapGraph>();
  private readonly universes = new Map<string, CachedUniverseSnapshot>();
  private readonly mapEpochs = new Map<string, number>();
  private readonly universeEpochs = new Map<string, number>();
  private readonly tenantGenerations = new Map<string, number>();
  private readonly listeners = new Set<TenantCacheListener>();
  private localRevisionSequence = 0;

  subscribe(listener: TenantCacheListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: TenantCacheEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private generation(tenantKey: string): number {
    return this.tenantGenerations.get(tenantKey) || 0;
  }

  beginMapRead(scope: TenantScope, mapId: string): CacheReadToken {
    const tenantKey = tenantScopeKey(scope);
    const key = tenantMapKey(scope, mapId);
    const baseEpoch = this.mapEpochs.get(key) || 0;
    if (!this.mapEpochs.has(key)) this.mapEpochs.set(key, baseEpoch);
    return { key, tenantKey, tenantGeneration: this.generation(tenantKey), baseEpoch };
  }

  commitServerSnapshot(token: CacheReadToken, snapshot: GraphSnapshot, storedAt = Date.now()): boolean {
    if (!token.key.startsWith(`${token.tenantKey}:map:`)) return false;
    if (this.generation(token.tenantKey) !== token.tenantGeneration) return false;
    const currentEpoch = this.mapEpochs.get(token.key) || 0;
    if (currentEpoch !== token.baseEpoch) return false;

    const nextEpoch = currentEpoch + 1;
    const current = this.maps.get(token.key);
    this.mapEpochs.set(token.key, nextEpoch);
    this.maps.set(token.key, {
      ...current,
      serverSnapshot: cloneGraphSnapshot(snapshot),
      storedAt,
      serverEpoch: nextEpoch,
    });
    this.emit({ type: "map-updated", tenantKey: token.tenantKey, key: token.key, changed: true });
    return true;
  }

  setLocalOverlay(scope: TenantScope, mapId: string, snapshot: GraphSnapshot, storedAt = Date.now()): LocalOverlayToken {
    const tenantKey = tenantScopeKey(scope);
    const key = tenantMapKey(scope, mapId);
    const currentEpoch = this.mapEpochs.get(key) || 0;
    const current = this.maps.get(key);
    const revision = ++this.localRevisionSequence;
    const baseEpoch = current?.localOverlay ? current.localBaseEpoch ?? currentEpoch : currentEpoch;
    if (!this.mapEpochs.has(key)) this.mapEpochs.set(key, currentEpoch);
    this.maps.set(key, {
      ...current,
      localOverlay: cloneGraphSnapshot(snapshot),
      storedAt: current?.storedAt ?? storedAt,
      serverEpoch: currentEpoch,
      localBaseEpoch: baseEpoch,
      localRevision: revision,
    });
    this.emit({ type: "map-updated", tenantKey, key, changed: true });
    return { key, tenantKey, revision, baseEpoch };
  }

  confirmLocalOverlay(token: LocalOverlayToken, confirmedSnapshot?: GraphSnapshot, storedAt = Date.now()): boolean {
    const current = this.maps.get(token.key);
    if (!token.key.startsWith(`${token.tenantKey}:map:`)) return false;
    if (!current?.localOverlay || current.localRevision !== token.revision || current.localBaseEpoch !== token.baseEpoch) return false;
    const currentEpoch = this.mapEpochs.get(token.key) || 0;
    const nextEpoch = currentEpoch + 1;
    this.mapEpochs.set(token.key, nextEpoch);
    this.maps.set(token.key, {
      serverSnapshot: cloneGraphSnapshot(confirmedSnapshot || current.localOverlay),
      storedAt,
      serverEpoch: nextEpoch,
    });
    this.emit({ type: "map-updated", tenantKey: token.tenantKey, key: token.key, changed: true });
    return true;
  }

  isLocalOverlayCurrent(token: LocalOverlayToken): boolean {
    const current = this.maps.get(token.key);
    return Boolean(
      token.key.startsWith(`${token.tenantKey}:map:`)
      && current?.localOverlay
      && current.localRevision === token.revision
      && current.localBaseEpoch === token.baseEpoch,
    );
  }

  discardLocalOverlay(token: LocalOverlayToken): boolean {
    const current = this.maps.get(token.key);
    if (!token.key.startsWith(`${token.tenantKey}:map:`)) return false;
    if (!current?.localOverlay || current.localRevision !== token.revision || current.localBaseEpoch !== token.baseEpoch) return false;
    if (current.serverSnapshot) {
      this.maps.set(token.key, {
        serverSnapshot: current.serverSnapshot,
        storedAt: current.storedAt,
        serverEpoch: current.serverEpoch,
      });
    } else {
      this.maps.delete(token.key);
    }
    this.emit({ type: "map-updated", tenantKey: token.tenantKey, key: token.key, changed: true });
    return true;
  }

  getMapGraph(scope: TenantScope, mapId: string): MapCacheRead | undefined {
    const entry = this.maps.get(tenantMapKey(scope, mapId));
    const snapshot = entry?.localOverlay || entry?.serverSnapshot;
    if (!entry || !snapshot) return undefined;
    return {
      snapshot,
      source: entry.localOverlay ? "local" : "server",
      storedAt: entry.storedAt,
      serverEpoch: entry.serverEpoch,
      localRevision: entry.localRevision,
    };
  }

  getCachedMapGraph(scope: TenantScope, mapId: string): CachedMapGraph | undefined {
    const entry = this.maps.get(tenantMapKey(scope, mapId));
    return entry ? { ...entry } : undefined;
  }

  clearMap(scope: TenantScope, mapId: string): boolean {
    const tenantKey = tenantScopeKey(scope);
    const key = tenantMapKey(scope, mapId);
    const changed = this.maps.delete(key);
    this.mapEpochs.set(key, (this.mapEpochs.get(key) || 0) + 1);
    this.emit({ type: "map-cleared", tenantKey, key, changed });
    return changed;
  }

  private universeKey(scope: TenantScope): string {
    return `${tenantScopeKey(scope)}:universe`;
  }

  beginUniverseRead(scope: TenantScope): CacheReadToken {
    const tenantKey = tenantScopeKey(scope);
    const key = this.universeKey(scope);
    const baseEpoch = this.universeEpochs.get(key) || 0;
    if (!this.universeEpochs.has(key)) this.universeEpochs.set(key, baseEpoch);
    return { key, tenantKey, tenantGeneration: this.generation(tenantKey), baseEpoch };
  }

  commitUniverseSnapshot(token: CacheReadToken, snapshot: UniverseSnapshot, storedAt = Date.now()): boolean {
    if (token.key !== `${token.tenantKey}:universe`) return false;
    if (this.generation(token.tenantKey) !== token.tenantGeneration) return false;
    const currentEpoch = this.universeEpochs.get(token.key) || 0;
    if (currentEpoch !== token.baseEpoch) return false;
    const nextEpoch = currentEpoch + 1;
    this.universeEpochs.set(token.key, nextEpoch);
    this.universes.set(token.key, {
      snapshot: cloneUniverseSnapshot(snapshot),
      storedAt,
      serverEpoch: nextEpoch,
    });
    this.emit({ type: "universe-updated", tenantKey: token.tenantKey, key: token.key, changed: true });
    return true;
  }

  getUniverseSnapshot(scope: TenantScope): CachedUniverseSnapshot | undefined {
    const entry = this.universes.get(this.universeKey(scope));
    return entry ? { ...entry } : undefined;
  }

  clearAllTenantCache(scope: TenantScope): boolean {
    const tenantKey = tenantScopeKey(scope);
    const prefix = `${tenantKey}:`;
    let changed = false;

    for (const key of Array.from(this.maps.keys())) {
      if (key.startsWith(prefix)) changed = this.maps.delete(key) || changed;
    }
    for (const key of Array.from(this.universes.keys())) {
      if (key.startsWith(prefix)) changed = this.universes.delete(key) || changed;
    }
    for (const key of Array.from(this.mapEpochs.keys())) {
      if (key.startsWith(prefix)) this.mapEpochs.delete(key);
    }
    for (const key of Array.from(this.universeEpochs.keys())) {
      if (key.startsWith(prefix)) this.universeEpochs.delete(key);
    }

    this.tenantGenerations.set(tenantKey, this.generation(tenantKey) + 1);
    this.emit({ type: "tenant-cleared", tenantKey, changed });
    return changed;
  }
}

export const tenantCache = new TenantCache();
