-- MindGrow 10.17: tenant-scoped product feedback, triage tags, and release follow-up.
-- Safe to run more than once in the Supabase SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS product_feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('retrieval', 'answer', 'citation', 'performance', 'ux', 'account', 'feature', 'community', 'other')),
  severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'blocker')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 20 AND 4000),
  locale TEXT NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN', 'en')),
  product_area TEXT NOT NULL DEFAULT 'knowledge' CHECK (product_area IN ('knowledge', 'article', 'meeting', 'universe', 'auth', 'guide', 'other')),
  issue_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'planned', 'resolved', 'closed')),
  contact_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  contact_email TEXT NOT NULL DEFAULT '' CHECK (char_length(contact_email) <= 320),
  client_version TEXT NOT NULL DEFAULT '' CHECK (char_length(client_version) <= 40),
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolution_note TEXT NOT NULL DEFAULT '' CHECK (char_length(resolution_note) <= 1000),
  resolved_version TEXT NOT NULL DEFAULT '' CHECK (char_length(resolved_version) <= 40),
  follow_up_acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_feedback_workspace_status
  ON product_feedback(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_feedback_user_created
  ON product_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_feedback_follow_up
  ON product_feedback(user_id, resolved_version, follow_up_acknowledged_at)
  WHERE resolved_version <> '';
CREATE INDEX IF NOT EXISTS idx_product_feedback_tags
  ON product_feedback USING GIN(issue_tags);

ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE product_feedback FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE product_feedback TO service_role;

COMMIT;
