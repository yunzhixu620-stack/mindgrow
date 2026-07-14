-- MindGrow V8 -> V9: verifiable document chunks and hybrid vector retrieval.
-- Safe to run more than once in the Supabase SQL editor.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE source_documents ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_documents ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE source_documents ADD COLUMN IF NOT EXISTS extraction_json JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_source_documents_content_hash
  ON source_documents(workspace_id, map_id, content_hash);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  locator TEXT NOT NULL DEFAULT '',
  page_number INTEGER,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 8 AND 8000),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  embedding VECTOR(1024),
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_workspace_map
  ON document_chunks(workspace_id, map_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_document_chunks_fts
  ON document_chunks USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING HNSW (embedding vector_cosine_ops);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE document_chunks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE document_chunks TO service_role;

CREATE OR REPLACE FUNCTION hybrid_search_document_chunks(
  p_workspace_id TEXT,
  p_map_id TEXT,
  p_query_text TEXT,
  p_query_embedding VECTOR(1024),
  p_match_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  chunk_id TEXT,
  document_id TEXT,
  document_title TEXT,
  source_type TEXT,
  source_url TEXT,
  file_name TEXT,
  chunk_index INTEGER,
  locator TEXT,
  content TEXT,
  score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH semantic AS (
    SELECT dc.id, row_number() OVER (ORDER BY dc.embedding <=> p_query_embedding) AS rank
    FROM document_chunks dc
    WHERE dc.workspace_id = p_workspace_id
      AND dc.map_id = p_map_id
      AND p_query_embedding IS NOT NULL
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> p_query_embedding
    LIMIT 60
  ),
  keyword AS (
    SELECT dc.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('simple', p_query_text)) DESC
      ) AS rank
    FROM document_chunks dc
    WHERE dc.workspace_id = p_workspace_id
      AND dc.map_id = p_map_id
      AND length(trim(COALESCE(p_query_text, ''))) > 0
      AND dc.fts @@ websearch_to_tsquery('simple', p_query_text)
    ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('simple', p_query_text)) DESC
    LIMIT 60
  ),
  fused AS (
    SELECT COALESCE(semantic.id, keyword.id) AS id,
      COALESCE(1.0 / (60 + semantic.rank), 0.0)
      + COALESCE(1.0 / (60 + keyword.rank), 0.0) AS rrf_score
    FROM semantic
    FULL OUTER JOIN keyword ON semantic.id = keyword.id
  )
  SELECT
    dc.id AS chunk_id,
    dc.document_id,
    sd.title AS document_title,
    sd.source_type,
    sd.source_url,
    sd.file_name,
    dc.chunk_index,
    dc.locator,
    dc.content,
    fused.rrf_score AS score
  FROM fused
  JOIN document_chunks dc ON dc.id = fused.id
  JOIN source_documents sd ON sd.id = dc.document_id
  ORDER BY fused.rrf_score DESC, dc.chunk_index ASC
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 20), 1), 60);
$$;

REVOKE ALL ON FUNCTION hybrid_search_document_chunks(TEXT, TEXT, TEXT, VECTOR, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hybrid_search_document_chunks(TEXT, TEXT, TEXT, VECTOR, INTEGER)
  TO service_role;

COMMIT;
