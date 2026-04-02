-- Support multiple maps
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#22d3a7',
  is_default INTEGER DEFAULT 0,
  node_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Update nodes to belong to a map
ALTER TABLE nodes ADD COLUMN map_id TEXT REFERENCES maps(id) ON DELETE CASCADE;
ALTER TABLE edges ADD COLUMN map_id TEXT REFERENCES maps(id) ON DELETE CASCADE;
ALTER TABLE node_layouts ADD COLUMN map_id TEXT REFERENCES maps(id) ON DELETE CASCADE;
