-- MindGrow V6 -> V7 live migration. Safe to run more than once.
-- Existing anonymous V6 rows remain unassigned (workspace_id IS NULL) and are
-- therefore invisible to V7 tenant-scoped API requests.

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

ALTER TABLE categories ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE maps ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE node_layouts ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_source_check;
ALTER TABLE nodes ADD CONSTRAINT nodes_source_check
  CHECK (source IN ('manual', 'auto_complete', 'article', 'meeting', 'ai_generated', 'template'));

CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_maps_workspace_updated ON maps(workspace_id, is_default DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_workspace_category ON maps(workspace_id, category_id);
CREATE INDEX IF NOT EXISTS idx_categories_workspace_sort ON categories(workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_nodes_workspace_map_status ON nodes(workspace_id, map_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_content_trgm ON nodes USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nodes_desc_trgm ON nodes USING GIN ("desc" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_edges_workspace_map ON edges(workspace_id, map_id);

CREATE OR REPLACE FUNCTION search_knowledge_nodes(
  p_workspace_id TEXT,
  p_map_id TEXT,
  p_query TEXT,
  p_limit INTEGER DEFAULT 12
)
RETURNS TABLE (id TEXT, content TEXT, description TEXT, type TEXT, score REAL)
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
      n.content % p_query OR n."desc" % p_query
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

DROP POLICY IF EXISTS "Allow all on categories" ON categories;
DROP POLICY IF EXISTS "Allow all on maps" ON maps;
DROP POLICY IF EXISTS "Allow all on nodes" ON nodes;
DROP POLICY IF EXISTS "Allow all on edges" ON edges;
DROP POLICY IF EXISTS "Allow all on node_layouts" ON node_layouts;

REVOKE ALL ON TABLE workspaces, workspace_members, categories, maps, nodes, edges, node_layouts FROM anon, authenticated;
REVOKE ALL ON FUNCTION search_knowledge_nodes(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE workspaces, workspace_members, categories, maps, nodes, edges, node_layouts TO service_role;
GRANT EXECUTE ON FUNCTION search_knowledge_nodes(TEXT, TEXT, TEXT, INTEGER) TO service_role;

COMMIT;
