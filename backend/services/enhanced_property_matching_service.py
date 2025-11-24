"""
Enhanced Property Matching Service
Provides intelligent property matching with fuzzy matching, spatial proximity, and confidence scoring
"""
import uuid
import logging
import math
import re
from typing import Dict, Any, List, Tuple, Optional
from uuid import UUID
from datetime import datetime
from difflib import SequenceMatcher
from geopy.distance import geodesic

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class EnhancedPropertyMatchingService:
    """Enhanced service for intelligent property matching and linking"""
    
    def __init__(self):
        """Initialize Supabase client and matching parameters"""
        try:
            self.supabase = get_supabase_client()
            logger.info("✅ EnhancedPropertyMatchingService initialized")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase client: {e}")
            raise
        
        # Matching configuration
        self.config = {
            'exact_match_threshold': 1.0,      # Perfect hash match
            'fuzzy_match_threshold': 0.85,     # High confidence fuzzy match
            'spatial_proximity_meters': 50,    # 50m radius for spatial matching
            'min_confidence_threshold': 0.7,   # Minimum confidence for auto-match
            'manual_review_threshold': 0.6,    # Threshold for manual review
            'max_candidates': 10               # Maximum candidates to return
        }
        
        # Address normalization patterns
        self.normalization_patterns = {
            'unit_patterns': [
                r'\b(apt|apartment|unit|flat|#)\s*\d+\w*\b',
                r'\b\d+\s*(apt|apartment|unit|flat)\b',
                r'\b(floor|level)\s*\d+\b'
            ],
            'suffix_patterns': [
                r'\b(uk|united kingdom|england|scotland|wales)\b',
                r'\b(ltd|limited|plc|inc|corp)\b'
            ],
            'punctuation_patterns': [
                r'[^\w\s]',  # Remove punctuation
                r'\s+',      # Collapse spaces
            ]
        }
    
    def find_or_create_property(
        self, 
        address_data: Dict[str, Any], 
        document_id: str, 
        business_id: str,
        extracted_data: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Enhanced property matching with multiple strategies
        
        Args:
            address_data: Normalized address and geocoding data
            document_id: Document being linked
            business_id: Business identifier
            extracted_data: Extracted property details
            
        Returns:
            Property matching result with confidence and match type
        """
        try:
            business_uuid = str(UUID(str(business_id))) if business_id else None
            logger.info(f"🔍 Enhanced property matching for: {address_data.get('original_address', 'N/A')}")
            
            # Step 1: Try exact hash match (fastest)
            exact_match = self._find_exact_match(address_data, business_uuid)
            if exact_match:
                logger.info(f"✅ Exact match found: {exact_match.get('id', 'unknown')}")
                return self._create_match_result(exact_match, 'exact_match', 1.0, document_id)
            
            # Step 2: Try fuzzy address matching
            fuzzy_matches = self._find_fuzzy_matches(address_data, business_uuid)
            if fuzzy_matches:
                best_fuzzy = fuzzy_matches[0]
                if best_fuzzy['confidence'] >= self.config['min_confidence_threshold']:
                    logger.info(f"✅ High-confidence fuzzy match: {best_fuzzy.get('id', 'unknown')} (confidence: {best_fuzzy['confidence']:.2f})")
                    return self._create_match_result(best_fuzzy, 'fuzzy_match', best_fuzzy['confidence'], document_id)
            
            # Step 3: Try spatial proximity matching
            spatial_matches = []  # Initialize as empty list
            if address_data.get('latitude') and address_data.get('longitude'):
                spatial_matches = self._find_spatial_matches(address_data, business_uuid)
                if spatial_matches:
                    best_spatial = spatial_matches[0]
                    if best_spatial['confidence'] >= self.config['min_confidence_threshold']:
                        logger.info(f"✅ High-confidence spatial match: {best_spatial.get('id', 'unknown')} (confidence: {best_spatial['confidence']:.2f})")
                        return self._create_match_result(best_spatial, 'spatial_match', best_spatial['confidence'], document_id)
            
            # Step 4: Check for manual review candidates
            all_candidates = []
            if fuzzy_matches:
                all_candidates.extend(fuzzy_matches)
            if spatial_matches:
                all_candidates.extend(spatial_matches)
            
            if all_candidates:
                best_candidate = max(all_candidates, key=lambda x: x['confidence'])
                if best_candidate['confidence'] >= self.config['manual_review_threshold']:
                    logger.info(f"⚠️ Manual review candidate: {best_candidate.get('id', 'unknown')} (confidence: {best_candidate['confidence']:.2f})")
                    return self._create_manual_review_result(best_candidate, all_candidates, document_id)
            
            # Step 5: Create new property if no matches found
            logger.info("🆕 No suitable matches found, creating new property")
            result = self._create_new_property(address_data, document_id, business_uuid, extracted_data)
            logger.info(f"🆕 New property creation result: {result}")
            return result
            
        except Exception as e:
            logger.error(f"❌ Error in enhanced property matching: {e}")
            import traceback
            logger.error(f"❌ Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'error': str(e),
                'match_type': 'error',
                'confidence': 0.0
            }
    
    def _find_exact_match(self, address_data: Dict[str, Any], business_id: str) -> Optional[Dict[str, Any]]:
        """Find exact hash match"""
        try:
            result = self.supabase.table('properties').select('*').eq(
                'address_hash', address_data['address_hash']
            ).eq('business_uuid', business_id).execute()
            
            if result.data:
                return result.data[0]
            return None
            
        except Exception as e:
            logger.error(f"Error finding exact match: {e}")
            return None
    
    def _find_fuzzy_matches(self, address_data: Dict[str, Any], business_id: str) -> List[Dict[str, Any]]:
        """Find fuzzy address matches using similarity scoring"""
        try:
            # Get all properties for business
            result = self.supabase.table('properties').select('*').eq(
                'business_uuid', business_id
            ).execute()
            
            if not result.data:
                return []
            
            candidates = []
            normalized_input = address_data['normalized_address']
            
            for property_data in result.data:
                # Calculate similarity scores
                similarity_scores = self._calculate_address_similarity(
                    normalized_input, 
                    property_data['normalized_address']
                )
                
                # Use the best similarity score
                best_score = max(similarity_scores.values())
                
                if best_score >= self.config['fuzzy_match_threshold']:
                    candidates.append({
                        **property_data,
                        'confidence': best_score,
                        'similarity_breakdown': similarity_scores
                    })
            
            # Sort by confidence descending
            candidates.sort(key=lambda x: x['confidence'], reverse=True)
            return candidates[:self.config['max_candidates']]
            
        except Exception as e:
            logger.error(f"Error finding fuzzy matches: {e}")
            return []
    
    def _find_spatial_matches(self, address_data: Dict[str, Any], business_id: str) -> List[Dict[str, Any]]:
        """Find spatial proximity matches"""
        try:
            input_lat = address_data['latitude']
            input_lon = address_data['longitude']
            
            if not input_lat or not input_lon:
                return []
            
            # Get all properties with coordinates for business
            result = self.supabase.table('properties').select('*').eq(
                'business_uuid', business_id
            ).not_.is_('latitude', 'null').not_.is_('longitude', 'null').execute()
            
            if not result.data:
                return []
            
            candidates = []
            input_point = (input_lat, input_lon)
            
            for property_data in result.data:
                prop_lat = property_data['latitude']
                prop_lon = property_data['longitude']
                
                if prop_lat and prop_lon:
                    # Calculate distance
                    prop_point = (prop_lat, prop_lon)
                    distance_meters = geodesic(input_point, prop_point).meters
                    
                    if distance_meters <= self.config['spatial_proximity_meters']:
                        # Calculate confidence based on distance
                        confidence = max(0, 1 - (distance_meters / self.config['spatial_proximity_meters']))
                        
                        candidates.append({
                            **property_data,
                            'confidence': confidence,
                            'distance_meters': distance_meters
                        })
            
            # Sort by confidence descending
            candidates.sort(key=lambda x: x['confidence'], reverse=True)
            return candidates[:self.config['max_candidates']]
            
        except Exception as e:
            logger.error(f"Error finding spatial matches: {e}")
            return []
    
    def _calculate_address_similarity(self, address1: str, address2: str) -> Dict[str, float]:
        """Calculate multiple similarity metrics between addresses"""
        similarities = {}
        
        # Basic string similarity
        similarities['string_similarity'] = SequenceMatcher(None, address1, address2).ratio()
        
        # Token-based similarity
        tokens1 = set(address1.split())
        tokens2 = set(address2.split())
        if tokens1 or tokens2:
            similarities['token_similarity'] = len(tokens1.intersection(tokens2)) / len(tokens1.union(tokens2))
        else:
            similarities['token_similarity'] = 0.0
        
        # Postcode similarity (if present)
        postcode1 = self._extract_postcode(address1)
        postcode2 = self._extract_postcode(address2)
        if postcode1 and postcode2:
            similarities['postcode_similarity'] = 1.0 if postcode1 == postcode2 else 0.0
        else:
            similarities['postcode_similarity'] = 0.0
        
        # Street name similarity
        street1 = self._extract_street_name(address1)
        street2 = self._extract_street_name(address2)
        if street1 and street2:
            similarities['street_similarity'] = SequenceMatcher(None, street1, street2).ratio()
        else:
            similarities['street_similarity'] = 0.0
        
        return similarities
    
    def _extract_postcode(self, address: str) -> Optional[str]:
        """Extract UK postcode from address"""
        postcode_pattern = r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})'
        match = re.search(postcode_pattern, address, re.IGNORECASE)
        return match.group(1).upper() if match else None
    
    def _extract_street_name(self, address: str) -> Optional[str]:
        """Extract street name from address"""
        # Remove postcode first
        address_no_postcode = re.sub(r'[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}', '', address, flags=re.IGNORECASE)
        
        # Look for street patterns
        street_patterns = [
            r'(\d+\s+[\w\s]+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|place|pl|close|crescent|cres|gardens|manor|house|farm))',
            r'([\w\s]+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|place|pl|close|crescent|cres|gardens|manor|house|farm))'
        ]
        
        for pattern in street_patterns:
            match = re.search(pattern, address_no_postcode, re.IGNORECASE)
            if match:
                return match.group(1).strip().lower()
        
        return None
    
    def _create_match_result(self, property_data: Dict[str, Any], match_type: str, confidence: float, document_id: str) -> Dict[str, Any]:
        """Create result for successful match"""
        # Handle both 'id' and 'property_id' keys
        property_id = property_data.get('id') or property_data.get('property_id')
        if not property_id:
            raise ValueError("Property data missing 'id' or 'property_id' field")
        
        # CRITICAL: If property has geocoding_status: 'manual', it has a user-set pin location
        # Documents added after property creation must NEVER alter the property pin location
        # The pin location is set once during property creation and remains fixed
        geocoding_status = property_data.get('geocoding_status')
        if geocoding_status == 'manual':
            logger.info(f"⚠️ Property {property_id} has user-set pin location (geocoding_status: 'manual'). Property pin location is immutable after creation.")
            
        return {
            'success': True,
            'property_id': property_id,
            'property': property_data,
            'match_type': match_type,
            'confidence': confidence,
            'action': 'linked_to_existing',
            'document_id': document_id
        }
    
    def _create_manual_review_result(self, best_candidate: Dict[str, Any], all_candidates: List[Dict[str, Any]], document_id: str) -> Dict[str, Any]:
        """Create result for manual review"""
        return {
            'success': False,
            'action': 'manual_review_required',
            'best_candidate': best_candidate,
            'all_candidates': all_candidates,
            'confidence': best_candidate['confidence'],
            'match_type': 'manual_review',
            'document_id': document_id,
            'message': f"Manual review required - best match has {best_candidate['confidence']:.2f} confidence"
        }
    
    def _create_new_property(self, address_data: Dict[str, Any], document_id: str, business_id: str, extracted_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create new property when no matches found"""
        try:
            property_id = str(uuid.uuid4())
            
            # Create property
            property_data = {
                'id': property_id,
                # Store normalized UUID in both legacy and new columns for compatibility
                'business_id': business_id,
                'business_uuid': business_id,
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
            
            result = self.supabase.table('properties').insert(property_data).execute()
            logger.info(f"🆕 Supabase insert result: {result}")
            
            if result.data:
                logger.info(f"✅ New property created: {property_id}")
                return {
                    'success': True,
                    'property_id': property_id,
                    'property': result.data[0],
                    'match_type': 'new_property',
                    'confidence': 1.0,
                    'action': 'created_new',
                    'document_id': document_id
                }
            else:
                logger.error(f"❌ Failed to create property - no data returned: {result}")
                raise Exception("Failed to create property in Supabase")
                
        except Exception as e:
            logger.error(f"❌ Error creating new property: {e}")
            return {
                'success': False,
                'error': str(e),
                'match_type': 'error',
                'confidence': 0.0
            }
    
    def create_document_relationship(
        self, 
        document_id: str, 
        property_id: str, 
        business_id: str, 
        address_data: Dict[str, Any], 
        match_type: str, 
        confidence: float,
        relationship_type: str = 'property_document',
        is_manual_upload: bool = False,
        address_mismatch: bool = False
    ) -> Dict[str, Any]:
        """Create document relationship with match metadata"""
        try:
            # Build relationship metadata
            relationship_metadata = {
                'match_type': match_type,
                'matching_service': 'enhanced_property_matching',
                'match_timestamp': datetime.utcnow().isoformat(),
                'address_hash': address_data.get('address_hash'),
                'geocoding_confidence': address_data.get('geocoding_confidence')
            }
            
            # Add manual upload metadata if applicable
            if is_manual_upload:
                relationship_metadata['upload_source'] = 'property_card'
                relationship_metadata['manually_linked'] = True
                if address_mismatch:
                    relationship_metadata['address_mismatch'] = True
                    relationship_metadata['document_address'] = address_data.get('original_address')
                    relationship_metadata['relationship_note'] = 'Document stored in property card but address does not match property address'
            
            relationship_data = {
                'id': str(uuid.uuid4()),
                'document_id': document_id,
                'property_id': property_id,
                'relationship_type': relationship_type,
                'address_source': address_data.get('address_source', 'extraction'),
                'confidence_score': confidence,
                'relationship_metadata': relationship_metadata,
                'created_at': datetime.utcnow().isoformat()
            }
            
            result = self.supabase.table('document_relationships').insert(relationship_data).execute()
            
            if result.data:
                logger.info(f"✅ Document relationship created: {relationship_data['id']}")
                logger.info(f"   Relationship type: {relationship_type}")
                logger.info(f"   Confidence: {confidence:.2f}")
                if is_manual_upload and address_mismatch:
                    logger.info(f"   ⚠️  Marked as unassociated (address mismatch)")
                return result.data[0]
            else:
                raise Exception("Failed to create relationship in Supabase")
                
        except Exception as e:
            logger.error(f"❌ Error creating document relationship: {e}")
            raise
    
    def get_matching_statistics(self, business_id: str) -> Dict[str, Any]:
        """Get statistics about property matching for a business"""
        try:
            # Get total properties
            properties_result = self.supabase.table('properties').select('id').eq('business_id', business_id).execute()
            total_properties = len(properties_result.data) if properties_result.data else 0
            
            # Get total relationships
            relationships_result = self.supabase.table('document_relationships').select('id').execute()
            total_relationships = len(relationships_result.data) if relationships_result.data else 0
            
            # Get match type distribution
            match_types_result = self.supabase.table('document_relationships').select('relationship_metadata').execute()
            match_type_counts = {}
            
            if match_types_result.data:
                for rel in match_types_result.data:
                    metadata = rel.get('relationship_metadata', {})
                    match_type = metadata.get('match_type', 'unknown')
                    match_type_counts[match_type] = match_type_counts.get(match_type, 0) + 1
            
            return {
                'total_properties': total_properties,
                'total_relationships': total_relationships,
                'match_type_distribution': match_type_counts,
                'average_documents_per_property': total_relationships / total_properties if total_properties > 0 else 0
            }
            
        except Exception as e:
            logger.error(f"Error getting matching statistics: {e}")
            return {
                'total_properties': 0,
                'total_relationships': 0,
                'match_type_distribution': {},
                'average_documents_per_property': 0
            }
