"""
Supabase Property Hub Service
Handles all property operations using only Supabase tables
"""
import os
import uuid
import logging
import time
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Import performance monitoring
try:
    from .performance_service import performance_service, track_db_query
    from .error_handling_service import error_handler
    PERFORMANCE_MONITORING = True
except ImportError:
    PERFORMANCE_MONITORING = False
    logger.warning("Performance monitoring not available")

class SupabasePropertyHubService:
    """Supabase-only service for property hub operations"""
    
    def __init__(self):
        """Initialize Supabase client"""
        try:
            self.supabase = create_client(
                os.environ['SUPABASE_URL'],
                os.environ['SUPABASE_SERVICE_KEY']
            )
            logger.info("✅ SupabasePropertyHubService initialized successfully")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase client: {e}")
            raise
    
    def create_property_with_relationships(
        self, 
        address_data: Dict[str, Any], 
        document_id: str, 
        business_id: str,
        extracted_data: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Create property in Supabase with all relationships using enhanced matching
        
        Args:
            address_data: Normalized address and geocoding data
            document_id: Document being linked
            business_id: Business identifier
            extracted_data: Extracted property details (optional)
            
        Returns:
            Property creation results with success status
        """
        try:
            logger.info(f"🏠 Creating property hub for document {document_id}")
            logger.info(f"   Business ID: {business_id}")
            logger.info(f"   Address: {address_data.get('normalized_address', 'N/A')}")
            
            # Use enhanced property matching service
            from .enhanced_property_matching_service import EnhancedPropertyMatchingService
            matching_service = EnhancedPropertyMatchingService()
            
            # Find or create property using enhanced matching
            match_result = matching_service.find_or_create_property(
                address_data=address_data,
                document_id=document_id,
                business_id=business_id,
                extracted_data=extracted_data
            )
            
            if not match_result['success']:
                logger.error(f"❌ Enhanced matching failed: {match_result.get('error', 'Unknown error')}")
                return match_result
            
            property_id = match_result['property_id']
            match_type = match_result['match_type']
            confidence = match_result['confidence']
            
            logger.info(f"   ✅ Property match result: {match_type} (confidence: {confidence:.2f})")
            
            # Create document relationship with enhanced metadata
            relationship_result = matching_service.create_document_relationship(
                document_id=document_id,
                property_id=property_id,
                business_id=business_id,
                address_data=address_data,
                match_type=match_type,
                confidence=confidence
            )
            
            # Store extracted data in property_details (if available and new property)
            details_result = None
            if extracted_data and match_result['action'] == 'created_new':
                details_result = self._create_property_details(
                    property_id, extracted_data, business_id, address_data
                )
            elif extracted_data and match_result['action'] == 'linked_to_existing':
                # Update existing property details with new data
                details_result = self._update_property_details(
                    property_id, extracted_data, business_id, address_data
                )
            
            logger.info(f"✅ Property hub processed successfully: {property_id}")
            logger.info(f"   Match Type: {match_type}")
            logger.info(f"   Confidence: {confidence:.2f}")
            logger.info(f"   Action: {match_result['action']}")
            
            return {
                'success': True,
                'property_id': property_id,
                'property': match_result['property'],
                'relationship': relationship_result,
                'property_details': details_result,
                'match_type': match_type,
                'confidence': confidence,
                'action': match_result['action']
            }
            
        except Exception as e:
            logger.error(f"❌ Error creating property hub: {e}")
            return {'success': False, 'error': str(e)}
    
    def _create_supabase_property(self, property_id: str, address_data: Dict, business_id: str) -> Dict[str, Any]:
        """Create property in Supabase properties table"""
        try:
            property_data = {
                'id': property_id,
                'business_id': business_id,
                'address_hash': address_data['address_hash'],
                'normalized_address': address_data['normalized_address'],
                'formatted_address': address_data.get('formatted_address'),
                'latitude': address_data.get('latitude'),
                'longitude': address_data.get('longitude'),
                'geocoding_status': address_data.get('geocoding_status'),
                'geocoding_confidence': address_data.get('geocoding_confidence'),
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
            logger.info(f"   Creating property in properties table...")
            result = self.supabase.table('properties').insert(property_data).execute()
            
            if result.data:
                logger.info(f"   ✅ Property created: {property_id}")
                return result.data[0]
            else:
                raise Exception("Failed to create property in Supabase")
                
        except Exception as e:
            logger.error(f"   ❌ Failed to create property: {e}")
            raise
    
    def _create_document_relationship(self, document_id: str, property_id: str, business_id: str, address_data: Dict) -> Dict[str, Any]:
        """Create document relationship in Supabase"""
        try:
            relationship_data = {
                'id': str(uuid.uuid4()),
                'document_id': document_id,
                'property_id': property_id,
                'relationship_type': 'valuation_report',  # Default, can be dynamic
                'address_source': address_data.get('address_source', 'extraction'),
                'confidence_score': address_data.get('geocoding_confidence', 0.8),
                'relationship_metadata': {'extraction_method': 'llama_extract'},
                'created_at': datetime.utcnow().isoformat()
            }
            
            logger.info(f"   Creating document relationship...")
            result = self.supabase.table('document_relationships').insert(relationship_data).execute()
            
            if result.data:
                logger.info(f"   ✅ Relationship created: {relationship_data['id']}")
                return result.data[0]
            else:
                raise Exception("Failed to create relationship in Supabase")
                
        except Exception as e:
            logger.error(f"   ❌ Failed to create relationship: {e}")
            raise
    
    def _update_property_details(self, property_id: str, extracted_data: Dict, business_id: str, address_data: Dict = None) -> Optional[Dict[str, Any]]:
        """Update existing property details with new extracted data"""
        try:
            # Check if property details already exist
            existing_result = self.supabase.table('property_details').select('*').eq('property_id', property_id).execute()
            
            if existing_result.data:
                # Update existing details with new data (merge strategy)
                existing_details = existing_result.data[0]
                
                # Prepare update data - only update fields that are not null in extracted_data
                update_data = {}
                for key, value in extracted_data.items():
                    if value is not None and value != '':
                        # Only update if existing value is null or if new value is more recent
                        if existing_details.get(key) is None or existing_details.get(key) == '':
                            # Convert float to int for bedrooms/bathrooms
                            if key in ['number_bedrooms', 'number_bathrooms']:
                                update_data[key] = int(value) if isinstance(value, (int, float)) else value
                            else:
                                update_data[key] = value
                
                # Always update metadata fields
                update_data.update({
                    'updated_at': datetime.utcnow().isoformat(),
                    'last_enrichment': datetime.utcnow().isoformat()
                })
                
                if update_data:
                    result = self.supabase.table('property_details').update(update_data).eq('property_id', property_id).execute()
                    if result.data:
                        logger.info(f"   ✅ Updated property details: {property_id}")
                        return result.data[0]
                
                logger.info(f"   ℹ️ No updates needed for property details: {property_id}")
                return existing_details
            else:
                # Create new details if none exist
                return self._create_property_details(property_id, extracted_data, business_id, address_data)
                
        except Exception as e:
            logger.error(f"   ❌ Failed to update property details: {e}")
            return None
    
    def _create_property_details(self, property_id: str, extracted_data: Dict, business_id: str, address_data: Dict = None) -> Optional[Dict[str, Any]]:
        """Create property details in property_details table with full schema"""
        try:
            details_data = {
                'property_id': property_id,
                'property_type': extracted_data.get('property_type'),
                'size_sqft': extracted_data.get('size_sqft'),
                'size_unit': extracted_data.get('size_unit'),
                'number_bedrooms': int(extracted_data.get('number_bedrooms')) if extracted_data.get('number_bedrooms') is not None else None,
                'number_bathrooms': int(extracted_data.get('number_bathrooms')) if extracted_data.get('number_bathrooms') is not None else None,
                'tenure': extracted_data.get('tenure'),
                'epc_rating': extracted_data.get('epc_rating'),
                'condition': extracted_data.get('condition'),
                'other_amenities': extracted_data.get('other_amenities'),
                'asking_price': extracted_data.get('asking_price'),
                'sold_price': extracted_data.get('sold_price'),
                'rent_pcm': extracted_data.get('rent_pcm'),
                'appraised_value': extracted_data.get('appraised_value'),
                'yield_percentage': extracted_data.get('yield_percentage'),
                'price_per_sqft': extracted_data.get('price_per_sqft'),
                'transaction_date': extracted_data.get('transaction_date'),
                'sold_date': extracted_data.get('sold_date'),
                'rented_date': extracted_data.get('rented_date'),
                'leased_date': extracted_data.get('leased_date'),
                'days_on_market': extracted_data.get('days_on_market'),
                'lease_details': extracted_data.get('lease_details'),
                'listed_building_grade': extracted_data.get('listed_building_grade'),
                'notes': extracted_data.get('notes'),
                'property_images': extracted_data.get('property_images') or [],
                'image_count': extracted_data.get('image_count', 0),
                'primary_image_url': extracted_data.get('primary_image_url'),
                'image_metadata': extracted_data.get('image_metadata', {}),
                'property_address': extracted_data.get('property_address'),
                'normalized_address': address_data.get('normalized_address') if address_data else None,
                'address_hash': address_data.get('address_hash') if address_data else None,
                'address_source': address_data.get('address_source') if address_data else None,
                'latitude': address_data.get('latitude') if address_data else None,
                'longitude': address_data.get('longitude') if address_data else None,
                'geocoded_address': address_data.get('formatted_address') if address_data else None,
                'geocoding_confidence': address_data.get('geocoding_confidence') if address_data else None,
                'geocoding_status': address_data.get('geocoding_status') if address_data else None,
                'source_document_id': extracted_data.get('source_document_id'),
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
            logger.info(f"   Creating property details...")
            result = self.supabase.table('property_details').insert(details_data).execute()
            
            if result.data:
                logger.info(f"   ✅ Property details created: {property_id}")
                return result.data[0]
            else:
                logger.warning(f"   ⚠️ Failed to create property details")
                return None
                
        except Exception as e:
            logger.error(f"   ❌ Failed to create property details: {e}")
            return None
    
    
    def test_basic_property_creation(self, business_id: str = "test_business") -> Dict[str, Any]:
        """
        Test basic property creation with simple data
        
        Args:
            business_id: Business identifier for testing
            
        Returns:
            Test results
        """
        try:
            logger.info("🧪 Testing basic property creation...")
            
            # Test data
            test_address_data = {
                'original_address': '123 Test Street, London',
                'normalized_address': '123 Test Street, London',
                'address_hash': f'test_hash_{uuid.uuid4().hex[:8]}',
                'formatted_address': '123 Test Street, London, UK',
                'latitude': 51.5074,
                'longitude': -0.1278,
                'geocoding_status': 'success',
                'geocoding_confidence': 0.9,
                'address_source': 'test'
            }
            
            test_document_id = str(uuid.uuid4())
            
            test_extracted_data = {
                'property_type': 'House',
                'size_sqft': 1500,
                'number_bedrooms': 3,
                'number_bathrooms': 2,
                'asking_price': 500000,
                'condition': 'Good'
            }
            
            # First, create a test document
            logger.info("   Creating test document...")
            test_document_data = {
                'id': test_document_id,
                'original_filename': 'test_document.pdf',
                's3_path': f'test/{test_document_id}/test_document.pdf',
                'file_type': 'application/pdf',
                'file_size': 1024,
                'business_id': business_id,
                'uploaded_by_user_id': 1,
                'status': 'completed',
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
            try:
                doc_result = self.supabase.table('documents').insert(test_document_data).execute()
                if doc_result.data:
                    logger.info("   ✅ Test document created")
                else:
                    logger.warning("   ⚠️ Failed to create test document, but continuing...")
            except Exception as e:
                logger.warning(f"   ⚠️ Could not create test document: {e}, but continuing...")
            
            # Test property creation
            result = self.create_property_with_relationships(
                address_data=test_address_data,
                document_id=test_document_id,
                business_id=business_id,
                extracted_data=test_extracted_data
            )
            
            if result['success']:
                logger.info("✅ Basic property creation test PASSED")
                return {
                    'test_passed': True,
                    'property_id': result['property_id'],
                    'message': 'Property creation test successful'
                }
            else:
                logger.error("❌ Basic property creation test FAILED")
                return {
                    'test_passed': False,
                    'error': result.get('error'),
                    'message': 'Property creation test failed'
                }
                
        except Exception as e:
            logger.error(f"❌ Test failed with exception: {e}")
            return {
                'test_passed': False,
                'error': str(e),
                'message': 'Test failed with exception'
            }
    
    def get_property_hub(self, property_id: str, business_id: str) -> Optional[Dict[str, Any]]:
        """
        Get complete property hub with all related data from Supabase
        
        Args:
            property_id: Property UUID
            business_id: Business identifier for multi-tenancy
            
        Returns:
            Complete property hub data or None if not found
        """
        try:
            logger.info(f"🏠 Getting property hub: {property_id}")
            logger.info(f"   Business ID: {business_id}")
            
            # 1. Get property from properties table
            property_result = self.supabase.table('properties').select('*').eq('id', property_id).eq('business_id', business_id).execute()
            
            if not property_result.data:
                logger.warning(f"   ⚠️ Property not found: {property_id}")
                return None
            
            property_data = property_result.data[0]
            logger.info(f"   ✅ Property found: {property_data.get('formatted_address', 'N/A')}")
            
            # 2. Get all related documents
            documents = self._get_property_documents(property_id)
            logger.info(f"   📄 Found {len(documents)} related documents")
            
            # 3. Get property details
            property_details = self._get_property_details(property_id)
            if property_details:
                logger.info(f"   ✅ Property details found")
            else:
                logger.info(f"   ⚠️ No property details found")
            
            # 4. Get comparable properties data
            comparable_data = self._get_property_details_data(property_id)
            logger.info(f"   📊 Found {len(comparable_data)} comparable records")
            
            # 5. Get property history
            # Property history table doesn't exist yet - skip for now
            property_history = []
            logger.info(f"   📈 Property history not available (table not created yet)")
            
            # 6. Get document vectors count
            document_vectors_count = self._get_document_vectors_count(property_id)
            logger.info(f"   🔍 Found {document_vectors_count} document vectors")
            
            # 7. Get property vectors count
            property_vectors_count = self._get_property_vectors_count(property_id)
            logger.info(f"   🏠 Found {property_vectors_count} property vectors")
            
            # 8. Calculate completeness score
            completeness_score = self._calculate_completeness_score(property_data, property_details, documents)
            
            hub_data = {
                'property': property_data,
                'documents': documents,
                'property_details': property_details,
                'comparable_data': comparable_data,
                'property_history': property_history,
                'vectors': {
                    'document_vectors_count': document_vectors_count,
                    'property_vectors_count': property_vectors_count
                },
                'summary': {
                    'document_count': len(documents),
                    'has_details': bool(property_details),
                    'has_comparable_data': bool(comparable_data),
                    'has_vectors': document_vectors_count > 0 or property_vectors_count > 0,
                    'completeness_score': completeness_score,
                    'total_records': len(documents) + len(comparable_data)
                }
            }
            
            logger.info(f"✅ Property hub retrieved successfully")
            logger.info(f"   Summary: {hub_data['summary']}")
            
            return hub_data
            
        except Exception as e:
            logger.error(f"❌ Error getting property hub: {e}")
            return None
    
    def get_all_property_hubs(self, business_id: str) -> List[Dict[str, Any]]:
        """
        Get all property hubs for a business
        
        Args:
            business_id: Business identifier for multi-tenancy
            
        Returns:
            List of property hub summaries
        """
        try:
            logger.info(f"🏠 Getting all property hubs for business: {business_id}")
            
            # Get all properties for business
            properties_result = self.supabase.table('properties').select('*').eq('business_id', business_id).order('created_at', desc=True).execute()
            
            if not properties_result.data:
                logger.info(f"   ⚠️ No properties found for business: {business_id}")
                return []
            
            logger.info(f"   📊 Found {len(properties_result.data)} properties")
            
            property_hubs = []
            for prop in properties_result.data:
                try:
                    # Get basic property data
                    prop_data = prop
                    
                    # Get document count
                    doc_count_result = self.supabase.table('document_relationships').select('id', count='exact').eq('property_id', prop['id']).execute()
                    prop_data['document_count'] = doc_count_result.count if doc_count_result.count else 0
                    
                    # Get latest document
                    latest_rel_result = self.supabase.table('document_relationships').select('*').eq('property_id', prop['id']).order('created_at', desc=True).limit(1).execute()
                    if latest_rel_result.data:
                        latest_doc_result = self.supabase.table('documents').select('original_filename, status, created_at').eq('id', latest_rel_result.data[0]['document_id']).execute()
                        if latest_doc_result.data:
                            prop_data['latest_document'] = latest_doc_result.data[0]
                    
                    # Get property details summary
                    details_result = self.supabase.table('property_details').select('property_type, size_sqft, asking_price, sold_price').eq('property_id', prop['id']).execute()
                    if details_result.data:
                        prop_data['property_details'] = details_result.data[0]
                    
                    # Get comparable data count
                    comparable_count_result = self.supabase.table('property_details').select('id', count='exact').eq('property_id', prop['id']).execute()
                    prop_data['comparable_count'] = comparable_count_result.count if comparable_count_result.count else 0
                    
                    property_hubs.append(prop_data)
                    
                except Exception as e:
                    logger.warning(f"   ⚠️ Error processing property {prop['id']}: {e}")
                    continue
            
            logger.info(f"✅ Retrieved {len(property_hubs)} property hubs")
            return property_hubs
            
        except Exception as e:
            logger.error(f"❌ Error getting all property hubs: {e}")
            return []
    
    def _get_property_documents(self, property_id: str) -> List[Dict[str, Any]]:
        """Get all documents linked to a property"""
        try:
            # Get relationships first
            relationships_result = self.supabase.table('document_relationships').select('*').eq('property_id', property_id).execute()
            
            if not relationships_result.data:
                return []
            
            # Get documents for each relationship
            documents = []
            for rel in relationships_result.data:
                doc_result = self.supabase.table('documents').select('*').eq('id', rel['document_id']).execute()
                if doc_result.data:
                    doc = doc_result.data[0]
                    doc['relationship'] = rel
                    documents.append(doc)
            
            return documents
            
        except Exception as e:
            logger.error(f"Error getting property documents: {e}")
            return []
    
    def _get_property_details(self, property_id: str) -> Optional[Dict[str, Any]]:
        """Get property details from property_details table"""
        try:
            result = self.supabase.table('property_details').select('*').eq('property_id', property_id).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"Error getting property details: {e}")
            return None
    
    def _get_property_details_data(self, property_id: str) -> List[Dict[str, Any]]:
        """Get comparable properties data"""
        try:
            result = self.supabase.table('property_details').select('*').eq('property_id', property_id).execute()
            return result.data if result.data else []
        except Exception as e:
            logger.error(f"Error getting comparable properties data: {e}")
            return []
    
    def _get_property_history(self, property_id: str) -> List[Dict[str, Any]]:
        """Get property history"""
        try:
            result = self.supabase.table('property_history').select('*').eq('property_id', property_id).order('event_date', desc=True).execute()
            return result.data if result.data else []
        except Exception as e:
            logger.error(f"Error getting property history: {e}")
            return []
    
    def _get_document_vectors_count(self, property_id: str) -> int:
        """Get count of document vectors for this property"""
        try:
            result = self.supabase.table('document_vectors').select('id', count='exact').eq('property_id', property_id).execute()
            return result.count if result.count else 0
        except Exception as e:
            logger.error(f"Error getting document vectors count: {e}")
            return 0
    
    def _get_property_vectors_count(self, property_id: str) -> int:
        """Get count of property vectors for this property"""
        try:
            result = self.supabase.table('property_vectors').select('id', count='exact').eq('property_id', property_id).execute()
            return result.count if result.count else 0
        except Exception as e:
            logger.error(f"Error getting property vectors count: {e}")
            return 0
    
    def _calculate_completeness_score(self, property_data: Dict, property_details: Optional[Dict], documents: List[Dict]) -> float:
        """Calculate property completeness score (0.0 to 1.0)"""
        try:
            score = 0.0
            max_score = 10.0
            
            # Basic property data (3 points)
            if property_data.get('formatted_address'):
                score += 1.0
            if property_data.get('latitude') and property_data.get('longitude'):
                score += 1.0
            if property_data.get('geocoding_confidence', 0) > 0.5:
                score += 1.0
            
            # Property details (4 points)
            if property_details:
                if property_details.get('property_type'):
                    score += 0.5
                if property_details.get('size_sqft'):
                    score += 0.5
                if property_details.get('number_bedrooms'):
                    score += 0.5
                if property_details.get('number_bathrooms'):
                    score += 0.5
                if property_details.get('asking_price') or property_details.get('sold_price'):
                    score += 1.0
                if property_details.get('condition'):
                    score += 0.5
                if property_details.get('epc_rating'):
                    score += 0.5
            
            # Documents (2 points)
            if len(documents) > 0:
                score += 1.0
            if len(documents) > 1:
                score += 1.0
            
            # Vectors (1 point)
            doc_vectors = self._get_document_vectors_count(property_data['id'])
            prop_vectors = self._get_property_vectors_count(property_data['id'])
            if doc_vectors > 0 or prop_vectors > 0:
                score += 1.0
            
            return min(score / max_score, 1.0)
            
        except Exception as e:
            logger.error(f"Error calculating completeness score: {e}")
            return 0.0
    
    def test_complete_property_hub_functionality(self, business_id: str = "test_business") -> Dict[str, Any]:
        """
        Test complete property hub functionality
        
        Args:
            business_id: Business identifier for testing
            
        Returns:
            Test results
        """
        try:
            logger.info("🧪 Testing complete property hub functionality...")
            
            # First, create a test property
            test_result = self.test_basic_property_creation(business_id)
            if not test_result['test_passed']:
                return {
                    'test_passed': False,
                    'error': 'Basic property creation failed',
                    'message': 'Cannot test hub functionality without a property'
                }
            
            property_id = test_result['property_id']
            logger.info(f"   Using test property: {property_id}")
            
            # Test 1: Get property hub
            logger.info("   Testing get_property_hub...")
            hub_data = self.get_property_hub(property_id, business_id)
            if not hub_data:
                return {
                    'test_passed': False,
                    'error': 'Failed to get property hub',
                    'message': 'get_property_hub returned None'
                }
            logger.info(f"   ✅ Property hub retrieved: {hub_data['summary']}")
            
            # Test 2: Get all property hubs
            logger.info("   Testing get_all_property_hubs...")
            all_hubs = self.get_all_property_hubs(business_id)
            if not all_hubs:
                return {
                    'test_passed': False,
                    'error': 'Failed to get all property hubs',
                    'message': 'get_all_property_hubs returned empty list'
                }
            logger.info(f"   ✅ Retrieved {len(all_hubs)} property hubs")
            
            # Test 3: Verify hub data structure
            logger.info("   Testing hub data structure...")
            required_keys = ['property', 'documents', 'property_details', 'comparable_data', 'vectors', 'summary']
            for key in required_keys:
                if key not in hub_data:
                    return {
                        'test_passed': False,
                        'error': f'Missing key in hub data: {key}',
                        'message': 'Hub data structure incomplete'
                    }
            logger.info("   ✅ Hub data structure is complete")
            
            # Test 4: Verify summary data
            summary = hub_data['summary']
            if not isinstance(summary.get('document_count'), int):
                return {
                    'test_passed': False,
                    'error': 'Invalid document_count in summary',
                    'message': 'Summary data validation failed'
                }
            logger.info("   ✅ Summary data is valid")
            
            logger.info("✅ Complete property hub functionality test PASSED")
            return {
                'test_passed': True,
                'property_id': property_id,
                'hub_data': hub_data,
                'all_hubs_count': len(all_hubs),
                'message': 'Complete property hub functionality test successful'
            }
            
        except Exception as e:
            logger.error(f"❌ Complete functionality test failed: {e}")
            return {
                'test_passed': False,
                'error': str(e),
                'message': 'Complete functionality test failed with exception'
            }
    
    def get_all_property_hubs(
        self, 
        business_id: str, 
        limit: int = 100, 
        offset: int = 0, 
        sort_by: str = 'created_at', 
        sort_order: str = 'desc'
    ) -> List[Dict[str, Any]]:
        """
        Get all property hubs for a business with pagination and sorting
        
        Args:
            business_id: Business identifier
            limit: Maximum number of results
            offset: Number of results to skip
            sort_by: Field to sort by (created_at, completeness_score, formatted_address)
            sort_order: Sort order (asc, desc)
            
        Returns:
            List of property hubs
        """
        start_time = time.time()
        
        try:
            logger.info(f"🔍 Getting all property hubs for business: {business_id}")
            
            # Validate sort parameters
            valid_sort_fields = ['created_at', 'updated_at', 'completeness_score', 'formatted_address']
            if sort_by not in valid_sort_fields:
                sort_by = 'created_at'
            
            if sort_order not in ['asc', 'desc']:
                sort_order = 'desc'
            
            # Get properties with pagination and sorting
            query = self.supabase.table('properties').select('*').eq('business_id', business_id)
            
            # Apply sorting
            query = query.order(sort_by, desc=(sort_order == 'desc'))
            
            # Apply pagination
            query = query.range(offset, offset + limit - 1)
            
            # Track database query performance
            if PERFORMANCE_MONITORING:
                performance_service.track_db_query('get_properties_paginated', time.time() - start_time)
            
            result = query.execute()
            
            if not result.data:
                logger.info(f"   No properties found for business: {business_id}")
                return []
            
            # Get property hubs for each property
            property_hubs = []
            for property_data in result.data:
                property_id = property_data['id']
                hub = self.get_property_hub(property_id, business_id)
                if hub:
                    property_hubs.append(hub)
            
            # Track total performance
            total_time = time.time() - start_time
            if PERFORMANCE_MONITORING:
                performance_service.track_db_query('get_all_property_hubs', total_time, len(property_hubs))
            
            logger.info(f"✅ Retrieved {len(property_hubs)} property hubs in {total_time:.3f}s")
            return property_hubs
            
        except Exception as e:
            total_time = time.time() - start_time
            logger.error(f"❌ Error getting all property hubs: {e}")
            
            if PERFORMANCE_MONITORING:
                performance_service.track_db_query('get_all_property_hubs', total_time, 0, str(e))
                return error_handler.handle_database_error(e, 'get_all_property_hubs')
            
            return []
    
    def search_property_hubs(
        self, 
        business_id: str, 
        query: str = '', 
        filters: Dict[str, Any] = None, 
        limit: int = 50, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Search property hubs with query and filters
        
        Args:
            business_id: Business identifier
            query: Search query string
            filters: Additional filters (property_type, price_range, etc.)
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            List of matching property hubs
        """
        try:
            logger.info(f"🔍 Searching property hubs for business: {business_id}")
            logger.info(f"   Query: '{query}'")
            logger.info(f"   Filters: {filters}")
            
            # Start with base query
            base_query = self.supabase.table('properties').select('*').eq('business_id', business_id)
            
            # Apply text search if query provided
            if query:
                # Search in formatted_address and normalized_address
                base_query = base_query.or_(f'formatted_address.ilike.%{query}%,normalized_address.ilike.%{query}%')
            
            # Apply filters
            if filters:
                # Property type filter
                if filters.get('property_type'):
                    # Need to join with property_details table
                    pass  # Will implement after getting base results
                
                # Price range filters
                if filters.get('min_price') or filters.get('max_price'):
                    # Need to join with property_details table
                    pass  # Will implement after getting base results
                
                # Bedroom/bathroom filters
                if filters.get('min_bedrooms') or filters.get('max_bedrooms'):
                    pass  # Will implement after getting base results
                
                if filters.get('min_bathrooms') or filters.get('max_bathrooms'):
                    pass  # Will implement after getting base results
            
            # Apply pagination
            base_query = base_query.range(offset, offset + limit - 1)
            
            result = base_query.execute()
            
            if not result.data:
                logger.info(f"   No properties found matching search criteria")
                return []
            
            # Get property hubs for each property
            property_hubs = []
            for property_data in result.data:
                property_id = property_data['id']
                hub = self.get_property_hub(property_id, business_id)
                if hub:
                    # Apply additional filters on the hub data
                    if self._matches_filters(hub, filters):
                        property_hubs.append(hub)
            
            logger.info(f"✅ Found {len(property_hubs)} matching property hubs")
            return property_hubs
            
        except Exception as e:
            logger.error(f"❌ Error searching property hubs: {e}")
            return []
    
    def _matches_filters(self, hub: Dict[str, Any], filters: Dict[str, Any]) -> bool:
        """
        Check if a property hub matches the given filters
        
        Args:
            hub: Property hub data
            filters: Filter criteria
            
        Returns:
            True if hub matches filters
        """
        if not filters:
            return True
        
        property_details = hub.get('property_details', {})
        
        # Property type filter
        if filters.get('property_type'):
            if property_details.get('property_type', '').lower() != filters['property_type'].lower():
                return False
        
        # Price range filters
        asking_price = property_details.get('asking_price')
        sold_price = property_details.get('sold_price')
        rent_pcm = property_details.get('rent_pcm')
        
        if filters.get('min_price'):
            min_price = filters['min_price']
            if not any(price and price >= min_price for price in [asking_price, sold_price, rent_pcm]):
                return False
        
        if filters.get('max_price'):
            max_price = filters['max_price']
            if not any(price and price <= max_price for price in [asking_price, sold_price, rent_pcm]):
                return False
        
        # Bedroom filters
        bedrooms = property_details.get('number_bedrooms')
        if filters.get('min_bedrooms') and bedrooms and bedrooms < filters['min_bedrooms']:
            return False
        if filters.get('max_bedrooms') and bedrooms and bedrooms > filters['max_bedrooms']:
            return False
        
        # Bathroom filters
        bathrooms = property_details.get('number_bathrooms')
        if filters.get('min_bathrooms') and bathrooms and bathrooms < filters['min_bathrooms']:
            return False
        if filters.get('max_bathrooms') and bathrooms and bathrooms > filters['max_bathrooms']:
            return False
        
        return True
