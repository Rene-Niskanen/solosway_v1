#!/usr/bin/env python3
"""
Re-run vector storage for a single document (e.g. one that has 0 document_vectors).
Useful for debugging "extraction completed but no chunks/embeddings".

Usage:
  python scripts/reembed_single_document.py ae2a58c6-6da0-4600-8d3e-990f6979aca5
  python scripts/reembed_single_document.py  # uses latest document
"""
import sys
import json
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")


def main():
    doc_id = None
    if len(sys.argv) > 1:
        doc_id = sys.argv[1].strip()
    if not doc_id:
        # Use latest document
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        r = supabase.table("documents").select("id").order("created_at", desc=True).limit(1).execute()
        if not r.data:
            print("No documents found.")
            return 1
        doc_id = r.data[0]["id"]
        print(f"Using latest document: {doc_id}")

    from backend.services.supabase_client_factory import get_supabase_client
    from backend.services.document_storage_service import DocumentStorageService
    from backend.services.vector_service import SupabaseVectorService
    from backend.tasks import get_document_summary_safe, extract_page_number_from_chunk

    supabase = get_supabase_client()
    doc_storage = DocumentStorageService()
    vector_service = SupabaseVectorService()

    # Fetch document by ID (no business filter for diagnostic script)
    r = supabase.table("documents").select("*").eq("id", str(doc_id)).limit(1).execute()
    if not r.data:
        print(f"Document {doc_id} not found")
        return 1
    document = r.data[0]

    business_id = document.get("business_uuid") or document.get("business_id")
    if not business_id:
        print("Document has no business_id - cannot proceed")
        return 1

    document_summary = get_document_summary_safe(document)
    reducto_chunks = document_summary.get("reducto_chunks") or []
    document_text = document.get("parsed_text") or document_summary.get("reducto_parsed_text") or ""

    print(f"\nDocument: {document.get('original_filename', '—')}")
    print(f"Business: {business_id}")
    print(f"reducto_chunks: {len(reducto_chunks)}")
    print(f"parsed_text length: {len(document_text)}")

    if not reducto_chunks and not document_text:
        print("No chunks or parsed text - nothing to embed")
        return 1

    # Build chunks the same way minimal extraction does
    chunks = []
    chunk_metadata_list = []
    if reducto_chunks:
        for chunk in reducto_chunks:
            embed_text = chunk.get("embed", "")
            content_text = chunk.get("content", "")
            text_to_embed = embed_text if embed_text else content_text
            if text_to_embed:
                chunks.append(text_to_embed)
                chunk_bbox = chunk.get("bbox")
                chunk_page = extract_page_number_from_chunk(chunk)
                chunk_metadata_list.append({
                    "bbox": chunk_bbox,
                    "blocks": chunk.get("blocks", []),
                    "page": chunk_page,
                })
        print(f"Built {len(chunks)} chunks from reducto (total chars: {sum(len(c) for c in chunks)})")
    else:
        chunks = vector_service.chunk_text(document_text, chunk_size=1200, overlap=None)
        print(f"Built {len(chunks)} chunks from manual chunking")

    if not chunks:
        print("No chunks to embed")
        return 1

    metadata = {
        "business_id": str(business_id),
        "document_id": str(doc_id),
        "property_id": document.get("property_id"),
        "classification_type": document.get("classification_type") or "other_documents",
        "boilerplate_lines": document_summary.get("boilerplate_lines", []),
        "parsed_text": document_text[:50000],  # Limit for context service
    }

    print(f"\nCalling store_document_vectors ({len(chunks)} chunks)...")
    try:
        success = vector_service.store_document_vectors(
            str(doc_id),
            chunks,
            metadata,
            chunk_metadata_list=chunk_metadata_list if chunk_metadata_list else None,
            lazy_embedding=False,
        )
        print(f"store_document_vectors returned: {success}")
        if success:
            from backend.services.supabase_client_factory import get_supabase_client
            supabase = get_supabase_client()
            r = supabase.table("document_vectors").select("id", count="exact").eq("document_id", doc_id).execute()
            print(f"document_vectors count: {r.count}")
        return 0 if success else 1
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
