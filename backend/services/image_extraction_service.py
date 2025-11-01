"""
Image Extraction Service
Handles extraction, classification, and storage of property images from documents.
Can run independently or in parallel with property extraction.
"""

import os
import re
import base64
import asyncio
import requests
import time
import logging
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
# LlamaParse import removed - images now extracted via LlamaExtract schema

logger = logging.getLogger(__name__)


class ImageExtractionService:
    """
    Service for extracting property images from documents and linking them to properties.
    """
    
    def __init__(self):
        """Initialize the image extraction service"""
        self.storage_service = None
        self.supabase = None
        
    def _get_storage_service(self):
        """Lazy load storage service"""
        if self.storage_service is None:
            from .storage_service import StorageService
            self.storage_service = StorageService()
        return self.storage_service
    
    def _get_supabase_client(self):
        """Lazy load Supabase client"""
        if self.supabase is None:
            from supabase import create_client
            self.supabase = create_client(
                os.environ['SUPABASE_URL'],
                os.environ['SUPABASE_SERVICE_KEY']
            )
        return self.supabase
    
    def process_extraction_schema_images(
        self,
        images_data: List[Dict],
        primary_image: Optional[str] = None,
        document_id: str = None,
        business_id: str = None,
        property_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process images extracted from LlamaExtract schema (base64-encoded or URLs).
        
        Args:
            images_data: List of image objects from extraction schema with 'image' field (base64 or URL)
            primary_image: Primary image as base64 string or URL (optional)
            document_id: Document UUID
            business_id: Business identifier
            property_id: Optional property_id to link images to immediately
        
        Returns:
            Dict with processed images array and metadata
        """
        try:
            storage_service = self._get_storage_service()
            
            logger.info(f"🖼️ Processing {len(images_data)} images from LlamaExtract schema...")
            
            processed_images = []
            successful_uploads = 0
            
            # Process each image from the extraction schema
            for i, img_data in enumerate(images_data):
                try:
                    image_str = img_data.get('image', '')
                    if not image_str:
                        logger.warning(f"Skipping image {i+1}: no image data")
                        continue
                    
                    # Decode base64 or use URL
                    image_binary = None
                    if image_str.startswith('data:image'):
                        # Base64 data URL: data:image/png;base64,xxxxx
                        try:
                            header, encoded = image_str.split(',', 1)
                            image_binary = base64.b64decode(encoded)
                            logger.info(f"   ✅ Decoded base64 image {i+1} ({len(image_binary)} bytes)")
                        except Exception as e:
                            logger.warning(f"   ⚠️ Failed to decode base64 image {i+1}: {e}")
                            continue
                    elif image_str.startswith('http://') or image_str.startswith('https://'):
                        # URL - download the image
                        try:
                            response = requests.get(image_str, timeout=30, stream=True)
                            if response.status_code == 200:
                                image_binary = response.content
                                logger.info(f"   ✅ Downloaded image {i+1} from URL ({len(image_binary)} bytes)")
                            else:
                                logger.warning(f"   ⚠️ Failed to download from URL: HTTP {response.status_code}")
                                continue
                        except Exception as e:
                            logger.warning(f"   ⚠️ Error downloading from URL: {e}")
                            continue
                    else:
                        # Assume it's base64 without data URL prefix
                        try:
                            image_binary = base64.b64decode(image_str)
                            logger.info(f"   ✅ Decoded base64 image {i+1} ({len(image_binary)} bytes)")
                        except Exception as e:
                            logger.warning(f"   ⚠️ Failed to decode base64 image {i+1}: {e}")
                            continue
                    
                    if not image_binary:
                        continue
                    
                    # Detect format
                    file_extension = self._detect_format_from_binary(image_binary)
                    
                    # Generate filename
                    description = img_data.get('description', f'image_{i+1}')
                    img_name = re.sub(r'[^\w\-_\.]', '_', description)
                    filename = f"property_{document_id}_{img_name}.{file_extension}"
                    
                    # Upload to storage
                    upload_success, upload_result = self._upload_image_with_retry(
                        storage_service,
                        image_binary,
                        filename,
                        business_id,
                        document_id,
                        property_id,
                        {
                            'description': description,
                            'image_type': img_data.get('image_type', 'photo'),
                            'page_number': img_data.get('page_number')
                        }
                    )
                    
                    if upload_success:
                        img_metadata = {
                            'url': upload_result['url'],
                            'filename': filename,
                            'description': description,
                            'image_type': img_data.get('image_type', 'photo'),
                            'page_number': img_data.get('page_number'),
                            'extracted_at': datetime.utcnow().isoformat(),
                            'storage_provider': upload_result['storage_provider'],
                            'storage_path': upload_result.get('path'),
                            'size_bytes': len(image_binary),
                            'format': file_extension,
                            'extraction_method': 'llamæxtract_schema'
                        }
                        processed_images.append(img_metadata)
                        successful_uploads += 1
                        logger.info(f"✅ Uploaded image {i+1}/{len(images_data)}: {filename}")
                    else:
                        logger.error(f"❌ Failed to upload image {i+1}")
                        
                except Exception as e:
                    logger.error(f"❌ Error processing image {i+1}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue
            
            # Handle primary image if provided separately
            primary_image_url = None
            if primary_image and not processed_images:
                # Only process primary_image if no other images were processed
                try:
                    image_binary = None
                    if primary_image.startswith('data:image'):
                        header, encoded = primary_image.split(',', 1)
                        image_binary = base64.b64decode(encoded)
                    elif primary_image.startswith('http://') or primary_image.startswith('https://'):
                        response = requests.get(primary_image, timeout=30)
                        if response.status_code == 200:
                            image_binary = response.content
                    else:
                        image_binary = base64.b64decode(primary_image)
                    
                    if image_binary:
                        file_extension = self._detect_format_from_binary(image_binary)
                        filename = f"property_{document_id}_primary.{file_extension}"
                        
                        upload_success, upload_result = self._upload_image_with_retry(
                            storage_service,
                            image_binary,
                            filename,
                            business_id,
                            document_id,
                            property_id,
                            {'description': 'Primary property image', 'image_type': 'photo'}
                        )
                        
                        if upload_success:
                            primary_image_url = upload_result['url']
                            if not processed_images:
                                processed_images.append({
                                    'url': primary_image_url,
                                    'filename': filename,
                                    'description': 'Primary property image',
                                    'extracted_at': datetime.utcnow().isoformat(),
                                    'storage_provider': upload_result['storage_provider'],
                                    'size_bytes': len(image_binary),
                                    'format': file_extension
                                })
                except Exception as e:
                    logger.warning(f"⚠️ Failed to process primary image: {e}")
            
            # Use first image as primary if not explicitly set
            if not primary_image_url and processed_images:
                primary_image_url = processed_images[0]['url']
            
            result = {
                'images': processed_images,
                'image_count': len(processed_images),
                'primary_image_url': primary_image_url,
                'total_images_found': len(images_data),
                'classification_stats': {
                    'total_classified': len(images_data),
                    'successful_uploads': successful_uploads,
                    'failed_uploads': len(images_data) - successful_uploads
                }
            }
            
            # Link images to property if property_id provided
            if property_id and processed_images:
                logger.info(f"🔗 Linking {len(processed_images)} images to property {property_id}")
                link_result = self.link_images_to_property(
                    property_id=property_id,
                    image_results=result,
                    business_id=business_id,
                    document_id=document_id
                )
                if link_result['success']:
                    logger.info(f"✅ Images linked to property successfully")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error processing extraction schema images: {e}")
            import traceback
            traceback.print_exc()
            return {
                'images': [],
                'image_count': 0,
                'primary_image_url': None,
                'total_images_found': len(images_data) if images_data else 0,
                'classification_stats': {
                    'total_classified': 0,
                    'successful_uploads': 0,
                    'failed_uploads': 0
                },
                'error': str(e)
            }
    
    def _detect_format_from_binary(self, image_binary: bytes) -> str:
        """Detect image format from binary data"""
        if image_binary.startswith(b'\x89PNG\r\n\x1a\n'):
            return 'png'
        elif image_binary.startswith(b'\xff\xd8\xff'):
            return 'jpg'
        elif image_binary.startswith(b'GIF8'):
            return 'gif'
        elif image_binary.startswith(b'RIFF') and b'WEBP' in image_binary[:12]:
            return 'webp'
        else:
            return 'jpg'  # Default
    
    def _upload_image_with_retry(
        self,
        storage_service,
        image_binary: bytes,
        filename: str,
        business_id: str,
        document_id: str,
        property_id: Optional[str],
        img_data: Dict,
        max_retries: int = 3
    ) -> Tuple[bool, Optional[Dict]]:
        """Upload image with retry logic"""
        upload_success = False
        upload_result = None
        
        for retry in range(max_retries):
            try:
                # Prepare metadata for storage service
                metadata_for_storage = {
                    'page_number': img_data.get('page_number'),
                    'image_type': img_data.get('image_type', 'photo'),
                    'description': img_data.get('description', ''),
                    'format': self._detect_format_from_binary(image_binary),
                    'property_id': property_id
                }
                
                upload_result = storage_service.upload_property_image(
                    image_data=image_binary,
                    filename=filename,
                    business_id=business_id,
                    document_id=document_id,
                    preferred_storage='supabase',
                    metadata=metadata_for_storage
                )
                
                if upload_result['success']:
                    upload_success = True
                    logger.info(f"   ✅ Upload attempt {retry+1} successful for {filename}")
                    break
                else:
                    logger.warning(f"   ⚠️ Upload attempt {retry+1} failed for {filename}: {upload_result.get('error')}")
                    if retry < max_retries - 1:
                        time.sleep(1)  # Wait before retry
            except Exception as e:
                logger.warning(f"   ⚠️ Upload attempt {retry+1} failed with exception for {filename}: {e}")
                if retry < max_retries - 1:
                    time.sleep(1)
        
        if not upload_success:
            logger.error(f"❌ Failed to upload {filename} after {max_retries} attempts")
        
        return upload_success, upload_result
    
    # DEPRECATED: Use process_extraction_schema_images() instead
    def extract_images(
        self,
        llama_parse_result: Any,
        temp_file_path: str,
        document_id: str,
        business_id: str,
        parsed_docs: Optional[List] = None,
        wait_for_property_id: bool = False,
        property_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        DEPRECATED: This method is no longer used.
        Images are now extracted via LlamaExtract schema.
        Use process_extraction_schema_images() instead.
        
        Returns empty result to maintain compatibility.
        """
        logger.warning("⚠️ extract_images() is deprecated. Use process_extraction_schema_images() instead.")
        return {
            'images': [],
            'image_count': 0,
            'primary_image_url': None,
            'total_images_found': 0,
            'classification_stats': {
                'total_classified': 0,
                'successful_uploads': 0,
                'failed_uploads': 0
            }
        }
    
    def link_images_to_property(
        self,
        property_id: str,
        image_results: Dict[str, Any],
        business_id: str,
        document_id: str
    ) -> Dict[str, Any]:
        """
        Link extracted images to a property in property_details table.
        
        Args:
            property_id: Property UUID to link images to
            image_results: Results from process_extraction_schema_images() method
            business_id: Business identifier
            document_id: Document ID
        
        Returns:
            Dict with success status and details
        """
        try:
            supabase = self._get_supabase_client()
            
            # Prepare image metadata array
            image_metadata_list = []
            for img in image_results.get('images', []):
                image_metadata_list.append({
                    'url': img['url'],
                    'filename': img['filename'],
                    'original_name': img.get('original_name'),
                    'page_number': img.get('page_number'),
                    'dimensions': img.get('dimensions'),
                    'classification': img.get('classification', {}),
                    'description': img.get('description', ''),
                    'extracted_at': img.get('extracted_at'),
                    'storage_provider': img.get('storage_provider'),
                    'storage_path': img.get('storage_path'),
                    'size_bytes': img.get('size_bytes'),
                    'format': img.get('format'),
                    'document_id': document_id
                })
            
            # Check if property_details exists
            existing_result = supabase.table('property_details').select('property_images').eq('property_id', property_id).execute()
            
            if existing_result.data:
                # Update existing property_details
                existing_images = existing_result.data[0].get('property_images', [])
                existing_image_urls = {img.get('url') for img in existing_images if img.get('url')}
                
                # Merge with existing images, avoiding duplicates
                new_images = [img for img in image_metadata_list if img['url'] not in existing_image_urls]
                merged_images = existing_images + new_images
                
                update_data = {
                    'property_images': merged_images,
                    'image_count': len(merged_images),
                    'primary_image_url': merged_images[0]['url'] if merged_images else None,
                    'image_metadata': {
                        'last_extraction': datetime.utcnow().isoformat(),
                        'extraction_stats': image_results.get('classification_stats', {}),
                        'last_updated': datetime.utcnow().isoformat()
                    },
                    'updated_at': datetime.utcnow().isoformat()
                }
                
                result = supabase.table('property_details').update(update_data).eq('property_id', property_id).execute()
                
                if result.data:
                    logger.info(f"✅ Updated property_details with {len(new_images)} new images (total: {len(merged_images)})")
                else:
                    logger.warning(f"⚠️ No data returned from property_details update")
                    return {'success': False, 'error': 'No data returned from update'}
            else:
                # Create new property_details entry with images
                create_data = {
                    'property_id': property_id,
                    'property_images': image_metadata_list,
                    'image_count': len(image_metadata_list),
                    'primary_image_url': image_metadata_list[0]['url'] if image_metadata_list else None,
                    'image_metadata': {
                        'last_extraction': datetime.utcnow().isoformat(),
                        'extraction_stats': image_results.get('classification_stats', {}),
                        'extraction_method': 'image_extraction_service'
                    },
                    'created_at': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat()
                }
                
                result = supabase.table('property_details').insert(create_data).execute()
                
                if result.data:
                    logger.info(f"✅ Created property_details with {len(image_metadata_list)} images")
                else:
                    logger.warning(f"⚠️ No data returned from property_details insert")
                    return {'success': False, 'error': 'No data returned from insert'}
            
            return {
                'success': True,
                'property_id': property_id,
                'updated_image_count': len(image_metadata_list)
            }
            
        except Exception as e:
            logger.error(f"❌ Error linking images to property {property_id}: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}
    
    # DEPRECATED - Keeping helper methods for backward compatibility but they're no longer used
    def _get_image_binary(
        self, 
        img_data: Dict, 
        downloaded_images_map: Dict, 
        img_index: int,
        figures_by_page: Optional[Dict] = None
    ) -> Tuple[Optional[bytes], Optional[str]]:
        """
        DEPRECATED: Helper method no longer used.
        """
        return None, None
    
    def _detect_image_format(self, img_data: Dict, image_binary: bytes) -> str:
        """
        DEPRECATED: Helper method no longer used.
        Use _detect_format_from_binary() instead.
        """
        return self._detect_format_from_binary(image_binary)
    
    def _is_property_photo_adaptive(self, image_data: Dict, page_context: Dict) -> bool:
        """
        DEPRECATED: No longer used for LlamaExtract schema images.
        Images are already classified by LlamaExtract.
        """
        return True
    
    def _extract_images_from_markdown(self, markdown_text: str) -> List[Dict]:
        """
        DEPRECATED: No longer used.
        Images are extracted via LlamaExtract schema.
        """
        return []
    
    def _classify_image_type(self, image_bytes: bytes) -> Dict[str, any]:
        """
        DEPRECATED: No longer used.
        """
        return {}
    
    def _wait_for_property_id(self, document_id: str, timeout: int = 300) -> Optional[str]:
        """
        DEPRECATED: Helper method no longer used.
        """
        return None
