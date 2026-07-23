-- MindGrow 10.16: tenant-scoped workspace search with explainable hits.
-- Safe to run more than once in the Supabase SQL editor.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_maps_name_trgm
  ON maps USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_maps_description_trgm
  ON maps USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_graph_entities_name_trgm
  ON graph_entities USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_graph_entities_description_trgm
  ON graph_entities USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_source_documents_title_trgm
  ON source_documents USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_trgm
  ON document_chunks USING GIN (content gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_workspace_knowledge(
  p_workspace_id TEXT,
  p_query_text TEXT,
  p_match_count INTEGER DEFAULT 24
)
RETURNS TABLE (
  result_type TEXT,
  result_id TEXT,
  map_id TEXT,
  map_name TEXT,
  title TEXT,
  snippet TEXT,
  match_field TEXT,
  locator TEXT,
  score REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH query_input AS (
    SELECT lower(trim(COALESCE(p_query_text, ''))) AS query_text
  ),
  candidates AS (
    SELECT
      'map'::TEXT AS result_type,
      m.id AS result_id,
      m.id AS map_id,
      m.name AS map_name,
      m.name AS title,
      left(COALESCE(NULLIF(m.description, ''), m.name), 360) AS snippet,
      CASE
        WHEN lower(m.name) LIKE '%' || q.query_text || '%' THEN 'map_title'
        ELSE 'map_description'
      END AS match_field,
      ''::TEXT AS locator,
      GREATEST(
        CASE WHEN lower(m.name) = q.query_text THEN 1.00 ELSE 0.00 END,
        CASE WHEN lower(m.name) LIKE q.query_text || '%' THEN 0.96 ELSE 0.00 END,
        CASE WHEN lower(m.name) LIKE '%' || q.query_text || '%' THEN 0.90 ELSE 0.00 END,
        similarity(lower(m.name), q.query_text) * 0.82,
        CASE WHEN lower(m.description) LIKE '%' || q.query_text || '%' THEN 0.72 ELSE 0.00 END,
        similarity(lower(m.description), q.query_text) * 0.62
      )::REAL AS score,
      m.updated_at AS ranked_at
    FROM maps m
    CROSS JOIN query_input q
    WHERE m.workspace_id = p_workspace_id
      AND length(q.query_text) BETWEEN 2 AND 120
      AND (
        lower(m.name) LIKE '%' || q.query_text || '%'
        OR lower(m.description) LIKE '%' || q.query_text || '%'
        OR m.name % q.query_text
        OR m.description % q.query_text
      )

    UNION ALL

    SELECT
      'node'::TEXT,
      n.id,
      n.map_id,
      m.name,
      left(n.content, 180),
      left(COALESCE(NULLIF(n."desc", ''), n.content), 360),
      CASE
        WHEN lower(n.content) LIKE '%' || q.query_text || '%' THEN 'node_title'
        ELSE 'node_description'
      END,
      ''::TEXT,
      GREATEST(
        CASE WHEN lower(n.content) = q.query_text THEN 0.99 ELSE 0.00 END,
        CASE WHEN lower(n.content) LIKE q.query_text || '%' THEN 0.94 ELSE 0.00 END,
        CASE WHEN lower(n.content) LIKE '%' || q.query_text || '%' THEN 0.88 ELSE 0.00 END,
        similarity(lower(n.content), q.query_text) * 0.80,
        CASE WHEN lower(n."desc") LIKE '%' || q.query_text || '%' THEN 0.70 ELSE 0.00 END,
        similarity(lower(n."desc"), q.query_text) * 0.60
      )::REAL,
      n.updated_at
    FROM nodes n
    JOIN maps m ON m.id = n.map_id AND m.workspace_id = p_workspace_id
    CROSS JOIN query_input q
    WHERE n.workspace_id = p_workspace_id
      AND n.status = 'active'
      AND length(q.query_text) BETWEEN 2 AND 120
      AND (
        lower(n.content) LIKE '%' || q.query_text || '%'
        OR lower(n."desc") LIKE '%' || q.query_text || '%'
        OR n.content % q.query_text
        OR n."desc" % q.query_text
      )

    UNION ALL

    SELECT
      'entity'::TEXT,
      ge.id,
      ge.map_id,
      m.name,
      ge.canonical_name,
      left(COALESCE(NULLIF(ge.description, ''), ge.canonical_name), 360),
      CASE
        WHEN lower(ge.canonical_name) LIKE '%' || q.query_text || '%' THEN 'entity_name'
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(ge.aliases) = 'array' THEN ge.aliases ELSE '[]'::jsonb END
          ) alias
          WHERE lower(alias) LIKE '%' || q.query_text || '%'
        ) THEN 'entity_alias'
        ELSE 'entity_description'
      END,
      ''::TEXT,
      GREATEST(
        CASE WHEN lower(ge.canonical_name) = q.query_text THEN 0.98 ELSE 0.00 END,
        CASE WHEN lower(ge.canonical_name) LIKE q.query_text || '%' THEN 0.93 ELSE 0.00 END,
        CASE WHEN lower(ge.canonical_name) LIKE '%' || q.query_text || '%' THEN 0.87 ELSE 0.00 END,
        similarity(lower(ge.canonical_name), q.query_text) * 0.79,
        CASE WHEN lower(ge.description) LIKE '%' || q.query_text || '%' THEN 0.69 ELSE 0.00 END,
        similarity(lower(ge.description), q.query_text) * 0.59,
        CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(ge.aliases) = 'array' THEN ge.aliases ELSE '[]'::jsonb END
          ) alias
          WHERE lower(alias) LIKE '%' || q.query_text || '%'
        ) THEN 0.84 ELSE 0.00 END
      )::REAL,
      ge.updated_at
    FROM graph_entities ge
    JOIN maps m ON m.id = ge.map_id AND m.workspace_id = p_workspace_id
    CROSS JOIN query_input q
    WHERE ge.workspace_id = p_workspace_id
      AND length(q.query_text) BETWEEN 2 AND 120
      AND (
        lower(ge.canonical_name) LIKE '%' || q.query_text || '%'
        OR lower(ge.description) LIKE '%' || q.query_text || '%'
        OR ge.canonical_name % q.query_text
        OR ge.description % q.query_text
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(ge.aliases) = 'array' THEN ge.aliases ELSE '[]'::jsonb END
          ) alias
          WHERE lower(alias) LIKE '%' || q.query_text || '%'
        )
      )

    UNION ALL

    SELECT
      'document'::TEXT,
      sd.id,
      sd.map_id,
      m.name,
      sd.title,
      left(COALESCE(NULLIF(dc.content, ''), sd.title), 360),
      CASE
        WHEN lower(sd.title) LIKE '%' || q.query_text || '%' THEN 'document_title'
        ELSE 'citation_text'
      END,
      COALESCE(NULLIF(dc.locator, ''), NULLIF(sd.file_name, ''), NULLIF(sd.source_url, ''), '')::TEXT,
      GREATEST(
        CASE WHEN lower(sd.title) = q.query_text THEN 0.97 ELSE 0.00 END,
        CASE WHEN lower(sd.title) LIKE q.query_text || '%' THEN 0.92 ELSE 0.00 END,
        CASE WHEN lower(sd.title) LIKE '%' || q.query_text || '%' THEN 0.86 ELSE 0.00 END,
        similarity(lower(sd.title), q.query_text) * 0.78,
        CASE WHEN lower(COALESCE(dc.content, '')) LIKE '%' || q.query_text || '%' THEN 0.76 ELSE 0.00 END,
        similarity(lower(COALESCE(dc.content, '')), q.query_text) * 0.58
      )::REAL,
      sd.created_at
    FROM source_documents sd
    JOIN maps m ON m.id = sd.map_id AND m.workspace_id = p_workspace_id
    CROSS JOIN query_input q
    LEFT JOIN LATERAL (
      SELECT chunk.content, chunk.locator
      FROM document_chunks chunk
      WHERE chunk.workspace_id = p_workspace_id
        AND chunk.map_id = sd.map_id
        AND chunk.document_id = sd.id
        AND (
          lower(chunk.content) LIKE '%' || q.query_text || '%'
          OR chunk.content % q.query_text
        )
      ORDER BY
        CASE WHEN lower(chunk.content) LIKE '%' || q.query_text || '%' THEN 1 ELSE 0 END DESC,
        similarity(lower(chunk.content), q.query_text) DESC,
        chunk.chunk_index ASC
      LIMIT 1
    ) dc ON TRUE
    WHERE sd.workspace_id = p_workspace_id
      AND length(q.query_text) BETWEEN 2 AND 120
      AND (
        lower(sd.title) LIKE '%' || q.query_text || '%'
        OR sd.title % q.query_text
        OR dc.content IS NOT NULL
      )
  ),
  deduplicated AS (
    SELECT *, row_number() OVER (
      PARTITION BY result_type, result_id
      ORDER BY score DESC, ranked_at DESC
    ) AS duplicate_rank
    FROM candidates
  )
  SELECT
    d.result_type,
    d.result_id,
    d.map_id,
    d.map_name,
    d.title,
    d.snippet,
    d.match_field,
    d.locator,
    d.score
  FROM deduplicated d
  WHERE d.duplicate_rank = 1
  ORDER BY d.score DESC, d.ranked_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 24), 1), 40);
$$;

REVOKE ALL ON FUNCTION search_workspace_knowledge(TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_workspace_knowledge(TEXT, TEXT, INTEGER)
  TO service_role;

COMMIT;
