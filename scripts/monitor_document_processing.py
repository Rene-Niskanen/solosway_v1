#!/usr/bin/env python3
"""
Monitor document processing status in real-time.

This script monitors:
- Document summary generation
- Chunk context generation
- Embedding generation
- Overall processing timeline
"""
import sys
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

# Add project root to Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
from backend.services.supabase_client_factory import get_supabase_client
import logging

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.WARNING)  # Suppress verbose logs
logger = logging.getLogger(__name__)


def get_document_status(supabase, document_id: str) -> Dict[str, Any]:
    """Get current status of document processing"""
    try:
        # Get document summary
        doc_result = supabase.table('documents').select(
            'id, original_filename, document_summary, created_at'
        ).eq('id', document_id).execute()
        
        doc = doc_result.data[0] if doc_result.data else None
        doc_summary = doc.get('document_summary', {}) if doc else {}
        if isinstance(doc_summary, str):
            import json
            try:
                doc_summary = json.loads(doc_summary)
            except:
                doc_summary = {}
        
        has_summary = bool(doc_summary.get('summary'))
        created_at = doc.get('created_at') if doc else None
        
        # Get chunks status
        chunks_result = supabase.table('document_vectors').select(
            'chunk_index, chunk_text, chunk_context, embedding_status, embedding, created_at'
        ).eq('document_id', document_id).order('chunk_index').execute()
        
        chunks = chunks_result.data if chunks_result.data else []
        
        total_chunks = len(chunks)
        chunks_with_context = sum(1 for c in chunks if c.get('chunk_context'))
        chunks_embedded = sum(1 for c in chunks if c.get('embedding') is not None)
        chunks_pending = sum(1 for c in chunks if c.get('embedding_status') == 'pending')
        chunks_queued = sum(1 for c in chunks if c.get('embedding_status') == 'queued')
        chunks_completed = sum(1 for c in chunks if c.get('embedding_status') == 'embedded')
        
        return {
            'document_id': document_id,
            'filename': doc.get('original_filename', 'Unknown') if doc else 'Unknown',
            'created_at': created_at,
            'has_summary': has_summary,
            'total_chunks': total_chunks,
            'chunks_with_context': chunks_with_context,
            'chunks_embedded': chunks_embedded,
            'chunks_pending': chunks_pending,
            'chunks_queued': chunks_queued,
            'chunks_completed': chunks_completed,
            'summary_preview': doc_summary.get('summary', '')[:100] if has_summary else None
        }
    except Exception as e:
        logger.error(f"Error getting document status: {e}")
        return None


def format_timestamp(timestamp: Optional[str]) -> str:
    """Format timestamp for display"""
    if not timestamp:
        return "N/A"
    try:
        dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        return dt.strftime('%H:%M:%S')
    except:
        return timestamp


