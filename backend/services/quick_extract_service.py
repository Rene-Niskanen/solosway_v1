"""
Quick Text Extraction Service

Provides fast text extraction from PDF and DOCX files without full document processing.
Used for immediate AI responses when users attach files to chat.

When EXTRACTION_SERVICE_URL is set, extraction is delegated to the Node service
(LobeHub file-loaders) for identical results and support for doc, xlsx, pptx, and
text-readable formats. On failure or when unset, falls back to Python extractors (PDF, DOCX, TXT).
"""

import logging
import io
import uuid
from typing import Dict, Any, Optional, List, Tuple
import tempfile
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Project root .env path (backend/services/quick_extract_service.py -> ../../.env)
_PROJECT_ROOT_ENV = Path(__file__).resolve().parent.parent.parent / ".env"


def _read_env_var_from_file(env_path: Path, key: str) -> str:
    """Read a single key from .env; value may have optional quotes. Returns empty string if not found."""
    if not env_path.is_file():
        return ""
    try:
        with open(env_path, "r", encoding="utf-8-sig") as f:  # utf-8-sig strips BOM
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k != key:
                    continue
                # Strip optional surrounding quotes
                v = v.strip("'\"").strip()
                # Remove inline comment (e.g. "http://localhost:5002 # optional")
                if " #" in v:
                    v = v.split(" #")[0].strip()
                if v:
                    return v.rstrip("/")
    except Exception as e:
        logger.warning("[QUICK-EXTRACT] Error reading %s for %s: %s", env_path, key, e)
    return ""


def _get_extraction_service_url() -> str:
    """Return EXTRACTION_SERVICE_URL: Flask config (when in app context), then env, then .env file, then localhost fallback."""
    try:
        from flask import current_app
        if current_app and current_app.config.get("EXTRACTION_SERVICE_URL"):
            url = (current_app.config["EXTRACTION_SERVICE_URL"] or "").strip().rstrip("/")
            if url:
                return url
    except RuntimeError:
        pass  # outside request/app context
    url = (os.environ.get("EXTRACTION_SERVICE_URL") or "").strip().rstrip("/")
    if url:
        return url
    # Try project root .env (path from this file)
    url = _read_env_var_from_file(_PROJECT_ROOT_ENV, "EXTRACTION_SERVICE_URL")
    if url:
        logger.info("[QUICK-EXTRACT] Using EXTRACTION_SERVICE_URL from %s", _PROJECT_ROOT_ENV)
        return url
    # Fallback: .env in current working directory (e.g. when run from IDE with cwd=project root)
    cwd_env = Path(os.getcwd()) / ".env"
    if cwd_env != _PROJECT_ROOT_ENV:
        url = _read_env_var_from_file(cwd_env, "EXTRACTION_SERVICE_URL")
        if url:
            logger.info("[QUICK-EXTRACT] Using EXTRACTION_SERVICE_URL from cwd .env: %s", cwd_env)
            return url
    # Local dev fallback: if backend is on 5001, assume Node extraction on 5002 (avoids .env/process env issues)
    try:
        import requests
        r = requests.get("http://127.0.0.1:5002/health", timeout=1)
        if r.status_code == 200:
            logger.info("[QUICK-EXTRACT] Using default http://127.0.0.1:5002 (Node service is up)")
            return "http://127.0.0.1:5002"
    except Exception:
        pass
    logger.warning(
        "[QUICK-EXTRACT] EXTRACTION_SERVICE_URL not set and not found in %s or %s",
        _PROJECT_ROOT_ENV,
        cwd_env,
    )
    return ""

# Maximum pages to extract for quick mode (to prevent memory issues)
MAX_QUICK_EXTRACT_PAGES = 50

# Timeout when calling Node extraction service (seconds); slightly under Node's 120s
NODE_EXTRACTION_TIMEOUT = 115


