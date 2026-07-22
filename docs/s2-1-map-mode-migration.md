# S2.1 maps.mode migration runbook

## Purpose

Move product-board ownership from hidden description markers to the explicit
`maps.mode` field. Valid values are `knowledge`, `meeting`, and `article`.

## Deployment order

1. Record pre-migration counts with the verification query below.
2. Run `supabase-v12-map-mode-migration.sql` in Supabase SQL Editor.
3. Re-run the verification query. Do not deploy if any row is invalid or the
   marker-derived counts changed unexpectedly.
4. Deploy the S2.1 Function Compute code, then the static frontend.
5. Run authenticated backend smoke and create one temporary map per mode.

The compatibility trigger keeps an older backend safe during the rollout: an
old article/meeting insert that still carries a marker is assigned the correct
mode. New code sends mode directly and no longer writes markers.

## Verification query

```sql
SELECT
  mode,
  count(*) AS maps,
  count(*) FILTER (WHERE description LIKE '%[MindGrow:meeting]%') AS meeting_markers,
  count(*) FILTER (WHERE description LIKE '%[MindGrow:article]%') AS article_markers
FROM maps
GROUP BY mode
ORDER BY mode;

SELECT count(*) AS invalid_maps
FROM maps
WHERE mode IS NULL OR mode NOT IN ('knowledge', 'meeting', 'article');
```

Expected: `invalid_maps = 0`; every historical meeting/article marker belongs
to its matching mode. Historical markers are retained during this migration so
rollback remains lossless.

## Rollback

1. Revert the S2.1 frontend/backend release.
2. Run `supabase-v12-map-mode-rollback.sql`.
3. Verify that every former meeting/article row has its legacy marker and that
   the application again classifies all existing maps correctly.

The rollback script restores markers for maps created after migration before it
drops the column, index, constraint, trigger, and trigger function.

## Security and operations

- No browser table access is added; existing RLS and service-role-only access
  stay unchanged.
- No new dependency or network egress is introduced.
- The index is tenant-first: `(workspace_id, mode, updated_at DESC)`.
- Apply and rollback are explicit Owner operations; this PR does not mutate the
  production database or Aliyun configuration.
