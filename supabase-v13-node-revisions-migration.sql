-- MindGrow v13: durable node revision history for S2.4 backlinks + timeline.
-- Safe to rerun. Apply before deploying API 10.8.0.

BEGIN;

CREATE TABLE IF NOT EXISTS node_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated')),
  content TEXT NOT NULL DEFAULT '',
  "desc" TEXT NOT NULL DEFAULT '',
  changed_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_revisions_workspace_node_created
  ON node_revisions(workspace_id, node_id, created_at DESC);

ALTER TABLE node_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE node_revisions FROM anon, authenticated;
GRANT ALL ON TABLE node_revisions TO service_role;

COMMIT;