def monitor_document(document_id: str, max_wait: int = 120, interval: int = 2):
    """
    Monitor document processing status with real-time updates.
    
    Args:
        document_id: Document UUID to monitor
        max_wait: Maximum time to wait in seconds (default: 120)
        interval: Check interval in seconds (default: 2)
    """
    supabase = get_supabase_client()
    start_time = time.time()
    last_status = None
    
    print("\n" + "="*80)
    print(f"📊 MONITORING DOCUMENT PROCESSING")
    print("="*80)
    print(f"   Document ID: {document_id[:8]}...")
    print(f"   Max wait time: {max_wait}s")
    print(f"   Check interval: {interval}s")
    print("="*80)
    print()
    
    # Header
    print(f"{'Time':<8} | {'Summary':<8} | {'Context':<12} | {'Embeddings':<12} | {'Status':<20}")
    print("-" * 80)
    
    milestones = {
        'summary': None,
        'context': None,
        'embeddings': None,
        'complete': None
    }
    
    try:
        while time.time() - start_time < max_wait:
            status = get_document_status(supabase, document_id)
            
            if not status:
                print("❌ Error: Could not retrieve document status")
                time.sleep(interval)
                continue
            
            elapsed = int(time.time() - start_time)
            
            # Check for milestones
            if status['has_summary'] and milestones['summary'] is None:
                milestones['summary'] = elapsed
            if status['chunks_with_context'] == status['total_chunks'] and status['total_chunks'] > 0 and milestones['context'] is None:
                milestones['context'] = elapsed
            if status['chunks_embedded'] == status['total_chunks'] and status['total_chunks'] > 0 and milestones['embeddings'] is None:
                milestones['embeddings'] = elapsed
            if (status['has_summary'] and 
                status['chunks_with_context'] == status['total_chunks'] and 
                status['chunks_embedded'] == status['total_chunks'] and 
                status['total_chunks'] > 0 and 
                milestones['complete'] is None):
                milestones['complete'] = elapsed
            
            # Format status line
            summary_status = "✅" if status['has_summary'] else "⏳"
            context_status = f"{status['chunks_with_context']}/{status['total_chunks']}"
            embedding_status = f"{status['chunks_embedded']}/{status['total_chunks']}"
            
            # Status details
            status_details = []
            if status['chunks_pending'] > 0:
                status_details.append(f"Pending:{status['chunks_pending']}")
            if status['chunks_queued'] > 0:
                status_details.append(f"Queued:{status['chunks_queued']}")
            if status['chunks_completed'] > 0:
                status_details.append(f"Done:{status['chunks_completed']}")
            status_str = ", ".join(status_details) if status_details else "Processing"
            
            # Print status (only if changed)
            current_status_key = (
                status['has_summary'],
                status['chunks_with_context'],
                status['chunks_embedded'],
                status['total_chunks']
            )
            
            if current_status_key != last_status:
                print(f"{elapsed:>6}s | {summary_status:<8} | {context_status:<12} | {embedding_status:<12} | {status_str:<20}")
                last_status = current_status_key
            
            # Check if complete
            if (status['has_summary'] and 
                status['chunks_with_context'] == status['total_chunks'] and 
                status['chunks_embedded'] == status['total_chunks'] and 
                status['total_chunks'] > 0):
                
                print("\n" + "="*80)
                print("✅ DOCUMENT PROCESSING COMPLETE!")
                print("="*80)
                print(f"   Document: {status['filename']}")
                print(f"   Total chunks: {status['total_chunks']}")
                print(f"   Summary: ✅ Generated")
                print(f"   Context: ✅ {status['chunks_with_context']}/{status['total_chunks']} chunks")
                print(f"   Embeddings: ✅ {status['chunks_embedded']}/{status['total_chunks']} chunks")
                print()
                print("📊 Timeline:")
                if milestones['summary']:
                    print(f"   Document summary: {milestones['summary']}s")
                if milestones['context']:
                    print(f"   Chunk contexts: {milestones['context']}s")
                if milestones['embeddings']:
                    print(f"   Embeddings: {milestones['embeddings']}s")
                if milestones['complete']:
                    print(f"   Total time: {milestones['complete']}s")
                
                if status['summary_preview']:
                    print(f"\n📄 Summary preview:")
                    print(f"   {status['summary_preview']}...")
                
                return True
            
            time.sleep(interval)
        
        # Timeout
        print("\n" + "="*80)
        print("⏱️  TIMEOUT")
        print("="*80)
        print(f"   Monitoring stopped after {max_wait}s")
        print(f"   Final status:")
        print(f"      Summary: {'✅' if status['has_summary'] else '❌'}")
        print(f"      Context: {status['chunks_with_context']}/{status['total_chunks']}")
        print(f"      Embeddings: {status['chunks_embedded']}/{status['total_chunks']}")
        return False
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Monitoring interrupted by user")
        return False
    except Exception as e:
        print(f"\n❌ Error during monitoring: {e}")
        import traceback
        print(traceback.format_exc())
        return False


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/monitor_document_processing.py <document_id> [max_wait_seconds]")
        print("\nExample:")
        print("  python scripts/monitor_document_processing.py 123e4567-e89b-12d3-a456-426614174000")
        print("  python scripts/monitor_document_processing.py 123e4567-e89b-12d3-a456-426614174000 60")
        sys.exit(1)
    
    document_id = sys.argv[1]
    max_wait = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    
    success = monitor_document(document_id, max_wait=max_wait)
    sys.exit(0 if success else 1)

