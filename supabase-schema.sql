-- MindGrow Supabase bootstrap schema (fresh project only).
-- Run once in the Supabase SQL Editor, then keep the service-role/secret key
-- only in Alibaba Cloud Function Compute. The browser must never receive it.

BEGIN;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '新文件夹',
  icon TEXT NOT NULL DEFAULT '📁',
  color TEXT NOT NULL DEFAULT '#22d3a7',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
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
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  "desc" TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'concept' CHECK (type IN ('topic', 'concept', 'detail', 'question')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'merged', 'deleted')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_complete', 'article', 'ai_generated', 'template')),
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
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
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  zoom_level REAL NOT NULL DEFAULT 1 CHECK (zoom_level > 0),
  PRIMARY KEY (node_id, map_id)
);

CREATE INDEX IF NOT EXISTS idx_maps_default_updated ON maps(is_default DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_category ON maps(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order);
CREATE INDEX IF NOT EXISTS idx_nodes_map_status ON nodes(map_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_map ON edges(map_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_layouts ENABLE ROW LEVEL SECURITY;

-- Remove legacy public-write policies if this script is used to repair an old schema.
DROP POLICY IF EXISTS "Allow all on categories" ON categories;
DROP POLICY IF EXISTS "Allow all on maps" ON maps;
DROP POLICY IF EXISTS "Allow all on nodes" ON nodes;
DROP POLICY IF EXISTS "Allow all on edges" ON edges;
DROP POLICY IF EXISTS "Allow all on node_layouts" ON node_layouts;

-- All cloud access goes through the trusted backend. No anonymous browser writes.
REVOKE ALL ON TABLE categories, maps, nodes, edges, node_layouts FROM anon, authenticated;
GRANT ALL ON TABLE categories, maps, nodes, edges, node_layouts TO service_role;

INSERT INTO maps (id, name, description, color, is_default)
VALUES ('map_default', '默认知识库', '我的第一个 AI 知识图谱', '#22d3a7', TRUE)
ON CONFLICT (id) DO NOTHING;

COMMIT;
