"""
Reducto Image Processing Service 
Handles downloading and storing images from reducto's parsed content blocks
"""
import os
import logging
from typing import Dict, Any, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
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
        document_text: Optional[str] = None,
        include_all_images: bool = True
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

        # Step 1: Download all images in parallel (before URLs expire)
        # Phase 2 Optimization: Parallel downloads (15 concurrent workers)
        downloaded_images = self._download_images_parallel(
            image_urls=image_urls,
            image_blocks_metadata=image_blocks_metadata,
            max_workers=15
        )
        
        logger.info(f"✅ Downloaded {len(downloaded_images)}/{total_images} images (parallel)")
        
        # Step 2: Choose images to upload
        # By default we now upload every image we can successfully download.
        # (This matches product expectation: "pull every image it can".)
        if include_all_images:
            images_to_upload = [img for img in downloaded_images if img.get('success')]
            filter_result = {
                'filtered_images': images_to_upload,
                'filtered_count': len(images_to_upload),
                'total_count': len(downloaded_images),
                'filter_reasons': {f"image_{img.get('index')}": "include_all_images=True" for img in images_to_upload}
            }
            logger.info(f"🖼️ include_all_images=True → uploading {len(images_to_upload)} images (no filtering)")
        else:
            # Filter images to keep only property-relevant photos
            filter_result = self.filter_service.filter_images(
                image_data_list=downloaded_images,
                block_metadata_list=image_blocks_metadata,
                document_text=document_text
            )
            images_to_upload = filter_result['filtered_images']
            logger.info(f"🎯 Filtered to {len(images_to_upload)} property-relevant images")
        
        # Step 3: Upload selected images
        processed_images = []
        errors = []

        for img_item in images_to_upload:
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
                    logger.info(f"✅ Uploaded image {original_index} (score: {img_item.get('score', 0):.1f})")
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
            'filtered': len(images_to_upload),
            'processed': len(processed_images),
            'filter_stats': {
                'total_downloaded': len(downloaded_images),
                'total_filtered': filter_result['filtered_count'],
                'filter_reasons': filter_result.get('filter_reasons', {})
            }
        }

    def _download_single_image(
        self,
        idx: int,
        image_url: str,
        image_blocks_metadata: Optional[List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """
        Download a single image and return result dict.
        
        Used by parallel download executor to download images concurrently.
        
        Args:
            idx: Image index (0-based)
            image_url: Presigned URL to download from Reducto
            image_blocks_metadata: Optional list of block metadata for matching
        
        Returns:
            Dict with success status, image data, metadata, or error
        """
        try:
            # Download image from presigned URL (24h expiration)
            image_data = self.reducto_service.download_image_from_url(image_url)
            
            # Get corresponding block metadata if available
            block_metadata = None
            if image_blocks_metadata and idx < len(image_blocks_metadata):
                block_metadata = image_blocks_metadata[idx]
            
            return {
                'success': True,
                'image_data': image_data,
                'image_url': image_url,
                'index': idx + 1,  # 1-based index for consistency
                'block_metadata': block_metadata
            }
        except Exception as e:
            logger.warning(f"Failed to download image {idx + 1}: {str(e)}")
            return {
                'success': False,
                'index': idx + 1,
                'error': str(e)
            }
    
    def _download_images_parallel(
        self,
        image_urls: List[str],
        image_blocks_metadata: Optional[List[Dict[str, Any]]],
        max_workers: int = 15
    ) -> List[Dict[str, Any]]:
        """
        Download images in parallel using ThreadPoolExecutor.
        
        Phase 2 Optimization: Downloads 15 images concurrently instead of sequentially.
        This reduces download time from ~3.5 minutes to ~30 seconds for 100+ images.
        
        Args:
            image_urls: List of presigned URLs from Reducto
            image_blocks_metadata: Optional metadata list for each image
            max_workers: Number of concurrent download threads (default: 15)
        
        Returns:
            List of successfully downloaded images with data and metadata
        """
        if not image_urls:
            return []
        
        total_images = len(image_urls)
        logger.info(f"⚡ Starting parallel download of {total_images} images (max {max_workers} concurrent)...")
        
        # Use ThreadPoolExecutor for parallel downloads
        # 15 workers balances speed vs API rate limits
        downloaded_images = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all download tasks
            futures = {
                executor.submit(
                    self._download_single_image,
                    idx,
                    url,
                    image_blocks_metadata
                ): idx
                for idx, url in enumerate(image_urls)
            }
            
            # Collect results as they complete
            # Use list to preserve order for metadata matching
            results = [None] * total_images
            completed_count = 0
            
            for future in as_completed(futures):
                result = future.result()
                completed_count += 1
                
                if result['success']:
                    # Store in original position to preserve metadata matching
                    results[result['index'] - 1] = result
                    logger.debug(f"✅ Downloaded image {result['index']}/{total_images} ({completed_count}/{total_images} completed)")
                else:
                    logger.debug(f"❌ Failed image {result['index']}/{total_images}: {result.get('error', 'unknown')}")
            
            # Filter out failed downloads and None values
            downloaded_images = [
                {
                    'image_data': r['image_data'],
                    'image_url': r['image_url'],
                    'index': r['index'],
                    'block_metadata': r['block_metadata']
                }
                for r in results
                if r and r['success']
            ]
        
        logger.info(f"✅ Parallel download complete: {len(downloaded_images)}/{total_images} successful")
        return downloaded_images

