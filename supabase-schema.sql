-- MindGrow Supabase Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- Maps table
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#22d3a7',
  is_default BOOLEAN DEFAULT FALSE,
  node_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nodes table
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL DEFAULT 'map_default',
  content TEXT NOT NULL,
  desc TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'concept',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'manual',
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Edges table
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL DEFAULT 'map_default',
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'contains',
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Node layouts table
CREATE TABLE IF NOT EXISTS node_layouts (
  node_id TEXT NOT NULL,
  map_id TEXT NOT NULL DEFAULT 'map_default',
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  zoom_level REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (node_id, map_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_map ON nodes(map_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_edges_map ON edges(map_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_maps_default ON maps(is_default);

-- Enable Row Level Security
ALTER TABLE maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_layouts ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon key (public app)
CREATE POLICY "Allow all on maps" ON maps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on nodes" ON nodes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on edges" ON edges FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on node_layouts" ON node_layouts FOR ALL USING (true) WITH CHECK (true);

-- Seed default map
INSERT INTO maps (id, name, description, color, is_default)
VALUES ('map_default', '默认知识库', '我的第一个思维导图', '#22d3a7')
ON CONFLICT (id) DO NOTHING;
