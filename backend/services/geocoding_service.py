from geopy.geocoders import Nominatim, GoogleV3
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
import os
import logging
from typing import Dict, Any, List, Optional
import time

logger = logging.getLogger(__name__)

class GeocodingService:
    """
    Geocoding Service using Google Maps API and Nominatim.
    
    This service provides geocoding functionality using your existing
    geocoding logic from tasks.py with Google API priority and Nominatim fallback.
    """
    
    def __init__(self):
        self.nominatim = Nominatim(user_agent="solosway_mvp", timeout=8)
        google_api_key = os.environ.get('GOOGLE_MAPS_API_KEY')
        self.google = GoogleV3(api_key=google_api_key, timeout=5) if google_api_key else None
    
    def geocode_address(self, address: str) -> Dict[str, Any]:
        """
        Forward geocoding: address -> coordinates.
        
        Args:
            address: Address string to geocode
            
        Returns:
            Dictionary with coordinates and metadata
        """
        logger.info(f"GeocodingService: Geocoding address: {address}")
        
        if not address or address.strip() == "":
            return {
                "lat": None,
                "lng": None,
                "formatted_address": None,
                "confidence": 0.0,
                "error": "Empty address provided"
            }
        
        # Clean and preprocess the address
        cleaned_address = self._preprocess_address(address)
        
        # Try Google Geocoding API first (much faster and more accurate)
        if self.google:
            try:
                location = self.google.geocode(cleaned_address, exactly_one=True, timeout=5)
                
                if location:
                    logger.info(f"GeocodingService: Google geocoding successful for: '{cleaned_address}'")
                    return {
                        "lat": location.latitude,
                        "lng": location.longitude,
                        "formatted_address": location.address,
                        "confidence": 0.9,
                        "provider": "google",
                        "original_address": address,
                        "used_variation": cleaned_address
                    }
            except Exception as e:
                logger.warning(f"GeocodingService: Google geocoding failed: {e}, falling back to Nominatim")
        
        # Fallback to Nominatim (slower but free)
        address_variations = self._generate_address_variations(cleaned_address)
        
        for variation in address_variations:
            logger.info(f"GeocodingService: Trying geocoding with: '{variation}'")
            
            try:
                location = self.nominatim.geocode(variation, exactly_one=True, timeout=8)
                
                if location:
                    logger.info(f"GeocodingService: Nominatim geocoding successful for: '{variation}'")
                    return {
                        "lat": location.latitude,
                        "lng": location.longitude,
                        "formatted_address": location.address,
                        "confidence": 0.8,
                        "provider": "nominatim",
                        "original_address": address,
                        "used_variation": variation
                    }
                    
            except (GeocoderTimedOut, GeocoderUnavailable) as e:
                logger.warning(f"GeocodingService: Geocoding attempt failed for '{variation}': {e}")
                time.sleep(0.5)  # Wait before retry
                continue
            
            except Exception as e:
                logger.warning(f"GeocodingService: Unexpected error geocoding '{variation}': {e}")
                break
            
            # Rate limiting - wait between address variations
            time.sleep(0.3)
        
        logger.warning(f"GeocodingService: All geocoding attempts failed for: '{address}'")
        return {
            "lat": None,
            "lng": None,
            "formatted_address": None,
            "confidence": 0.0,
            "error": "Address not found",
            "original_address": address,
            "tried_variations": len(address_variations)
        }
    
    def reverse_geocode(self, lat: float, lng: float) -> Dict[str, Any]:
        """
        Reverse geocoding: coordinates -> address.
        
        Args:
            lat: Latitude
            lng: Longitude
            
        Returns:
            Dictionary with address and metadata
        """
        logger.info(f"GeocodingService: Reverse geocoding lat: {lat}, lng: {lng}")
        
        try:
            if self.google:
                location = self.google.reverse((lat, lng), timeout=5)
                provider = "google"
                confidence = 0.9
            else:
                location = self.nominatim.reverse((lat, lng), timeout=8)
                provider = "nominatim"
                confidence = 0.8
            
            if location:
                logger.info(f"GeocodingService: Reverse geocoding successful")
                return {
                    "address": location.address,
                    "lat": lat,
                    "lng": lng,
                    "confidence": confidence,
                    "provider": provider
                }
            else:
                logger.warning("GeocodingService: Reverse geocoding found no address")
                return {
                    "address": None,
                    "lat": lat,
                    "lng": lng,
                    "confidence": 0.0,
                    "error": "Location not found"
                }
        except Exception as e:
            logger.error(f"GeocodingService: Reverse geocoding error: {e}")
            return {
                "address": None,
                "lat": lat,
                "lng": lng,
                "confidence": 0.0,
                "error": str(e)
            }
    
    def search_location(self, query: str) -> List[Dict[str, Any]]:
        """
        Search for locations matching query.
        
        Args:
            query: Location search query
            
        Returns:
            List of location dictionaries
        """
        logger.info(f"GeocodingService: Searching location: {query}")
        
        try:
            if self.google:
                results = self.google.geocode(query, exactly_one=False, timeout=5)
                provider = "google"
            else:
                results = self.nominatim.geocode(query, exactly_one=False, timeout=8)
                provider = "nominatim"
            
            if results:
                locations = []
                for loc in results[:10]:  # Limit to 10 results
                    locations.append({
                        "address": loc.address,
                        "lat": loc.latitude,
                        "lng": loc.longitude,
                        "provider": provider
                    })
                
                logger.info(f"GeocodingService: Found {len(locations)} locations")
                return locations
            else:
                logger.info("GeocodingService: No locations found")
                return []
                
        except Exception as e:
            logger.error(f"GeocodingService: Location search error: {e}")
            return []
    
    def _preprocess_address(self, address: str) -> str:
        """
        Clean and preprocess address for better geocoding results.
        
        Args:
            address: Original address string
            
        Returns:
            Cleaned address string
        """
        if not address:
            return ""
        
        # Remove common formatting issues
        cleaned = address.strip()
        
        # Remove bracketed content that might confuse geocoding
        import re
        cleaned = re.sub(r'\[.*?\]', '', cleaned)
        cleaned = re.sub(r'\(.*?\)', '', cleaned)
        
        # Clean up extra whitespace and commas
        cleaned = re.sub(r'\s+', ' ', cleaned)
        cleaned = re.sub(r',\s*,', ',', cleaned)
        cleaned = cleaned.strip(', ')
        
        return cleaned
    
    def _generate_address_variations(self, address: str) -> List[str]:
        """
        Generate multiple address variations to improve geocoding success.
        
        Args:
            address: Original address string
            
        Returns:
            List of address variations
        """
        variations = [address]  # Start with original
        
        # Extract postcode for UK addresses
        import re
        postcode_match = re.search(r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})', address, re.IGNORECASE)
        postcode = postcode_match.group(1) if postcode_match else None
        
        if postcode:
            # For UK addresses, add UK context to avoid US geocoding
            parts = address.split(',')
            if len(parts) >= 2:
                # Try last two parts (usually town and postcode) + UK
                town_postcode = ','.join(parts[-2:]).strip()
                variations.append(f"{town_postcode}, UK")
                
                # Try just postcode + UK
                variations.append(f"{postcode}, UK")
        
        # Try without specific house names/buildings
        simplified = re.sub(r'^[^,]+,\s*', '', address)  # Remove first part (house name)
        if simplified != address:
            variations.append(simplified)
        
        # Try with just the main road and postcode + UK
        if postcode:
            road_match = re.search(r'([^,]+(?:Road|Street|Lane|Way|Drive|Avenue|Close|Gardens|Manor|House|Farm)[^,]*)', address, re.IGNORECASE)
            if road_match:
                road_name = road_match.group(1).strip()
                variations.append(f"{road_name}, {postcode}, UK")
        
        # Remove duplicates while preserving order
        seen = set()
        unique_variations = []
        for variation in variations:
            if variation and variation not in seen:
                seen.add(variation)
                unique_variations.append(variation)
        
        return unique_variations
