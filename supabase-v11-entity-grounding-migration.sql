-- MindGrow 10.5: preserve dedicated description evidence and grounded
-- relation explanations across save/reload.
-- Apply this migration before deploying the P2.1.2 backend.

BEGIN;

ALTER TABLE graph_entities
  ADD COLUMN IF NOT EXISTS description_citation_indexes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE graph_relations
  ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';

COMMIT;

-- Rollback (data-destructive for v4 grounding metadata):
-- ALTER TABLE graph_relations DROP COLUMN IF EXISTS explanation;
-- ALTER TABLE graph_entities DROP COLUMN IF EXISTS description_citation_indexes;
