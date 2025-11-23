"""
SQL Query Tool for LLM to query property_details and find similar properties.
Allows LLM to dynamically construct SQL queries based on user intent.

This is a LangChain tool that the agent can invoke directly to query the database.
Supports: bedrooms, bathrooms, price, square footage, distances, property type, EPC rating, etc.
"""

import logging
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field
from langchain.tools import StructuredTool
from backend.services.supabase_client_factory import get_supabase_client
import math

logger = logging.getLogger(__name__)


class PropertyQueryInput(BaseModel):
    """Input schema for property query tool."""
    number_bedrooms: Optional[int] = Field(None, description="Exact number of bedrooms")
    number_bathrooms: Optional[int] = Field(None, description="Exact number of bathrooms")
    bedroom_min: Optional[int] = Field(None, description="Minimum number of bedrooms (for range queries)")
    bedroom_max: Optional[int] = Field(None, description="Maximum number of bedrooms (for range queries)")
    bathroom_min: Optional[int] = Field(None, description="Minimum number of bathrooms (for range queries)")
    bathroom_max: Optional[int] = Field(None, description="Maximum number of bathrooms (for range queries)")
    property_type: Optional[str] = Field(None, description="Property type: detached, semi-detached, terraced, flat, apartment, etc.")
    min_price: Optional[float] = Field(None, description="Minimum asking price in GBP")
    max_price: Optional[float] = Field(None, description="Maximum asking price in GBP")
    min_size_sqft: Optional[float] = Field(None, description="Minimum property size in square feet")
    max_size_sqft: Optional[float] = Field(None, description="Maximum property size in square feet")
    epc_rating: Optional[str] = Field(None, description="EPC rating: A, B, C, D, E, F, G")
    tenure: Optional[str] = Field(None, description="Tenure type: freehold, leasehold, etc.")
    latitude: Optional[float] = Field(None, description="Latitude for distance-based search")
    longitude: Optional[float] = Field(None, description="Longitude for distance-based search")
    max_distance_km: Optional[float] = Field(None, description="Maximum distance in kilometers from the given coordinates")
    limit: int = Field(50, description="Maximum number of results to return (default: 50, max: 100)")


