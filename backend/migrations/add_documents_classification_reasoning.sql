-- Migration: Add classification_reasoning column to documents table
-- The SQLAlchemy Document model expects this column; add it if missing.

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS classification_reasoning TEXT;
