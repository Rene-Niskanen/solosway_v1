-- Migration: Update project_status enum to use uppercase values
-- Run this SQL in your Supabase SQL Editor or via psql

-- Step 1: Rename the old enum type
ALTER TYPE project_status RENAME TO project_status_old;

-- Step 2: Create new enum type with uppercase values
CREATE TYPE project_status AS ENUM ('ACTIVE', 'NEGOTIATING', 'ARCHIVED');

-- Step 3: Update the projects table to use the new enum type
-- Convert existing lowercase values to uppercase
ALTER TABLE projects 
  ALTER COLUMN status TYPE project_status 
  USING CASE 
    WHEN status::text = 'active' THEN 'ACTIVE'::project_status
    WHEN status::text = 'negotiating' THEN 'NEGOTIATING'::project_status
    WHEN status::text = 'archived' THEN 'ARCHIVED'::project_status
    ELSE 'ACTIVE'::project_status  -- Default fallback
  END;

-- Step 4: Drop the old enum type
DROP TYPE project_status_old;

-- Verify the change
SELECT DISTINCT status FROM projects;
