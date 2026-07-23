import type { GraphEntity, MapMode } from "@/types";

export interface WorkspaceEntityLibrary {
  map: { id: string; name: string; mode: MapMode };
  entityGraph: { entities: GraphEntity[] };
}

export interface WorkspaceEntityOccurrence {
  mapId: string;
  mapName: string;
  mapMode: MapMode;
  entity: GraphEntity;
}

export interface WorkspaceEntityGroup {
  id: string;
  canonicalName: string;
  entityType: string;
  aliases: string[];
  occurrences: WorkspaceEntityOccurrence[];
  sourceMapIds: string[];
  sourceMapNames: string[];
  sourceModes: MapMode[];
  primary: WorkspaceEntityOccurrence;
}

export function normalizeWorkspaceEntityName(value: string): string {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[\s·•—–_:/\\|()[\]{}'"“”‘’，,。.；;!?！？]+/g, " ")
    .trim()
    .slice(0, 300);
}

function reliableAliasKey(value: string): string | null {
  const normalized = normalizeWorkspaceEntityName(value);
  if (!normalized) return null;
  const containsHan = /[\u3400-\u9fff]/.test(normalized);
  return normalized.length >= (containsHan ? 2 : 3) ? normalized : null;
}

function occurrenceKeys(occurrence: WorkspaceEntityOccurrence): string[] {
  const type = String(occurrence.entity.entityType || "other").toLocaleLowerCase();
  const canonical = normalizeWorkspaceEntityName(occurrence.entity.canonicalName);
  const keys = new Set<string>();
  if (occurrence.entity.workspaceEntityId) keys.add(`workspace:${occurrence.entity.workspaceEntityId}`);
  if (canonical) keys.add(`name:${type}:${canonical}`);
  for (const alias of occurrence.entity.aliases || []) {
    const reliable = reliableAliasKey(alias);
    if (reliable) keys.add(`name:${type}:${reliable}`);
  }
  return Array.from(keys);
}

function stableWorkspaceGroupId(parts: string[]): string {
  let hash = 2166136261;
  const value = parts.slice().sort().join("|");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `workspace-entity:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function primaryScore(occurrence: WorkspaceEntityOccurrence): number {
  const entity = occurrence.entity;
  return (entity.descriptionCitations?.length ? 4 : 0)
    + (entity.citations?.length ? 2 : 0)
    + Math.max(0, Math.min(1, Number(entity.confidence || 0)));
}

/**
 * Builds a read-only workspace projection. Map-local entities are never
 * rewritten or deleted: their ids remain the evidence and permission boundary.
 */
export function groupWorkspaceEntities(libraries: WorkspaceEntityLibrary[]): WorkspaceEntityGroup[] {
  const occurrences: WorkspaceEntityOccurrence[] = libraries.flatMap((library) => (
    (library.entityGraph.entities || []).map((entity) => ({
      mapId: library.map.id,
      mapName: library.map.name,
      mapMode: library.map.mode,
      entity,
    }))
  ));
  const parent = occurrences.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const ownerByKey = new Map<string, number>();
  occurrences.forEach((occurrence, index) => {
    occurrenceKeys(occurrence).forEach((key) => {
      const owner = ownerByKey.get(key);
      if (owner === undefined) ownerByKey.set(key, index);
      else union(index, owner);
    });
  });

  const grouped = new Map<number, WorkspaceEntityOccurrence[]>();
  occurrences.forEach((occurrence, index) => {
    const root = find(index);
    const members = grouped.get(root) || [];
    members.push(occurrence);
    grouped.set(root, members);
  });

  return Array.from(grouped.values()).map((members) => {
    const ordered = members.slice().sort((left, right) => (
      primaryScore(right) - primaryScore(left)
      || left.mapId.localeCompare(right.mapId)
      || left.entity.id.localeCompare(right.entity.id)
    ));
    const primary = ordered[0];
    const aliases = new Set<string>();
    ordered.forEach((item) => {
      if (item.entity.canonicalName !== primary.entity.canonicalName) aliases.add(item.entity.canonicalName);
      (item.entity.aliases || []).forEach((alias) => aliases.add(alias));
    });
    const sourceMapIds = Array.from(new Set(ordered.map((item) => item.mapId))).sort();
    const sourceMapNames = sourceMapIds.map((mapId) => ordered.find((item) => item.mapId === mapId)?.mapName || mapId);
    const sourceModes = Array.from(new Set(ordered.map((item) => item.mapMode))).sort() as MapMode[];
    const stableParts = ordered.flatMap(occurrenceKeys);
    return {
      id: stableWorkspaceGroupId(stableParts),
      canonicalName: primary.entity.canonicalName,
      entityType: primary.entity.entityType,
      aliases: Array.from(aliases).filter(Boolean).sort(),
      occurrences: ordered,
      sourceMapIds,
      sourceMapNames,
      sourceModes,
      primary,
    };
  }).sort((left, right) => (
    right.sourceMapIds.length - left.sourceMapIds.length
    || left.canonicalName.localeCompare(right.canonicalName)
    || left.id.localeCompare(right.id)
  ));
}
