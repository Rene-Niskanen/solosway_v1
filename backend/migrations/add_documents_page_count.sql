-- Add page_count to documents table for profile stats (document + page counter).
-- Run this in Supabase SQL Editor (or your migration runner).
-- Existing rows will have page_count NULL until processing runs or backfill.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer;
