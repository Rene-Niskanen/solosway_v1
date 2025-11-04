"""
Reducto Image Processing Service 
Handles downloading and storing images from reducto's parsed content blocks
"""
import os
import logging
from typing import Dict, Any, List, Optional
from .reducto_service import ReductoService
from .storage_service import StorageService
from .image_filter_service import ImageFilterService

logger = logging.getLogger(__name__)

class ReductoImageService:
    """service for processing images from reductos parsed blocks"""

    def __init__(self):
        self.reducto_service = ReductoService()
        self.storage_service = StorageService()
        self.filter_service = ImageFilterService()

    def process_parsed_images(
        self,
        image_urls: List[str],
        document_id: str,
        business_id: str,
        property_id: Optional[str] = None,
        image_blocks_metadata: Optional[List[Dict[str, Any]]] = None,
        document_text: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Download the images from the presigned urls, filter for property-relevant images,
        and upload to storage

        Args:
            image_urls: List of presigned URLs from Reducto Parse blocks
            document_id: Document ID for metadata
            business_id: Business ID for multi-tenancy
            property_id: Optional property ID if linked
            image_blocks_metadata: Optional list of block metadata (type, bbox, etc.) for filtering
            document_text: Optional document text for context-based filtering
            
        Returns:
            Dict with processed images metadata
        """
        total_images = len(image_urls)
        logger.info(f"📸 Processing {total_images} images from Reducto...")
        
        # Step 1: Download all images first (before URLs expire)
        downloaded_images = []
        for idx, image_url in enumerate(image_urls):
            try:
                # Download image from presigned urls before expiry
                image_data = self.reducto_service.download_image_from_url(image_url)
                
                # Get corresponding block metadata if available
                block_metadata = None
                if image_blocks_metadata and idx < len(image_blocks_metadata):
                    block_metadata = image_blocks_metadata[idx]
                
                downloaded_images.append({
                    'image_data': image_data,
                    'image_url': image_url,
                    'index': idx + 1,
                    'block_metadata': block_metadata
                })
                logger.debug(f"Downloaded image {idx + 1}/{total_images}")
                
            except Exception as e:
                logger.warning(f"Failed to download image {idx + 1}: {str(e)}")
                continue
        
        logger.info(f"✅ Downloaded {len(downloaded_images)}/{total_images} images")
        
        # Step 2: Filter images to keep only property-relevant photos
        filter_result = self.filter_service.filter_images(
            image_data_list=downloaded_images,
            block_metadata_list=image_blocks_metadata,
            document_text=document_text
        )
        
        filtered_images = filter_result['filtered_images']
        logger.info(f"🎯 Filtered to {len(filtered_images)} property-relevant images")
        
        # Step 3: Upload filtered images
        processed_images = []
        errors = []

        for img_item in filtered_images:
            image_data = img_item['image_data']
            image_url = img_item['image_url']
            original_index = img_item['index']
            
            try:
                # Determine image format from URL or content
                image_ext = 'jpg'
                if '.png' in image_url.lower():
                    image_ext = 'png'
                elif '.gif' in image_url.lower():
                    image_ext = 'gif'

                # Generate storage path 
                image_filename = f"document_{document_id}_image_{original_index}.{image_ext}"

                # Upload using the existing StorageService (handles Supabase and S3)
                upload_result = self.storage_service.upload_property_image(
                    image_data=image_data,
                    filename=image_filename,
                    business_id=business_id,
                    document_id=document_id,
                    preferred_storage='supabase'
                )

                if upload_result.get('success'):
                    processed_images.append({
                        'url': upload_result['url'],
                        'document_id': document_id,
                        'source_document_id': document_id,
                        'storage_path': upload_result.get('path', ''),
                        'image_index': original_index,
                        'size_bytes': len(image_data),
                        'storage_provider': upload_result.get('storage_provider', 'supabase'),
                        'filter_score': img_item.get('score', 0)
                    })
                    logger.info(f"✅ Uploaded filtered image {original_index} (score: {img_item.get('score', 0):.1f})")
                else:
                    errors.append(f"Failed to upload image {original_index}: {upload_result.get('error', 'unknown error')}")
                
            except Exception as e:
                error_msg = f"Failed to process filtered image {original_index}: {str(e)}"
                logger.warning(error_msg)
                errors.append(error_msg)

        return {
            'success': len(errors) == 0,
            'images': processed_images,
            'errors': errors,
            'total': total_images,
            'filtered': len(filtered_images),
            'processed': len(processed_images),
            'filter_stats': {
                'total_downloaded': len(downloaded_images),
                'total_filtered': filter_result['filtered_count'],
                'filter_reasons': filter_result.get('filter_reasons', {})
            }
        }

