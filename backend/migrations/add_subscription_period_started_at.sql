-- Add subscription_period_started_at to users (exact moment period started; usage counted from here so 0/500 after plan change). Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_period_started_at'
  ) THEN
    ALTER TABLE users ADD COLUMN subscription_period_started_at TIMESTAMPTZ NULL;
  END IF;
END $$;
