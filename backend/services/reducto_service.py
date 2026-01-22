"""
Reducto service adapter - Synchronus processing 
Handles the document parsing, classification, and extraction using Reducto's API 
"""
import os 
import logging 
import requests 
from pathlib import Path
from typing import Dict, Any, List, Optional
from reducto import Reducto

logger = logging.getLogger(__name__)

def calculate_union_bbox(bbox1: dict, bbox2: dict) -> dict:
    """
    Calculate the union bounding box that encompasses both bboxes.
    
    Args:
        bbox1: First bbox dict with left, top, width, height, page, original_page
        bbox2: Second bbox dict with left, top, width, height, page, original_page
        
    Returns:
        Union bbox dict that contains both input bboxes
    """
    if not bbox1:
        return bbox2.copy() if bbox2 else None
    if not bbox2:
        return bbox1.copy()
    
    # Calculate right and bottom edges for both bboxes
    left1 = bbox1.get('left', 0) or 0
    top1 = bbox1.get('top', 0) or 0
    width1 = bbox1.get('width', 0) or 0
    height1 = bbox1.get('height', 0) or 0
    right1 = left1 + width1
    bottom1 = top1 + height1
    
    left2 = bbox2.get('left', 0) or 0
    top2 = bbox2.get('top', 0) or 0
    width2 = bbox2.get('width', 0) or 0
    height2 = bbox2.get('height', 0) or 0
    right2 = left2 + width2
    bottom2 = top2 + height2
    
    # Union: min left/top, max right/bottom
    union_left = min(left1, left2)
    union_top = min(top1, top2)
    union_right = max(right1, right2)
    union_bottom = max(bottom1, bottom2)
    
    union_bbox = {
        'left': union_left,
        'top': union_top,
        'width': union_right - union_left,
        'height': union_bottom - union_top,
        'page': bbox1.get('page') or bbox2.get('page'),
        'original_page': bbox1.get('original_page') or bbox2.get('original_page')
    }
    
    return union_bbox

def extract_block_metadata(block: Any) -> Optional[Dict[str, Any]]:
    """
    Extract metadata from a Reducto block, handling both dict and object structures.
    Filters out empty/invalid blocks.
    
    Args:
        block: Reducto block (can be dict or object)
        
    Returns:
        Block metadata dict, or None if block is empty/invalid
    """
    # Handle both object and dict block structures
    if isinstance(block, dict):
        block_type = block.get('type', 'unknown')
        block_content = block.get('content', '')
        block_image_url = block.get('image_url', None)
        block_confidence = block.get('confidence', None)
        block_logprobs_confidence = block.get('logprobs_confidence', None)
        block_bbox_raw = block.get('bbox', None)
    else:
        block_type = getattr(block, 'type', 'unknown')
        block_content = getattr(block, 'content', '')
        block_image_url = getattr(block, 'image_url', None)
        block_confidence = getattr(block, 'confidence', None)
        block_logprobs_confidence = getattr(block, 'logprobs_confidence', None)
        block_bbox_raw = getattr(block, 'bbox', None) if hasattr(block, 'bbox') else None
    
    # FILTER OUT EMPTY/INVALID BLOCKS
    # A block is considered valid if it has:
    # - A valid type (not 'unknown' or empty)
    # - OR content (not empty)
    # - OR image_url (for Figure/Table blocks)
    # - OR bbox (for citation matching)
    is_valid = (
        (block_type and block_type != 'unknown') or
        (block_content and block_content.strip()) or
        block_image_url or
        block_bbox_raw
    )
    
    if not is_valid:
        return None  # Skip empty/invalid blocks
    
    # Extract bbox
    block_bbox = None
    if block_bbox_raw:
        if isinstance(block_bbox_raw, dict):
            block_bbox = block_bbox_raw
        elif hasattr(block_bbox_raw, '__dict__'):
            # Object with attributes
            block_bbox = {
                'left': getattr(block_bbox_raw, 'left', None),
                'top': getattr(block_bbox_raw, 'top', None),
                'width': getattr(block_bbox_raw, 'width', None),
                'height': getattr(block_bbox_raw, 'height', None),
                'page': getattr(block_bbox_raw, 'page', None),
                'original_page': getattr(block_bbox_raw, 'original_page', None)
            }
    
    return {
        'type': block_type,
        'content': block_content,
        'bbox': block_bbox,
        'confidence': block_confidence,
        'logprobs_confidence': block_logprobs_confidence,
        'image_url': block_image_url
    }

def get_block_attr(block: Any, attr: str, default: Any = None) -> Any:
    """
    Safely get attribute from block (handles both dict and object).
    
    Args:
        block: Block (dict or object)
        attr: Attribute name to get
        default: Default value if not found
        
    Returns:
        Attribute value or default
    """
    if isinstance(block, dict):
        return block.get(attr, default)
    else:
        return getattr(block, attr, default)


def get_bbox_data(bbox: Any) -> Optional[Dict[str, Any]]:
    """
    Extract bbox data from bbox object/dict.
    
    Args:
        bbox: Bbox (dict or object)
        
    Returns:
        Dict with bbox coordinates or None
    """
    if not bbox:
        return None
    
    if isinstance(bbox, dict):
        return {
            'left': bbox.get('left'),
            'top': bbox.get('top'),
            'width': bbox.get('width'),
            'height': bbox.get('height'),
            'page': bbox.get('page') or bbox.get('original_page'),
            'original_page': bbox.get('original_page') or bbox.get('page')
        }
    else:
        # Object access
        return {
            'left': getattr(bbox, 'left', None),
            'top': getattr(bbox, 'top', None),
            'width': getattr(bbox, 'width', None),
            'height': getattr(bbox, 'height', None),
            'page': getattr(bbox, 'page', None) or getattr(bbox, 'original_page', None),
            'original_page': getattr(bbox, 'original_page', None) or getattr(bbox, 'page', None)
        }


def extract_blocks_from_chunk(chunk: Any) -> List[Any]:
    """
    Extract blocks from chunk using multiple access patterns.
    Tries different ways to access blocks based on Reducto response structure.
    
    Args:
        chunk: Chunk object from Reducto parse result
        
    Returns:
        List of block objects (or empty list if none found)
    """
    blocks = []
    
    # Pattern 1: Direct blocks attribute (most common)
    if hasattr(chunk, 'blocks') and chunk.blocks:
        blocks = chunk.blocks
        logger.debug("✅ Extracted blocks via chunk.blocks")
    
    # Pattern 2: Blocks in content object
    elif hasattr(chunk, 'content') and hasattr(chunk.content, 'blocks'):
        blocks = chunk.content.blocks
        logger.debug("✅ Extracted blocks via chunk.content.blocks")
    
    # Pattern 3: Blocks as dict key
    elif isinstance(chunk, dict) and 'blocks' in chunk:
        blocks = chunk['blocks']
        logger.debug("✅ Extracted blocks via chunk['blocks']")
    
    # Pattern 4: Blocks in metadata
    elif hasattr(chunk, 'metadata') and hasattr(chunk.metadata, 'blocks'):
        blocks = chunk.metadata.blocks
        logger.debug("✅ Extracted blocks via chunk.metadata.blocks")
    
    # Pattern 5: Try __dict__ access
    elif hasattr(chunk, '__dict__') and 'blocks' in chunk.__dict__:
        blocks = chunk.__dict__['blocks']
        logger.debug("✅ Extracted blocks via chunk.__dict__['blocks']")
    
    if not blocks:
        logger.debug("⚠️ No blocks found in chunk using any access pattern")
    
    return blocks if blocks else []


def log_raw_blocks_diagnostics(result_obj: Any) -> Dict[str, Any]:
    """
    Analyze raw blocks from Reducto BEFORE filtering.
    This helps diagnose why blocks are being filtered out.
    
    Args:
        result_obj: Raw result object from Reducto (with chunks.blocks)
        
    Returns:
        Dict with diagnostic metrics
    """
    diagnostics = {
        'total_blocks': 0,
        'unknown_blocks': 0,
        'empty_blocks': 0,
        'confidence_scores': [],
        'block_types': {},
        'blocks_with_content': 0,
        'blocks_with_bbox': 0
    }
    
    unknown_block_details = []
    
    if hasattr(result_obj, 'chunks') and result_obj.chunks:
        for chunk_idx, chunk in enumerate(result_obj.chunks):
            # Use helper to extract blocks
            raw_blocks = extract_blocks_from_chunk(chunk)
            
            if raw_blocks:
                for block_idx, block in enumerate(raw_blocks):
                    # Use helper functions to safely access block attributes
                    block_type = get_block_attr(block, 'type', 'unknown')
                    block_content = get_block_attr(block, 'content', '')
                    block_confidence = get_block_attr(block, 'confidence', None)
                    block_bbox_raw = get_block_attr(block, 'bbox', None)
                    block_bbox = get_bbox_data(block_bbox_raw)  # Extract bbox data
                    
                    diagnostics['total_blocks'] += 1
                    diagnostics['block_types'][block_type] = diagnostics['block_types'].get(block_type, 0) + 1
                    
                    if block_type == 'unknown':
                        diagnostics['unknown_blocks'] += 1
                        unknown_block_details.append({
                            'chunk_idx': chunk_idx,
                            'block_idx': block_idx,
                            'confidence': block_confidence,
                            'content_preview': block_content[:100] if block_content else '(empty)',
                            'has_bbox': bool(block_bbox),
                            'page': block_bbox.get('page') if block_bbox else None
                        })
                    
                    if not block_content or not block_content.strip():
                        diagnostics['empty_blocks'] += 1
                    else:
                        diagnostics['blocks_with_content'] += 1
                    
                    if block_bbox:
                        diagnostics['blocks_with_bbox'] += 1
                    
                    if block_confidence is not None:
                        diagnostics['confidence_scores'].append(block_confidence)
    
    # Log summary
    logger.info(f"📊 RAW BLOCKS Diagnostics (BEFORE filtering):")
    logger.info(f"   Total blocks: {diagnostics['total_blocks']}")
    logger.info(f"   Unknown blocks: {diagnostics['unknown_blocks']} ({diagnostics['unknown_blocks']/max(diagnostics['total_blocks'], 1)*100:.1f}%)")
    logger.info(f"   Empty blocks: {diagnostics['empty_blocks']} ({diagnostics['empty_blocks']/max(diagnostics['total_blocks'], 1)*100:.1f}%)")
    logger.info(f"   Blocks with content: {diagnostics['blocks_with_content']} ({diagnostics['blocks_with_content']/max(diagnostics['total_blocks'], 1)*100:.1f}%)")
    logger.info(f"   Blocks with bbox: {diagnostics['blocks_with_bbox']} ({diagnostics['blocks_with_bbox']/max(diagnostics['total_blocks'], 1)*100:.1f}%)")
    
    if diagnostics['block_types']:
        logger.info(f"   Block type distribution: {dict(diagnostics['block_types'])}")
    
    if diagnostics['confidence_scores']:
        avg_confidence = sum(diagnostics['confidence_scores']) / len(diagnostics['confidence_scores'])
        min_confidence = min(diagnostics['confidence_scores'])
        max_confidence = max(diagnostics['confidence_scores'])
        logger.info(f"   Confidence scores: avg={avg_confidence:.3f}, min={min_confidence:.3f}, max={max_confidence:.3f}")
    else:
        logger.warning("   ⚠️ No confidence scores found in raw blocks")
    
    # Log unknown block details (first 10)
    if unknown_block_details:
        logger.warning(f"⚠️ Unknown blocks detected ({len(unknown_block_details)} total):")
        for i, detail in enumerate(unknown_block_details[:10]):
            logger.warning(
                f"   Unknown block #{i+1}: "
                f"chunk={detail['chunk_idx']}, block={detail['block_idx']}, "
                f"confidence={detail['confidence']}, "
                f"page={detail['page']}, "
                f"has_bbox={detail['has_bbox']}, "
                f"content='{detail['content_preview']}'"
            )
        if len(unknown_block_details) > 10:
            logger.warning(f"   ... and {len(unknown_block_details) - 10} more unknown blocks")
    
    # Quality warning
    if diagnostics['total_blocks'] > 0:
        unknown_ratio = diagnostics['unknown_blocks'] / diagnostics['total_blocks']
        empty_ratio = diagnostics['empty_blocks'] / diagnostics['total_blocks']
        if unknown_ratio > 0.5 or empty_ratio > 0.9:
            logger.error(f"❌ CRITICAL: Poor block quality detected!")
            logger.error(f"   Unknown blocks: {unknown_ratio*100:.1f}%, Empty blocks: {empty_ratio*100:.1f}%")
            logger.error(f"   Consider: advanced OCR, agentic mode, or document quality check")
        elif unknown_ratio > 0.2 or empty_ratio > 0.5:
            logger.warning(f"⚠️ WARNING: Moderate block quality issues detected.")
            logger.warning(f"   Unknown blocks: {unknown_ratio*100:.1f}%, Empty blocks: {empty_ratio*100:.1f}%")
            logger.warning(f"   Consider trying advanced OCR or agentic mode.")
    
    return diagnostics

