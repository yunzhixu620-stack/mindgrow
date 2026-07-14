-- MindGrow V7 Supabase bootstrap schema (fresh project only).
-- Cloud data is accessed only through the trusted Function Compute backend.
-- The browser receives a public publishable key for Supabase Auth only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '新文件夹',
  icon TEXT NOT NULL DEFAULT '📁',
  color TEXT NOT NULL DEFAULT '#22d3a7',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#22d3a7',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  "desc" TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'concept' CHECK (type IN ('topic', 'concept', 'detail', 'question')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'merged', 'deleted')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_complete', 'article', 'meeting', 'ai_generated', 'template')),
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'contains' CHECK (relation IN ('contains', 'relates_to', 'contradicts')),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_id <> target_id)
);

CREATE TABLE IF NOT EXISTS node_layouts (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  zoom_level REAL NOT NULL DEFAULT 1 CHECK (zoom_level > 0),
  PRIMARY KEY (node_id, map_id)
);

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'pdf', 'text', 'meeting')),
  source_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS node_citations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  citation_index INTEGER NOT NULL CHECK (citation_index > 0),
  quote TEXT NOT NULL CHECK (char_length(quote) BETWEEN 1 AND 1000),
  locator TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (node_id, document_id, citation_index)
);

CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_maps_workspace_updated ON maps(workspace_id, is_default DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_workspace_category ON maps(workspace_id, category_id);
CREATE INDEX IF NOT EXISTS idx_categories_workspace_sort ON categories(workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_nodes_workspace_map_status ON nodes(workspace_id, map_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_content_trgm ON nodes USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nodes_desc_trgm ON nodes USING GIN ("desc" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_edges_workspace_map ON edges(workspace_id, map_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_map ON source_documents(workspace_id, map_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citations_workspace_map ON node_citations(workspace_id, map_id, node_id);
CREATE INDEX IF NOT EXISTS idx_citations_document ON node_citations(document_id, citation_index);

-- Bounded, tenant-scoped candidate retrieval. The backend expands graph neighbors
-- and validates citations before returning an answer.
CREATE OR REPLACE FUNCTION search_knowledge_nodes(
  p_workspace_id TEXT,
  p_map_id TEXT,
  p_query TEXT,
  p_limit INTEGER DEFAULT 12
)
RETURNS TABLE (
  id TEXT,
  content TEXT,
  description TEXT,
  type TEXT,
  score REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    n.id,
    n.content,
    n."desc" AS description,
    n.type,
    GREATEST(
      similarity(lower(n.content), lower(p_query)),
      similarity(lower(n."desc"), lower(p_query)),
      CASE WHEN lower(n.content) LIKE '%' || lower(p_query) || '%' THEN 1.0 ELSE 0.0 END
    )::REAL AS score
  FROM nodes n
  WHERE n.workspace_id = p_workspace_id
    AND n.map_id = p_map_id
    AND n.status = 'active'
    AND (
      n.content % p_query
      OR n."desc" % p_query
      OR lower(n.content) LIKE '%' || lower(p_query) || '%'
      OR lower(n."desc") LIKE '%' || lower(p_query) || '%'
    )
  ORDER BY score DESC, n.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_citations ENABLE ROW LEVEL SECURITY;

-- Remove legacy permissive policies. No direct browser table access is allowed.
DROP POLICY IF EXISTS "Allow all on categories" ON categories;
DROP POLICY IF EXISTS "Allow all on maps" ON maps;
DROP POLICY IF EXISTS "Allow all on nodes" ON nodes;
DROP POLICY IF EXISTS "Allow all on edges" ON edges;
DROP POLICY IF EXISTS "Allow all on node_layouts" ON node_layouts;

REVOKE ALL ON TABLE workspaces, workspace_members, categories, maps, nodes, edges, node_layouts, source_documents, node_citations FROM anon, authenticated;
REVOKE ALL ON FUNCTION search_knowledge_nodes(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE workspaces, workspace_members, categories, maps, nodes, edges, node_layouts, source_documents, node_citations TO service_role;
GRANT EXECUTE ON FUNCTION search_knowledge_nodes(TEXT, TEXT, TEXT, INTEGER) TO service_role;

COMMIT;
