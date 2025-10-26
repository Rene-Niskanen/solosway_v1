"""
Unified Storage Service
Handles both Supabase Storage and S3 storage for property images
"""

import os
import boto3
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from supabase import create_client

class StorageService:
    """Unified storage service for property images"""
    
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
        preferred_storage: str = 'supabase'
    ) -> Dict:
        """
        Upload property image to storage
        
        Args:
            image_data: Raw image bytes
            filename: Image filename
            business_id: Business ID for organization
            document_id: Document ID
            preferred_storage: 'supabase' or 's3'
        
        Returns:
            Dict with upload results and metadata
        """
        try:
            # Generate storage path
            storage_path = f"{business_id}/property-images/{document_id}/{filename}"
            
            if preferred_storage == 'supabase':
                # Try Supabase first
                result = self._upload_to_supabase(image_data, storage_path)
                if result['success']:
                    return result
                else:
                    print(f"⚠️ Supabase upload failed, falling back to S3: {result['error']}")
                    return self._upload_to_s3(image_data, storage_path)
            else:
                # Try S3 first
                result = self._upload_to_s3(image_data, storage_path)
                if result['success']:
                    return result
                else:
                    print(f"⚠️ S3 upload failed, falling back to Supabase: {result['error']}")
                    return self._upload_to_supabase(image_data, storage_path)
                    
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'storage_provider': None,
                'url': None
            }
    
    def _upload_to_supabase(self, image_data: bytes, storage_path: str) -> Dict:
        """Upload image to Supabase Storage"""
        try:
            response = self.supabase.storage.from_(self.supabase_bucket).upload(
                storage_path,
                image_data,
                file_options={'content-type': 'image/jpeg'}
            )
            
            if response.get('error'):
                return {
                    'success': False,
                    'error': response['error'],
                    'storage_provider': 'supabase',
                    'url': None
                }
            
            # Get public URL
            public_url = self.supabase.storage.from_(self.supabase_bucket).get_public_url(storage_path)
            
            return {
                'success': True,
                'storage_provider': 'supabase',
                'url': public_url,
                'path': storage_path,
                'error': None
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'storage_provider': 'supabase',
                'url': None
            }
    
    def _upload_to_s3(self, image_data: bytes, storage_path: str) -> Dict:
        """Upload image to S3"""
        try:
            self.s3_client.put_object(
                Bucket=self.s3_bucket,
                Key=storage_path,
                Body=image_data,
                ContentType='image/jpeg'
            )
            
            # Generate public URL
            public_url = f"https://{self.s3_bucket}.s3.{os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')}.amazonaws.com/{storage_path}"
            
            return {
                'success': True,
                'storage_provider': 's3',
                'url': public_url,
                'path': storage_path,
                'error': None
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'storage_provider': 's3',
                'url': None
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
        """List all images for a property document"""
        try:
            # List from Supabase
            supabase_path = f"{business_id}/property-images/{document_id}/"
            supabase_files = self.supabase.storage.from_(self.supabase_bucket).list(supabase_path)
            
            images = []
            for file_info in supabase_files:
                if file_info['name'].endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif')):
                    images.append({
                        'filename': file_info['name'],
                        'path': f"{supabase_path}{file_info['name']}",
                        'size': file_info.get('metadata', {}).get('size', 0),
                        'storage_provider': 'supabase',
                        'url': self.get_image_url(f"{supabase_path}{file_info['name']}", 'supabase')
                    })
            
            return images
            
        except Exception as e:
            print(f"❌ Error listing images: {e}")
            return []
    
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
