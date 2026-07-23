-- MindGrow 10.17 feedback-loop rollback. This removes feedback records.
-- Export product_feedback first if production submissions must be retained.

BEGIN;
DROP TABLE IF EXISTS product_feedback;
COMMIT;
