#!/usr/bin/env python3
"""
Re-embed all documents and chunks with Gemini embeddings.

Prerequisites:
  1. Apply migration: backend/migrations/add_gemini_embedding_768.sql
  2. Set USE_GEMINI_EMBEDDINGS=true and GEMINI_API_KEY in .env

Usage:
  python -m backend.scripts.reembed_with_gemini

Options (env vars):
  REEMBED_BATCH_SIZE=50       Documents per batch
  REEMBED_BUSINESS_ID=        Optional: limit to one business
"""
import os
import sys
import logging
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    if os.environ.get("USE_GEMINI_EMBEDDINGS", "false").lower() != "true":
        logger.error("Set USE_GEMINI_EMBEDDINGS=true to run this script")
        return False
    if not os.environ.get("GEMINI_API_KEY"):
        logger.error("Set GEMINI_API_KEY to run this script")
        return False

    from backend.services.supabase_client_factory import get_supabase_client
    from backend.services.vector_service import SupabaseVectorService
    from backend.services.document_summary_service import DocumentSummaryService

    supabase = get_supabase_client()
    vector_service = SupabaseVectorService()
    if not vector_service.use_gemini:
        logger.error("Vector service is not using Gemini. Check USE_GEMINI_EMBEDDINGS and GEMINI_API_KEY.")
        return False

    batch_size = int(os.environ.get("REEMBED_BATCH_SIZE", "50"))
    business_id = os.environ.get("REEMBED_BUSINESS_ID")

    # Fetch document IDs
    query = supabase.table("documents").select("id, business_uuid")
    if business_id:
        query = query.eq("business_uuid", business_id)
    result = query.execute()
    docs = result.data or []
    logger.info("Found %d documents to re-embed", len(docs))

    doc_summary_svc = DocumentSummaryService()
    success = 0
    failed = 0

    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(docs) + batch_size - 1) // batch_size
        logger.info("Batch %d/%d: %d documents", batch_num, total_batches, len(batch))

        for doc in batch:
            doc_id = doc["id"]
            try:
                # Fetch chunks for this document
                chunks_result = supabase.table("document_vectors").select(
                    "id, chunk_index, chunk_text_clean, chunk_text"
                ).eq("document_id", doc_id).order("chunk_index").execute()
                chunk_rows = chunks_result.data or []

                if not chunk_rows:
                    logger.debug("Document %s has no chunks, skipping", doc_id[:8])
                    continue

                # Use chunk_text_clean for embedding (preferred) or chunk_text
                texts = [
                    (r.get("chunk_text_clean") or r.get("chunk_text") or "").strip()
                    for r in chunk_rows
                ]
                texts = [t for t in texts if t]

                if not texts:
                    logger.warning("Document %s chunks have no text, skipping", doc_id[:8])
                    continue

                # Embed with Gemini (RETRIEVAL_DOCUMENT for chunks)
                embeddings = vector_service.create_embeddings(texts, task_type="RETRIEVAL_DOCUMENT")
                if len(embeddings) != len(texts):
                    logger.error("Embedding count mismatch for document %s", doc_id[:8])
                    failed += 1
                    continue

                # Update each chunk's embedding
                for j, row in enumerate(chunk_rows):
                    if j < len(embeddings):
                        supabase.table("document_vectors").update({
                            "embedding": embeddings[j],
                            "embedding_status": "embedded",
                            "embedding_model": vector_service.embedding_model,
                        }).eq("id", row["id"]).execute()

                # Mean-pool for document embedding and update documents table
                doc_embedding = doc_summary_svc.generate_document_embedding_from_chunks(str(doc_id))
                if doc_embedding:
                    supabase.table("documents").update({
                        "document_embedding": doc_embedding,
                    }).eq("id", doc_id).execute()

                success += 1
                logger.debug("Re-embedded document %s (%d chunks)", doc_id[:8], len(texts))
            except Exception as e:
                logger.exception("Failed to re-embed document %s: %s", doc_id[:8], e)
                failed += 1

    logger.info("Re-embed complete: %d success, %d failed", success, failed)
    return failed == 0


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
