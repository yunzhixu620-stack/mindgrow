-- MindGrow 10.16 workspace search rollback.

BEGIN;

DROP FUNCTION IF EXISTS search_workspace_knowledge(TEXT, TEXT, INTEGER);
DROP INDEX IF EXISTS idx_document_chunks_content_trgm;
DROP INDEX IF EXISTS idx_source_documents_title_trgm;
DROP INDEX IF EXISTS idx_graph_entities_description_trgm;
DROP INDEX IF EXISTS idx_graph_entities_name_trgm;
DROP INDEX IF EXISTS idx_maps_description_trgm;
DROP INDEX IF EXISTS idx_maps_name_trgm;

COMMIT;