class SQLQueryTool:
    """
    Tool that allows LLM to query property_details table with SQL-like queries.
    Supports similarity-based searches (ranges, fuzzy matching).
    """
    
    def __init__(self, business_id: str):
        self.supabase = get_supabase_client()
        self.business_id = business_id
    
    def query_properties(
        self,
        number_bedrooms: Optional[int] = None,
        number_bathrooms: Optional[int] = None,
        bedroom_min: Optional[int] = None,
        bedroom_max: Optional[int] = None,
        bathroom_min: Optional[int] = None,
        bathroom_max: Optional[int] = None,
        property_type: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        min_size_sqft: Optional[float] = None,
        max_size_sqft: Optional[float] = None,
        epc_rating: Optional[str] = None,
        tenure: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        max_distance_km: Optional[float] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Query property_details table with flexible criteria.
        Supports exact matches, ranges, and distance-based searches.
        
        Args:
            number_bedrooms: Exact bedroom count
            number_bathrooms: Exact bathroom count
            bedroom_min/bedroom_max: Bedroom range
            bathroom_min/bathroom_max: Bathroom range
            property_type: Filter by property type
            min_price/max_price: Price range in GBP
            min_size_sqft/max_size_sqft: Size range in square feet
            epc_rating: EPC rating filter (A-G)
            tenure: Tenure type filter
            latitude/longitude: Coordinates for distance search
            max_distance_km: Maximum distance in kilometers
            limit: Max results to return (default 50, max 100)
            
        Returns:
            List of property_details records with property_id and distance (if location provided)
        """
        try:
            # Select all relevant fields including location
            query = self.supabase.table('property_details')\
                .select('property_id, number_bedrooms, number_bathrooms, property_type, size_sqft, asking_price, sold_price, rent_pcm, epc_rating, tenure, latitude, longitude, property_address')
            
            # Apply filters
            if number_bedrooms is not None:
                query = query.eq('number_bedrooms', number_bedrooms)
            elif bedroom_min is not None or bedroom_max is not None:
                if bedroom_min is not None:
                    query = query.gte('number_bedrooms', bedroom_min)
                if bedroom_max is not None:
                    query = query.lte('number_bedrooms', bedroom_max)
            
            if number_bathrooms is not None:
                query = query.eq('number_bathrooms', number_bathrooms)
            elif bathroom_min is not None or bathroom_max is not None:
                if bathroom_min is not None:
                    query = query.gte('number_bathrooms', bathroom_min)
                if bathroom_max is not None:
                    query = query.lte('number_bathrooms', bathroom_max)
            
            if property_type:
                # Case-insensitive partial match for property type
                query = query.ilike('property_type', f'%{property_type}%')
            
            if min_price is not None:
                query = query.gte('asking_price', min_price)
            if max_price is not None:
                query = query.lte('asking_price', max_price)
            
            if min_size_sqft is not None:
                query = query.gte('size_sqft', min_size_sqft)
            if max_size_sqft is not None:
                query = query.lte('size_sqft', max_size_sqft)
            
            if epc_rating:
                query = query.eq('epc_rating', epc_rating.upper())
            
            if tenure:
                query = query.ilike('tenure', f'%{tenure}%')
            
            # Limit results (cap at 100)
            limit = min(limit, 100)
            query = query.limit(limit)
            
            result = query.execute()
            properties = result.data if result.data else []
            
            # Calculate distances if location provided
            if latitude is not None and longitude is not None and max_distance_km is not None:
                filtered_properties = []
                for prop in properties:
                    if prop.get('latitude') and prop.get('longitude'):
                        distance_km = self._calculate_distance(
                            latitude, longitude,
                            prop['latitude'], prop['longitude']
                        )
                        if distance_km <= max_distance_km:
                            prop['distance_km'] = round(distance_km, 2)
                            filtered_properties.append(prop)
                properties = filtered_properties
                # Sort by distance
                properties.sort(key=lambda x: x.get('distance_km', float('inf')))
            
            logger.info(f"SQL query tool found {len(properties)} properties")
            return properties
            
        except Exception as e:
            logger.error(f"SQL query tool error: {e}", exc_info=True)
            return []
    
    def _calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """
        Calculate distance between two coordinates using Haversine formula.
        Returns distance in kilometers.
        """
        # Radius of Earth in kilometers
        R = 6371.0
        
        # Convert to radians
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)
        
        # Haversine formula
        dlat = lat2_rad - lat1_rad
        dlon = lon2_rad - lon1_rad
        
        a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        distance = R * c
        return distance
    
    def find_similar_properties(
        self,
        target_bedrooms: int,
        target_bathrooms: Optional[int] = None,
        similarity_tolerance: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Find properties similar to target criteria (not exact matches).
        Uses range-based search: target ± tolerance.
        
        Args:
            target_bedrooms: Target bedroom count
            target_bathrooms: Target bathroom count (optional)
            similarity_tolerance: ± range for similarity (default 1)
            
        Returns:
            List of similar properties
        """
        return self.query_properties(
            bedroom_min=max(1, target_bedrooms - similarity_tolerance),
            bedroom_max=target_bedrooms + similarity_tolerance,
            bathroom_min=max(1, target_bathrooms - similarity_tolerance) if target_bathrooms else None,
            bathroom_max=target_bathrooms + similarity_tolerance if target_bathrooms else None,
            limit=50
        )


def create_property_query_tool(business_id: str) -> StructuredTool:
    """
    Create a LangChain StructuredTool for property queries.
    This tool can be used by LLM agents to query the property database.
    
    Args:
        business_id: Business UUID for filtering properties
        
    Returns:
        LangChain StructuredTool instance
    """
    tool_instance = SQLQueryTool(business_id=business_id)
    
    def query_properties_tool(
        number_bedrooms: Optional[int] = None,
        number_bathrooms: Optional[int] = None,
        bedroom_min: Optional[int] = None,
        bedroom_max: Optional[int] = None,
        bathroom_min: Optional[int] = None,
        bathroom_max: Optional[int] = None,
        property_type: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        min_size_sqft: Optional[float] = None,
        max_size_sqft: Optional[float] = None,
        epc_rating: Optional[str] = None,
        tenure: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        max_distance_km: Optional[float] = None,
        limit: int = 50
    ) -> str:
        """
        Query properties in the database based on various criteria.
        
        Use this tool when the user asks about:
        - Properties with specific bedroom/bathroom counts
        - Properties within a price range
        - Properties of a certain size (square footage)
        - Properties near a location (requires latitude, longitude, max_distance_km)
        - Properties by type (detached, semi-detached, terraced, flat, etc.)
        - Properties with specific EPC ratings
        - Properties by tenure type
        
        Examples:
        - "Find properties with 5 bedrooms" → number_bedrooms=5
        - "Properties between £500k and £1M" → min_price=500000, max_price=1000000
        - "Properties over 2000 sqft" → min_size_sqft=2000
        - "Properties within 5km of London" → latitude=51.5074, longitude=-0.1278, max_distance_km=5
        - "Detached properties" → property_type="detached"
        
        Returns a JSON string with property details.
        """
        results = tool_instance.query_properties(
            number_bedrooms=number_bedrooms,
            number_bathrooms=number_bathrooms,
            bedroom_min=bedroom_min,
            bedroom_max=bedroom_max,
            bathroom_min=bathroom_min,
            bathroom_max=bathroom_max,
            property_type=property_type,
            min_price=min_price,
            max_price=max_price,
            min_size_sqft=min_size_sqft,
            max_size_sqft=max_size_sqft,
            epc_rating=epc_rating,
            tenure=tenure,
            latitude=latitude,
            longitude=longitude,
            max_distance_km=max_distance_km,
            limit=limit
        )
        
        import json
        return json.dumps({
            "count": len(results),
            "properties": results
        }, indent=2)
    
    return StructuredTool.from_function(
        func=query_properties_tool,
        name="query_properties",
        description="""Query the property database to find properties matching specific criteria.
        
Use this tool when users ask about:
- Properties with specific bedroom/bathroom counts (e.g., "5 bedrooms", "3-4 bedrooms")
- Properties within price ranges (e.g., "under £500k", "between £1M and £2M")
- Properties by size (e.g., "over 2000 sqft", "between 1500-2500 sqft")
- Properties near locations (provide latitude, longitude, and max_distance_km)
- Properties by type (detached, semi-detached, terraced, flat, apartment, etc.)
- Properties with specific EPC ratings (A, B, C, D, E, F, G)
- Properties by tenure (freehold, leasehold)

For range queries, use bedroom_min/bedroom_max or bathroom_min/bathroom_max.
For exact matches, use number_bedrooms or number_bathrooms.

For distance-based searches, you need:
- latitude: Decimal degrees (e.g., 51.5074 for London)
- longitude: Decimal degrees (e.g., -0.1278 for London)
- max_distance_km: Maximum distance in kilometers

Returns a JSON object with property details including property_id, bedrooms, bathrooms, price, size, location, etc.""",
        args_schema=PropertyQueryInput
    )