def detect_file_type(file_bytes: bytes, filename: str) -> str:
    """
    Detect file type from bytes and filename.
    
    Args:
        file_bytes: Raw file content
        filename: Original filename
        
    Returns:
        File type string: 'pdf', 'docx', 'doc', 'txt', 'pptx', 'excel', or 'unknown'
    """
    filename_lower = filename.lower() if filename else ''
    
    # Check by extension first
    if filename_lower.endswith('.pdf'):
        return 'pdf'
    elif filename_lower.endswith('.docx'):
        return 'docx'
    elif filename_lower.endswith('.doc'):
        return 'doc'
    elif filename_lower.endswith('.txt'):
        return 'txt'
    elif filename_lower.endswith('.pptx') or filename_lower.endswith('.ppt'):
        return 'pptx'
    elif filename_lower.endswith('.xlsx') or filename_lower.endswith('.xls'):
        return 'excel'
    
    # Check magic bytes
    if len(file_bytes) >= 4:
        # PDF magic bytes: %PDF
        if file_bytes[:4] == b'%PDF':
            return 'pdf'
        # DOCX/PPTX/XLSX (Office Open XML) all start with ZIP
        if file_bytes[:4] == b'PK\x03\x04':
            return 'docx'  # default; extension is used above for pptx/xlsx
    
    return 'unknown'


def extract_text_from_pdf(file_bytes: bytes, max_pages: int = MAX_QUICK_EXTRACT_PAGES) -> Dict[str, Any]:
    """
    Extract text from PDF using PyMuPDF (fitz).
    
    Args:
        file_bytes: Raw PDF content
        max_pages: Maximum number of pages to extract
        
    Returns:
        Dictionary with:
        - success: bool
        - text: Full concatenated text
        - page_texts: List of text per page
        - page_count: Total pages in document
        - extracted_pages: Number of pages actually extracted
        - error: Error message if failed
    """
    try:
        import fitz  # type: ignore # PyMuPDF - imported as 'fitz'
        
        # Open PDF from bytes
        pdf_document = fitz.open(stream=file_bytes, filetype="pdf")
        
        total_pages = len(pdf_document)
        pages_to_extract = min(total_pages, max_pages)
        
        page_texts: List[str] = []
        
        for page_num in range(pages_to_extract):
            page = pdf_document[page_num]
            text = page.get_text("text")
            page_texts.append(text.strip())
        
        pdf_document.close()
        
        # Concatenate all text with page markers
        full_text = "\n\n".join([
            f"--- Page {i+1} ---\n{text}" 
            for i, text in enumerate(page_texts) 
            if text
        ])
        
        truncated = total_pages > max_pages
        
        logger.info(f"📄 Quick PDF extraction: {pages_to_extract}/{total_pages} pages, {len(full_text)} chars")
        
        return {
            'success': True,
            'text': full_text,
            'page_texts': page_texts,
            'page_count': total_pages,
            'extracted_pages': pages_to_extract,
            'truncated': truncated,
            'char_count': len(full_text),
            'word_count': len(full_text.split())
        }
        
    except ImportError:
        logger.error("❌ PyMuPDF (fitz) not installed. Run: pip install pymupdf")
        return {
            'success': False,
            'error': 'PDF extraction library not available',
            'text': '',
            'page_texts': [],
            'page_count': 0
        }
    except Exception as e:
        logger.error(f"❌ PDF extraction failed: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'text': '',
            'page_texts': [],
            'page_count': 0
        }


