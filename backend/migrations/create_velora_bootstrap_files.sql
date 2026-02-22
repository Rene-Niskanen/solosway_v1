-- Bootstrap / USER.md: project context stored per user per business.
-- Run in Supabase SQL Editor or via psql.

CREATE TABLE IF NOT EXISTS velora_bootstrap_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_velora_bootstrap_files_scope_name
    ON velora_bootstrap_files (business_id, user_id, name);

CREATE INDEX IF NOT EXISTS idx_velora_bootstrap_files_lookup
    ON velora_bootstrap_files (business_id, user_id, name);

COMMENT ON TABLE velora_bootstrap_files IS 'Bootstrap files (e.g. USER.md) per user per business for system prompt context';
