-- Add profile_picture_url to users for profile photo uploads. Idempotent.
-- Run in Supabase SQL editor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_picture_url'
  ) THEN
    ALTER TABLE public.users ADD COLUMN profile_picture_url TEXT;
  END IF;
END $$;
