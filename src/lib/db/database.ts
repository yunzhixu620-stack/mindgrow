import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { KnowledgeNode, KnowledgeEdge, NodeLayout } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let supabase: SupabaseClient | null = null;

export interface MindMap {
  id: string;
  name: string;
  description: string;
  color: string;
  isDefault: boolean;
  categoryId: string | null;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

function getDB(): SupabaseClient {
  if (!supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabase;
}

// ============================================================
// Category / Folder operations
// ============================================================

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  createdAt: string;
}

export async function createCategory(name: string, icon = "📁", color = "#22d3a7"): Promise<Category> {
  const db = getDB();
  const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  // Get current max sort_order
  const { data: existing } = await db.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = existing && existing.length > 0 ? (existing[0].sort_order || 0) + 1 : 0;

  const { data, error } = await db
    .from("categories")
    .insert({
      id,
      name,
      icon,
      color,
      sort_order: nextOrder,
      created_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    icon: data.icon,
    color: data.color,
    sortOrder: data.sort_order,
    createdAt: data.created_at,
  };
}

export async function getAllCategories(): Promise<Category[]> {
  const db = getDB();
  const { data, error } = await db
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }));
}

export async function deleteCategory(categoryId: string): Promise<boolean> {
  const db = getDB();
  // Move all maps in this category to uncategorized
  await db.from("maps").update({ category_id: null }).eq("category_id", categoryId);
  const { error } = await db.from("categories").delete().eq("id", categoryId);
  return !error;
}

export async function renameCategory(categoryId: string, name: string): Promise<boolean> {
  const db = getDB();
  const { error } = await db
    .from("categories")
    .update({ name })
    .eq("id", categoryId);
  return !error;
}

export async function updateCategoryIcon(categoryId: string, icon: string): Promise<boolean> {
  const db = getDB();
  const { error } = await db
    .from("categories")
    .update({ icon })
    .eq("id", categoryId);
  return !error;
}

export async function moveMapToCategory(mapId: string, categoryId: string | null): Promise<boolean> {
  const db = getDB();
  const { error } = await db
    .from("maps")
    .update({ category_id: categoryId, updated_at: new Date().toISOString() })
    .eq("id", mapId);
  return !error;
}

// ============================================================
// Map operations
// ============================================================

