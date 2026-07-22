-- MindGrow S2.12: expose independent sparse/semantic retrieval signals for
-- explainable GraphRAG reranking. Safe to run more than once.

BEGIN;

CREATE OR REPLACE FUNCTION hybrid_search_document_chunks_v2(
  p_workspace_id TEXT,
  p_map_id TEXT,
  p_query_text TEXT,
  p_query_embedding VECTOR(1024),
  p_match_count INTEGER DEFAULT 30
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
  rrf_score DOUBLE PRECISION,
  semantic_rank BIGINT,
  keyword_rank BIGINT,
  semantic_score DOUBLE PRECISION,
  keyword_score REAL,
  document_created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH semantic AS (
    SELECT
      dc.id,
      row_number() OVER (ORDER BY dc.embedding <=> p_query_embedding) AS rank,
      1.0 - (dc.embedding <=> p_query_embedding) AS score
    FROM document_chunks dc
    WHERE dc.workspace_id = p_workspace_id
      AND dc.map_id = p_map_id
      AND p_query_embedding IS NOT NULL
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> p_query_embedding
    LIMIT 60
  ),
  keyword AS (
    SELECT
      dc.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('simple', p_query_text)) DESC
      ) AS rank,
      ts_rank_cd(dc.fts, websearch_to_tsquery('simple', p_query_text)) AS score
    FROM document_chunks dc
    WHERE dc.workspace_id = p_workspace_id
      AND dc.map_id = p_map_id
      AND length(trim(COALESCE(p_query_text, ''))) > 0
      AND dc.fts @@ websearch_to_tsquery('simple', p_query_text)
    ORDER BY score DESC
    LIMIT 60
  ),
  fused AS (
    SELECT
      COALESCE(semantic.id, keyword.id) AS id,
      COALESCE(1.0 / (60 + semantic.rank), 0.0)
        + COALESCE(1.0 / (60 + keyword.rank), 0.0) AS rrf_score,
      semantic.rank AS semantic_rank,
      keyword.rank AS keyword_rank,
      semantic.score AS semantic_score,
      keyword.score AS keyword_score
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
    fused.rrf_score,
    fused.semantic_rank,
    fused.keyword_rank,
    fused.semantic_score,
    fused.keyword_score,
    sd.created_at AS document_created_at
  FROM fused
  JOIN document_chunks dc ON dc.id = fused.id
  JOIN source_documents sd ON sd.id = dc.document_id
  ORDER BY fused.rrf_score DESC, dc.chunk_index ASC
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 30), 1), 60);
$$;

REVOKE ALL ON FUNCTION hybrid_search_document_chunks_v2(TEXT, TEXT, TEXT, VECTOR, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hybrid_search_document_chunks_v2(TEXT, TEXT, TEXT, VECTOR, INTEGER)
  TO service_role;

COMMIT;
