-- MindGrow 10.4: evidence-backed LLM Wiki entity graph.
-- The existing nodes/edges tables remain the editable concept map. These
-- tables form a separate retrieval graph so typed relations never rewrite or
-- semantically downgrade user-authored hierarchy.

CREATE TABLE IF NOT EXISTS graph_entities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL CHECK (char_length(canonical_name) BETWEEN 1 AND 300),
  normalized_name TEXT NOT NULL CHECK (char_length(normalized_name) BETWEEN 1 AND 300),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'person', 'organization', 'model', 'method', 'dataset', 'metric', 'task',
    'event', 'decision', 'time', 'concept', 'claim', 'other'
  )),
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT NOT NULL DEFAULT '',
  description_citation_indexes JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, map_id, normalized_name, entity_type)
);

CREATE TABLE IF NOT EXISTS graph_relations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (char_length(relation_type) BETWEEN 1 AND 80),
  label TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'asserted' CHECK (status IN ('asserted', 'historical', 'negated', 'proposed')),
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_entity_id <> target_entity_id),
  UNIQUE (workspace_id, map_id, source_entity_id, target_entity_id, relation_type, status)
);

CREATE TABLE IF NOT EXISTS graph_evidence (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('entity', 'relation')),
  subject_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL DEFAULT '',
  citation_index INTEGER NOT NULL CHECK (citation_index > 0),
  quote TEXT NOT NULL CHECK (char_length(quote) BETWEEN 1 AND 1400),
  locator TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_kind, subject_id, document_id, citation_index)
);

CREATE INDEX IF NOT EXISTS idx_graph_entities_map_type
  ON graph_entities(workspace_id, map_id, entity_type, normalized_name);
CREATE INDEX IF NOT EXISTS idx_graph_entities_aliases
  ON graph_entities USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_graph_relations_map_source
  ON graph_relations(workspace_id, map_id, source_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_graph_relations_map_target
  ON graph_relations(workspace_id, map_id, target_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_graph_evidence_subject
  ON graph_evidence(workspace_id, map_id, subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_graph_evidence_document
  ON graph_evidence(document_id, citation_index);

ALTER TABLE graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE graph_entities, graph_relations, graph_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE graph_entities, graph_relations, graph_evidence TO service_role;
