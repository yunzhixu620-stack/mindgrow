-- MindGrow V7 -> V8: source documents and node-level citations.
-- Safe to run more than once.

BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_documents_workspace_map ON source_documents(workspace_id, map_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citations_workspace_map ON node_citations(workspace_id, map_id, node_id);
CREATE INDEX IF NOT EXISTS idx_citations_document ON node_citations(document_id, citation_index);

ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_citations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE source_documents, node_citations FROM anon, authenticated;
GRANT ALL ON TABLE source_documents, node_citations TO service_role;

COMMIT;
