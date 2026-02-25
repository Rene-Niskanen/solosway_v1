-- Add privacy_mode column to users for Settings > Privacy.
-- Values: 'share' (Share Data) or 'privacy' (Privacy Mode). Default: 'privacy'.
-- After running, add privacy_mode to allowed_for_db in views.py update_user_profile
-- and to user_data in api_auth_me.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'privacy_mode') THEN
    ALTER TABLE public.users ADD COLUMN privacy_mode VARCHAR(32) NOT NULL DEFAULT 'privacy';
  END IF;
END $$;
