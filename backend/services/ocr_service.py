from llama_parse import LlamaParse
import os
import tempfile
import logging
from werkzeug.datastructures import FileStorage
from typing import Dict, Any

logger = logging.getLogger(__name__)

class OCRService:
    def __init__(self):
        self.parser = LlamaParse(
            api_key=os.environ.get('LLAMA_CLOUD_API_KEY'),
            result_type="text"
        )
    
    def extract_text_from_image(self, image_file: FileStorage) -> Dict[str, Any]:
        """
        Extract text from image using LlamaParse.
        
        Args:
            image_file: Uploaded image file
            
        Returns:
            Dictionary with extracted text and metadata
        """
        logger.info(f"OCRService: Extracting text from image: {image_file.filename}")
        
        # Determine file extension
        file_ext = self._get_file_extension(image_file.filename)
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_ext}') as tmp:
            image_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            logger.info(f"OCRService: Saved image to temporary file: {tmp_path}")
            
            # Parse with LlamaParse
            documents = self.parser.load_data(tmp_path)
            
            if documents and len(documents) > 0:
                extracted_text = documents[0].text
                
                # Calculate confidence based on text quality
                confidence = self._calculate_confidence(extracted_text)
                
                logger.info(f"OCRService: Successfully extracted {len(extracted_text)} characters with confidence {confidence}")
                
                return {
                    "text": extracted_text,
                    "confidence": confidence,
                    "success": True,
                    "character_count": len(extracted_text),
                    "word_count": len(extracted_text.split()),
                    "filename": image_file.filename
                }
            else:
                logger.warning("OCRService: No text extracted from image")
                return {
                    "text": "",
                    "confidence": 0.0,
                    "success": False,
                    "error": "No text extracted",
                    "filename": image_file.filename
                }
        except Exception as e:
            logger.error(f"OCRService: Error extracting text from image: {e}")
            return {
                "text": "",
                "confidence": 0.0,
                "success": False,
                "error": str(e),
                "filename": image_file.filename
            }
        finally:
            # Cleanup
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                    logger.debug(f"OCRService: Cleaned up temporary file: {tmp_path}")
                except Exception as e:
                    logger.warning(f"OCRService: Failed to clean up temporary file: {e}")
    
    def _get_file_extension(self, filename: str) -> str:
        """
        Extract file extension from filename.
        
        Args:
            filename: Original filename
            
        Returns:
            File extension (without dot)
        """
        if '.' in filename:
            return filename.rsplit('.', 1)[1].lower()
        return 'jpg'  # Default extension
    
    def _calculate_confidence(self, extracted_text: str) -> float:
        """
        Calculate confidence score based on extracted text quality.
        
        Args:
            extracted_text: The extracted text
            
        Returns:
            Confidence score (0.0 to 1.0)
        """
        if not extracted_text or len(extracted_text.strip()) == 0:
            return 0.0
        
        # Base confidence
        confidence = 0.5
        
        # Increase confidence for longer text
        if len(extracted_text) > 100:
            confidence += 0.2
        elif len(extracted_text) > 50:
            confidence += 0.1
        
        # Increase confidence for text with proper words
        words = extracted_text.split()
        if len(words) > 10:
            confidence += 0.1
        elif len(words) > 5:
            confidence += 0.05
        
        # Increase confidence for text with numbers (common in property docs)
        if any(char.isdigit() for char in extracted_text):
            confidence += 0.1
        
        # Increase confidence for text with currency symbols or prices
        if any(char in extracted_text for char in ['£', '$', '€', 'pcm', 'sq ft']):
            confidence += 0.1
        
        # Cap at 1.0
        return min(1.0, confidence)
