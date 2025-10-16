from ..models import ExtractedProperty, db
from sqlalchemy import or_, and_, func
import json
import logging
from typing import List, Dict, Any, Optional
import os
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
import uuid

logger = logging.getLogger(__name__)

class PropertySearchService:
    def __init__(self):
        """Initialize with AstraDB Tabular connection"""
        self.session = None
    
    def _get_astra_session(self):
        """Get or create AstraDB Tabular session"""
        if not self.session:
            try:
                bundle_path = os.environ['ASTRA_DB_TABULAR_SECURE_CONNECT_BUNDLE_PATH']
                token = os.environ['ASTRA_DB_TABULAR_APPLICATION_TOKEN']
                
                if not os.path.exists(bundle_path):
                    raise ValueError(f"AstraDB bundle not found: {bundle_path}")
                
                auth_provider = PlainTextAuthProvider('token', token)
                cluster = Cluster(
                    cloud={'secure_connect_bundle': bundle_path}, 
                    auth_provider=auth_provider
                )
                self.session = cluster.connect()
                self.session.set_keyspace(os.environ['ASTRA_DB_TABULAR_KEYSPACE'])
                
                logger.info("✅ Connected to AstraDB Tabular")
            except Exception as e:
                logger.error(f"❌ Failed to connect to AstraDB Tabular: {e}")
                raise
        
        return self.session
    
    def search_properties(self, business_id: str, query: str = "", filters: dict = None) -> List[Dict[str, Any]]:
        """
        Search properties in AstraDB Tabular store (primary source of truth).
        
        Args:
            business_id: Business identifier for multi-tenancy
            query: Text search query (optional - returns ALL if empty)
            filters: Additional filters (price, bedrooms, etc.)
            
        Returns:
            List of property dictionaries with full geocoded data
        """
        logger.info(f"🔍 PropertySearchService: Querying AstraDB Tabular for business '{business_id}'")
        logger.info(f"   Query: '{query}', Filters: {filters}")
        
        try:
            session = self._get_astra_session()
            table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
            
            # Query ALL properties for this business from AstraDB Tabular
            cql_query = f"""
                SELECT 
                    id, property_address, property_type, 
                    number_bedrooms, number_bathrooms, 
                    size_sqft, size_unit,
                    sold_price, asking_price, rent_pcm,
                    price_per_sqft, yield_percentage,
                    tenure, listed_building_grade,
                    transaction_date, sold_date, rented_date, leased_date,
                    epc_rating, condition, other_amenities,
                    lease_details, days_on_market, notes,
                    latitude, longitude, geocoded_address,
                    geocoding_confidence, geocoding_status,
                    source_document_id, business_id
                FROM {table_name}
                WHERE business_id = %s
                ALLOW FILTERING
            """
            
            logger.info(f"📋 Executing CQL query for business: {business_id}")
            result = session.execute(cql_query, [business_id])
            
            # Convert rows to dictionaries
            properties = []
            total_rows = 0
            geocoded_rows = 0
            
            for row in result:
                total_rows += 1
                
                # Only include successfully geocoded properties (required for map)
                if row.latitude and row.longitude and row.geocoding_status == 'success':
                    geocoded_rows += 1
                    
                    prop_dict = {
                        'id': str(row.id),
                        'property_address': row.property_address,
                        'property_type': row.property_type,
                        'number_bedrooms': row.number_bedrooms,
                        'number_bathrooms': row.number_bathrooms,
                        'size_sqft': float(row.size_sqft) if row.size_sqft else None,
                        'size_unit': row.size_unit,
                        'sold_price': float(row.sold_price) if row.sold_price else None,
                        'asking_price': float(row.asking_price) if row.asking_price else None,
                        'rent_pcm': float(row.rent_pcm) if row.rent_pcm else None,
                        'price_per_sqft': float(row.price_per_sqft) if row.price_per_sqft else None,
                        'yield_percentage': float(row.yield_percentage) if row.yield_percentage else None,
                        'tenure': row.tenure,
                        'listed_building_grade': row.listed_building_grade,
                        'transaction_date': str(row.transaction_date) if row.transaction_date else None,
                        'sold_date': str(row.sold_date) if row.sold_date else None,
                        'rented_date': str(row.rented_date) if row.rented_date else None,
                        'leased_date': str(row.leased_date) if row.leased_date else None,
                        'epc_rating': row.epc_rating,
                        'condition': row.condition,
                        'other_amenities': row.other_amenities,
                        'lease_details': row.lease_details,
                        'days_on_market': row.days_on_market,
                        'notes': row.notes,
                        'latitude': float(row.latitude),
                        'longitude': float(row.longitude),
                        'geocoded_address': row.geocoded_address,
                        'geocoding_confidence': float(row.geocoding_confidence) if row.geocoding_confidence else 0.0,
                        'geocoding_status': row.geocoding_status,
                        'source_document_id': str(row.source_document_id)
                    }
                    properties.append(prop_dict)
                    
                    # 🔍 PHASE 1 DEBUG: Log price data for first 3 properties
                    if len(properties) <= 3:
                        logger.info(f"🔍 PHASE 1 DEBUG Property {len(properties)} - {row.property_address[:50]}...")
                        logger.info(f"   💰 Raw Price Data: sold_price={row.sold_price}, rent_pcm={row.rent_pcm}, asking_price={row.asking_price}")
                        logger.info(f"   📊 Type Check: sold_price type={type(row.sold_price)}, rent_pcm type={type(row.rent_pcm)}")
                        logger.info(f"   🔄 Converted Data: sold_price={prop_dict.get('sold_price')}, rent_pcm={prop_dict.get('rent_pcm')}, asking_price={prop_dict.get('asking_price')}")
            
            logger.info(f"📊 AstraDB Tabular Results:")
            logger.info(f"   Total rows: {total_rows}")
            logger.info(f"   Geocoded: {geocoded_rows}")
            logger.info(f"   Returned: {len(properties)}")
            
            # 🔍 PHASE 1 DEBUG: Comprehensive price data analysis
            if properties:
                price_analysis = {
                    'has_sold_price': sum(1 for p in properties if p.get('sold_price') and p['sold_price'] > 0),
                    'has_rent_pcm': sum(1 for p in properties if p.get('rent_pcm') and p['rent_pcm'] > 0),
                    'has_asking_price': sum(1 for p in properties if p.get('asking_price') and p['asking_price'] > 0),
                    'no_price_data': sum(1 for p in properties if not (p.get('sold_price') or p.get('rent_pcm') or p.get('asking_price')))
                }
                
                logger.info(f"🔍 PHASE 1 DEBUG - Price Data Analysis:")
                logger.info(f"   Properties with sold_price: {price_analysis['has_sold_price']}")
                logger.info(f"   Properties with rent_pcm: {price_analysis['has_rent_pcm']}")
                logger.info(f"   Properties with asking_price: {price_analysis['has_asking_price']}")
                logger.info(f"   Properties with no price data: {price_analysis['no_price_data']}")
                
                # Sample price values
                sample_props = properties[:3]
                for i, prop in enumerate(sample_props, 1):
                    logger.info(f"   Sample {i}: {prop['property_address'][:40]}... - sold: {prop.get('sold_price')}, rent: {prop.get('rent_pcm')}, asking: {prop.get('asking_price')}")
            
            return properties
            
        except Exception as e:
            logger.error(f"❌ Error searching AstraDB Tabular: {e}")
            import traceback
            traceback.print_exc()
            
            # Fallback to PostgreSQL if AstraDB fails
            logger.warning("⚠️ Falling back to PostgreSQL...")
            return self._search_postgresql_fallback(business_id, query, filters)
    
    def _search_postgresql_fallback(self, business_id: str, query: str, filters: dict) -> List[Dict[str, Any]]:
        """Fallback to PostgreSQL if AstraDB fails"""
        try:
            logger.info("🔄 Using PostgreSQL fallback...")
            base_query = ExtractedProperty.query.filter(
                ExtractedProperty.business_id == business_id
            )
            
            # Text search
            if query and query.strip():
                search_filter = or_(
                    ExtractedProperty.property_address.ilike(f'%{query}%'),
                    ExtractedProperty.property_type.ilike(f'%{query}%'),
                    ExtractedProperty.notes.ilike(f'%{query}%'),
                    ExtractedProperty.other_amenities.ilike(f'%{query}%')
                )
                base_query = base_query.filter(search_filter)
            
            # Limit results
            limit = filters.get('limit', 1000) if filters else 1000
            results = base_query.limit(limit).all()
            
            logger.info(f"✅ PostgreSQL fallback found {len(results)} properties")
            return [prop.serialize() for prop in results]
            
        except Exception as e:
            logger.error(f"❌ PostgreSQL fallback also failed: {e}")
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
