-- MindGrow v14: durable Heptabase-style whiteboard layout foundation.
-- Safe to rerun. Apply before deploying API 10.10.0.

BEGIN;

ALTER TABLE maps
  ADD COLUMN IF NOT EXISTS canvas_view TEXT NOT NULL DEFAULT 'mindmap';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maps_canvas_view_check'
  ) THEN
    ALTER TABLE maps ADD CONSTRAINT maps_canvas_view_check
      CHECK (canvas_view IN ('mindmap', 'whiteboard'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS whiteboard_groups (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  color TEXT NOT NULL DEFAULT '#22d3a7',
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 720 CHECK (width BETWEEN 240 AND 2400),
  height REAL NOT NULL DEFAULT 480 CHECK (height BETWEEN 160 AND 2000),
  collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, map_id)
);

ALTER TABLE node_layouts ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE node_layouts ADD COLUMN IF NOT EXISTS card_width REAL NOT NULL DEFAULT 280;
ALTER TABLE node_layouts ADD COLUMN IF NOT EXISTS card_height REAL NOT NULL DEFAULT 168;
ALTER TABLE node_layouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'node_layouts_card_width_check'
  ) THEN
    ALTER TABLE node_layouts ADD CONSTRAINT node_layouts_card_width_check
      CHECK (card_width BETWEEN 180 AND 800);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'node_layouts_card_height_check'
  ) THEN
    ALTER TABLE node_layouts ADD CONSTRAINT node_layouts_card_height_check
      CHECK (card_height BETWEEN 96 AND 640);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'node_layouts_group_map_fk'
  ) THEN
    ALTER TABLE node_layouts ADD CONSTRAINT node_layouts_group_map_fk
      FOREIGN KEY (group_id)
      REFERENCES whiteboard_groups(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_whiteboard_groups_workspace_map_sort
  ON whiteboard_groups(workspace_id, map_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_node_layouts_workspace_map_group
  ON node_layouts(workspace_id, map_id, group_id);

ALTER TABLE whiteboard_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE whiteboard_groups FROM anon, authenticated;
GRANT ALL ON TABLE whiteboard_groups TO service_role;

COMMIT;
