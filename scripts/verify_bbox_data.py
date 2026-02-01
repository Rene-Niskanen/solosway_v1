#!/usr/bin/env python3
"""
Quick script to verify bbox and page_number data in Supabase document_vectors table
"""
import os
import sys
from supabase import create_client

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

def verify_bbox_data(document_id: str = None):
    """Verify bbox and page_number data in document_vectors"""
    
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    
    if not supabase_url or not supabase_key:
        print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
        return
    
    supabase = create_client(supabase_url, supabase_key)
    
    # Query document_vectors
    if document_id:
        query = supabase.table('document_vectors').select(
            'id, chunk_index, page_number, bbox, block_count, chunk_text'
        ).eq('document_id', document_id).order('chunk_index').limit(20)
    else:
        # Get latest document
        query = supabase.table('document_vectors').select(
            'document_id, chunk_index, page_number, bbox, block_count'
        ).order('created_at', desc=True).limit(20)
    
    result = query.execute()
    
    if not result.data:
        print("❌ No document vectors found")
        return
    
    print(f"\n📊 Found {len(result.data)} document vectors\n")
    
    # Check for unique values
    unique_pages = set()
    unique_bboxes = set()
    page_counts = {}
    
    for vec in result.data:
        page = vec.get('page_number')
        bbox_str = str(vec.get('bbox'))
        
        if page:
            unique_pages.add(page)
            page_counts[page] = page_counts.get(page, 0) + 1
        
        if bbox_str and bbox_str != 'None':
            unique_bboxes.add(bbox_str)
    
    print(f"📄 Unique page numbers: {len(unique_pages)}")
    print(f"   Pages found: {sorted(unique_pages) if unique_pages else 'None'}")
    print(f"📦 Unique bboxes: {len(unique_bboxes)}")
    
    # Show sample data
    print(f"\n📋 Sample Data (first 10 chunks):")
    print("-" * 100)
    for i, vec in enumerate(result.data[:10]):
        chunk_idx = vec.get('chunk_index', 'N/A')
        page = vec.get('page_number', 'NULL')
        bbox = vec.get('bbox')
        blocks = vec.get('block_count', 0)
        
        bbox_preview = 'NULL'
        if bbox:
            if isinstance(bbox, dict):
                bbox_preview = f"page={bbox.get('page', '?')}, left={bbox.get('left', '?'):.3f}"
            elif isinstance(bbox, str):
                try:
                    import json
                    bbox_dict = json.loads(bbox)
                    bbox_preview = f"page={bbox_dict.get('page', '?')}, left={bbox_dict.get('left', '?'):.3f}"
                except:
                    bbox_preview = str(bbox)[:50]
            else:
                bbox_preview = str(bbox)[:50]
        
        page_str = str(page) if page is not None else 'NULL'
        print(f"Chunk {chunk_idx:3d} | Page: {page_str:>5} | Blocks: {blocks:3d} | Bbox: {bbox_preview}")
    
    print("-" * 100)
    
    # Summary statistics
    if document_id:
        # Get full statistics for this document
        stats_query = supabase.table('document_vectors').select(
            'page_number, bbox'
        ).eq('document_id', document_id)
        
        stats_result = stats_query.execute()
        
        total = len(stats_result.data) if stats_result.data else 0
        with_page = sum(1 for v in stats_result.data if v.get('page_number') is not None) if stats_result.data else 0
        with_bbox = sum(1 for v in stats_result.data if v.get('bbox') is not None) if stats_result.data else 0
        
        print(f"\n📈 Full Statistics for document {document_id}:")
        print(f"   Total vectors: {total}")
        print(f"   With page_number: {with_page} ({with_page/total*100:.1f}%)" if total > 0 else "   With page_number: 0")
        print(f"   With bbox: {with_bbox} ({with_bbox/total*100:.1f}%)" if total > 0 else "   With bbox: 0")
        print(f"   Unique pages: {len(unique_pages)}")
        print(f"   Unique bboxes: {len(unique_bboxes)}")
        
        if len(unique_pages) == 1 and len(unique_bboxes) == 1:
            print("\n⚠️  WARNING: All chunks have the same page_number and bbox!")
            print("   This indicates the fix needs to be tested with a new document upload.")
        elif len(unique_pages) > 1 or len(unique_bboxes) > 1:
            print("\n✅ GOOD: Multiple unique page_numbers and bboxes found!")
            print("   The fix is working correctly.")

if __name__ == "__main__":
    # Check latest document or specific document ID
    doc_id = sys.argv[1] if len(sys.argv) > 1 else None
    
    if doc_id:
        print(f"🔍 Checking document: {doc_id}\n")
    else:
        print("🔍 Checking latest document vectors\n")
    
    verify_bbox_data(doc_id)

