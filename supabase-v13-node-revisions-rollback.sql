-- MindGrow v13 rollback. Revert API 10.8.0 before running this script.

BEGIN;

DROP INDEX IF EXISTS idx_node_revisions_workspace_node_created;
DROP TABLE IF EXISTS node_revisions;

COMMIT;
