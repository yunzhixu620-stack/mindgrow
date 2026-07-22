-- MindGrow v12: make product-board ownership an explicit, indexed map field.
-- Safe to rerun. Apply before deploying the S2.1 backend revision.

BEGIN;

ALTER TABLE maps ADD COLUMN IF NOT EXISTS mode TEXT;

-- Preserve already-valid explicit values. Only migrate null/invalid rows, plus
-- legacy rows that still carry a marker while the new column is at its default.
UPDATE maps
SET mode = 'meeting'
WHERE description LIKE '%[MindGrow:meeting]%'
  AND (mode IS NULL OR mode = 'knowledge');

UPDATE maps
SET mode = 'article'
WHERE description LIKE '%[MindGrow:article]%'
  AND (mode IS NULL OR mode = 'knowledge');

UPDATE maps
SET mode = 'knowledge'
WHERE mode IS NULL OR mode NOT IN ('knowledge', 'meeting', 'article');

-- Keep the database default null during the compatibility window. The BEFORE
-- trigger can then distinguish an old backend that omitted mode from a new
-- backend that explicitly selected knowledge.
ALTER TABLE maps ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE maps ALTER COLUMN mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maps_mode_check' AND conrelid = 'maps'::regclass
  ) THEN
    ALTER TABLE maps
      ADD CONSTRAINT maps_mode_check CHECK (mode IN ('knowledge', 'meeting', 'article'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_maps_workspace_mode_updated
  ON maps(workspace_id, mode, updated_at DESC);

CREATE OR REPLACE FUNCTION normalize_map_mode_from_legacy_marker()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.mode IS NULL THEN
    IF NEW.description LIKE '%[MindGrow:meeting]%' THEN
      NEW.mode := 'meeting';
    ELSIF NEW.description LIKE '%[MindGrow:article]%' THEN
      NEW.mode := 'article';
    ELSE
      NEW.mode := 'knowledge';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maps_legacy_mode_compat ON maps;
CREATE TRIGGER maps_legacy_mode_compat
BEFORE INSERT OR UPDATE OF description, mode ON maps
FOR EACH ROW EXECUTE FUNCTION normalize_map_mode_from_legacy_marker();

REVOKE ALL ON FUNCTION normalize_map_mode_from_legacy_marker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION normalize_map_mode_from_legacy_marker() TO service_role;

COMMIT;
