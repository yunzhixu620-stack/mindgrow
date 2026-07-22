-- MindGrow v12 rollback.
-- Revert the S2.1 application/backend commit first, then run this script.
-- Markers are restored before dropping mode so maps created after migration
-- remain correctly classified by the legacy application.

BEGIN;

UPDATE maps
SET description = '[MindGrow:meeting] ' || description
WHERE mode = 'meeting'
  AND description NOT LIKE '%[MindGrow:meeting]%';

UPDATE maps
SET description = '[MindGrow:article] ' || description
WHERE mode = 'article'
  AND description NOT LIKE '%[MindGrow:article]%';

DROP TRIGGER IF EXISTS maps_legacy_mode_compat ON maps;
DROP FUNCTION IF EXISTS normalize_map_mode_from_legacy_marker();
DROP INDEX IF EXISTS idx_maps_workspace_mode_updated;
ALTER TABLE maps DROP CONSTRAINT IF EXISTS maps_mode_check;
ALTER TABLE maps DROP COLUMN IF EXISTS mode;

COMMIT;