export async function createMap(name: string, description = "", color = "#22d3a7"): Promise<MindMap> {
  const db = getDB();
  const id = `map_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("maps")
    .insert({
      id,
      name,
      description,
      color,
      is_default: false,
      node_count: 0,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return rowToMap(data);
}

export async function getAllMaps(): Promise<MindMap[]> {
  const db = getDB();
  const { data, error } = await db
    .from("maps")
    .select("*")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToMap);
}

export async function getMap(id: string): Promise<MindMap | null> {
  const db = getDB();
  const { data, error } = await db.from("maps").select("*").eq("id", id).single();
  if (error || !data) return null;
  return rowToMap(data);
}

export async function deleteMap(mapId: string): Promise<boolean> {
  const db = getDB();
  const { error } = await db.from("maps").delete().eq("id", mapId).eq("is_default", false);
  return !error;
}

export async function renameMap(mapId: string, name: string): Promise<boolean> {
  const db = getDB();
  const { error } = await db
    .from("maps")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", mapId);
  return !error;
}

export async function clearMap(mapId: string): Promise<boolean> {
  const db = getDB();
  const { error: edgesError } = await db.from("edges").delete().eq("map_id", mapId);
  if (edgesError) return false;
  const { error: layoutsError } = await db.from("node_layouts").delete().eq("map_id", mapId);
  if (layoutsError) return false;
  const { error: nodesError } = await db.from("nodes").delete().eq("map_id", mapId);
  if (nodesError) return false;
  const { error: mapError } = await db
    .from("maps")
    .update({ node_count: 0, updated_at: new Date().toISOString() })
    .eq("id", mapId);
  return !mapError;
}

// ============================================================
// Node operations
// ============================================================

export async function createNode(
  node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt"> & { mapId?: string }
): Promise<KnowledgeNode> {
  const db = getDB();
  const mapId = node.mapId || "map_default";
  const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const { error } = await db.from("nodes").insert({
    id,
    map_id: mapId,
    content: node.content,
    desc: node.desc || "",
    type: node.type,
    status: node.status,
    source: node.source,
    confidence: node.confidence,
    created_at: now,
    updated_at: now,
  });

  if (error) throw error;

  // Update map node count
  await updateMapNodeCount(mapId);

  return { ...node, id, createdAt: now, updatedAt: now };
}

export async function getNodesByMap(mapId: string): Promise<KnowledgeNode[]> {
  const db = getDB();
  const { data, error } = await db
    .from("nodes")
    .select("*")
    .eq("map_id", mapId)
    .eq("status", "active")
    .order("created_at");

  if (error) throw error;
  return (data || []).map(rowToNode);
}

export async function getNode(id: string): Promise<KnowledgeNode | null> {
  const db = getDB();
  const { data, error } = await db
    .from("nodes")
    .select("*")
    .eq("id", id)
    .eq("status", "active")
    .single();
  if (error || !data) return null;
  return rowToNode(data);
}

export async function deleteNode(nodeId: string): Promise<boolean> {
  const db = getDB();
  const node = await getNode(nodeId);
  if (!node) return false;

  const now = new Date().toISOString();
  const { error } = await db
    .from("nodes")
    .update({ status: "deleted", updated_at: now })
    .eq("id", nodeId);
  if (error) return false;

  // Delete related edges and layouts
  await db.from("edges").delete().or(`source_id.eq.${nodeId},target_id.eq.${nodeId}`);
  await db.from("node_layouts").delete().eq("node_id", nodeId);

  // Get map_id from the node (before status change it was active)
  // We already have the node object
  if (node) {
    // Get map_id - we need to check the original node data
    const mapId = (await db.from("nodes").select("map_id").eq("id", nodeId).single())?.data?.map_id;
    if (mapId) await updateMapNodeCount(mapId);
  }

  return true;
}

export async function updateNode(id: string, updates: Partial<KnowledgeNode>): Promise<KnowledgeNode | null> {
  const db = getDB();
  const existing = await getNode(id);
  if (!existing) return null;

  const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.content !== undefined) dbUpdates.content = updates.content;
  if (updates.desc !== undefined) dbUpdates.desc = updates.desc;
  if (updates.type !== undefined) dbUpdates.type = updates.type;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.source !== undefined) dbUpdates.source = updates.source;
  if (updates.confidence !== undefined) dbUpdates.confidence = updates.confidence;

  const { error } = await db.from("nodes").update(dbUpdates).eq("id", id);
  if (error) return null;

  return getNode(id);
}

export async function searchNodesInMap(mapId: string, query: string): Promise<KnowledgeNode[]> {
  const db = getDB();
  const { data, error } = await db
    .from("nodes")
    .select("*")
    .eq("map_id", mapId)
    .eq("status", "active")
    .ilike("content", `%${query}%`)
    .order("created_at");

  if (error) throw error;
  return (data || []).map(rowToNode);
}

// ============================================================
// Edge operations
// ============================================================

export async function createEdge(
  edge: Omit<KnowledgeEdge, "id" | "createdAt"> & { mapId?: string }
): Promise<KnowledgeEdge> {
  const db = getDB();
  const mapId = edge.mapId || "map_default";
  const id = `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const { error } = await db.from("edges").insert({
    id,
    map_id: mapId,
    source_id: edge.sourceId,
    target_id: edge.targetId,
    relation: edge.relation,
    weight: edge.weight,
    created_at: now,
  });

  if (error) throw error;

  return { ...edge, id, createdAt: now };
}

export async function getEdgesByMap(mapId: string): Promise<KnowledgeEdge[]> {
  const db = getDB();
  const { data, error } = await db
    .from("edges")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at");

  if (error) throw error;
  return (data || []).map(rowToEdge);
}

export async function getChildEdges(parentId: string): Promise<KnowledgeEdge[]> {
  const db = getDB();
  const { data, error } = await db
    .from("edges")
    .select("*")
    .eq("source_id", parentId)
    .eq("relation", "contains")
    .order("created_at");

  if (error) throw error;
  return (data || []).map(rowToEdge);
}

// ============================================================
// Layout operations
// ============================================================

export async function saveLayout(layout: {
  nodeId: string;
  mapId?: string;
  positionX: number;
  positionY: number;
  zoomLevel?: number;
}): Promise<void> {
  const db = getDB();
  const mapId = layout.mapId || "map_default";

  await db
    .from("node_layouts")
    .upsert(
      {
        node_id: layout.nodeId,
        map_id: mapId,
        position_x: layout.positionX,
        position_y: layout.positionY,
        zoom_level: layout.zoomLevel || 1,
      },
      { onConflict: "node_id,map_id" }
    );
}

// ============================================================
// Helpers
// ============================================================

async function updateMapNodeCount(mapId: string): Promise<void> {
  const db = getDB();
  const { count } = await db
    .from("nodes")
    .select("*", { count: "exact", head: true })
    .eq("map_id", mapId)
    .eq("status", "active");

  await db
    .from("maps")
    .update({
      node_count: count || 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mapId);
}

function rowToNode(row: any): KnowledgeNode {
  return {
    id: row.id,
    content: row.content,
    desc: row.desc || "",
    type: row.type,
    status: row.status,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEdge(row: any): KnowledgeEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    weight: row.weight,
    createdAt: row.created_at,
  };
}

function rowToMap(row: any): MindMap {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    isDefault: row.is_default,
    categoryId: row.category_id || null,
    nodeCount: row.node_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
