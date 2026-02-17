-- Add subscription_period_ends_at to users (plan period = 1 month from switch). Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_period_ends_at'
  ) THEN
    ALTER TABLE users ADD COLUMN subscription_period_ends_at DATE NULL;
  END IF;
END $$;
