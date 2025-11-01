"""
Enhanced Unified Storage Service
Handles both Supabase Storage and S3 storage for property images with improved metadata management
"""

import os
import boto3
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from supabase import create_client
import json
import hashlib

class StorageService:
    """Enhanced unified storage service for property images with metadata management"""
    
    def __init__(self):
        self.supabase = create_client(
            os.environ['SUPABASE_URL'],
            os.environ['SUPABASE_SERVICE_KEY']
        )
        
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        
        self.s3_bucket = os.environ['S3_UPLOAD_BUCKET']
        self.supabase_bucket = 'property-images'
    
    def upload_property_image(
        self, 
        image_data: bytes, 
        filename: str, 
        business_id: str, 
        document_id: str,
        preferred_storage: str = 'supabase',
        metadata: Optional[Dict] = None
    ) -> Dict:
        """
        Upload property image to storage with enhanced metadata
        
        Args:
            image_data: Raw image bytes
            filename: Image filename
            business_id: Business ID for organization
            document_id: Document ID
            preferred_storage: 'supabase' or 's3'
            metadata: Additional image metadata
        
        Returns:
            Dict with upload results and enhanced metadata
        """
        try:
            # Generate enhanced storage path with timestamp
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            clean_filename = self._clean_filename(filename)
            storage_path = f"{business_id}/property-images/{document_id}/{timestamp}_{clean_filename}"
            
            # Generate image hash for deduplication
            image_hash = hashlib.md5(image_data).hexdigest()
            
            # Prepare enhanced metadata
            enhanced_metadata = {
                'business_id': business_id,
                'document_id': document_id,
                'original_filename': filename,
                'image_hash': image_hash,
                'size_bytes': len(image_data),
                'upload_timestamp': datetime.utcnow().isoformat(),
                'content_type': self._detect_content_type(image_data),
                **(metadata or {})
            }
            
            if preferred_storage == 'supabase':
                # Try Supabase first
                result = self._upload_to_supabase(image_data, storage_path, enhanced_metadata)
                if result['success']:
                    return result
                else:
                    print(f"⚠️ Supabase upload failed, falling back to S3: {result['error']}")
                    return self._upload_to_s3(image_data, storage_path, enhanced_metadata)
            else:
                # Try S3 first
                result = self._upload_to_s3(image_data, storage_path, enhanced_metadata)
                if result['success']:
                    return result
                else:
                    print(f"⚠️ S3 upload failed, falling back to Supabase: {result['error']}")
                    return self._upload_to_supabase(image_data, storage_path, enhanced_metadata)
                    
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'storage_provider': None,
                'url': None,
                'metadata': None
            }
    
    def _clean_filename(self, filename: str) -> str:
        """Clean filename for safe storage"""
        import re
        # Remove or replace unsafe characters
        clean_name = re.sub(r'[^\w\-_\.]', '_', filename)
        # Ensure it's not too long
        if len(clean_name) > 100:
            name, ext = os.path.splitext(clean_name)
            clean_name = name[:95] + ext
        return clean_name
    
    def _detect_content_type(self, image_data: bytes) -> str:
        """Detect image content type from bytes"""
        if image_data.startswith(b'\xff\xd8\xff'):
            return 'image/jpeg'
        elif image_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return 'image/png'
        elif image_data.startswith(b'GIF87a') or image_data.startswith(b'GIF89a'):
            return 'image/gif'
        elif image_data.startswith(b'RIFF') and b'WEBP' in image_data[:12]:
            return 'image/webp'
        else:
            return 'image/jpeg'  # Default fallback
    
    def _upload_to_supabase(self, image_data: bytes, storage_path: str, metadata: Dict) -> Dict:
        """Upload image to Supabase Storage with metadata"""
        try:
            # Upload with metadata
            response = self.supabase.storage.from_(self.supabase_bucket).upload(
                storage_path,
                image_data,
                file_options={
                    'content-type': metadata.get('content_type', 'image/jpeg'),
                    'metadata': json.dumps(metadata)
                }
            )
            
            if response.get('error'):
                return {
                    'success': False,
                    'error': response['error'],
                    'storage_provider': 'supabase',
                    'url': None,
                    'metadata': metadata
                }
            
            # Get public URL
            public_url = self.supabase.storage.from_(self.supabase_bucket).get_public_url(storage_path)
            
            return {
                'success': True,
                'storage_provider': 'supabase',
                'url': public_url,
                'path': storage_path,
                'metadata': metadata,
                'error': None
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'storage_provider': 'supabase',
                'url': None,
                'metadata': metadata
            }
    
    def _upload_to_s3(self, image_data: bytes, storage_path: str, metadata: Dict) -> Dict:
        """Upload image to S3 with metadata"""
        try:
            # Upload with metadata tags
            metadata_tags = {
                'business_id': metadata.get('business_id', ''),
                'document_id': metadata.get('document_id', ''),
                'image_hash': metadata.get('image_hash', ''),
                'upload_timestamp': metadata.get('upload_timestamp', ''),
                'original_filename': metadata.get('original_filename', '')
            }
            
            self.s3_client.put_object(
                Bucket=self.s3_bucket,
                Key=storage_path,
                Body=image_data,
                ContentType=metadata.get('content_type', 'image/jpeg'),
                Metadata=metadata_tags
            )
            
            # Generate public URL
            public_url = f"https://{self.s3_bucket}.s3.{os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')}.amazonaws.com/{storage_path}"
            
            return {
                'success': True,
                'storage_provider': 's3',
                'url': public_url,
                'path': storage_path,
                'metadata': metadata,
                'error': None
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'storage_provider': 's3',
                'url': None,
                'metadata': metadata
            }
    
    def delete_property_image(self, storage_path: str, storage_provider: str) -> bool:
        """Delete property image from storage"""
        try:
            if storage_provider == 'supabase':
                response = self.supabase.storage.from_(self.supabase_bucket).remove([storage_path])
                return not response.get('error')
            elif storage_provider == 's3':
                self.s3_client.delete_object(Bucket=self.s3_bucket, Key=storage_path)
                return True
            else:
                print(f"⚠️ Unknown storage provider: {storage_provider}")
                return False
                
        except Exception as e:
            print(f"❌ Error deleting image: {e}")
            return False
    
    def get_image_url(self, storage_path: str, storage_provider: str) -> Optional[str]:
        """Get public URL for stored image"""
        try:
            if storage_provider == 'supabase':
                return self.supabase.storage.from_(self.supabase_bucket).get_public_url(storage_path)
            elif storage_provider == 's3':
                return f"https://{self.s3_bucket}.s3.{os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')}.amazonaws.com/{storage_path}"
            else:
                return None
        except Exception as e:
            print(f"❌ Error getting image URL: {e}")
            return None
    
    def list_property_images(self, business_id: str, document_id: str) -> List[Dict]:
        """List all images for a property document with enhanced metadata"""
        try:
            # List from Supabase
            supabase_path = f"{business_id}/property-images/{document_id}/"
            supabase_files = self.supabase.storage.from_(self.supabase_bucket).list(supabase_path)
            
            images = []
            for file_info in supabase_files:
                if file_info['name'].endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif')):
                    # Extract metadata from filename if available
                    metadata = file_info.get('metadata', {})
                    
                    images.append({
                        'filename': file_info['name'],
                        'path': f"{supabase_path}{file_info['name']}",
                        'size': file_info.get('metadata', {}).get('size', 0),
                        'storage_provider': 'supabase',
                        'url': self.get_image_url(f"{supabase_path}{file_info['name']}", 'supabase'),
                        'metadata': metadata,
                        'created_at': file_info.get('created_at'),
                        'updated_at': file_info.get('updated_at')
                    })
            
            return images
            
        except Exception as e:
            print(f"❌ Error listing images: {e}")
            return []
    
    def get_image_metadata(self, storage_path: str, storage_provider: str) -> Optional[Dict]:
        """Get metadata for a stored image"""
        try:
            if storage_provider == 'supabase':
                # Get file info from Supabase
                file_info = self.supabase.storage.from_(self.supabase_bucket).get_file_info(storage_path)
                return file_info.get('metadata', {})
            elif storage_provider == 's3':
                # Get object metadata from S3
                response = self.s3_client.head_object(Bucket=self.s3_bucket, Key=storage_path)
                return response.get('Metadata', {})
            else:
                return None
        except Exception as e:
            print(f"❌ Error getting image metadata: {e}")
            return None
    
    def deduplicate_images(self, business_id: str, document_id: str) -> Dict:
        """Remove duplicate images based on hash"""
        try:
            images = self.list_property_images(business_id, document_id)
            hash_map = {}
            duplicates = []
            
            for img in images:
                metadata = img.get('metadata', {})
                image_hash = metadata.get('image_hash')
                
                if image_hash:
                    if image_hash in hash_map:
                        # This is a duplicate
                        duplicates.append({
                            'duplicate': img,
                            'original': hash_map[image_hash]
                        })
                    else:
                        hash_map[image_hash] = img
            
            # Remove duplicates
            removed_count = 0
            for dup in duplicates:
                if self.delete_property_image(dup['duplicate']['path'], dup['duplicate']['storage_provider']):
                    removed_count += 1
            
            return {
                'success': True,
                'total_images': len(images),
                'unique_images': len(hash_map),
                'duplicates_found': len(duplicates),
                'duplicates_removed': removed_count
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'total_images': 0,
                'unique_images': 0,
                'duplicates_found': 0,
                'duplicates_removed': 0
            }
    
    def optimize_image_storage(self, business_id: str, document_id: str) -> Dict:
        """Optimize image storage by removing duplicates and organizing files"""
        try:
            # First deduplicate
            dedup_result = self.deduplicate_images(business_id, document_id)
            
            # Get remaining images
            images = self.list_property_images(business_id, document_id)
            
            # Sort by upload timestamp (newest first)
            images.sort(key=lambda x: x.get('metadata', {}).get('upload_timestamp', ''), reverse=True)
            
            return {
                'success': True,
                'deduplication': dedup_result,
                'total_images_after_optimization': len(images),
                'images': images[:10]  # Return first 10 for preview
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'deduplication': {'success': False, 'error': str(e)},
                'total_images_after_optimization': 0,
                'images': []
            }
    
    def migrate_images_to_supabase(self, business_id: str, document_id: str) -> Dict:
        """Migrate images from S3 to Supabase Storage"""
        try:
            # This would require listing S3 objects and re-uploading to Supabase
            # Implementation depends on your specific migration needs
            return {
                'success': False,
                'error': 'Migration not implemented yet',
                'migrated_count': 0
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'migrated_count': 0
            }
