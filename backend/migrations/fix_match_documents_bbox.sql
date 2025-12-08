-- Drop the existing function first to allow return type change
DROP FUNCTION IF EXISTS match_documents;

-- Re-create the function with bbox included
-- NOTE: bbox is stored as TEXT (JSON string) in document_vectors, so return as TEXT
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count int,
  match_threshold float,
  filter_property_id uuid DEFAULT NULL,
  filter_classification_type text DEFAULT NULL,
  filter_address_hash text DEFAULT NULL,
  filter_business_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  property_id uuid,
  chunk_text text,
  chunk_context text,
  chunk_index int,
  page_number int,
  bbox text,           -- FIXED: Return bbox as TEXT (matches storage type)
  classification_type text,
  address_hash text,
  business_uuid uuid,
  original_filename text,
  property_address text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dv.id,
    dv.document_id,
    dv.property_id,
    dv.chunk_text,
    dv.chunk_context,
    dv.chunk_index,
    dv.page_number,
    dv.bbox::text,      -- FIXED: Cast to text to ensure type match
    dv.classification_type,
    dv.address_hash,
    dv.business_uuid,
    d.original_filename::text,      -- Cast to text to avoid type mismatch
    p.formatted_address::text as property_address, -- Cast to text
    1 - (dv.embedding <=> query_embedding) as similarity
  FROM document_vectors dv
  LEFT JOIN documents d ON d.id = dv.document_id
  LEFT JOIN properties p ON p.id = dv.property_id
  WHERE dv.embedding IS NOT NULL
    AND (filter_property_id IS NULL OR dv.property_id = filter_property_id)
    AND (filter_classification_type IS NULL OR dv.classification_type = filter_classification_type)
    AND (filter_address_hash IS NULL OR dv.address_hash = filter_address_hash)
    AND (filter_business_id IS NULL OR dv.business_uuid = filter_business_id)
    AND 1 - (dv.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