def extract_text_from_docx(file_bytes: bytes) -> Dict[str, Any]:
    """
    Extract text from DOCX using python-docx.
    
    Args:
        file_bytes: Raw DOCX content
        
    Returns:
        Dictionary with:
        - success: bool
        - text: Full document text
        - page_texts: List with single entry (DOCX doesn't have true pages)
        - page_count: Estimated page count
        - error: Error message if failed
    """
    try:
        from docx import Document  # type: ignore # python-docx
        
        # Create a file-like object from bytes
        file_stream = io.BytesIO(file_bytes)
        doc = Document(file_stream)
        
        # Extract all paragraphs
        paragraphs = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                paragraphs.append(text)
        
        # Also extract text from tables
        for table in doc.tables:
            for row in table.rows:
                row_text = ' | '.join([cell.text.strip() for cell in row.cells if cell.text.strip()])
                if row_text:
                    paragraphs.append(row_text)
        
        full_text = '\n\n'.join(paragraphs)
        
        # Estimate page count (rough: ~3000 chars per page)
        estimated_pages = max(1, len(full_text) // 3000)
        
        logger.info(f"📄 Quick DOCX extraction: ~{estimated_pages} pages, {len(full_text)} chars")
        
        return {
            'success': True,
            'text': full_text,
            'page_texts': [full_text],  # DOCX doesn't have true page breaks
            'page_count': estimated_pages,
            'extracted_pages': estimated_pages,
            'truncated': False,
            'char_count': len(full_text),
            'word_count': len(full_text.split())
        }
        
    except ImportError:
        logger.error("❌ python-docx not installed. Run: pip install python-docx")
        return {
            'success': False,
            'error': 'DOCX extraction library not available',
            'text': '',
            'page_texts': [],
            'page_count': 0
        }
    except Exception as e:
        logger.error(f"❌ DOCX extraction failed: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'text': '',
            'page_texts': [],
            'page_count': 0
        }


def extract_text_from_txt(file_bytes: bytes) -> Dict[str, Any]:
    """
    Extract text from plain text file.
    
    Args:
        file_bytes: Raw text content
        
    Returns:
        Dictionary with extracted text
    """
    try:
        # Try different encodings
        for encoding in ['utf-8', 'latin-1', 'cp1252']:
            try:
                text = file_bytes.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = file_bytes.decode('utf-8', errors='replace')
        
        # Estimate page count
        estimated_pages = max(1, len(text) // 3000)
        
        logger.info(f"📄 Quick TXT extraction: {len(text)} chars")
        
        return {
            'success': True,
            'text': text,
            'page_texts': [text],
            'page_count': estimated_pages,
            'extracted_pages': estimated_pages,
            'truncated': False,
            'char_count': len(text),
            'word_count': len(text.split())
        }
        
    except Exception as e:
        logger.error(f"❌ TXT extraction failed: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'text': '',
            'page_texts': [],
            'page_count': 0
        }


def _extract_via_node_service(file_bytes: bytes, filename: str) -> Optional[Dict[str, Any]]:
    """
    Call the Node extraction service (LobeHub file-loaders) if configured.
    Returns the response dict on success (with success True), or None on any failure.
    """
    base_url = _get_extraction_service_url()
    if not base_url:
        logger.info("[QUICK-EXTRACT] EXTRACTION_SERVICE_URL not set — Node (LobeHub) skipped")
        return None
    url = f'{base_url}/extract'
    logger.info(f"[QUICK-EXTRACT] Trying Node service first: POST {url} (file={filename}, size={len(file_bytes)} bytes)")
    try:
        import requests
        files = {'file': (filename, io.BytesIO(file_bytes), 'application/octet-stream')}
        resp = requests.post(
            url,
            files=files,
            timeout=NODE_EXTRACTION_TIMEOUT,
        )
        if resp.status_code != 200:
            logger.warning(
                f"[QUICK-EXTRACT] Node service returned {resp.status_code}: {resp.text[:500]}"
            )
            return None
        try:
            data = resp.json()
        except ValueError:
            logger.warning(
                f"[QUICK-EXTRACT] Node returned non-JSON response (status={resp.status_code})"
            )
            return None
        if not data.get('success', False):
            logger.warning(
                f"[QUICK-EXTRACT] Node extraction failed: {data.get('error', 'unknown')}"
            )
            return None
        logger.info(f"[QUICK-EXTRACT] Node success: {data.get('page_count', 0)} pages, {data.get('char_count', 0)} chars")
        return data
    except Exception as e:
        logger.warning(f"[QUICK-EXTRACT] Node service call failed, falling back to Python: {e}")
        return None


def quick_extract(file_bytes: bytes, filename: str, store_temp: bool = True) -> Dict[str, Any]:
    """
    Main entry point for quick text extraction.
    When EXTRACTION_SERVICE_URL is set, tries Node (LobeHub) service first; on failure
    falls back to Python extractors for PDF, DOCX, TXT.
    
    Args:
        file_bytes: Raw file content
        filename: Original filename
        store_temp: Whether to store file temporarily for later full processing
        
    Returns:
        Dictionary with:
        - success: bool
        - text: Extracted text
        - page_texts: List of text per page
        - page_count: Number of pages
        - file_type: Detected file type
        - temp_file_id: UUID for temp storage (if store_temp=True)
        - error: Error message if failed
    """
    file_type = detect_file_type(file_bytes, filename)
    logger.info(f"🔍 [QUICK-EXTRACT] Starting for {filename} (detected type: {file_type}, size: {len(file_bytes)} bytes)")

    # Try Node extraction service first when configured
    node_result = _extract_via_node_service(file_bytes, filename)
    if node_result is not None:
        node_result['filename'] = filename
        if store_temp:
            node_result['temp_file_id'] = str(uuid.uuid4())
        logger.info(f"✅ [QUICK-EXTRACT] Using Node result: {node_result.get('page_count')} pages, {node_result.get('char_count', 0)} chars")
        return node_result

    # No Python fallback: extraction is Node (LobeHub) only
    base_url = _get_extraction_service_url()
    if not base_url:
        logger.warning("[QUICK-EXTRACT] EXTRACTION_SERVICE_URL not set; extraction requires Node service")
        return {
            'success': False,
            'error': 'Document extraction requires the Node extraction service. Set EXTRACTION_SERVICE_URL in .env (e.g. http://localhost:5002) and start the doc-extraction service.',
            'text': '',
            'page_texts': [],
            'page_count': 0,
            'file_type': file_type
        }
    logger.warning(f"[QUICK-EXTRACT] Node service failed or returned no result for {filename}; no Python fallback")
    return {
        'success': False,
        'error': 'Extraction failed. Ensure the Node extraction service is running at EXTRACTION_SERVICE_URL and supports this file type.',
        'text': '',
        'page_texts': [],
        'page_count': 0,
        'file_type': file_type
    }


def store_temp_file(file_bytes: bytes, filename: str, temp_file_id: str) -> Dict[str, Any]:
    """
    Store file temporarily in S3 for later full processing.
    
    Args:
        file_bytes: Raw file content
        filename: Original filename
        temp_file_id: UUID for temp storage
        
    Returns:
        Dictionary with storage result
    """
    try:
        import boto3
        import os
        
        bucket_name = os.environ.get('S3_UPLOAD_BUCKET')
        if not bucket_name:
            logger.warning("⚠️ S3_UPLOAD_BUCKET not configured, temp storage disabled")
            return {'success': False, 'error': 'S3 not configured'}
        
        s3_client = boto3.client('s3')
        
        # Store with temp_ prefix for easy cleanup
        s3_key = f"temp_uploads/{temp_file_id}/{filename}"
        
        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=file_bytes,
            ContentType='application/octet-stream',
            Metadata={
                'temp_file_id': temp_file_id,
                'original_filename': filename
            }
        )
        
        logger.info(f"✅ Stored temp file: {s3_key}")
        
        return {
            'success': True,
            's3_key': s3_key,
            'temp_file_id': temp_file_id
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to store temp file: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }


def get_temp_file(temp_file_id: str) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Retrieve a temporarily stored file.
    
    Args:
        temp_file_id: UUID of temp file
        
    Returns:
        Tuple of (file_bytes, filename) or (None, None) if not found
    """
    try:
        import boto3
        import os
        
        bucket_name = os.environ.get('S3_UPLOAD_BUCKET')
        if not bucket_name:
            return None, None
        
        s3_client = boto3.client('s3')
        
        # List objects with temp prefix
        prefix = f"temp_uploads/{temp_file_id}/"
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        
        if 'Contents' not in response or len(response['Contents']) == 0:
            return None, None
        
        # Get the first (and should be only) file
        s3_key = response['Contents'][0]['Key']
        filename = s3_key.split('/')[-1]
        
        obj = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        file_bytes = obj['Body'].read()
        
        return file_bytes, filename
        
    except Exception as e:
        logger.error(f"❌ Failed to retrieve temp file: {str(e)}")
        return None, None


def delete_temp_file(temp_file_id: str) -> bool:
    """
    Delete a temporarily stored file.
    
    Args:
        temp_file_id: UUID of temp file
        
    Returns:
        True if deleted, False otherwise
    """
    try:
        import boto3
        import os
        
        bucket_name = os.environ.get('S3_UPLOAD_BUCKET')
        if not bucket_name:
            return False
        
        s3_client = boto3.client('s3')
        
        # List and delete objects with temp prefix
        prefix = f"temp_uploads/{temp_file_id}/"
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        
        if 'Contents' in response:
            for obj in response['Contents']:
                s3_client.delete_object(Bucket=bucket_name, Key=obj['Key'])
            logger.info(f"🗑️ Deleted temp file: {temp_file_id}")
            return True
        
        return False
        
    except Exception as e:
        logger.error(f"❌ Failed to delete temp file: {str(e)}")
        return False

