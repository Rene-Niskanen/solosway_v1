-- Add subscription_tier to users (Starter / Pro / Business). Idempotent: skip if column exists.
-- Run once; existing users get default 'professional'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'subscription_tier'
  ) THEN
    ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(32) NOT NULL DEFAULT 'professional';
  END IF;
END $$;
