-- Add chunk_quality_score column to document_vectors table
ALTER TABLE document_vectors 
ADD COLUMN IF NOT EXISTS chunk_quality_score FLOAT;

-- Add comment explaining the column
COMMENT ON COLUMN document_vectors.chunk_quality_score IS 
'Quality score (0.0-1.0) for chunk quality assessment. Higher scores indicate better quality chunks.';

-- Add index for quality-based filtering
CREATE INDEX IF NOT EXISTS idx_document_vectors_quality_score 
ON document_vectors(chunk_quality_score) 
WHERE chunk_quality_score IS NOT NULL;

-- Add composite index for document-level quality ranking
-- This enables queries like: "Get best chunks per document ordered by quality"
CREATE INDEX IF NOT EXISTS idx_document_vectors_doc_quality 
ON document_vectors(document_id, chunk_quality_score DESC)
WHERE chunk_quality_score IS NOT NULL;

-- Add index for quality threshold filtering
-- Enables queries like: "Get chunks with quality > 0.7"
CREATE INDEX IF NOT EXISTS idx_document_vectors_quality_threshold 
ON document_vectors(chunk_quality_score)
WHERE chunk_quality_score >= 0.7;

