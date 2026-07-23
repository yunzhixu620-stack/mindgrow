-- MindGrow V17 -> V18: persistent sentence-level citation coordinates.
-- Safe to run more than once.

BEGIN;

ALTER TABLE node_citations
  ADD COLUMN IF NOT EXISTS char_start INTEGER,
  ADD COLUMN IF NOT EXISTS char_end INTEGER,
  ADD COLUMN IF NOT EXISTS sentence_index INTEGER;

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS char_start INTEGER,
  ADD COLUMN IF NOT EXISTS char_end INTEGER,
  ADD COLUMN IF NOT EXISTS sentence_index INTEGER;

ALTER TABLE node_citations DROP CONSTRAINT IF EXISTS node_citations_quote_check;
ALTER TABLE node_citations
  ADD CONSTRAINT node_citations_quote_check
  CHECK (char_length(quote) BETWEEN 1 AND 4000);

ALTER TABLE node_citations DROP CONSTRAINT IF EXISTS node_citations_offsets_check;
ALTER TABLE node_citations
  ADD CONSTRAINT node_citations_offsets_check
  CHECK (
    (char_start IS NULL AND char_end IS NULL AND sentence_index IS NULL)
    OR (
      char_start >= 0
      AND char_end > char_start
      AND sentence_index >= 0
      AND char_end - char_start = char_length(quote)
    )
  );

ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS document_chunks_offsets_check;
ALTER TABLE document_chunks
  ADD CONSTRAINT document_chunks_offsets_check
  CHECK (
    (char_start IS NULL AND char_end IS NULL AND sentence_index IS NULL)
    OR (
      char_start >= 0
      AND char_end > char_start
      AND sentence_index >= 0
    )
  );

COMMIT;
