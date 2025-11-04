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

class ReductoService:
    """Service wrapper for reducto API calls"""

    def __init__(self):
        self.api_key = os.environ.get('REDUCTO_API_KEY')
        if not self.api_key:
            raise ValueError("REDUCTO_API_KEY environment variable not set")

        self.client = Reducto(api_key=self.api_key, timeout=300)

    def parse_document(self, file_path: str, return_images: List[str] = None, use_async: bool = False) -> Dict[str, Any]:
        """
        Parse a document and return job_id, text, chunks, and image URLs
        
        Args:
            file_path: Path to the document file
            return_images: List of image types to return (e.g., ["figure", "table"])
            use_async: If True, use async job-based processing (recommended for large files)
            
        Returns:
            Dict with keys: job_id, document_text, chunks, image_urls
        """
        try: 
            if return_images is None:
                return_images = ["figure", "table"]

            # Convert file_path to Path object if it's a string (Reducto requires Path or file-like object)
            file_path_obj = Path(file_path) if isinstance(file_path, str) else file_path

            # Upload the document first
            logger.info(f"📤 Uploading document to Reducto: {file_path}")
            upload = self.client.upload(file=file_path_obj)
            
            if use_async:
                # Use async job-based processing (recommended for large files)
                # This prevents timeouts and connection issues
                logger.info("🔄 Using async job-based parsing")
                import time
                
                submission = self.client.parse.run_job(
                    input=upload,
                    settings={
                        "return_images": return_images
                    }
                )
                
                job_id = submission.job_id
                logger.info(f"📋 Parse job submitted: {job_id}")
                
                # Poll for job completion
                max_wait = 600  # 10 minutes max
                wait_time = 0
                poll_interval = 2  # Check every 2 seconds
                
                while wait_time < max_wait:
                    job = self.client.job.get(job_id)
                    
                    if job.status == "Completed":
                        logger.info(f"Parse job completed: {job_id}")
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
                    elif job.status == "Failed":
                        error_msg = getattr(job, 'error', 'Unknown error')
                        logger.error(f"❌ Parse job failed: {error_msg}")
                        raise Exception(f"Reducto parse job failed: {error_msg}")
                    elif job.status == "Pending" or job.status == "Processing":
                        logger.debug(f"⏳ Parse job {job_id} status: {job.status} (waited {wait_time}s)")
                        time.sleep(poll_interval)
                        wait_time += poll_interval
                    else:
                        logger.warning(f"⚠️ Unknown job status: {job.status}")
                        time.sleep(poll_interval)
                        wait_time += poll_interval
                
                if wait_time >= max_wait:
                    raise TimeoutError(f"Parse job {job_id} timed out after {max_wait} seconds")
            else:
                # Use synchronous parsing (for small files)
                logger.info("🔄 Using synchronous parsing")
                parse_result = self.client.parse.run(
                    input=upload,
                    settings={
                        "return_images": return_images
                    }
                )
                
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
                if hasattr(result_obj, 'chunks') and result_obj.chunks:
                    logger.info(f"📦 Found {len(result_obj.chunks)} chunks in parse result")
                    for chunk in result_obj.chunks:
                        chunk_content = chunk.content if hasattr(chunk, 'content') else ''
                        chunk_embed = chunk.embed if hasattr(chunk, 'embed') else ''
                        chunks.append({
                            'content': chunk_content,
                            'embed': chunk_embed,
                            'blocks': []
                        })
                        document_text += chunk_content + "\n"

                        # Extract image URLs from blocks with metadata
                        if hasattr(chunk, 'blocks') and chunk.blocks:
                            for block in chunk.blocks:
                                if hasattr(block, 'image_url') and block.image_url:
                                    image_urls.append(block.image_url)
                                    
                                    # Store block metadata for filtering
                                    block_metadata = {
                                        'type': getattr(block, 'type', 'unknown'),
                                        'image_url': block.image_url,
                                        'bbox': None
                                    }
                                    
                                    # Extract bbox if available
                                    if hasattr(block, 'bbox'):
                                        bbox = block.bbox
                                        if bbox:
                                            block_metadata['bbox'] = {
                                                'left': getattr(bbox, 'left', None) if hasattr(bbox, 'left') else None,
                                                'top': getattr(bbox, 'top', None) if hasattr(bbox, 'top') else None,
                                                'width': getattr(bbox, 'width', None) if hasattr(bbox, 'width') else None,
                                                'height': getattr(bbox, 'height', None) if hasattr(bbox, 'height') else None,
                                                'page': getattr(bbox, 'page', None) if hasattr(bbox, 'page') else None,
                                                'original_page': getattr(bbox, 'original_page', None) if hasattr(bbox, 'original_page') else None
                                            }
                                    
                                    image_blocks_metadata.append(block_metadata)
                                    chunks[-1]['blocks'].append(block_metadata)
                
                # Alternative if chunks are not available, try direct text extraction 
                elif hasattr(result_obj, 'text'):
                    document_text = result_obj.text if result_obj.text else ''
                    logger.info(f"📄 Extracted text directly (no chunks): {len(document_text)} chars")
                else:
                    logger.warning(f"⚠️ No chunks or text found in result_obj. Attributes: {dir(result_obj)}")
            else:
                logger.error(f"❌ Could not extract result object from parse_result") 

            return {
                'job_id': job_id,
                'document_text': document_text,
                'chunks': chunks,
                'image_urls': image_urls,
                'image_blocks_metadata': image_blocks_metadata
            }

        except TimeoutError as e:
            logger.error(f"Reducto parse timeout: {e}")
            raise
        except ConnectionError as e:
            logger.error(f"Reducto connection error: {e}")
            raise Exception(f"Connection error with Reducto API: {str(e)}. Please check your network connection and try again.")
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Reducto parse failed: {error_msg}")
            
            # Check for SSL errors
            if "SSL" in error_msg or "EOF" in error_msg:
                logger.error("SSL/EOF error detected. This may be due to network issues or large file size.")
                logger.info("💡 Consider using async job-based processing (use_async=True) for large files")
                raise Exception(f"Network error during parsing: {error_msg}. Try using async processing for large files.")
            
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
            
            # Use jobid:// prefix to retrieve existing parse result
            parse_result = self.client.parse.run(
                input=f"jobid://{job_id}",
                settings={
                    "return_images": return_images
                }
            )
            
            # Extract text from chunks 
            document_text = ""
            chunks = []
            image_urls = []
            image_blocks_metadata = []

            if hasattr(parse_result, 'result') and parse_result.result:
                result_obj = parse_result.result

                if hasattr(result_obj, 'chunks'):
                    for chunk in result_obj.chunks:
                        chunk_content = chunk.content if hasattr(chunk, 'content') else ''
                        chunks.append({
                            'content': chunk_content,
                            'embed': chunk.embed if hasattr(chunk, 'embed') else '',
                            'blocks': []
                        })
                        document_text += chunk_content

                        # Extract image URLs from blocks with metadata
                        if hasattr(chunk, 'blocks'):
                            for block in chunk.blocks:
                                if hasattr(block, 'image_url') and block.image_url:
                                    image_urls.append(block.image_url)
                                    
                                    # Store block metadata for filtering
                                    block_metadata = {
                                        'type': getattr(block, 'type', 'unknown'),
                                        'image_url': block.image_url,
                                        'bbox': None
                                    }
                                    
                                    # Extract bbox if available
                                    if hasattr(block, 'bbox'):
                                        bbox = block.bbox
                                        if bbox:
                                            block_metadata['bbox'] = {
                                                'left': getattr(bbox, 'left', None),
                                                'top': getattr(bbox, 'top', None),
                                                'width': getattr(bbox, 'width', None),
                                                'height': getattr(bbox, 'height', None),
                                                'page': getattr(bbox, 'page', None),
                                                'original_page': getattr(bbox, 'original_page', None)
                                            }
                                    
                                    image_blocks_metadata.append(block_metadata)
                                    chunks[-1]['blocks'].append(block_metadata)
                # Alternative if chunks are not available, try direct text extraction 
                elif hasattr(result_obj, 'text'):
                    document_text = result_obj.text 
            
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
                        "enum": ["valuation_report", "market_appraisal", "other_documents"],
                        "description": "The type of document being classified"
                    }
                },
                "required": ["document_type"]
            }

            result = self.client.extract.run(
                input=f"jobid://{job_id}",
                instructions={
                    "schema": classification_schema,
                    "system_prompt": "Classify this document based on its content. Focus on whether its a formal valuation report, market appraisal, or other property document."
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

        
 







