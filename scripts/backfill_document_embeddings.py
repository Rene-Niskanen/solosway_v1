#!/usr/bin/env python3
"""
Backfill script to regenerate document embeddings using mean pooling from chunks.

This script:
1. Queries all documents with existing embeddings (or all documents)
2. Recomputes document embeddings using mean pooling from chunk embeddings
3. Updates documents.document_embedding column

Usage:
    python scripts/backfill_document_embeddings.py [--business-id BUSINESS_UUID] [--dry-run]
"""

import sys
import os
import argparse
import logging
from typing import List, Optional

# CRITICAL: Load .env file BEFORE any backend imports
# This ensures SUPABASE_DB_URL and other env vars are available when backend.config is imported
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Now import backend modules (after .env is loaded)
from backend.services.document_summary_service import DocumentSummaryService
from backend.services.supabase_client_factory import get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_documents_to_backfill(
    business_id: Optional[str] = None, 
    all_documents: bool = False,
    document_id: Optional[str] = None
) -> List[dict]:
    """
    Get list of documents that need embedding regeneration.
    
    Args:
        business_id: Optional business UUID to filter documents
        all_documents: If True, backfill all documents (not just those with embeddings)
        document_id: Optional specific document ID to backfill
        
    Returns:
        List of document dictionaries with id, original_filename, etc.
    """
    supabase = get_supabase_client()
    
    query = supabase.table('documents').select('id, original_filename, classification_type, business_uuid')
    
    # If document_id is specified, only get that document
    if document_id:
        query = query.eq('id', document_id)
    elif business_id:
        query = query.eq('business_uuid', business_id)
    
    if not all_documents and not document_id:
        # Only get documents that have embeddings (to regenerate them)
        # Skip this filter if document_id is specified (we want to process it even if missing embedding)
        query = query.not_.is_('document_embedding', 'null')
    
    response = query.execute()
    
    documents = response.data if response.data else []
    logger.info(f"Found {len(documents)} documents to backfill")
    
    return documents


def backfill_document_embedding(document_id: str, dry_run: bool = False) -> bool:
    """
    Regenerate document embedding, summary, and key topics for a single document.
    
    This function:
    1. Generates document summary using Ollama (or OpenAI fallback)
    2. Extracts key topics from chunks
    3. Generates document embedding using mean pooling from chunk embeddings
    4. Updates all three fields in the database
    
    Args:
        document_id: Document UUID
        dry_run: If True, don't actually update the database
        
    Returns:
        True if successful, False otherwise
    """
    try:
        supabase = get_supabase_client()
        summary_service = DocumentSummaryService()
        
        # Get document and chunks
        doc_response = supabase.table('documents').select('*').eq('id', document_id).execute()
        if not doc_response.data:
            logger.warning(f"⚠️ Document {document_id[:8]}... not found")
            return False
        
        document = doc_response.data[0]
        
        # Get chunks for this document
        chunks_response = supabase.table('document_vectors').select(
            'id, chunk_text, chunk_text_clean, page_number, metadata'
        ).eq('document_id', document_id).execute()
        
        chunks = chunks_response.data if chunks_response.data else []
        if not chunks:
            logger.warning(f"⚠️ No chunks found for document {document_id[:8]}...")
            return False
        
        logger.info(f"   Found {len(chunks)} chunks for document {document_id[:8]}...")
        
        # Step 1: Generate document summary (requires Ollama or OpenAI fallback)
        logger.info(f"   Generating document summary...")
        summary_text = summary_service.generate_document_summary(document, chunks)
        
        if not summary_text:
            logger.warning(f"⚠️ Could not generate summary for document {document_id[:8]}... (Ollama may be unavailable)")
            # Continue anyway - we can still generate embedding
        
        # Step 2: Extract key topics
        logger.info(f"   Extracting key topics...")
        key_topics = summary_service._extract_key_topics(chunks, document)
        
        # Step 3: Generate embedding from chunks (mean pooling)
        logger.info(f"   Generating document embedding from chunks...")
        embedding = summary_service.generate_document_embedding_from_chunks(document_id)
        
        if not embedding:
            logger.warning(f"⚠️ Could not generate embedding for document {document_id[:8]}...")
            return False
        
        if dry_run:
            logger.info(f"   [DRY RUN] Would update document {document_id[:8]}...")
            logger.info(f"      - Summary: {len(summary_text) if summary_text else 0} chars")
            logger.info(f"      - Key topics: {len(key_topics) if key_topics else 0} topics")
            logger.info(f"      - Embedding: {len(embedding)} dimensions")
            return True
        
        # Step 4: Update database with all fields
        update_data = {
            'document_embedding': embedding
        }
        
        if summary_text:
            update_data['summary_text'] = summary_text
        
        if key_topics:
            update_data['key_topics'] = key_topics
        
        result = supabase.table('documents').update(update_data).eq('id', document_id).execute()
        
        if result.data:
            logger.info(f"✅ Updated document {document_id[:8]}...")
            if summary_text:
                logger.info(f"      - Summary: {len(summary_text)} chars")
            if key_topics:
                logger.info(f"      - Key topics: {len(key_topics)} topics")
            logger.info(f"      - Embedding: {len(embedding)} dimensions")
            return True
        else:
            logger.warning(f"⚠️ No document found with id {document_id[:8]}...")
            return False
            
    except Exception as e:
        logger.error(f"❌ Failed to backfill document {document_id[:8]}...: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return False


def main():
    """Main entry point for backfill script."""
    parser = argparse.ArgumentParser(
        description='Backfill document embeddings using mean pooling from chunks'
    )
    parser.add_argument(
        '--business-id',
        type=str,
        help='Business UUID to filter documents (optional)'
    )
    parser.add_argument(
        '--all-documents',
        action='store_true',
        help='Backfill all documents, not just those with existing embeddings'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Dry run mode - don\'t actually update the database'
    )
    parser.add_argument(
        '--document-id',
        type=str,
        help='Specific document ID to backfill (optional)'
    )
    
    args = parser.parse_args()
    
    if args.dry_run:
        logger.info("🔍 DRY RUN MODE - No database updates will be made")
    
    # Get documents to backfill
    documents = get_documents_to_backfill(
        business_id=args.business_id,
        all_documents=args.all_documents,
        document_id=args.document_id
    )
    
    if not documents:
        logger.warning("No documents found to backfill")
        return
    
    # Process each document
    successful = 0
    failed = 0
    
    for i, doc in enumerate(documents, 1):
        document_id = doc.get('id')
        filename = doc.get('original_filename', 'unknown')
        
        logger.info(f"[{i}/{len(documents)}] Processing: {filename} ({document_id[:8]}...)")
        
        success = backfill_document_embedding(document_id, dry_run=args.dry_run)
        
        if success:
            successful += 1
        else:
            failed += 1
    
    # Summary
    logger.info("=" * 60)
    logger.info(f"Backfill complete:")
    logger.info(f"  ✅ Successful: {successful}")
    logger.info(f"  ❌ Failed: {failed}")
    logger.info(f"  📊 Total: {len(documents)}")
    logger.info("=" * 60)


if __name__ == '__main__':
    main()
