from ..models import db
from sqlalchemy import or_, and_, func
import json
import logging
from typing import List, Dict, Any, Optional
import os
# Cassandra imports removed - using Supabase only
import uuid
from supabase import create_client, Client

logger = logging.getLogger(__name__)

class PropertySearchService:
    def __init__(self):
        """Initialize with Supabase connection only"""
        # AstraDB session removed - using Supabase only
        self.supabase_client = None
    
    # AstraDB session method removed - using Supabase only
    
    def _get_supabase_client(self) -> Client:
        """Get or create Supabase client"""
        if not self.supabase_client:
            try:
                self.supabase_client = create_client(
                    os.environ['SUPABASE_URL'],
                    os.environ['SUPABASE_SERVICE_KEY']
                )
                logger.info("✅ Connected to Supabase")
            except Exception as e:
                logger.error(f"❌ Failed to connect to Supabase: {e}")
                raise
        return self.supabase_client
    
    def search_properties(self, business_id: str, query: str = "", filters: dict = None) -> List[Dict[str, Any]]:
        """
        Search properties using Supabase (primary), PostgreSQL (fallback).
        
        Args:
            business_id: Business identifier for multi-tenancy
            query: Text search query (optional - returns ALL if empty)
            filters: Additional filters (price, bedrooms, etc.)
            
        Returns:
            List of property dictionaries with full geocoded data
        """
        logger.info(f"🔍 PropertySearchService: Searching properties for business '{business_id}'")
        logger.info(f"   Query: '{query}', Filters: {filters}")
        
        # Try Supabase first (primary source)
        try:
            logger.info("🆕 Attempting Supabase search...")
            return self._search_supabase(business_id, query, filters)
        except Exception as e:
            logger.warning(f"⚠️ Supabase search failed: {e}")
            
            # Fallback to PostgreSQL
            logger.warning("🔄 Falling back to PostgreSQL...")
            return self._search_postgresql_fallback(business_id, query, filters)
    
    def _search_supabase(self, business_id: str, query: str, filters: dict) -> List[Dict[str, Any]]:
        """Search properties using Supabase - now using property_details table"""
        supabase = self._get_supabase_client()
        
        # Build the query - get properties first, then get details separately
        query_builder = supabase.table('properties').select('*').eq('business_id', business_id)
        
        # Apply geocoding filter (only successfully geocoded properties)
        query_builder = query_builder.eq('geocoding_status', 'success')
        query_builder = query_builder.not_.is_('latitude', 'null')
        query_builder = query_builder.not_.is_('longitude', 'null')
        
        # Apply text search if provided
        if query and query.strip():
            # Search in property address, type, and amenities
            query_builder = query_builder.or_(
                f'formatted_address.ilike.%{query}%,'
                f'normalized_address.ilike.%{query}%'
            )
        
        # Execute query
        result = query_builder.execute()
        properties = result.data
        
        # Convert to consistent format - get property details separately
        formatted_properties = []
        for prop in properties:
            # Get property details separately
            details_result = supabase.table('property_details').select('*').eq('property_id', prop['id']).execute()
            details = details_result.data[0] if details_result.data else {}
            
            prop_dict = {
                'id': str(prop['id']),
                'property_address': details.get('property_address') or prop.get('formatted_address'),
                'property_type': details.get('property_type'),
                'number_bedrooms': details.get('number_bedrooms'),
                'number_bathrooms': details.get('number_bathrooms'),
                'size_sqft': float(details['size_sqft']) if details.get('size_sqft') else None,
                'size_unit': details.get('size_unit'),
                'sold_price': float(details['sold_price']) if details.get('sold_price') else None,
                'asking_price': float(details['asking_price']) if details.get('asking_price') else None,
                'rent_pcm': float(details['rent_pcm']) if details.get('rent_pcm') else None,
                'price_per_sqft': float(details['price_per_sqft']) if details.get('price_per_sqft') else None,
                'yield_percentage': float(details['yield_percentage']) if details.get('yield_percentage') else None,
                'tenure': details.get('tenure'),
                'listed_building_grade': details.get('listed_building_grade'),
                'transaction_date': str(details['transaction_date']) if details.get('transaction_date') else None,
                'sold_date': str(details['sold_date']) if details.get('sold_date') else None,
                'rented_date': str(details['rented_date']) if details.get('rented_date') else None,
                'leased_date': str(details['leased_date']) if details.get('leased_date') else None,
                'epc_rating': details.get('epc_rating'),
                'condition': details.get('condition'),
                'other_amenities': details.get('other_amenities'),
                'lease_details': details.get('lease_details'),
                'days_on_market': details.get('days_on_market'),
                'notes': details.get('notes'),
                'latitude': float(prop['latitude']) if prop.get('latitude') else None,
                'longitude': float(prop['longitude']) if prop.get('longitude') else None,
                'geocoded_address': details.get('geocoded_address') or prop.get('formatted_address'),
                'geocoding_confidence': float(prop['geocoding_confidence']) if prop.get('geocoding_confidence') else 0.0,
                'geocoding_status': prop.get('geocoding_status'),
                'source_document_id': str(details['source_document_id']) if details.get('source_document_id') else None
            }
            formatted_properties.append(prop_dict)
        
        logger.info(f"📊 Supabase Results:")
        logger.info(f"   Total properties: {len(formatted_properties)}")
        
        # Price analysis
        if formatted_properties:
            price_analysis = {
                'has_sold_price': sum(1 for p in formatted_properties if p.get('sold_price') and p['sold_price'] > 0),
                'has_rent_pcm': sum(1 for p in formatted_properties if p.get('rent_pcm') and p['rent_pcm'] > 0),
                'has_asking_price': sum(1 for p in formatted_properties if p.get('asking_price') and p['asking_price'] > 0),
                'no_price_data': sum(1 for p in formatted_properties if not (p.get('sold_price') or p.get('rent_pcm') or p.get('asking_price')))
            }
            
            logger.info(f"🔍 Supabase Price Analysis:")
            logger.info(f"   Properties with sold_price: {price_analysis['has_sold_price']}")
            logger.info(f"   Properties with rent_pcm: {price_analysis['has_rent_pcm']}")
            logger.info(f"   Properties with asking_price: {price_analysis['has_asking_price']}")
            logger.info(f"   Properties with no price data: {price_analysis['no_price_data']}")
        
        return formatted_properties
    
    # AstraDB search method removed - using Supabase only
    
    def _search_postgresql_fallback(self, business_id: str, query: str, filters: dict) -> List[Dict[str, Any]]:
        """Fallback method - ExtractedProperty model removed, use Supabase only"""
        try:
            logger.warning("🔄 PostgreSQL fallback not available - ExtractedProperty model removed")
            logger.warning("   All property data is now stored in Supabase property_details table")
            return []
            
        except Exception as e:
            logger.error(f"❌ Fallback failed: {e}")
            return []
    
    def analyze_property_query(self, query: str, previous_results: List[Dict] = None) -> Dict[str, Any]:
        """
        Analyze property query to refine search.
        
        Args:
            query: User's search query
            previous_results: Previous search results
            
        Returns:
            Analysis results with suggestions
        """
        logger.info(f"PropertySearchService: Analyzing property query: {query}")
        
        try:
            # Use LLMService to analyze the query
            from .llm_service import LLMService
            llm = LLMService()
            analysis = llm.analyze_query(query, [])
            return json.loads(analysis)
        except Exception as e:
            logger.warning(f"PropertySearchService: LLM analysis failed, using fallback: {e}")
            # Fallback analysis
            return {
                "intent": "property_search",
                "extracted_criteria": {},
                "confidence": 0.5,
                "suggested_response": "I can help you find properties. Please specify your requirements.",
                "needs_clarification": True,
                "missing_information": ["location", "property_type"]
            }
    
    def find_comparables(self, property_id: str, criteria: dict = None) -> List[Dict[str, Any]]:
        """
        Find comparable properties using similarity matching.
        
        Args:
            property_id: UUID of the source property
            criteria: Comparison criteria (radius, bedroom tolerance, etc.)
            
        Returns:
            List of comparable property dictionaries
        """
        logger.info(f"PropertySearchService: Finding comparables for {property_id} with criteria {criteria}")
        
        try:
            # Get the source property from Supabase
            from supabase import create_client
            supabase = create_client(
                os.environ['SUPABASE_URL'],
                os.environ['SUPABASE_SERVICE_KEY']
            )
            
            source_result = supabase.table('property_details').select('*').eq('property_id', property_id).execute()
            if not source_result.data:
                logger.warning(f"PropertySearchService: Property {property_id} not found")
                return []
            
            source_prop = source_result.data[0]
            
            # Get all properties for the same business from Supabase
            # First get properties, then get their details
            properties_result = supabase.table('properties').select('*').eq('business_id', source_prop.get('business_id', '')).execute()
            all_properties = []
            if properties_result.data:
                for prop in properties_result.data:
                    details_result = supabase.table('property_details').select('*').eq('property_id', prop['id']).execute()
                    if details_result.data:
                        all_properties.extend(details_result.data)
            
            # Filter out the source property
            comparables = [prop for prop in all_properties if prop['property_id'] != property_id]
            
            # Apply similarity criteria
            filtered_comparables = []
            for comp in comparables:
                # Check bedroom tolerance
                if source_prop.get('number_bedrooms') and comp.get('number_bedrooms'):
                    bedroom_tolerance = criteria.get('bedroom_tolerance', 1) if criteria else 1
                    if abs(comp['number_bedrooms'] - source_prop['number_bedrooms']) > bedroom_tolerance:
                        continue
                
                # Check bathroom tolerance
                if source_prop.get('number_bathrooms') and comp.get('number_bathrooms'):
                    bathroom_tolerance = criteria.get('bathroom_tolerance', 0.5) if criteria else 0.5
                    if abs(comp['number_bathrooms'] - source_prop['number_bathrooms']) > bathroom_tolerance:
                        continue
                
                # Check price range
                reference_price = source_prop.get('sold_price') or source_prop.get('asking_price')
                comp_price = comp.get('sold_price') or comp.get('asking_price')
                if reference_price and comp_price:
                    price_tolerance = criteria.get('price_tolerance_percent', 20) if criteria else 20
                    price_min = reference_price * (1 - price_tolerance / 100)
                    price_max = reference_price * (1 + price_tolerance / 100)
                    if not (price_min <= comp_price <= price_max):
                        continue
                
                filtered_comparables.append(comp)
            
            # Calculate similarity scores and sort
            limit = criteria.get('limit', 10) if criteria else 10
            comparables = []
            for prop in filtered_comparables[:limit]:
                prop["similarity_score"] = self._calculate_similarity_score(source_prop, prop)
                comparables.append(prop)
            
            # Sort by similarity score
            comparables.sort(key=lambda x: x['similarity_score'], reverse=True)
            
            logger.info(f"PropertySearchService: Found {len(comparables)} comparable properties")
            return comparables
            
        except Exception as e:
            logger.error(f"PropertySearchService: Error finding comparables: {e}")
            return []
    
    def _calculate_similarity_score(self, source_prop: dict, comp_prop: dict) -> float:
        """
        Calculate similarity score between two properties.
        
        Args:
            source_prop: Source property
            comp_prop: Comparable property
            
        Returns:
            Similarity score (0.0 to 1.0)
        """
        score = 0.0
        factors = 0
        
        # Bedroom similarity (25% weight)
        if source_prop.get('number_bedrooms') and comp_prop.get('number_bedrooms'):
            bedroom_diff = abs(source_prop['number_bedrooms'] - comp_prop['number_bedrooms'])
            bedroom_score = max(0, 1 - (bedroom_diff / 3))  # Perfect match = 1, 3+ diff = 0
            score += bedroom_score * 0.25
            factors += 1
        
        # Bathroom similarity (20% weight)
        if source_prop.get('number_bathrooms') and comp_prop.get('number_bathrooms'):
            bathroom_diff = abs(source_prop['number_bathrooms'] - comp_prop['number_bathrooms'])
            bathroom_score = max(0, 1 - (bathroom_diff / 2))  # Perfect match = 1, 2+ diff = 0
            score += bathroom_score * 0.20
            factors += 1
        
        # Size similarity (25% weight)
        if source_prop.get('size_sqft') and comp_prop.get('size_sqft'):
            size_diff = abs(source_prop['size_sqft'] - comp_prop['size_sqft']) / source_prop['size_sqft']
            size_score = max(0, 1 - size_diff)
            score += size_score * 0.25
            factors += 1
        
        # Price similarity (30% weight)
        source_price = source_prop.get('sold_price') or source_prop.get('asking_price')
        comp_price = comp_prop.get('sold_price') or comp_prop.get('asking_price')
        if source_price and comp_price:
            price_diff = abs(source_price - comp_price) / source_price
            price_score = max(0, 1 - price_diff)
            score += price_score * 0.30
            factors += 1
        
        # Normalize by number of factors considered
        if factors > 0:
            return score / (score / factors if score > 0 else 1)
        else:
            return 0.5  # Default score if no factors available
