-- MindGrow v14 rollback. Revert API 10.10.0 before running this script.

BEGIN;

DROP INDEX IF EXISTS idx_node_layouts_workspace_map_group;
DROP INDEX IF EXISTS idx_whiteboard_groups_workspace_map_sort;

ALTER TABLE node_layouts DROP CONSTRAINT IF EXISTS node_layouts_group_map_fk;
ALTER TABLE node_layouts DROP CONSTRAINT IF EXISTS node_layouts_card_height_check;
ALTER TABLE node_layouts DROP CONSTRAINT IF EXISTS node_layouts_card_width_check;
ALTER TABLE node_layouts DROP COLUMN IF EXISTS updated_at;
ALTER TABLE node_layouts DROP COLUMN IF EXISTS card_height;
ALTER TABLE node_layouts DROP COLUMN IF EXISTS card_width;
ALTER TABLE node_layouts DROP COLUMN IF EXISTS group_id;

DROP TABLE IF EXISTS whiteboard_groups;

ALTER TABLE maps DROP CONSTRAINT IF EXISTS maps_canvas_view_check;
ALTER TABLE maps DROP COLUMN IF EXISTS canvas_view;

COMMIT;
