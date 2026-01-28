-- Migration: Create projects table
-- Run this SQL in your Supabase SQL Editor or via psql

-- Create enum type for project status
DO $$ BEGIN
    CREATE TYPE project_status AS ENUM ('ACTIVE', 'NEGOTIATING', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Client information
    client_name VARCHAR(255) NOT NULL,
    client_logo_url VARCHAR(1024),
    
    -- Project details
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status project_status NOT NULL DEFAULT 'ACTIVE',
    tags JSONB DEFAULT '[]'::jsonb,
    tool VARCHAR(100),
    
    -- Budget (stored in cents for precision)
    budget_min INTEGER,
    budget_max INTEGER,
    
    -- Timeline
    due_date TIMESTAMP WITH TIME ZONE,
    
    -- Media
    thumbnail_url VARCHAR(1024),
    
    -- Engagement
    message_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

-- Create a function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at on row updates
DROP TRIGGER IF EXISTS projects_updated_at_trigger ON projects;
CREATE TRIGGER projects_updated_at_trigger
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_projects_updated_at();

-- Add comments for documentation
COMMENT ON TABLE projects IS 'Projects for freelance/design work management';
COMMENT ON COLUMN projects.budget_min IS 'Minimum budget in cents';
COMMENT ON COLUMN projects.budget_max IS 'Maximum budget in cents';
COMMENT ON COLUMN projects.tags IS 'Array of tag strings like ["Web Design", "Branding"]';
