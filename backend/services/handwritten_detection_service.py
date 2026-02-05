"""
Handwritten Text Detection Service

Detects if a document contains handwritten text or poor quality scans
that would benefit from agentic mode parsing.

This service uses file-based heuristics to determine if a document
requires agentic mode parsing, which is more expensive but better
at extracting handwritten or poorly scanned text.
"""

import logging
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

class HandwrittenDetectionService:
    """Service for detecting handwritten text in documents."""
    
    def __init__(self):
        """Initialize the handwritten detection service."""
        pass
    
    def detect_handwritten_text(
        self, 
        file_path: str,
        reducto_service=None  # Optional: for quick pre-parse
    ) -> Dict[str, Any]:
        """
        Detect if document contains handwritten text or needs agentic mode.
        
        Strategy:
        1. File-based heuristics (fast, no API call)
        2. Optional: Quick OCR confidence check (future enhancement)
        
        Args:
            file_path: Path to document file
            reducto_service: Optional ReductoService instance for pre-parse
                           (not currently used, reserved for future OCR confidence check)
            
        Returns:
            Dict with:
            {
                'needs_agentic': bool,
                'confidence': float,  # 0.0-1.0
                'reason': str,
                'detection_method': str
            }
        """
        try:
            # Method 1: File-based heuristics (fast, no API call)
            file_heuristic = self._check_file_characteristics(file_path)
            
            if file_heuristic['needs_agentic']:
                logger.info(
                    f"🔍 Handwritten detection: {file_heuristic['reason']} "
                    f"(confidence: {file_heuristic['confidence']:.2f})"
                )
                return {
                    'needs_agentic': True,
                    'confidence': file_heuristic['confidence'],
                    'reason': file_heuristic['reason'],
                    'detection_method': 'file_heuristic'
                }
            
            # Method 2: Quick OCR confidence check (if reducto_service provided)
            # TODO: Implement if Reducto supports sample parsing
            # This would do a quick standard parse on first page and check confidence scores
            if reducto_service:
                try:
                    ocr_check = self._check_ocr_confidence(file_path, reducto_service)
                    if ocr_check['needs_agentic']:
                        logger.info(
                            f"🔍 Handwritten detection (OCR): {ocr_check['reason']} "
                            f"(confidence: {ocr_check['confidence']:.2f})"
                        )
                        return {
                            'needs_agentic': True,
                            'confidence': ocr_check['confidence'],
                            'reason': ocr_check['reason'],
                            'detection_method': 'ocr_confidence'
                        }
                except Exception as e:
                    logger.warning(f"OCR confidence check failed: {e}, using file heuristic")
            
            # Default: Standard mode sufficient
            logger.info(
                f"🔍 Handwritten detection: {file_heuristic['reason']} "
                f"(confidence: {file_heuristic['confidence']:.2f})"
            )
            return {
                'needs_agentic': False,
                'confidence': file_heuristic['confidence'],
                'reason': file_heuristic['reason'],
                'detection_method': 'file_heuristic'
            }
            
        except Exception as e:
            logger.error(f"Error in handwritten detection: {e}")
            # Default to standard mode on error (conservative approach)
            return {
                'needs_agentic': False,
                'confidence': 0.5,
                'reason': f'Detection error: {str(e)} - defaulting to standard mode',
                'detection_method': 'error_fallback'
            }
    
    def _check_file_characteristics(self, file_path: str) -> Dict[str, Any]:
        """
        Check file characteristics to infer if handwritten.
        
        Heuristics:
        - Large file size (>5MB) = likely scanned images
        - Filename keywords (scan, handwritten, etc.)
        - File extension patterns
        
        Args:
            file_path: Path to document file
            
        Returns:
            Dict with:
            {
                'needs_agentic': bool,
                'confidence': float,
                'reason': str
            }
        """
        try:
            file_path_obj = Path(file_path)
            
            if not file_path_obj.exists():
                logger.warning(f"File does not exist: {file_path}")
                return {
                    'needs_agentic': False,
                    'confidence': 0.5,
                    'reason': 'File not found - defaulting to standard mode'
                }
            
            # Check file size
            file_size = file_path_obj.stat().st_size
            file_size_mb = file_size / (1024 * 1024)
            
            # Large files (>5MB) are often scanned documents
            # Scanned PDFs are typically much larger than digital PDFs
            if file_size_mb > 5.0:
                return {
                    'needs_agentic': True,
                    'confidence': 0.6,
                    'reason': f'Large file size ({file_size_mb:.1f}MB) suggests scanned document'
                }
            
            # Check filename for scan indicators
            filename_lower = file_path_obj.name.lower()
            scan_keywords = ['scan', 'scanned', 'handwritten', 'hand', 'written', 'photo', 'image']
            
            for keyword in scan_keywords:
                if keyword in filename_lower:
                    return {
                        'needs_agentic': True,
                        'confidence': 0.7,
                        'reason': f'Filename contains "{keyword}" - suggests scanned/handwritten document'
                    }
            
            # Check for image file extensions (if document was converted from images)
            image_extensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif']
            if any(file_path_obj.suffix.lower() in image_extensions):
                return {
                    'needs_agentic': True,
                    'confidence': 0.8,
                    'reason': f'Image file format ({file_path_obj.suffix}) - likely needs agentic mode'
                }
            
            # Default: Standard mode should work for digital documents
            return {
                'needs_agentic': False,
                'confidence': 0.7,
                'reason': f'File characteristics suggest digital document (size: {file_size_mb:.2f}MB)'
            }
            
        except Exception as e:
            logger.warning(f"File characteristic check failed: {e}")
            return {
                'needs_agentic': False,
                'confidence': 0.5,
                'reason': f'Could not determine file characteristics: {str(e)}'
            }
    
    def _check_ocr_confidence(
        self, 
        file_path: str, 
        reducto_service
    ) -> Dict[str, Any]:
        """
        Do a quick standard parse and check OCR confidence scores.
        
        If many blocks have low confidence, recommend agentic mode.
        
        NOTE: This is a placeholder for future enhancement.
        Would require Reducto to support sample parsing (first page only).
        
        Args:
            file_path: Path to document file
            reducto_service: ReductoService instance
            
        Returns:
            Dict with detection result
        """
        try:
            # TODO: Implement quick sample parse if Reducto supports it
            # For now, return conservative default
            # This would involve:
            # 1. Quick parse of first page only
            # 2. Check confidence scores of blocks
            # 3. If >30% blocks have low confidence, recommend agentic
            
            logger.debug("OCR confidence check not yet implemented (requires sample parse support)")
            return {
                'needs_agentic': False,
                'confidence': 0.7,
                'reason': 'OCR confidence check not yet implemented (requires sample parse support)'
            }
            
        except Exception as e:
            logger.warning(f"OCR confidence check failed: {e}")
            return {
                'needs_agentic': False,
                'confidence': 0.5,
                'reason': f'OCR check error: {str(e)}'
            }

