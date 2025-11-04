"""
Image Filtering Service
Intelligently filters images to keep only property-relevant photos (5-15 images)
Filters out charts, tables, logos, headers, footers, and other non-property images
"""
import logging
from typing import Dict, Any, List, Optional, Tuple
from PIL import Image
import io

logger = logging.getLogger(__name__)

class ImageFilterService:
    """Service for filtering property-relevant images from document extraction"""
    
    # Configuration
    MIN_IMAGE_SIZE_BYTES = 50_000  # 50KB minimum (filters out tiny icons)
    MAX_IMAGE_SIZE_BYTES = 10_000_000  # 10MB maximum (filters out corrupted/large images)
    MIN_IMAGE_DIMENSION = 200  # Minimum width or height in pixels
    MAX_IMAGES_TO_KEEP = 15  # Maximum number of property images to store
    MIN_IMAGES_TO_KEEP = 3  # Minimum to keep if we have good candidates
    
    # Keywords that indicate property photos (positive signals)
    PROPERTY_PHOTO_KEYWORDS = [
        'property', 'house', 'home', 'building', 'exterior', 'interior',
        'kitchen', 'bathroom', 'bedroom', 'living', 'room', 'garden',
        'yard', 'front', 'back', 'side', 'view', 'photo', 'image',
        'photograph', 'picture', 'floor plan', 'layout', 'elevation'
    ]
    
    # Keywords that indicate non-property images (negative signals)
    NON_PROPERTY_KEYWORDS = [
        'chart', 'graph', 'table', 'diagram', 'logo', 'header', 'footer',
        'signature', 'stamp', 'watermark', 'icon', 'symbol', 'comparison',
        'analysis', 'data', 'statistics', 'market', 'trend', 'valuation'
    ]
    
    def __init__(self):
        """Initialize the image filter service"""
        pass
    
    def filter_images(
        self,
        image_data_list: List[Dict[str, Any]],
        block_metadata_list: Optional[List[Dict[str, Any]]] = None,
        document_text: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Filter images to keep only property-relevant photos
        
        Args:
            image_data_list: List of dicts with keys: 'image_data' (bytes), 'image_url' (str), 'index' (int)
            block_metadata_list: Optional list of block metadata from Reducto (type, bbox, etc.)
            document_text: Optional document text for context analysis
            
        Returns:
            Dict with 'filtered_images' (list), 'filtered_count', 'total_count', 'filter_reasons'
        """
        total_count = len(image_data_list)
        logger.info(f"🔍 Filtering {total_count} images to find property-relevant photos...")
        
        if total_count == 0:
            return {
                'filtered_images': [],
                'filtered_count': 0,
                'total_count': 0,
                'filter_reasons': {}
            }
        
        # Score each image
        scored_images = []
        filter_reasons = {}
        
        for idx, image_item in enumerate(image_data_list):
            image_data = image_item.get('image_data')
            image_url = image_item.get('image_url', '')
            original_index = image_item.get('index', idx + 1)
            
            if not image_data:
                filter_reasons[f"image_{original_index}"] = "No image data"
                continue
            
            # Get metadata if available
            block_metadata = None
            if block_metadata_list and idx < len(block_metadata_list):
                block_metadata = block_metadata_list[idx]
            
            # Score the image
            score, reason = self._score_image(
                image_data=image_data,
                image_url=image_url,
                block_metadata=block_metadata,
                document_text=document_text,
                index=original_index
            )
            
            scored_images.append({
                'score': score,
                'index': original_index,
                'image_data': image_data,
                'image_url': image_url,
                'block_metadata': block_metadata,
                'reason': reason
            })
            
            filter_reasons[f"image_{original_index}"] = reason
        
        # Sort by score (highest first)
        scored_images.sort(key=lambda x: x['score'], reverse=True)
        
        # Take top images (with minimum threshold)
        filtered_images = []
        for img in scored_images:
            # Only include images with positive scores (property-relevant)
            if img['score'] > 0:
                filtered_images.append({
                    'image_data': img['image_data'],
                    'image_url': img['image_url'],
                    'index': img['index'],
                    'block_metadata': img.get('block_metadata'),
                    'score': img['score']
                })
                
                # Stop at max images
                if len(filtered_images) >= self.MAX_IMAGES_TO_KEEP:
                    break
        
        # If we don't have enough good candidates, take at least minimum
        if len(filtered_images) < self.MIN_IMAGES_TO_KEEP and len(scored_images) > 0:
            # Take top N even if some have lower scores
            for img in scored_images[:self.MIN_IMAGES_TO_KEEP]:
                if img not in filtered_images:
                    filtered_images.append({
                        'image_data': img['image_data'],
                        'image_url': img['image_url'],
                        'index': img['index'],
                        'block_metadata': img.get('block_metadata'),
                        'score': img['score']
                    })
        
        filtered_count = len(filtered_images)
        logger.info(f"✅ Filtered {total_count} images → {filtered_count} property-relevant photos")
        
        return {
            'filtered_images': filtered_images,
            'filtered_count': filtered_count,
            'total_count': total_count,
            'filter_reasons': filter_reasons
        }
    
    def _score_image(
        self,
        image_data: bytes,
        image_url: str,
        block_metadata: Optional[Dict[str, Any]],
        document_text: Optional[str],
        index: int
    ) -> Tuple[float, str]:
        """
        Score an image based on how likely it is to be a property photo
        
        Returns:
            Tuple of (score, reason_string)
            Score: Higher = more likely to be property photo
        """
        score = 0.0
        reasons = []
        
        # 1. Filter by block type (tables/charts are not property photos)
        if block_metadata:
            block_type = block_metadata.get('type', '').lower()
            if block_type == 'table':
                return (-10.0, "Table/chart - not a property photo")
            elif block_type == 'figure':
                score += 5.0
                reasons.append("Figure type")
        
        # 2. Filter by image size (too small = icon/logo)
        try:
            image_size = len(image_data)
            
            if image_size < self.MIN_IMAGE_SIZE_BYTES:
                return (-5.0, f"Too small ({image_size} bytes) - likely icon/logo")
            
            if image_size > self.MAX_IMAGE_SIZE_BYTES:
                return (-3.0, f"Too large ({image_size} bytes) - likely corrupted")
            
            # Good size range
            score += 2.0
            reasons.append(f"Good size ({image_size // 1024}KB)")
            
        except Exception as e:
            logger.warning(f"Error checking image size for image {index}: {e}")
        
        # 3. Check image dimensions
        try:
            img = Image.open(io.BytesIO(image_data))
            width, height = img.size
            
            if width < self.MIN_IMAGE_DIMENSION or height < self.MIN_IMAGE_DIMENSION:
                return (-4.0, f"Dimensions too small ({width}x{height})")
            
            # Check aspect ratio (property photos are usually landscape or square)
            aspect_ratio = width / height if height > 0 else 1.0
            if 0.5 <= aspect_ratio <= 2.0:  # Reasonable aspect ratio
                score += 1.0
                reasons.append(f"Good aspect ratio ({width}x{height})")
            else:
                score -= 1.0
                reasons.append(f"Unusual aspect ratio ({width}x{height})")
                
        except Exception as e:
            logger.warning(f"Error checking image dimensions for image {index}: {e}")
            # Don't penalize if we can't check dimensions
        
        # 4. Check context from document text (if available)
        if document_text:
            # Look for property-related keywords near this image
            # (This is a simplified check - in production, you'd use position/bbox)
            text_lower = document_text.lower()
            
            property_keyword_count = sum(1 for keyword in self.PROPERTY_PHOTO_KEYWORDS if keyword in text_lower)
            non_property_keyword_count = sum(1 for keyword in self.NON_PROPERTY_KEYWORDS if keyword in text_lower)
            
            if property_keyword_count > non_property_keyword_count:
                score += 2.0
                reasons.append("Property-related context")
            elif non_property_keyword_count > property_keyword_count:
                score -= 2.0
                reasons.append("Non-property context")
        
        # 5. Position-based filtering (if block metadata has bbox/page info)
        if block_metadata:
            bbox = block_metadata.get('bbox')
            if bbox:
                # Images on first/last pages might be headers/footers
                page = bbox.get('page', 0)
                if page == 0 or page == 1:  # First page
                    score -= 1.0
                    reasons.append("First page (possible header)")
                elif page > 10:  # Later pages are more likely property photos
                    score += 1.0
                    reasons.append(f"Page {page} (likely content)")
        
        # 6. URL-based filtering (if image URL contains keywords)
        url_lower = image_url.lower() if image_url else ''
        if any(keyword in url_lower for keyword in ['chart', 'table', 'diagram', 'logo']):
            score -= 3.0
            reasons.append("URL suggests non-photo")
        
        reason_str = "; ".join(reasons) if reasons else "Standard image"
        return (score, reason_str)

