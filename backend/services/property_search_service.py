from ..models import ExtractedProperty, db
from sqlalchemy import or_, and_, func
import json
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class PropertySearchService:
    def search_properties(self, business_id: str, query: str = "", filters: dict = None) -> List[Dict[str, Any]]:
        """
        Search properties in PostgreSQL ExtractedProperty table.
        
        Args:
            business_id: Business identifier for multi-tenancy
            query: Text search query
            filters: Additional filters (price, bedrooms, etc.)
            
        Returns:
            List of property dictionaries
        """
        logger.info(f"PropertySearchService: Searching properties for business {business_id} with query '{query}' and filters {filters}")
        
        try:
            # Base query filtered by business
            base_query = ExtractedProperty.query.filter(
                ExtractedProperty.business_id == business_id
            )
            
            # Text search across multiple fields
            if query and query.strip():
                search_filter = or_(
                    ExtractedProperty.property_address.ilike(f'%{query}%'),
                    ExtractedProperty.property_type.ilike(f'%{query}%'),
                    ExtractedProperty.notes.ilike(f'%{query}%'),
                    ExtractedProperty.other_amenities.ilike(f'%{query}%')
                )
                base_query = base_query.filter(search_filter)
            
            # Apply filters
            if filters:
                # Price filters
                if filters.get('min_price'):
                    base_query = base_query.filter(
                        or_(
                            ExtractedProperty.sold_price >= filters['min_price'],
                            ExtractedProperty.asking_price >= filters['min_price']
                        )
                    )
                if filters.get('max_price'):
                    base_query = base_query.filter(
                        or_(
                            ExtractedProperty.sold_price <= filters['max_price'],
                            ExtractedProperty.asking_price <= filters['max_price']
                        )
                    )
                
                # Bedroom filters
                if filters.get('bedrooms'):
                    if isinstance(filters['bedrooms'], int):
                        base_query = base_query.filter(
                            ExtractedProperty.number_bedrooms >= filters['bedrooms']
                        )
                    elif isinstance(filters['bedrooms'], dict):
                        if filters['bedrooms'].get('min'):
                            base_query = base_query.filter(
                                ExtractedProperty.number_bedrooms >= filters['bedrooms']['min']
                            )
                        if filters['bedrooms'].get('max'):
                            base_query = base_query.filter(
                                ExtractedProperty.number_bedrooms <= filters['bedrooms']['max']
                            )
                
                # Bathroom filters
                if filters.get('bathrooms'):
                    if isinstance(filters['bathrooms'], (int, float)):
                        base_query = base_query.filter(
                            ExtractedProperty.number_bathrooms >= filters['bathrooms']
                        )
                    elif isinstance(filters['bathrooms'], dict):
                        if filters['bathrooms'].get('min'):
                            base_query = base_query.filter(
                                ExtractedProperty.number_bathrooms >= filters['bathrooms']['min']
                            )
                        if filters['bathrooms'].get('max'):
                            base_query = base_query.filter(
                                ExtractedProperty.number_bathrooms <= filters['bathrooms']['max']
                            )
                
                # Property type filter
                if filters.get('property_type'):
                    base_query = base_query.filter(
                        ExtractedProperty.property_type.ilike(f'%{filters["property_type"]}%')
                    )
                
                # Location radius filter (if coordinates provided)
                if filters.get('location') and filters.get('radius_km'):
                    # This would require implementing distance calculation
                    # For now, we'll just filter by geocoded address containing the location
                    base_query = base_query.filter(
                        ExtractedProperty.geocoded_address.ilike(f'%{filters["location"]}%')
                    )
            
            # Order by most recent first
            base_query = base_query.order_by(ExtractedProperty.extracted_at.desc())
            
            # Limit results
            limit = filters.get('limit', 50) if filters else 50
            results = base_query.limit(limit).all()
            
            logger.info(f"PropertySearchService: Found {len(results)} properties")
            return [prop.serialize() for prop in results]
            
        except Exception as e:
            logger.error(f"PropertySearchService: Error searching properties: {e}")
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
            # Get the source property
            source_prop = ExtractedProperty.query.get(property_id)
            if not source_prop:
                logger.warning(f"PropertySearchService: Property {property_id} not found")
                return []
            
            # Build comparable search query
            query = ExtractedProperty.query.filter(
                ExtractedProperty.business_id == source_prop.business_id,
                ExtractedProperty.id != property_id
            )
            
            # Apply similarity criteria
            if criteria:
                # Bedroom tolerance (default ±1)
                bedroom_tolerance = criteria.get('bedroom_tolerance', 1)
                if source_prop.number_bedrooms:
                    query = query.filter(
                        ExtractedProperty.number_bedrooms.between(
                            max(1, source_prop.number_bedrooms - bedroom_tolerance),
                            source_prop.number_bedrooms + bedroom_tolerance
                        )
                    )
                
                # Bathroom tolerance (default ±0.5)
                bathroom_tolerance = criteria.get('bathroom_tolerance', 0.5)
                if source_prop.number_bathrooms:
                    query = query.filter(
                        ExtractedProperty.number_bathrooms.between(
                            max(0, source_prop.number_bathrooms - bathroom_tolerance),
                            source_prop.number_bathrooms + bathroom_tolerance
                        )
                    )
                
                # Price range (default ±20%)
                price_tolerance = criteria.get('price_tolerance_percent', 20)
                reference_price = source_prop.sold_price or source_prop.asking_price
                if reference_price:
                    price_min = reference_price * (1 - price_tolerance / 100)
                    price_max = reference_price * (1 + price_tolerance / 100)
                    query = query.filter(
                        or_(
                            and_(
                                ExtractedProperty.sold_price >= price_min,
                                ExtractedProperty.sold_price <= price_max
                            ),
                            and_(
                                ExtractedProperty.asking_price >= price_min,
                                ExtractedProperty.asking_price <= price_max
                            )
                        )
                    )
            else:
                # Default criteria if none provided
                if source_prop.number_bedrooms:
                    query = query.filter(
                        ExtractedProperty.number_bedrooms.between(
                            max(1, source_prop.number_bedrooms - 1),
                            source_prop.number_bedrooms + 1
                        )
                    )
            
            # Order by similarity (for now, just by date)
            query = query.order_by(ExtractedProperty.extracted_at.desc())
            
            # Limit results
            limit = criteria.get('limit', 10) if criteria else 10
            results = query.limit(limit).all()
            
            # Convert to serializable format with similarity scores
            comparables = []
            for prop in results:
                prop_dict = prop.serialize()
                prop_dict["similarity_score"] = self._calculate_similarity_score(source_prop, prop)
                comparables.append(prop_dict)
            
            # Sort by similarity score
            comparables.sort(key=lambda x: x['similarity_score'], reverse=True)
            
            logger.info(f"PropertySearchService: Found {len(comparables)} comparable properties")
            return comparables
            
        except Exception as e:
            logger.error(f"PropertySearchService: Error finding comparables: {e}")
            return []
    
    def _calculate_similarity_score(self, source_prop: ExtractedProperty, comp_prop: ExtractedProperty) -> float:
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
        if source_prop.number_bedrooms and comp_prop.number_bedrooms:
            bedroom_diff = abs(source_prop.number_bedrooms - comp_prop.number_bedrooms)
            bedroom_score = max(0, 1 - (bedroom_diff / 3))  # Perfect match = 1, 3+ diff = 0
            score += bedroom_score * 0.25
            factors += 1
        
        # Bathroom similarity (20% weight)
        if source_prop.number_bathrooms and comp_prop.number_bathrooms:
            bathroom_diff = abs(source_prop.number_bathrooms - comp_prop.number_bathrooms)
            bathroom_score = max(0, 1 - (bathroom_diff / 2))  # Perfect match = 1, 2+ diff = 0
            score += bathroom_score * 0.20
            factors += 1
        
        # Size similarity (25% weight)
        if source_prop.size_sqft and comp_prop.size_sqft:
            size_diff = abs(source_prop.size_sqft - comp_prop.size_sqft) / source_prop.size_sqft
            size_score = max(0, 1 - size_diff)
            score += size_score * 0.25
            factors += 1
        
        # Price similarity (30% weight)
        source_price = source_prop.sold_price or source_prop.asking_price
        comp_price = comp_prop.sold_price or comp_prop.asking_price
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
