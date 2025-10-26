"""
Manual Property Matching Review Service
Handles manual review of ambiguous property matches
"""
import os
import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from supabase import create_client, Client

logger = logging.getLogger(__name__)

class ManualPropertyReviewService:
    """Service for managing manual review of property matches"""
    
    def __init__(self):
        """Initialize Supabase client"""
        try:
            self.supabase = create_client(
                os.environ['SUPABASE_URL'],
                os.environ['SUPABASE_SERVICE_KEY']
            )
            logger.info("✅ ManualPropertyReviewService initialized")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase client: {e}")
            raise
    
    def create_review_request(
        self, 
        document_id: str, 
        business_id: str, 
        address_data: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        extracted_data: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Create a manual review request for ambiguous property matches
        
        Args:
            document_id: Document requiring review
            business_id: Business identifier
            address_data: Address data from document
            candidates: List of candidate properties
            extracted_data: Extracted property data
            
        Returns:
            Review request result
        """
        try:
            review_id = str(uuid.uuid4())
            
            review_data = {
                'id': review_id,
                'document_id': document_id,
                'business_id': business_id,
                'status': 'pending',
                'address_data': address_data,
                'candidates': candidates,
                'extracted_data': extracted_data,
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
            # Store in manual_review_requests table (you'll need to create this table)
            result = self.supabase.table('manual_review_requests').insert(review_data).execute()
            
            if result.data:
                logger.info(f"✅ Manual review request created: {review_id}")
                return {
                    'success': True,
                    'review_id': review_id,
                    'review_request': result.data[0],
                    'message': 'Manual review request created successfully'
                }
            else:
                raise Exception("Failed to create review request")
                
        except Exception as e:
            logger.error(f"❌ Error creating review request: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def get_pending_reviews(self, business_id: str) -> List[Dict[str, Any]]:
        """Get all pending manual reviews for a business"""
        try:
            result = self.supabase.table('manual_review_requests').select('*').eq(
                'business_id', business_id
            ).eq('status', 'pending').order('created_at', desc=True).execute()
            
            return result.data if result.data else []
            
        except Exception as e:
            logger.error(f"Error getting pending reviews: {e}")
            return []
    
    def process_review_decision(
        self, 
        review_id: str, 
        decision: str, 
        selected_property_id: Optional[str] = None,
        reviewer_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a manual review decision
        
        Args:
            review_id: Review request ID
            decision: 'link_to_existing', 'create_new', or 'reject'
            selected_property_id: Property ID if linking to existing
            reviewer_notes: Optional notes from reviewer
            
        Returns:
            Processing result
        """
        try:
            # Get the review request
            review_result = self.supabase.table('manual_review_requests').select('*').eq('id', review_id).execute()
            
            if not review_result.data:
                return {'success': False, 'error': 'Review request not found'}
            
            review_request = review_result.data[0]
            document_id = review_request['document_id']
            business_id = review_request['business_id']
            address_data = review_request['address_data']
            extracted_data = review_request['extracted_data']
            
            # Process based on decision
            if decision == 'link_to_existing' and selected_property_id:
                # Link document to existing property
                result = self._link_to_existing_property(
                    document_id, selected_property_id, business_id, address_data
                )
                
            elif decision == 'create_new':
                # Create new property
                result = self._create_new_property_from_review(
                    document_id, business_id, address_data, extracted_data
                )
                
            elif decision == 'reject':
                # Mark as rejected
                result = {'success': True, 'action': 'rejected'}
                
            else:
                return {'success': False, 'error': 'Invalid decision or missing property ID'}
            
            # Update review request status
            update_data = {
                'status': 'completed',
                'decision': decision,
                'selected_property_id': selected_property_id,
                'reviewer_notes': reviewer_notes,
                'completed_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
            self.supabase.table('manual_review_requests').update(update_data).eq('id', review_id).execute()
            
            logger.info(f"✅ Review decision processed: {review_id} -> {decision}")
            return {
                'success': True,
                'review_id': review_id,
                'decision': decision,
                'result': result
            }
            
        except Exception as e:
            logger.error(f"❌ Error processing review decision: {e}")
            return {'success': False, 'error': str(e)}
    
    def _link_to_existing_property(
        self, 
        document_id: str, 
        property_id: str, 
        business_id: str, 
        address_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Link document to existing property"""
        try:
            from .enhanced_property_matching_service import EnhancedPropertyMatchingService
            matching_service = EnhancedPropertyMatchingService()
            
            # Create document relationship
            relationship_result = matching_service.create_document_relationship(
                document_id=document_id,
                property_id=property_id,
                business_id=business_id,
                address_data=address_data,
                match_type='manual_review',
                confidence=1.0  # Manual decisions have full confidence
            )
            
            return {
                'success': True,
                'action': 'linked_to_existing',
                'property_id': property_id,
                'relationship': relationship_result
            }
            
        except Exception as e:
            logger.error(f"Error linking to existing property: {e}")
            return {'success': False, 'error': str(e)}
    
    def _create_new_property_from_review(
        self, 
        document_id: str, 
        business_id: str, 
        address_data: Dict[str, Any],
        extracted_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create new property from manual review"""
        try:
            from .supabase_property_hub_service import SupabasePropertyHubService
            property_hub_service = SupabasePropertyHubService()
            
            # Create new property
            result = property_hub_service.create_property_with_relationships(
                address_data=address_data,
                document_id=document_id,
                business_id=business_id,
                extracted_data=extracted_data
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Error creating new property from review: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_review_statistics(self, business_id: str) -> Dict[str, Any]:
        """Get statistics about manual reviews"""
        try:
            # Get total reviews
            total_result = self.supabase.table('manual_review_requests').select('id').eq('business_id', business_id).execute()
            total_reviews = len(total_result.data) if total_result.data else 0
            
            # Get pending reviews
            pending_result = self.supabase.table('manual_review_requests').select('id').eq('business_id', business_id).eq('status', 'pending').execute()
            pending_reviews = len(pending_result.data) if pending_result.data else 0
            
            # Get decision distribution
            decisions_result = self.supabase.table('manual_review_requests').select('decision').eq('business_id', business_id).eq('status', 'completed').execute()
            decision_counts = {}
            
            if decisions_result.data:
                for review in decisions_result.data:
                    decision = review.get('decision', 'unknown')
                    decision_counts[decision] = decision_counts.get(decision, 0) + 1
            
            return {
                'total_reviews': total_reviews,
                'pending_reviews': pending_reviews,
                'completed_reviews': total_reviews - pending_reviews,
                'decision_distribution': decision_counts
            }
            
        except Exception as e:
            logger.error(f"Error getting review statistics: {e}")
            return {
                'total_reviews': 0,
                'pending_reviews': 0,
                'completed_reviews': 0,
                'decision_distribution': {}
            }