def log_parse_diagnostics(parse_result: Any, result_obj: Any, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Log comprehensive diagnostics for Reducto parse results.
    
    Args:
        parse_result: Raw parse result from Reducto API
        result_obj: Extracted result object (parse_result.result)
        chunks: List of processed chunks
        
    Returns:
        Dict with diagnostic metrics
    """
    diagnostics = {
        'total_blocks': 0,
        'unknown_blocks': 0,
        'empty_blocks': 0,
        'confidence_scores': [],
        'block_types': {},
        'parse_confidence': None
    }
    
    # Check granular confidence from parse result
    try:
        if hasattr(parse_result, 'granular_confidence'):
            gc = parse_result.granular_confidence
            if hasattr(gc, 'parse_confidence'):
                diagnostics['parse_confidence'] = gc.parse_confidence
                logger.info(f"📊 Parse confidence: {gc.parse_confidence}")
        elif hasattr(parse_result, 'parse_confidence'):
            diagnostics['parse_confidence'] = parse_result.parse_confidence
            logger.info(f"📊 Parse confidence: {parse_result.parse_confidence}")
    except Exception as e:
        logger.debug(f"Could not extract parse confidence: {e}")
    
    # Analyze blocks from chunks
    unknown_block_details = []
    
    for chunk_idx, chunk in enumerate(chunks):
        chunk_blocks = chunk.get('blocks', [])
        if not chunk_blocks:
            continue
            
        diagnostics['total_blocks'] += len(chunk_blocks)
        
        for block_idx, block in enumerate(chunk_blocks):
            block_type = block.get('type', 'unknown')
            block_content = block.get('content', '')
            block_confidence = block.get('confidence', None)
            block_bbox = block.get('bbox', {})
            
            # Track block types
            diagnostics['block_types'][block_type] = diagnostics['block_types'].get(block_type, 0) + 1
            
            # Track unknown blocks
            if block_type == 'unknown':
                diagnostics['unknown_blocks'] += 1
                unknown_block_details.append({
                    'chunk_idx': chunk_idx,
                    'block_idx': block_idx,
                    'confidence': block_confidence,
                    'content_preview': block_content[:100] if block_content else '(empty)',
                    'has_bbox': bool(block_bbox),
                    'page': block_bbox.get('page') or block_bbox.get('original_page') if block_bbox else None
                })
            
            # Track empty blocks
            if not block_content or not block_content.strip():
                diagnostics['empty_blocks'] += 1
            
            # Collect confidence scores
            if block_confidence is not None:
                diagnostics['confidence_scores'].append(block_confidence)
    
    # Log summary
    logger.info(f"📊 Parse Diagnostics Summary:")
    logger.info(f"   Total blocks: {diagnostics['total_blocks']}")
    logger.info(f"   Unknown blocks: {diagnostics['unknown_blocks']} ({diagnostics['unknown_blocks']/max(diagnostics['total_blocks'], 1)*100:.1f}%)")
    logger.info(f"   Empty blocks: {diagnostics['empty_blocks']} ({diagnostics['empty_blocks']/max(diagnostics['total_blocks'], 1)*100:.1f}%)")
    
    # Log block type distribution
    if diagnostics['block_types']:
        logger.info(f"   Block type distribution: {dict(diagnostics['block_types'])}")
    
    # Log confidence statistics
    if diagnostics['confidence_scores']:
        avg_confidence = sum(diagnostics['confidence_scores']) / len(diagnostics['confidence_scores'])
        min_confidence = min(diagnostics['confidence_scores'])
        max_confidence = max(diagnostics['confidence_scores'])
        logger.info(f"   Confidence scores: avg={avg_confidence:.3f}, min={min_confidence:.3f}, max={max_confidence:.3f}")
    else:
        logger.warning("   ⚠️ No confidence scores found in blocks")
    
    # Log unknown block details (first 10)
    if unknown_block_details:
        logger.warning(f"⚠️ Unknown blocks detected ({len(unknown_block_details)} total):")
        for i, detail in enumerate(unknown_block_details[:10]):  # Log first 10
            logger.warning(
                f"   Unknown block #{i+1}: "
                f"chunk={detail['chunk_idx']}, block={detail['block_idx']}, "
                f"confidence={detail['confidence']}, "
                f"page={detail['page']}, "
                f"content='{detail['content_preview']}'"
            )
        if len(unknown_block_details) > 10:
            logger.warning(f"   ... and {len(unknown_block_details) - 10} more unknown blocks")
    
    # Quality warning
    if diagnostics['total_blocks'] > 0:
        unknown_ratio = diagnostics['unknown_blocks'] / diagnostics['total_blocks']
        if unknown_ratio > 0.5:
            logger.error(f"❌ CRITICAL: >50% unknown blocks detected ({unknown_ratio*100:.1f}%). Document parsing quality is poor.")
            logger.error(f"   Consider: advanced OCR, agentic mode, or document quality check")
        elif unknown_ratio > 0.2:
            logger.warning(f"⚠️ WARNING: >20% unknown blocks detected ({unknown_ratio*100:.1f}%). Consider trying advanced OCR or agentic mode.")
    
    return diagnostics

class ReductoService:
    """Service wrapper for reducto API calls"""

    def __init__(self):
        self.api_key = os.environ.get('REDUCTO_API_KEY')
        if not self.api_key:
            raise ValueError("REDUCTO_API_KEY environment variable not set")

        self.client = Reducto(api_key=self.api_key, timeout=300)

    def parse_document(
        self, 
        file_path: str, 
        return_images: List[str] = None, 
        use_async: bool = False,
        ocr_system: str = "standard",
        use_agentic: bool = False,
        table_format: str = "md"
    ) -> Dict[str, Any]:
        """
        Parse a document with section-based chunking and return job_id, text, chunks, and image URLs.
        
        Uses section-based chunking (chunk_mode: "section") to maintain document structure by 
        page titles/sections, ensuring better semantic boundaries for improved retrieval accuracy.
        
        Args:
            file_path: Path to the document file
            return_images: List of image types to return (e.g., ["figure", "table"])
            use_async: If True, use async job-based processing (recommended for large files)
            ocr_system: OCR system to use ("standard" or "advanced")
            use_agentic: If True, enable agentic mode for enhanced text extraction
            table_format: Table output format ("md", "html", "json", etc.)
            
        Returns:
            Dict with keys: job_id, document_text, chunks (section-based), image_urls
        """
        try: 
            if return_images is None:
                return_images = ["figure", "table"]

            # Convert file_path to Path object if it's a string (Reducto requires Path or file-like object)
            file_path_obj = Path(file_path) if isinstance(file_path, str) else file_path

            # Get file size for logging
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            
            # Log detailed upload information
            logger.info(f"📤 Uploading document to Reducto: {file_path}")
            logger.info(f"   File size: {file_size_mb:.2f}MB ({file_size:,} bytes)")
            logger.info(f"   API key present: {bool(self.api_key)}")
            logger.info(f"   API key length: {len(self.api_key) if self.api_key else 0} chars")
            logger.info(f"   Client timeout: {self.client.timeout if hasattr(self.client, 'timeout') else 'unknown'}s")
            
            # Try to get API endpoint if available
            try:
                api_endpoint = getattr(self.client, 'base_url', None) or getattr(self.client, '_base_url', None)
                if api_endpoint:
                    logger.info(f"   API endpoint: {api_endpoint}")
            except:
                pass
            
            try:
                upload = self.client.upload(file=file_path_obj)
                logger.info(f"✅ Upload successful")
            except Exception as upload_error:
                logger.error(f"❌ Upload failed: {type(upload_error).__name__}: {str(upload_error)}")
                logger.error(f"   File path: {file_path}")
                logger.error(f"   File exists: {os.path.exists(file_path)}")
                logger.error(f"   File size: {file_size_mb:.2f}MB")
                raise
            
            if use_async:
                # Use async job-based processing (recommended for large files)
                # This prevents timeouts and connection issues
                logger.info("🔄 Using async job-based parsing")
                import time
                
                # Build settings with configurable options
                settings = {
                        "retrieval": {
                            "chunking": {
                                "chunk_mode": "section"  # Section-based chunking (by page titles/sections)
                        },
                        "embedding_optimized": True  # Better table summaries for vector search
                        },
                        "return_images": return_images,
                    "ocr_system": ocr_system,  # Configurable: "standard" or "advanced"
                    "formatting": {
                        "table_output_format": table_format  # Configurable: "md", "html", etc.
                    }
                }
                
                # Build enhance config for cost-optimized parsing
                # Standard figure summarization is included in base cost (no extra credits)
                # Agentic mode only enabled when explicitly requested (for handwritten text)
                enhance_config = None
                if return_images:
                    # Standard figure summarization (included in base cost, no extra credits)
                    enhance_config = {
                        "summarize_figures": True  # Standard chart descriptions (no extra cost)
                    }
                    logger.info(f"📸 Standard figure summarization enabled (no extra cost)")
                
                # Only enable agentic if explicitly requested (for handwritten text)
                if use_agentic:
                    if enhance_config is None:
                        enhance_config = {}
                    enhance_config["agentic"] = [
                        {"scope": "text"},  # For handwritten/faded text
                        {"scope": "table"}  # For complex table structures
                        # NOTE: No advanced_chart_agent (saves 4 credits/chart)
                    ]
                    logger.info(f"🤖 Agentic mode enabled (handwritten text detected): text, table")
                    logger.info(f"   ⚠️ Advanced chart agent disabled (cost optimization)")
                
                logger.info(f"⚙️ Parse settings: ocr_system={ocr_system}, table_format={table_format}, agentic={use_agentic}")
                
                # PHASE 3: Verify chunking configuration
                chunking_config = settings.get('retrieval', {}).get('chunking', {})
                logger.info(f"🔍 DEBUG: Chunking config: {chunking_config}")
                logger.info(f"🔍 DEBUG: Chunk mode: {chunking_config.get('chunk_mode', 'NOT_SET')}")
                
                # Build parse call with enhance config
                parse_kwargs = {
                    "input": upload,
                    "settings": settings
                }
                if enhance_config:
                    parse_kwargs["enhance"] = enhance_config
                
                submission = self.client.parse.run_job(**parse_kwargs)
                
                job_id = submission.job_id
                logger.info(f"📋 Parse job submitted: {job_id}")
                
                # Poll for job completion
                max_wait = 600  # 10 minutes max
                wait_time = 0
                poll_interval = 2  # Check every 2 seconds
                
                logger.info(f"⏳ Starting job polling for {job_id} (max wait: {max_wait}s)")
                
                while wait_time < max_wait:
                    try:
                        job = self.client.job.get(job_id)
                        
                        # DIAGNOSTIC: Log job object structure for debugging
                        if wait_time == 0:  # Only log on first check to reduce noise
                            logger.debug(f"🔍 Job object type: {type(job)}, attributes: {dir(job) if hasattr(job, '__dict__') else 'N/A'}")
                            if isinstance(job, dict):
                                logger.debug(f"🔍 Job dict keys: {list(job.keys())}")
                        
                        # Safely get job status (handle both object and dict)
                        job_status = None
                        if hasattr(job, 'status'):
                            job_status = job.status
                        elif isinstance(job, dict):
                            job_status = job.get('status')
                        else:
                            # Try to access status as attribute even if hasattr failed
                            try:
                                job_status = getattr(job, 'status', None)
                            except:
                                job_status = 'Unknown'
                        
                        # If still None, try common response wrapper patterns
                        if job_status is None:
                            # Some APIs wrap responses in 'data' or 'result'
                            if isinstance(job, dict):
                                job_status = job.get('data', {}).get('status') or job.get('result', {}).get('status')
                            elif hasattr(job, 'data'):
                                job_status = getattr(job.data, 'status', None) if hasattr(job.data, 'status') else None
                        
                        # Log status every 30 seconds (reduced noise for concurrent processing)
                        if wait_time % 30 == 0 and wait_time > 0:
                            logger.info(f"⏳ Parse job {job_id} status: {job_status} (waited {wait_time}s)")
                        
                        if job_status == "Completed":
                            logger.info(f"✅ Parse job completed: {job_id}")
                            # When job completes, the result is in job.result
                            # The job.result is the parse response object with .result containing chunks
                            if hasattr(job, 'result') and job.result:
                                # job.result is the parse response, use it directly
                                parse_result = job.result
                                logger.info(f"✅ Extracted parse result from completed job")
                            else:
                                # Fallback: Try to get result from job object directly
                                # Sometimes the structure might be different
                                logger.warning(f"⚠️ Job result structure unexpected, inspecting job object")
                                logger.debug(f"Job object attributes: {dir(job)}")
                                
                                # Try accessing result differently
                                if hasattr(job, 'result'):
                                    parse_result = job
                                else:
                                    raise Exception(f"Completed job {job_id} has no result attribute")
                            break
                        elif job_status == "Failed":
                            # IMPROVED: Better error extraction with multiple fallbacks
                            # Reducto AsyncJobResponse uses 'reason' field for error messages, not 'error'
                            error_msg = 'Unknown error'
                            
                            # Try 'reason' field first (Reducto AsyncJobResponse standard)
                            if hasattr(job, 'reason'):
                                error_msg = getattr(job, 'reason', None)
                                if error_msg:
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Fallback to 'error' field
                            if hasattr(job, 'error'):
                                error_msg = getattr(job, 'error', 'Unknown error')
                                if error_msg and error_msg != 'Unknown error':
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Try nested error structures
                            if hasattr(job, 'data') and hasattr(job.data, 'error'):
                                error_msg = getattr(job.data, 'error', 'Unknown error')
                                if error_msg and error_msg != 'Unknown error':
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Try dict access (for dict responses)
                            if isinstance(job, dict):
                                error_msg = (
                                    job.get('reason') or  # Reducto standard
                                    job.get('error') or 
                                    job.get('data', {}).get('error') or 
                                    job.get('result', {}).get('error') or 
                                    'Unknown error'
                                )
                                if error_msg and error_msg != 'Unknown error':
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Log the full job object for debugging if error is still unknown
                            if error_msg == 'Unknown error':
                                logger.error(f"❌ Could not extract error from job object. Job type: {type(job)}, Job repr: {repr(job)[:500]}")
                            
                            logger.error(f"❌ Parse job failed: {error_msg}")
                            raise Exception(f"Reducto parse job failed: {error_msg}")
                        elif job_status in ["Pending", "Processing"]:
                            time.sleep(poll_interval)
                            wait_time += poll_interval
                        else:
                            logger.warning(f"⚠️ Unknown job status: {job_status} (waited {wait_time}s)")
                            time.sleep(poll_interval)
                            wait_time += poll_interval
                    except Exception as e:
                        logger.error(f"❌ Error checking job status: {e}")
                        # Continue polling but log the error
                        # If we've been waiting a while, this might indicate a real problem
                        if wait_time > 60:  # After 1 minute of errors, log more aggressively
                            logger.warning(f"⚠️ Job status check errors persisting after {wait_time}s")
                        time.sleep(poll_interval)
                        wait_time += poll_interval
                
                if wait_time >= max_wait:
                    logger.error(f"⏱️ Parse job {job_id} timed out after {max_wait} seconds")
                    raise TimeoutError(f"Parse job {job_id} timed out after {max_wait} seconds")
            else:
                # Use synchronous parsing (for small files)
                logger.info("🔄 Using synchronous parsing")
                
                # Build settings with configurable options
                settings = {
                    "retrieval": {
                        "chunking": {
                            "chunk_mode": "section"  # Section-based chunking (by page titles/sections)
                        },
                        "embedding_optimized": True  # Better table summaries for vector search
                    },
                    "return_images": return_images,
                    "ocr_system": ocr_system,  # Configurable: "standard" or "advanced"
                    "formatting": {
                        "table_output_format": table_format  # Configurable: "md", "html", etc.
                    }
                }
                
                # Build enhance config for cost-optimized parsing
                # Standard figure summarization is included in base cost (no extra credits)
                # Agentic mode only enabled when explicitly requested (for handwritten text)
                enhance_config = None
                if return_images:
                    # Standard figure summarization (included in base cost, no extra credits)
                    enhance_config = {
                        "summarize_figures": True  # Standard chart descriptions (no extra cost)
                    }
                    logger.info(f"📸 Standard figure summarization enabled (no extra cost)")
                
                # Only enable agentic if explicitly requested (for handwritten text)
                if use_agentic:
                    if enhance_config is None:
                        enhance_config = {}
                    enhance_config["agentic"] = [
                        {"scope": "text"},  # For handwritten/faded text
                        {"scope": "table"}  # For complex table structures
                        # NOTE: No advanced_chart_agent (saves 4 credits/chart)
                    ]
                    logger.info(f"🤖 Agentic mode enabled (handwritten text detected): text, table")
                    logger.info(f"   ⚠️ Advanced chart agent disabled (cost optimization)")
                
                logger.info(f"⚙️ Parse settings: ocr_system={ocr_system}, table_format={table_format}, agentic={use_agentic}")
                
                # PHASE 3: Verify chunking configuration
                chunking_config = settings.get('retrieval', {}).get('chunking', {})
                logger.info(f"🔍 DEBUG: Chunking config: {chunking_config}")
                logger.info(f"🔍 DEBUG: Chunk mode: {chunking_config.get('chunk_mode', 'NOT_SET')}")
                
                # Build parse call with enhance config
                parse_kwargs = {
                    "input": upload,
                    "settings": settings
                }
                if enhance_config:
                    parse_kwargs["enhance"] = enhance_config
                
                parse_result = self.client.parse.run(**parse_kwargs)

            # Extract Job_id
            job_id = getattr(parse_result, 'job_id', None)

            # Extract text from chunks 
            document_text = ""
            chunks = []
            image_urls = []
            image_blocks_metadata = []  # Store block metadata for filtering

            # Parse result structure can vary:
            # - For sync: parse_result.result.chunks
            # - For async completed job: job.result.result.chunks (or job.result.chunks)
            result_obj = None
            
            # Try different access patterns
            if hasattr(parse_result, 'result') and parse_result.result:
                # Standard structure: parse_result.result
                result_obj = parse_result.result
            elif hasattr(parse_result, 'chunks'):
                # Direct chunks access (async job result)
                result_obj = parse_result
            else:
                logger.warning(f"⚠️ Unexpected parse result structure. Attributes: {dir(parse_result)}")
                # Try to access as dict if it's a dict-like object
                if isinstance(parse_result, dict):
                    result_obj = parse_result.get('result', parse_result)
                elif hasattr(parse_result, '__dict__'):
                    # Try to get result from __dict__
                    result_obj = parse_result.__dict__.get('result', parse_result)

            if result_obj:
                # PHASE 1: DEBUG - Inspect parse result structure
                logger.info(f"🔍 DEBUG: result_obj type: {type(result_obj)}")
                logger.info(f"🔍 DEBUG: result_obj attributes: {[attr for attr in dir(result_obj) if not attr.startswith('_')]}")
                
                # Handle ResultURLResult - fetch actual result from URL
                result_obj_type_name = type(result_obj).__name__
                if result_obj_type_name == 'ResultURLResult':
                    logger.warning(f"⚠️ Received ResultURLResult instead of actual result. Attempting to fetch from URL")
                    try:
                        # Get the URL from ResultURLResult
                        result_url = getattr(result_obj, 'url', None)
                        result_id = getattr(result_obj, 'result_id', None)
                        
                        if result_url:
                            logger.info(f"🔄 Fetching result from URL: {result_url[:100]}...")
                            # Fetch the result JSON from the URL
                            # S3 presigned URLs don't need Authorization headers - they're self-authenticating
                            try:
                                response = requests.get(result_url, timeout=60)
                                response.raise_for_status()
                                result_data = response.json()
                                
                                # Try to extract chunks from the JSON response
                                # The structure might be: result_data['result']['chunks'] or result_data['chunks']
                                fetched_chunks = None
                                if isinstance(result_data, dict):
                                    if 'result' in result_data and isinstance(result_data['result'], dict):
                                        fetched_chunks = result_data['result'].get('chunks')
                                    elif 'chunks' in result_data:
                                        fetched_chunks = result_data['chunks']
                                
                                if fetched_chunks:
                                    logger.info(f"✅ Successfully fetched {len(fetched_chunks)} chunks from URL")
                                    # The chunks from the URL are raw Reducto chunk objects/dicts
                                    # Create a mock result object that will be processed by the existing loop
                                    class MockResult:
                                        def __init__(self, chunks_data, full_data):
                                            self.chunks = chunks_data
                                            self._full_data = full_data
                                        
                                        def __getattr__(self, name):
                                            # Allow access to other fields from the full data
                                            if name in self._full_data.get('result', {}):
                                                return self._full_data['result'][name]
                                            return None
                                    
                                    result_obj = MockResult(fetched_chunks, result_data)
                                    # Successfully fetched from URL, continue processing with MockResult
                                    url_fetch_success = True
                                else:
                                    logger.error(f"❌ Could not find chunks in fetched result. Keys: {list(result_data.keys()) if isinstance(result_data, dict) else 'N/A'}")
                                    # Try to log the structure for debugging
                                    if isinstance(result_data, dict):
                                        logger.debug(f"Result data structure: {list(result_data.keys())}")
                                        if 'result' in result_data:
                                            logger.debug(f"Result keys: {list(result_data['result'].keys()) if isinstance(result_data['result'], dict) else type(result_data['result'])}")
                                    # Fall through to result_id fallback
                                    result_url = None  # Clear result_url to trigger fallback
                                    url_fetch_success = False
                            except requests.exceptions.RequestException as url_error:
                                logger.warning(f"⚠️ Failed to fetch from URL: {url_error}. Falling back to result_id method.")
                                result_url = None  # Clear result_url to trigger fallback
                                url_fetch_success = False
                        else:
                            url_fetch_success = False
                        
                        # Fallback: Use result_id if URL fetch failed or no URL available
                        if not url_fetch_success and result_id:
                            # Fallback: Try using get_parse_result_from_job_id with result_id
                            logger.info(f"🔄 No URL found or URL fetch failed, trying to fetch using result_id: {result_id}")
                            try:
                                fetched_result = self.get_parse_result_from_job_id(result_id, return_images=return_images)
                                if fetched_result and fetched_result.get('chunks'):
                                    logger.info(f"✅ Successfully fetched {len(fetched_result['chunks'])} chunks using result_id")
                                    # The chunks from get_parse_result_from_job_id are already processed dicts
                                    # Return early with the fetched result
                                    return {
                                        'job_id': job_id,
                                        'document_text': fetched_result.get('document_text', ''),
                                        'chunks': fetched_result.get('chunks', []),
                                        'image_urls': fetched_result.get('image_urls', []),
                                        'image_blocks_metadata': fetched_result.get('image_blocks_metadata', [])
                                    }
                                else:
                                    logger.error(f"❌ Failed to fetch chunks using result_id")
                            except Exception as e2:
                                logger.error(f"❌ Error in get_parse_result_from_job_id: {e2}")
                                import traceback
                                logger.debug(traceback.format_exc())
                        elif not url_fetch_success and not result_id:
                            logger.error(f"❌ ResultURLResult has neither url nor result_id")
                    except Exception as e:
                        logger.error(f"❌ Error fetching result from ResultURLResult: {e}")
                        import traceback
                        logger.debug(traceback.format_exc())
                        # Continue with original result_obj processing as fallback
                
                # Run raw blocks diagnostics BEFORE filtering
                if result_obj and hasattr(result_obj, 'chunks') and result_obj.chunks:
                    try:
                        log_raw_blocks_diagnostics(result_obj)
                    except Exception as e:
                        logger.warning(f"⚠️ Error running raw blocks diagnostics: {str(e)}")
                
                if hasattr(result_obj, 'chunks') and result_obj.chunks:
                    logger.info(f"📦 Found {len(result_obj.chunks)} chunks in parse result")
                    
                    # PHASE 1: DEBUG - Inspect first chunk structure
                    first_chunk = result_obj.chunks[0]
                    logger.info(f"🔍 DEBUG: First chunk type: {type(first_chunk)}")
                    if isinstance(first_chunk, dict):
                        logger.info(f"🔍 DEBUG: First chunk keys: {list(first_chunk.keys())}")
                    else:
                        logger.info(f"🔍 DEBUG: First chunk attributes: {[attr for attr in dir(first_chunk) if not attr.startswith('_')]}")
                    logger.info(f"🔍 DEBUG: First chunk has blocks: {hasattr(first_chunk, 'blocks') if not isinstance(first_chunk, dict) else 'blocks' in first_chunk}")
                    
                    if isinstance(first_chunk, dict):
                        if 'blocks' in first_chunk:
                            logger.info(f"🔍 DEBUG: First chunk blocks type: {type(first_chunk['blocks'])}")
                            logger.info(f"🔍 DEBUG: First chunk blocks length: {len(first_chunk['blocks']) if first_chunk['blocks'] else 0}")
                    elif hasattr(first_chunk, 'blocks'):
                        logger.info(f"🔍 DEBUG: First chunk blocks type: {type(first_chunk.blocks)}")
                        logger.info(f"🔍 DEBUG: First chunk blocks length: {len(first_chunk.blocks) if first_chunk.blocks else 0}")
                        
                        if first_chunk.blocks and len(first_chunk.blocks) > 0:
                            first_block = first_chunk.blocks[0]
                            logger.info(f"🔍 DEBUG: First block type: {type(first_block)}")
                            logger.info(f"🔍 DEBUG: First block attributes: {[attr for attr in dir(first_block) if not attr.startswith('_')]}")
                            logger.info(f"🔍 DEBUG: First block.type: {get_block_attr(first_block, 'type', 'NO_TYPE_ATTR')}")
                            logger.info(f"🔍 DEBUG: First block.content (first 100 chars): {str(get_block_attr(first_block, 'content', 'NO_CONTENT_ATTR'))[:100]}")
                            logger.info(f"🔍 DEBUG: First block.bbox: {get_block_attr(first_block, 'bbox', 'NO_BBOX_ATTR')}")
                            logger.info(f"🔍 DEBUG: First block.confidence: {get_block_attr(first_block, 'confidence', 'NO_CONFIDENCE_ATTR')}")
                            if hasattr(first_block, '__dict__'):
                                logger.info(f"🔍 DEBUG: First block.__dict__: {first_block.__dict__}")
                    
                    for chunk in result_obj.chunks:
                        # Handle both dict and object chunks (from URL fetch vs direct parse)
                        if isinstance(chunk, dict):
                            logger.debug(f"🔍 Processing dict chunk with keys: {list(chunk.keys())}")
                            chunk_content = chunk.get('content', '') or chunk.get('text', '') or chunk.get('chunk_text', '')
                            chunk_embed = chunk.get('embed', '')
                            chunk_enriched = chunk.get('enriched', None)
                            logger.debug(f"🔍 Extracted chunk_content length: {len(chunk_content)} chars")
                        else:
                            chunk_content = chunk.content if hasattr(chunk, 'content') else (getattr(chunk, 'text', '') if hasattr(chunk, 'text') else '')
                            chunk_embed = chunk.embed if hasattr(chunk, 'embed') else ''
                            chunk_enriched = getattr(chunk, 'enriched', None)  # NEW: Get enriched content
                        
                        # Extract ALL blocks with full metadata (not just image blocks)
                        chunk_blocks = []
                        chunk_bbox_aggregate = None  # Aggregate bbox for the chunk
                        
                        # PHASE 2: Use helper function to extract blocks with multiple access patterns
                        raw_blocks = extract_blocks_from_chunk(chunk)
                        
                        if raw_blocks:
                            logger.debug(f"📦 Processing {len(raw_blocks)} blocks in chunk")
                            
                            for block in raw_blocks:
                                # Use helper functions to safely access block attributes (handles dict and object)
                                block_type = get_block_attr(block, 'type', 'unknown')
                                block_content = get_block_attr(block, 'content', '')
                                block_image_url = get_block_attr(block, 'image_url', None)
                                block_confidence = get_block_attr(block, 'confidence', None)
                                block_logprobs_confidence = get_block_attr(block, 'logprobs_confidence', None)
                                block_bbox_raw = get_block_attr(block, 'bbox', None)
                                
                                # Extract bbox using helper function (handles dict and object bbox)
                                block_bbox = get_bbox_data(block_bbox_raw)
                                
                                # PHASE 4: Log confidence for debugging (don't filter based on it)
                                if block_confidence is not None:
                                    logger.debug(f"📊 Block confidence: {block_confidence} (type: {block_type})")
                                
                                # Extract bbox for ALL block types (Text, Table, Figure)
                                # PHASE 4: Extract bbox even if content is empty
                                if block_bbox:
                                    # Calculate chunk-level bbox as union of all blocks (for fallback)
                                    # But prefer using individual block bboxes for citations
                                    if chunk_bbox_aggregate is None:
                                        chunk_bbox_aggregate = block_bbox.copy()
                                    else:
                                        # Union bbox: expand to include all blocks
                                        chunk_bbox_aggregate = calculate_union_bbox(chunk_bbox_aggregate, block_bbox)
                                
                                # CRITICAL: Extract image_url from blocks with type "Figure" or "Table"
                                # Per Reducto docs: blocks with return_images enabled have image_url field
                                if block_type in ["Figure", "Table"] and block_image_url:
                                    image_urls.append(block_image_url)
                                    image_blocks_metadata.append({
                                        'type': block_type,
                                        'image_url': block_image_url,
                                        'bbox': block_bbox,
                                        'content': block_content  # Store content for context
                                    })
                                    logger.debug(f"📸 Found {block_type} block with image_url: {block_image_url[:50]}...")
                                elif block_type in ["Figure", "Table"] and not block_image_url:
                                    # Log warning if Figure/Table block doesn't have image_url (might indicate issue)
                                    logger.warning(
                                        f"⚠️ {block_type} block found but no image_url. "
                                        f"return_images={return_images}, block_type={block_type}"
                                    )
                                
                                # PHASE 4: FIXED - Don't skip blocks just because they're unknown or have low confidence
                                # Only skip blocks that are TRULY invalid (no bbox, no content, no image_url)
                                is_image_block = block_type in ["Figure", "Table"]
                                has_content = block_content and block_content.strip()
                                has_image_url = bool(block_image_url)
                                has_bbox = bool(block_bbox)
                                
                                # Only skip if block has absolutely nothing useful
                                if not has_content and not has_image_url and not has_bbox:
                                    logger.debug(f"⏭️ Skipping truly invalid block: type={block_type}, no content/image/bbox")
                                    continue
                                
                                # Log if we're keeping a block with limited info (for debugging)
                                if block_type == 'unknown' and (has_content or has_bbox or has_image_url):
                                    logger.debug(f"✅ Keeping unknown block with useful data: content={bool(has_content)}, bbox={bool(has_bbox)}, image={bool(has_image_url)}")
                                
                                block_metadata = {
                                    'type': block_type,
                                    'content': block_content,
                                    'bbox': block_bbox,
                                    'confidence': block_confidence,
                                    'logprobs_confidence': block_logprobs_confidence,
                                    'image_url': block_image_url  # Store image_url in block metadata
                                }
                                
                                chunk_blocks.append(block_metadata)
                                
                            # Log block filtering summary
                            if len(chunk_blocks) < len(raw_blocks):
                                logger.info(
                                    f"📊 Filtered blocks: {len(raw_blocks)} total → {len(chunk_blocks)} valid "
                                    f"({len(raw_blocks) - len(chunk_blocks)} empty/invalid skipped)"
                                )
                        
                        # PHASE 6: Fallback - Extract bbox/page from chunk-level metadata if blocks are empty
                        if not chunk_bbox_aggregate:
                            # Try to get bbox from chunk itself (handles both dict and object)
                            chunk_bbox_raw = chunk.get('bbox') if isinstance(chunk, dict) else (getattr(chunk, 'bbox', None) if hasattr(chunk, 'bbox') else None)
                            if chunk_bbox_raw:
                                chunk_bbox_aggregate = get_bbox_data(chunk_bbox_raw)
                                if chunk_bbox_aggregate:
                                    logger.debug("✅ Extracted bbox from chunk-level metadata (fallback)")
                            
                            # Try to get page from chunk metadata (handles both dict and object)
                            chunk_page_raw = chunk.get('page') if isinstance(chunk, dict) else (getattr(chunk, 'page', None) if hasattr(chunk, 'page') else None)
                            if chunk_page_raw:
                                if not chunk_bbox_aggregate:
                                    chunk_bbox_aggregate = {}
                                chunk_bbox_aggregate['page'] = chunk_page_raw
                                chunk_bbox_aggregate['original_page'] = chunk_page_raw
                                logger.debug(f"✅ Extracted page from chunk metadata: {chunk_page_raw} (fallback)")
                        
                        chunks.append({
                            'content': chunk_content,
                            'embed': chunk_embed,
                            'enriched': chunk_enriched,  
                            'blocks': chunk_blocks,  
                            'bbox': chunk_bbox_aggregate  
                        })
                        document_text += chunk_content + "\n"
                
                # PHASE 5: Check for images in multiple locations
                # Pattern 1: From blocks (already done above)
                # Pattern 2: From result_obj directly
                if hasattr(result_obj, 'images') and result_obj.images:
                    logger.info(f"📸 Found images in result_obj.images: {len(result_obj.images)}")
                    image_urls.extend(result_obj.images)
                
                # Pattern 3: From parse_result
                if hasattr(parse_result, 'images') and parse_result.images:
                    logger.info(f"📸 Found images in parse_result.images: {len(parse_result.images)}")
                    image_urls.extend(parse_result.images)
                
                # Remove duplicates
                image_urls = list(set(image_urls))
                
                # Log image extraction summary
                logger.info(f"📸 Image extraction summary:")
                logger.info(f"   Total image URLs extracted: {len(image_urls)}")
                logger.info(f"   Image blocks metadata: {len(image_blocks_metadata)}")
                if image_blocks_metadata:
                    figure_count = len([b for b in image_blocks_metadata if b.get('type') == 'Figure'])
                    table_count = len([b for b in image_blocks_metadata if b.get('type') == 'Table'])
                    logger.info(f"   Figures: {figure_count}, Tables: {table_count}")
                else:
                    logger.warning("⚠️ No image blocks metadata found - check return_images setting")
                
                # Extract structural signals from chunks
                if chunks:
                    try:
                        from backend.services.structure_extraction_service import StructureExtractionService
                        structure_service = StructureExtractionService()

                        # Extract section hierarchy
                        section_metadata = structure_service.extract_section_hierarchy(chunks)

                        # Add section metadata to chunks
                        for i, chunk_meta in enumerate(section_metadata):
                            if i < len(chunks):
                                chunks[i].update(chunk_meta)

                        
                        # Extract table and image boundaries
                        all_blocks = []
                        for chunk in chunks:
                            all_blocks.extend(chunk.get('blocks', []))

                        table_boundaries = structure_service.identify_table_boundaries(all_blocks)
                        image_regions = structure_service.identify_image_regions(all_blocks)

                        logger.info(
                            f"Extracted structure: {len(section_metadata)} sections, "
                            f"{len(table_boundaries)} tables, {len(image_regions)} images"
                        )

                    except Exception as e:
                        logger.warning(f"❌ Error extracting structure: {str(e)}")

                # Alternative if chunks are not available, try direct text extraction 
                elif hasattr(result_obj, 'text'):
                    document_text = result_obj.text if result_obj.text else ''
                    logger.info(f"📄 Extracted text directly (no chunks): {len(document_text)} chars")
                else:
                    logger.warning(f"⚠️ No chunks or text found in result_obj. Attributes: {dir(result_obj)}")
            else:
                logger.error(f"❌ Could not extract result object from parse_result") 
            
            # Run diagnostic logging after chunks are processed
            if chunks and result_obj:
                try:
                    diagnostics = log_parse_diagnostics(parse_result, result_obj, chunks)
                    # Store diagnostics in return dict for potential use
                except Exception as e:
                    logger.warning(f"⚠️ Error running parse diagnostics: {str(e)}")

            return {
                'job_id': job_id,
                'document_text': document_text,
                'chunks': chunks,
                'image_urls': image_urls,
                'image_blocks_metadata': image_blocks_metadata
            }

        except TimeoutError as e:
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            logger.error(f"❌ Reducto parse timeout: {e}")
            logger.error(f"   File: {file_path}")
            logger.error(f"   File size: {file_size_mb:.2f}MB")
            logger.error(f"   Timeout setting: {self.client.timeout if hasattr(self.client, 'timeout') else 'unknown'}s")
            logger.error(f"   Use async: {use_async}")
            raise
        except ConnectionError as e:
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            logger.error(f"❌ Reducto connection error: {type(e).__name__}: {str(e)}")
            logger.error(f"   File: {file_path}")
            logger.error(f"   File size: {file_size_mb:.2f}MB ({file_size:,} bytes)")
            logger.error(f"   API key present: {bool(self.api_key)}")
            logger.error(f"   API key length: {len(self.api_key) if self.api_key else 0} chars")
            logger.error(f"   API key prefix: {self.api_key[:10] + '...' if self.api_key and len(self.api_key) > 10 else 'N/A'}")
            try:
                api_endpoint = getattr(self.client, 'base_url', None) or getattr(self.client, '_base_url', None)
                if api_endpoint:
                    logger.error(f"   API endpoint: {api_endpoint}")
            except:
                pass
            logger.error(f"   Client timeout: {self.client.timeout if hasattr(self.client, 'timeout') else 'unknown'}s")
            logger.error(f"   Use async: {use_async}")
            logger.error(f"   Error details: {repr(e)}")
            raise Exception(f"Connection error with Reducto API: {str(e)}. Please check your network connection and try again.")
        except Exception as e:
            error_msg = str(e)
            error_type = type(e).__name__
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            
            logger.error(f"❌ Reducto parse failed: {error_type}: {error_msg}")
            logger.error(f"   File: {file_path}")
            logger.error(f"   File size: {file_size_mb:.2f}MB ({file_size:,} bytes)")
            logger.error(f"   File exists: {os.path.exists(file_path)}")
            logger.error(f"   Use async: {use_async}")
            logger.error(f"   Error details: {repr(e)}")
            
            # Check for SSL errors
            if "SSL" in error_msg or "EOF" in error_msg:
                logger.error("   SSL/EOF error detected. This may be due to network issues or large file size.")
                logger.info("   💡 Consider using async job-based processing (use_async=True) for large files")
                raise Exception(f"Network error during parsing: {error_msg}. Try using async processing for large files.")
            
            # Check for file size related errors
            if "size" in error_msg.lower() or "limit" in error_msg.lower() or "too large" in error_msg.lower():
                logger.error(f"   File size limit error detected. File size: {file_size_mb:.2f}MB")
                logger.info("   💡 Reducto may have file size limits. Check your Reducto account limits.")
            
            # Check for authentication errors
            if "auth" in error_msg.lower() or "unauthorized" in error_msg.lower() or "401" in error_msg or "403" in error_msg:
                logger.error("   Authentication error detected. Check your REDUCTO_API_KEY.")
                logger.error(f"   API key present: {bool(self.api_key)}")
                logger.error(f"   API key length: {len(self.api_key) if self.api_key else 0} chars")
            
            raise 

    def parse_document_fast(
        self, 
        file_path: str,
        use_sync_for_small: bool = True  # Use sync for files < 2MB (faster)
    ) -> Dict[str, Any]:
        """
        Fast parse with section-based chunking, optimized for speed.
        
        Settings:
        - Section-based chunking (maintains document structure by page titles/sections)
        - Standard OCR (faster than enhanced)
        - No image extraction (skip figure/table images for speed)
        - Synchronous for small files (< 2MB) - faster than async polling
        - Faster async polling for larger files (1s interval, 60s timeout)
        
        Target: 5-15 seconds for typical documents
        
        Args:
            file_path: Path to the document file
            use_sync_for_small: If True, use synchronous parsing for files < 2MB (faster)
            
        Returns:
            Dict with keys: job_id, document_text, chunks (section-based), image_urls (empty)
        """
        try:
            file_path_obj = Path(file_path) if isinstance(file_path, str) else file_path
            
            # Upload document
            logger.info(f"⚡ FAST PARSE: Uploading document to Reducto: {file_path}")
            upload = self.client.upload(file=file_path_obj)
            
            # Fast settings: section-based chunking, standard OCR, no images
            fast_settings = {
                "retrieval": {
                    "chunking": {
                        "chunk_mode": "section"  # Section-based chunking (by page titles/sections)
                    },
                    "embedding_optimized": True  # Better table summaries for vector search
                },
                "return_images": [],  # No images for speed
                "ocr_system": "standard",  # Standard OCR (faster than enhanced)
                "formatting": {
                    "table_output_format": "md"  # Use markdown instead of HTML for cleaner output
                }
            }
            
            # Use synchronous parsing for small files (faster - no polling overhead)
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024)
            
            if use_sync_for_small and file_size_mb < 2.0:
                # Synchronous - immediate response, faster for small files
                logger.info(f"⚡ Using synchronous parsing (fast mode, {file_size_mb:.2f}MB)")
                parse_result = self.client.parse.run(
                    input=upload,
                    settings=fast_settings
                )
            else:
                # Async for larger files (but with faster polling)
                logger.info(f"🔄 Using async parsing (file {file_size_mb:.2f}MB)")
                import time
                
                submission = self.client.parse.run_job(
                    input=upload,
                    settings=fast_settings
                )
                
                job_id = submission.job_id
                logger.info(f"📋 Parse job submitted: {job_id}")
                
                # Faster polling: 1 second intervals, 180 second timeout for larger documents
                max_wait = 180  # 3 minutes max (increased from 60s for larger documents)
                wait_time = 0
                poll_interval = 1  # Check every 1 second (faster than main pipeline's 2s)
                
                logger.info(f"⏳ Starting fast job polling for {job_id} (max wait: {max_wait}s)")
                
                while wait_time < max_wait:
                    try:
                        job = self.client.job.get(job_id)
                        
                        # DIAGNOSTIC: Log job object structure for debugging
                        if wait_time == 0:  # Only log on first check to reduce noise
                            logger.debug(f"🔍 Fast job object type: {type(job)}, attributes: {dir(job) if hasattr(job, '__dict__') else 'N/A'}")
                            if isinstance(job, dict):
                                logger.debug(f"🔍 Fast job dict keys: {list(job.keys())}")
                        
                        # Safely get job status (handle both object and dict)
                        job_status = None
                        if hasattr(job, 'status'):
                            job_status = job.status
                        elif isinstance(job, dict):
                            job_status = job.get('status')
                        else:
                            # Try to access status as attribute even if hasattr failed
                            try:
                                job_status = getattr(job, 'status', None)
                            except:
                                job_status = 'Unknown'
                        
                        # If still None, try common response wrapper patterns
                        if job_status is None:
                            # Some APIs wrap responses in 'data' or 'result'
                            if isinstance(job, dict):
                                job_status = job.get('data', {}).get('status') or job.get('result', {}).get('status')
                            elif hasattr(job, 'data'):
                                job_status = getattr(job.data, 'status', None) if hasattr(job.data, 'status') else None
                        
                        # Log status every 30 seconds (reduced noise for concurrent processing)
                        if wait_time % 30 == 0 and wait_time > 0:
                            logger.info(f"⏳ Fast parse job {job_id} status: {job_status} (waited {wait_time}s)")
                        
                        if job_status == "Completed":
                            parse_result = job.result if hasattr(job, 'result') and job.result else job
                            logger.info(f"✅ Parse completed in {wait_time}s")
                            break
                        elif job_status == "Failed":
                            # IMPROVED: Better error extraction with multiple fallbacks
                            # Reducto AsyncJobResponse uses 'reason' field for error messages, not 'error'
                            error_msg = 'Unknown error'
                            
                            # Try 'reason' field first (Reducto AsyncJobResponse standard)
                            if hasattr(job, 'reason'):
                                error_msg = getattr(job, 'reason', None)
                                if error_msg:
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Fallback to 'error' field
                            if hasattr(job, 'error'):
                                error_msg = getattr(job, 'error', 'Unknown error')
                                if error_msg and error_msg != 'Unknown error':
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Try nested error structures
                            if hasattr(job, 'data') and hasattr(job.data, 'error'):
                                error_msg = getattr(job.data, 'error', 'Unknown error')
                                if error_msg and error_msg != 'Unknown error':
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Try dict access (for dict responses)
                            if isinstance(job, dict):
                                error_msg = (
                                    job.get('reason') or  # Reducto standard
                                    job.get('error') or 
                                    job.get('data', {}).get('error') or 
                                    job.get('result', {}).get('error') or 
                                    'Unknown error'
                                )
                                if error_msg and error_msg != 'Unknown error':
                                    logger.error(f"❌ Parse job failed: {error_msg}")
                                    raise Exception(f"Reducto parse job failed: {error_msg}")
                            
                            # Log the full job object for debugging if error is still unknown
                            if error_msg == 'Unknown error':
                                logger.error(f"❌ Could not extract error from fast job object. Job type: {type(job)}, Job repr: {repr(job)[:500]}")
                            
                            logger.error(f"❌ Parse job failed: {error_msg}")
                            raise Exception(f"Reducto parse job failed: {error_msg}")
                        elif job_status in ["Pending", "Processing"]:
                            time.sleep(poll_interval)
                            wait_time += poll_interval
                        else:
                            logger.warning(f"⚠️ Unknown job status: {job_status} (waited {wait_time}s)")
                            time.sleep(poll_interval)
                            wait_time += poll_interval
                    except Exception as e:
                        logger.error(f"❌ Error checking fast job status: {e}")
                        # Continue polling but log the error
                        if wait_time > 30:  # After 30 seconds of errors, log more aggressively
                            logger.warning(f"⚠️ Fast job status check errors persisting after {wait_time}s")
                        time.sleep(poll_interval)
                        wait_time += poll_interval
                
                if wait_time >= max_wait:
                    logger.error(f"⏱️ Fast parse job {job_id} timed out after {max_wait} seconds")
                    raise TimeoutError(f"Parse job {job_id} timed out after {max_wait}s")
            
            # Extract job_id
            job_id = getattr(parse_result, 'job_id', None)
            
            # Extract text from chunks (reuse existing logic)
            document_text = ""
            chunks = []
            
            # Parse result structure can vary (same as parse_document)
            result_obj = None
            
            if hasattr(parse_result, 'result') and parse_result.result:
                result_obj = parse_result.result
            elif hasattr(parse_result, 'chunks'):
                result_obj = parse_result
            else:
                logger.warning(f"⚠️ Unexpected parse result structure. Attributes: {dir(parse_result)}")
                if isinstance(parse_result, dict):
                    result_obj = parse_result.get('result', parse_result)
                elif hasattr(parse_result, '__dict__'):
                    result_obj = parse_result.__dict__.get('result', parse_result)
            
            if result_obj:
                if hasattr(result_obj, 'chunks') and result_obj.chunks:
                    logger.info(f"📦 Fast parse: Found {len(result_obj.chunks)} section-based chunks")
                    for chunk in result_obj.chunks:
                        chunk_content = chunk.content if hasattr(chunk, 'content') else ''
                        chunk_embed = chunk.embed if hasattr(chunk, 'embed') else ''
                        chunk_enriched = getattr(chunk, 'enriched', None)
                        
                        # Extract ALL blocks with full metadata (reuse existing logic)
                        chunk_blocks = []
                        chunk_bbox_aggregate = None
                        
                        if hasattr(chunk, 'blocks') and chunk.blocks:
                            for block in chunk.blocks:
                                block_type = getattr(block, 'type', 'unknown')
                                block_content = getattr(block, 'content', '')
                                block_confidence = getattr(block, 'confidence', None)
                                block_logprobs_confidence = getattr(block, 'logprobs_confidence', None)
                                
                                # Extract bbox for ALL block types (Text, Table, Figure)
                                block_bbox = None
                                if hasattr(block, 'bbox') and block.bbox:
                                    bbox_obj = block.bbox
                                    block_bbox = {
                                        'left': getattr(bbox_obj, 'left', None),
                                        'top': getattr(bbox_obj, 'top', None),
                                        'width': getattr(bbox_obj, 'width', None),
                                        'height': getattr(bbox_obj, 'height', None),
                                        'page': getattr(bbox_obj, 'page', None),
                                        'original_page': getattr(bbox_obj, 'original_page', None)
                                    }
                                    # Calculate chunk-level bbox as union of all blocks (for fallback)
                                    # But prefer using individual block bboxes for citations
                                    if chunk_bbox_aggregate is None:
                                        chunk_bbox_aggregate = block_bbox.copy()
                                    else:
                                        # Union bbox: expand to include all blocks
                                        chunk_bbox_aggregate = calculate_union_bbox(chunk_bbox_aggregate, block_bbox)
                                
                                # VALIDATION: Skip empty/invalid blocks
                                has_content = block_content and block_content.strip()
                                
                                # Skip block if no content and type is unknown
                                if not has_content and block_type == 'unknown':
                                    logger.debug(f"⏭️ Skipping empty unknown block in fast mode")
                                    continue
                                
                                block_metadata = {
                                    'type': block_type,
                                    'content': block_content,
                                    'bbox': block_bbox,
                                    'confidence': block_confidence,
                                    'logprobs_confidence': block_logprobs_confidence,
                                    'image_url': None  # No images in fast mode
                                }
                                
                                chunk_blocks.append(block_metadata)
                            
                            # Log block filtering summary
                            if len(chunk_blocks) < len(chunk.blocks):
                                logger.info(
                                    f"📊 Fast mode: Filtered blocks: {len(chunk.blocks)} total → {len(chunk_blocks)} valid "
                                    f"({len(chunk.blocks) - len(chunk_blocks)} empty/invalid skipped)"
                                )
                        
                        chunks.append({
                            'content': chunk_content,
                            'embed': chunk_embed,
                            'enriched': chunk_enriched,
                            'blocks': chunk_blocks,
                            'bbox': chunk_bbox_aggregate
                        })
                        document_text += chunk_content + "\n"
                
                # Alternative if chunks are not available, try direct text extraction
                elif hasattr(result_obj, 'text'):
                    document_text = result_obj.text if result_obj.text else ''
                    logger.info(f"📄 Fast parse: Extracted text directly (no chunks): {len(document_text)} chars")
                else:
                    logger.warning(f"⚠️ Fast parse: No chunks or text found in result_obj. Attributes: {dir(result_obj)}")
            else:
                logger.error(f"❌ Fast parse: Could not extract result object from parse_result")
            
            # Run diagnostic logging after chunks are processed
            if chunks and result_obj:
                try:
                    diagnostics = log_parse_diagnostics(parse_result, result_obj, chunks)
                except Exception as e:
                    logger.warning(f"⚠️ Error running parse diagnostics in fast mode: {str(e)}")
            
            logger.info(f"✅ Fast parse completed: {len(chunks)} section-based chunks, {len(document_text)} chars")
            
            return {
                'job_id': job_id,
                'document_text': document_text,
                'chunks': chunks,
                'image_urls': [],  # No images in fast mode
                'image_blocks_metadata': []  # No images in fast mode
            }
            
        except TimeoutError as e:
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            logger.error(f"❌ Fast parse timeout: {e}")
            logger.error(f"   File: {file_path}")
            logger.error(f"   File size: {file_size_mb:.2f}MB")
            logger.error(f"   Timeout setting: {self.client.timeout if hasattr(self.client, 'timeout') else 'unknown'}s")
            raise
        except ConnectionError as e:
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            logger.error(f"❌ Fast parse connection error: {type(e).__name__}: {str(e)}")
            logger.error(f"   File: {file_path}")
            logger.error(f"   File size: {file_size_mb:.2f}MB ({file_size:,} bytes)")
            logger.error(f"   API key present: {bool(self.api_key)}")
            logger.error(f"   API key length: {len(self.api_key) if self.api_key else 0} chars")
            logger.error(f"   API key prefix: {self.api_key[:10] + '...' if self.api_key and len(self.api_key) > 10 else 'N/A'}")
            try:
                api_endpoint = getattr(self.client, 'base_url', None) or getattr(self.client, '_base_url', None)
                if api_endpoint:
                    logger.error(f"   API endpoint: {api_endpoint}")
            except:
                pass
            logger.error(f"   Client timeout: {self.client.timeout if hasattr(self.client, 'timeout') else 'unknown'}s")
            logger.error(f"   Error details: {repr(e)}")
            raise Exception(f"Connection error with Reducto API: {str(e)}. Please check your network connection and try again.")
        except Exception as e:
            error_msg = str(e)
            error_type = type(e).__name__
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            file_size_mb = file_size / (1024 * 1024) if file_size > 0 else 0
            
            logger.error(f"❌ Fast parse failed: {error_type}: {error_msg}")
            logger.error(f"   File: {file_path}")
            logger.error(f"   File size: {file_size_mb:.2f}MB ({file_size:,} bytes)")
            logger.error(f"   File exists: {os.path.exists(file_path)}")
            logger.error(f"   Error details: {repr(e)}")
            
            # Check for SSL errors
            if "SSL" in error_msg or "EOF" in error_msg:
                logger.error("   SSL/EOF error detected. This may be due to network issues or large file size.")
                raise Exception(f"Network error during fast parsing: {error_msg}")
            
            # Check for file size related errors
            if "size" in error_msg.lower() or "limit" in error_msg.lower() or "too large" in error_msg.lower():
                logger.error(f"   File size limit error detected. File size: {file_size_mb:.2f}MB")
                logger.info("   💡 Reducto may have file size limits. Check your Reducto account limits.")
            
            # Check for authentication errors
            if "auth" in error_msg.lower() or "unauthorized" in error_msg.lower() or "401" in error_msg or "403" in error_msg:
                logger.error("   Authentication error detected. Check your REDUCTO_API_KEY.")
                logger.error(f"   API key present: {bool(self.api_key)}")
                logger.error(f"   API key length: {len(self.api_key) if self.api_key else 0} chars")
            
            raise

    def get_parse_result_from_job_id(self, job_id: str, return_images: List[str] = None) -> Dict[str, Any]:
        """
        Retrieve parse results from an existing job_id
        
        Args:
            job_id: Job ID from a previous parse operation
            return_images: List of image types to return (e.g., ["figure", "table"])
            
        Returns:
            Dict with keys: job_id, document_text, chunks, image_urls, image_blocks_metadata
        """
        try:
            if return_images is None:
                return_images = ["figure", "table"]
            
            logger.info(f"🔄 Retrieving parse result from job_id: {job_id}")
            
            # Build settings
            settings = {
                "retrieval": {
                    "chunking": {
                        "chunk_mode": "section"  # Section-based chunking (by page titles/sections)
                    },
                    "embedding_optimized": True  # Better table summaries for vector search
                },
                "return_images": return_images,
                "formatting": {
                    "table_output_format": "md"  # Use markdown instead of HTML for cleaner output
                }
            }
            
            # Build enhance config for cost-optimized parsing
            # Standard figure summarization is included in base cost (no extra credits)
            # Agentic mode only enabled when explicitly requested (for handwritten text)
            enhance_config = None
            if return_images:
                # Standard figure summarization (included in base cost, no extra credits)
                enhance_config = {
                    "summarize_figures": True  # Standard chart descriptions (no extra cost)
                }
                logger.info(f"📸 Standard figure summarization enabled (no extra cost)")
            
            # Only enable agentic if explicitly requested (for handwritten text)
            # Note: get_parse_result_from_job_id doesn't have use_agentic parameter,
            # so agentic mode won't be enabled here (this is fine as it's used for retrieval)
            # If agentic is needed, it should be set during initial parse
            
            # Build parse call with enhance config
            parse_kwargs = {
                "input": f"jobid://{job_id}",
                "settings": settings
            }
            if enhance_config:
                parse_kwargs["enhance"] = enhance_config
            
            try:
                parse_result = self.client.parse.run(**parse_kwargs)
            except Exception as parse_error:
                logger.error(f"❌ Error calling parse.run with jobid://{job_id}: {parse_error}")
                # If jobid:// protocol fails, try using the job API directly
                logger.info(f"🔄 Trying alternative method: using job.get() API directly")
                try:
                    job = self.client.job.get(job_id)
                    if hasattr(job, 'result') and job.result:
                        parse_result = type('ParseResult', (), {'result': job.result})()
                        logger.info(f"✅ Successfully retrieved result from job.get() API")
                    else:
                        raise Exception(f"Job {job_id} has no result attribute")
                except Exception as job_error:
                    logger.error(f"❌ Failed to retrieve result via job.get(): {job_error}")
                    raise parse_error  # Re-raise original error
            
            # Extract text from chunks 
            document_text = ""
            chunks = []
            image_urls = []
            image_blocks_metadata = []

            if hasattr(parse_result, 'result') and parse_result.result:
                result_obj = parse_result.result
                
                # Handle ResultURLResult - fetch actual result from URL/result_id
                result_obj_type_name = type(result_obj).__name__
                if result_obj_type_name == 'ResultURLResult':
                    logger.warning(f"⚠️ Received ResultURLResult instead of actual result in get_parse_result_from_job_id")
                    # Try to get result_id or url from ResultURLResult
                    result_id = getattr(result_obj, 'result_id', None) or getattr(result_obj, 'id', None)
                    url = getattr(result_obj, 'url', None)
                    
                    if result_id and result_id != job_id:
                        logger.info(f"🔄 Fetching result using result_id: {result_id}")
                        try:
                            # Recursively fetch using result_id (but only if different from job_id to avoid infinite loop)
                            fetched_result = self.get_parse_result_from_job_id(result_id, return_images=return_images)
                            if fetched_result and fetched_result.get('chunks'):
                                logger.info(f"✅ Successfully fetched {len(fetched_result['chunks'])} chunks using result_id")
                                return fetched_result
                        except Exception as e:
                            logger.error(f"❌ Error fetching result using result_id {result_id}: {e}")
                    
                    if url:
                        logger.warning(f"⚠️ ResultURLResult has URL but fetching from URL not implemented. URL: {url[:100]}...")
                    
                    logger.error(f"❌ Could not fetch result from ResultURLResult (result_id: {result_id}, url: {bool(url)})")
                    # Continue with original result_obj processing as fallback

                if hasattr(result_obj, 'chunks'):
                    for chunk in result_obj.chunks:
                        chunk_content = chunk.content if hasattr(chunk, 'content') else ''
                        chunk_embed = chunk.embed if hasattr(chunk, 'embed') else ''
                        chunk_enriched = getattr(chunk, 'enriched', None)  # NEW: Get enriched content
                        
                        # Extract ALL blocks with full metadata (not just image blocks)
                        chunk_blocks = []
                        chunk_bbox_aggregate = None  # Aggregate bbox for the chunk
                        
                        # PHASE 2: Use helper function to extract blocks with multiple access patterns
                        raw_blocks = extract_blocks_from_chunk(chunk)
                        
                        if raw_blocks:
                            logger.debug(f"📦 Processing {len(raw_blocks)} blocks in chunk")
                            
                            for block in raw_blocks:
                                # Use helper functions to safely access block attributes (handles dict and object)
                                block_type = get_block_attr(block, 'type', 'unknown')
                                block_content = get_block_attr(block, 'content', '')
                                block_image_url = get_block_attr(block, 'image_url', None)
                                block_confidence = get_block_attr(block, 'confidence', None)
                                block_logprobs_confidence = get_block_attr(block, 'logprobs_confidence', None)
                                block_bbox_raw = get_block_attr(block, 'bbox', None)
                                
                                # Extract bbox using helper function (handles dict and object bbox)
                                block_bbox = get_bbox_data(block_bbox_raw)
                                
                                # PHASE 4: Log confidence for debugging (don't filter based on it)
                                if block_confidence is not None:
                                    logger.debug(f"📊 Block confidence: {block_confidence} (type: {block_type})")
                                
                                # Extract bbox for ALL block types (Text, Table, Figure)
                                # PHASE 4: Extract bbox even if content is empty
                                if block_bbox:
                                    # Calculate chunk-level bbox as union of all blocks (for fallback)
                                    # But prefer using individual block bboxes for citations
                                    if chunk_bbox_aggregate is None:
                                        chunk_bbox_aggregate = block_bbox.copy()
                                    else:
                                        # Union bbox: expand to include all blocks
                                        chunk_bbox_aggregate = calculate_union_bbox(chunk_bbox_aggregate, block_bbox)
                                
                                # CRITICAL: Extract image_url from blocks with type "Figure" or "Table"
                                # Per Reducto docs: blocks with return_images enabled have image_url field
                                if block_type in ["Figure", "Table"] and block_image_url:
                                    image_urls.append(block_image_url)
                                    image_blocks_metadata.append({
                                        'type': block_type,
                                        'image_url': block_image_url,
                                        'bbox': block_bbox,
                                        'content': block_content  # Store content for context
                                    })
                                    logger.debug(f"📸 Found {block_type} block with image_url: {block_image_url[:50]}...")
                                elif block_type in ["Figure", "Table"] and not block_image_url:
                                    # Log warning if Figure/Table block doesn't have image_url (might indicate issue)
                                    logger.warning(
                                        f"⚠️ {block_type} block found but no image_url. "
                                        f"return_images={return_images}, block_type={block_type}"
                                    )
                                
                                # PHASE 4: FIXED - Don't skip blocks just because they're unknown or have low confidence
                                # Only skip blocks that are TRULY invalid (no bbox, no content, no image_url)
                                is_image_block = block_type in ["Figure", "Table"]
                                has_content = block_content and block_content.strip()
                                has_image_url = bool(block_image_url)
                                has_bbox = bool(block_bbox)
                                
                                # Only skip if block has absolutely nothing useful
                                if not has_content and not has_image_url and not has_bbox:
                                    logger.debug(f"⏭️ Skipping truly invalid block: type={block_type}, no content/image/bbox")
                                    continue
                                
                                # Log if we're keeping a block with limited info (for debugging)
                                if block_type == 'unknown' and (has_content or has_bbox or has_image_url):
                                    logger.debug(f"✅ Keeping unknown block with useful data: content={bool(has_content)}, bbox={bool(has_bbox)}, image={bool(has_image_url)}")
                                
                                block_metadata = {
                                    'type': block_type,
                                    'content': block_content,
                                    'bbox': block_bbox,
                                    'confidence': block_confidence,
                                    'logprobs_confidence': block_logprobs_confidence,
                                    'image_url': block_image_url  # Store image_url in block metadata
                                }
                                
                                chunk_blocks.append(block_metadata)
                                
                            # Log block filtering summary
                            if len(chunk_blocks) < len(raw_blocks):
                                logger.info(
                                    f"📊 Filtered blocks: {len(raw_blocks)} total → {len(chunk_blocks)} valid "
                                    f"({len(raw_blocks) - len(chunk_blocks)} empty/invalid skipped)"
                                )
                        
                        # PHASE 6: Fallback - Extract bbox/page from chunk-level metadata if blocks are empty
                        if not chunk_bbox_aggregate:
                            # Try to get bbox from chunk itself (handles both dict and object)
                            chunk_bbox_raw = chunk.get('bbox') if isinstance(chunk, dict) else (getattr(chunk, 'bbox', None) if hasattr(chunk, 'bbox') else None)
                            if chunk_bbox_raw:
                                chunk_bbox_aggregate = get_bbox_data(chunk_bbox_raw)
                                if chunk_bbox_aggregate:
                                    logger.debug("✅ Extracted bbox from chunk-level metadata (fallback)")
                            
                            # Try to get page from chunk metadata (handles both dict and object)
                            chunk_page_raw = chunk.get('page') if isinstance(chunk, dict) else (getattr(chunk, 'page', None) if hasattr(chunk, 'page') else None)
                            if chunk_page_raw:
                                if not chunk_bbox_aggregate:
                                    chunk_bbox_aggregate = {}
                                chunk_bbox_aggregate['page'] = chunk_page_raw
                                chunk_bbox_aggregate['original_page'] = chunk_page_raw
                                logger.debug(f"✅ Extracted page from chunk metadata: {chunk_page_raw} (fallback)")
                        
                        chunks.append({
                            'content': chunk_content,
                            'embed': chunk_embed,
                            'enriched': chunk_enriched,  # NEW
                            'blocks': chunk_blocks,  # ALL blocks, not just images
                            'bbox': chunk_bbox_aggregate  # Chunk-level bbox (union of all blocks)
                        })
                        document_text += chunk_content
                    
                    # PHASE 5: Check for images in multiple locations
                    # Pattern 1: From blocks (already done above)
                    # Pattern 2: From result_obj directly
                    if hasattr(result_obj, 'images') and result_obj.images:
                        logger.info(f"📸 Found images in result_obj.images: {len(result_obj.images)}")
                        image_urls.extend(result_obj.images)
                    
                    # Pattern 3: From parse_result
                    if hasattr(parse_result, 'images') and parse_result.images:
                        logger.info(f"📸 Found images in parse_result.images: {len(parse_result.images)}")
                        image_urls.extend(parse_result.images)
                    
                    # Remove duplicates
                    image_urls = list(set(image_urls))
                    
                    # Log image extraction summary (after processing all chunks)
                    logger.info(f"📸 Image extraction summary:")
                    logger.info(f"   Total image URLs extracted: {len(image_urls)}")
                    logger.info(f"   Image blocks metadata: {len(image_blocks_metadata)}")
                    if image_blocks_metadata:
                        figure_count = len([b for b in image_blocks_metadata if b.get('type') == 'Figure'])
                        table_count = len([b for b in image_blocks_metadata if b.get('type') == 'Table'])
                        logger.info(f"   Figures: {figure_count}, Tables: {table_count}")
                    else:
                        logger.warning("⚠️ No image blocks metadata found - check return_images setting")
                
                # Alternative if chunks are not available, try direct text extraction 
                elif hasattr(result_obj, 'text'):
                    document_text = result_obj.text 
            
            # Run diagnostic logging after chunks are processed
            if chunks and result_obj:
                try:
                    diagnostics = log_parse_diagnostics(parse_result, result_obj, chunks)
                except Exception as e:
                    logger.warning(f"⚠️ Error running parse diagnostics for job_id {job_id}: {str(e)}")

            logger.info(f"✅ Retrieved parse result: {len(document_text)} chars, {len(image_urls)} images")
            
            return {
                'job_id': job_id,
                'document_text': document_text,
                'chunks': chunks,
                'image_urls': image_urls,
                'image_blocks_metadata': image_blocks_metadata
            }

        except Exception as e:
            logger.error(f"Failed to retrieve parse result from job_id {job_id}: {e}")
            raise 

    def classify_document(self, job_id: str) -> Dict[str, Any]:
        """
        Classify document type using extract endpount with classification schema

        Args:
            job_id: Job Id of the parsed operation - document ID

        Returns:
            Dict with document_type classification 
        """
        try:
            classification_schema = {
                "type": "object",
                "properties": {
                    "document_type": {
                        "type": "string",
                        "enum": [
                            "valuation_report",
                            "title_deed",
                            "epc_certificate",
                            "letter_of_offer",
                            "tenancy_agreement",
                            "other_documents"
                            ],
                        "description": "The type of document being classified"
                    }
                },
                "required": ["document_type"]
            }

            result = self.client.extract.run(
                input=f"jobid://{job_id}",
                instructions={
                    "schema": classification_schema,
                    "system_prompt": (
                        "You are an expert document classifier for real estate records. "
                        "Your goal is to determine the single most appropriate category for the uploaded document. "
                        "Classify the document into ONE of the following categories:\n\n"
                        "**valuation_report** — Formal property valuation report prepared by a valuer or surveyor. "
                        "Usually includes market value, comparable sales, property description, inspection date, and valuer signature.\n\n"
                        "**title_deed** — Official land ownership record or land registry document. "
                        "Contains title number, proprietorship, charges, boundaries, or property description issued by the land registry.\n\n"
                        "**epc_certificate** — Energy Performance Certificate. "
                        "Includes EPC ratings (A–G), current/potential efficiency scores, assessment date, assessor details, and recommendations.\n\n"
                        "**tenancy_agreement** — Contract between landlord and tenant describing rent amount, lease term, start/end dates, tenant/landlord names, and obligations.\n\n"
                        "**letter_of_offer** — A letter or memorandum expressing an offer to purchase, lease, or finance a property. "
                        "May include proposed price, buyer and seller details, and conditions of the offer.\n\n"
                        "**other_documents** — Use only when none of the above definitions clearly fit (e.g. correspondence, invoices, general letters, photos, or appendices).\n\n"
                        "**Instructions:**\n"
                        "- Read the entire document carefully before classifying.\n"
                        "- Match based on the document’s *primary purpose and content*, not just keywords.\n"
                        "- If the document partially matches multiple categories, choose the one that best describes its main function.\n"
                        "- Output only the final classification label (exactly as listed above).\n"
                    )
                }
            )

            # Transform Reducto Response format
            # Handle both dict and list response formats from Reducto API
            if hasattr(result, 'result') and result.result:
                # Check if result.result is a dict or list
                if isinstance(result.result, dict):
                    doc_type_data = result.result.get('document_type', {})
                elif isinstance(result.result, list) and len(result.result) > 0:
                    # If it's a list, try to get document_type from first item
                    first_item = result.result[0]
                    if isinstance(first_item, dict):
                        doc_type_data = first_item.get('document_type', {})
                    else:
                        doc_type_data = {}
                else:
                    doc_type_data = {}

                if isinstance(doc_type_data, dict) and 'value' in doc_type_data:
                    document_type = doc_type_data['value']
                    # Extract confidence from citations array per Reducto documentation
                    citations = doc_type_data.get('citations', [])
                    confidence = citations[0].get('confidence', 'medium') if citations and isinstance(citations, list) and len(citations) > 0 else 'medium'
                elif isinstance(doc_type_data, str):
                    # If it's already a string, use it directly
                    document_type = doc_type_data
                    confidence = 'medium'
                else:
                    document_type = 'other_documents'
                    confidence = 'low'

                return {
                    'document_type': document_type or 'other_documents',
                    'confidence': confidence
                }

            return {'document_type': 'other_documents', 'confidence': 'low'}

        except Exception as e:
            logger.error(f"Reducto classification failed: {e}")
            return {'document_type': 'other_documents', 'confidence': 'low'}

        
    def extract_with_schema(self, job_id: str, schema: Dict[str, Any], system_prompt: str = None) -> Dict[str, Any]:
        """
        Extract structured data using a schema
        
        Args:
            job_id: Job ID from parse operation
            schema: JSON Schema for extraction (from extraction_schemas.py)
            system_prompt: Optional system prompt for extraction
            
        Returns:
            Dict with extracted data matching schema
        """
        try: 
            if system_prompt is None:
                system_prompt = "Be precise and thorough. Extract all property details."

            result = self.client.extract.run(
                input=f"jobid://{job_id}",
                instructions={
                    "schema": schema,
                    "system_prompt": system_prompt
                },
                settings={
                    "citations": {"enabled": True}
                }
            ) 

            # Transform reducto response to match expected format
            # Recursively extract 'value' from dict structures
            def extract_value_recursive(data):
                """Recursively extract 'value' from Reducto response structures"""
                if isinstance(data, dict):
                    # If it's a Reducto field structure with 'value' key
                    # Check if it looks like a field structure (has 'value' and maybe 'citations')
                    if 'value' in data:
                        # Check if this is a simple field structure (value + optional citations)
                        # vs a nested object that happens to have a 'value' key
                        keys = set(data.keys())
                        if keys.issubset({'value', 'citations'}):
                            # This is a Reducto field structure - extract the value
                            return data['value']
                    
                    # If it's a nested object (like subject_property), recurse into it
                    extracted = {}
                    for key, val in data.items():
                        if key == 'citations':
                            # Skip citations at object level - they're handled per field
                            continue
                        extracted[key] = extract_value_recursive(val)
                    return extracted
                elif isinstance(data, list):
                    # Handle arrays - recurse into each item
                    return [extract_value_recursive(item) for item in data]
                else:
                    # Primitive value, return as-is
                    return data

            extracted_data = {}
            citations = {}

            if hasattr(result, 'result') and result.result:
                for field_name, field_data in result.result.items():
                    # Recursively extract values from nested structures
                    extracted_value = extract_value_recursive(field_data)
                    extracted_data[field_name] = extracted_value
                    
                    # Store citations if available (at top level)
                    if isinstance(field_data, dict) and 'citations' in field_data:
                            citations[field_name] = field_data['citations']

            return {
                'data': extracted_data,
                'citations': citations
            }

        except Exception as e:
            logger.error(f"Reducto extraction failed: {e}")
            raise

    def download_image_from_url(self, presigned_url: str) -> bytes:
        """
        Download image from presigned url (must download immediately - 24h expiary)

        Args:
            presigned_url: URL of image from reducto's parsed conent blocks

        Returns:
            Image binary data 
        """
        try:
            response = requests.get(presigned_url, timeout=30)
            response.raise_for_status()
            return response.content 
        except Exception as e:
            logger.error(f"Failed to download image from {presigned_url}: {e}")
            raise
        
        
 







