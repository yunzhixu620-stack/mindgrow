BEGIN;

ALTER TABLE node_citations DROP CONSTRAINT IF EXISTS node_citations_offsets_check;
ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS document_chunks_offsets_check;

ALTER TABLE node_citations
  DROP COLUMN IF EXISTS char_start,
  DROP COLUMN IF EXISTS char_end,
  DROP COLUMN IF EXISTS sentence_index;

ALTER TABLE document_chunks
  DROP COLUMN IF EXISTS char_start,
  DROP COLUMN IF EXISTS char_end,
  DROP COLUMN IF EXISTS sentence_index;

ALTER TABLE node_citations DROP CONSTRAINT IF EXISTS node_citations_quote_check;
ALTER TABLE node_citations
  ADD CONSTRAINT node_citations_quote_check
  CHECK (char_length(quote) BETWEEN 1 AND 1000);

COMMIT;
