"""
Address Normalization and Hashing Service
"""
import hashlib
import re
import logging
from typing import Dict, Any, Optional
from geopy.geocoders import GoogleV3, Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
import os

logger = logging.getLogger(__name__)

class AddressNormalizationService:
    """Service for normalizing addresses and computing hashes for property linking"""
    
    def __init__(self):
        self.google_api_key = os.environ.get('GOOGLE_MAPS_API_KEY')
        
        # Initialize geocoders
        if self.google_api_key:
            self.google_geocoder = GoogleV3(api_key=self.google_api_key, timeout=5)
        else:
            self.google_geocoder = None
            
        self.nominatim_geocoder = Nominatim(user_agent="solosway_mvp", timeout=8)
        
        # Common abbreviations mapping
        self.abbreviations = {
            'st': 'street',
            'rd': 'road',
            'ave': 'avenue',
            'dr': 'drive',
            'ln': 'lane',
            'ct': 'court',
            'pl': 'place',
            'blvd': 'boulevard',
            'pkwy': 'parkway',
            'sq': 'square',
            'cres': 'crescent',
            'close': 'close',
            'way': 'way',
            'gardens': 'gardens',
            'manor': 'manor',
            'house': 'house',
            'farm': 'farm',
            'apartment': 'apartment',
            'apt': 'apartment',
            'flat': 'flat',
            'unit': 'unit'
        }
    
    def normalize_address(self, address: str) -> str:
        """
        Normalize address for consistent hashing
        
        Args:
            address: Raw address string
            
        Returns:
            Normalized address string
        """
        if not address:
            return ""
        
        # Start with lowercase
        normalized = address.lower().strip()
        
        # Remove common formatting issues
        normalized = re.sub(r'\[.*?\]', '', normalized)  # Remove bracketed content
        normalized = re.sub(r'\(.*?\)', '', normalized)  # Remove parenthetical content
        
        # Remove unit/apartment numbers that might vary
        normalized = re.sub(r'\b(apt|apartment|unit|flat|#)\s*\d+\w*\b', '', normalized)
        normalized = re.sub(r'\b\d+\s*(apt|apartment|unit|flat)\b', '', normalized)
        
        # Remove common suffixes that don't affect property identity
        normalized = re.sub(r'\b(uk|united kingdom|england|scotland|wales)\b', '', normalized)
        
        # Expand abbreviations
        for abbr, full in self.abbreviations.items():
            # Use word boundaries to avoid partial matches
            pattern = r'\b' + re.escape(abbr) + r'\b'
            normalized = re.sub(pattern, full, normalized)
        
        # Clean up extra whitespace and punctuation
        normalized = re.sub(r'[^\w\s]', ' ', normalized)  # Replace punctuation with spaces
        normalized = re.sub(r'\s+', ' ', normalized)      # Collapse multiple spaces
        normalized = normalized.strip()
        
        return normalized
    
    def compute_address_hash(self, normalized_address: str) -> str:
        """
        Generate SHA256 hash for normalized address
        
        Args:
            normalized_address: Normalized address string
            
        Returns:
            SHA256 hash as hex string
        """
        if not normalized_address:
            return ""
        
        return hashlib.sha256(normalized_address.encode('utf-8')).hexdigest()
    
    def geocode_address(self, address: str) -> Dict[str, Any]:
        """
        Geocode address using Google Maps API with Nominatim fallback
        
        Args:
            address: Address to geocode
            
        Returns:
            Geocoding result dictionary
        """
        if not address or address.strip() == "":
            return {
                "latitude": None,
                "longitude": None,
                "confidence": 0.0,
                "status": "empty_address",
                "formatted_address": None
            }
        
        # Try Google Geocoding API first (more accurate)
        if self.google_geocoder:
            try:
                location = self.google_geocoder.geocode(address, exactly_one=True, timeout=5)
                
                if location:
                    logger.info(f"Google geocoding successful for: '{address}'")
                    return {
                        "latitude": location.latitude,
                        "longitude": location.longitude,
                        "confidence": 0.9,
                        "status": "success",
                        "formatted_address": location.address,
                        "geocoder": "google"
                    }
            except Exception as e:
                logger.warning(f"Google geocoding failed: {e}, trying Nominatim")
        
        # Fallback to Nominatim
        try:
            location = self.nominatim_geocoder.geocode(address, exactly_one=True, timeout=8)
            
            if location:
                logger.info(f"Nominatim geocoding successful for: '{address}'")
                return {
                    "latitude": location.latitude,
                    "longitude": location.longitude,
                    "confidence": 0.8,
                    "status": "success",
                    "formatted_address": location.address,
                    "geocoder": "nominatim"
                }
        except Exception as e:
            logger.warning(f"Nominatim geocoding failed: {e}")
        
        logger.error(f"All geocoding attempts failed for: '{address}'")
        return {
            "latitude": None,
            "longitude": None,
            "confidence": 0.0,
            "status": "not_found",
            "formatted_address": None,
            "geocoder": "none"
        }
    
    async def geocode_and_normalize(self, address: str) -> Dict[str, Any]:
        """
        Complete address processing: normalization + geocoding
        
        Args:
            address: Raw address string
            
        Returns:
            Complete address processing result
        """
        try:
            # Normalize the address
            normalized = self.normalize_address(address)
            
            # Compute hash
            address_hash = self.compute_address_hash(normalized)
            
            # Geocode the original address (not normalized, as geocoding works better with original format)
            geocoding_result = self.geocode_address(address)
            
            return {
                'original_address': address,
                'normalized_address': normalized,
                'address_hash': address_hash,
                'latitude': geocoding_result.get('latitude'),
                'longitude': geocoding_result.get('longitude'),
                'formatted_address': geocoding_result.get('formatted_address'),
                'geocoding_status': geocoding_result.get('status'),
                'geocoding_confidence': geocoding_result.get('confidence'),
                'geocoder_used': geocoding_result.get('geocoder', 'none')
            }
            
        except Exception as e:
            logger.error(f"Error in geocode_and_normalize: {e}")
            return {
                'original_address': address,
                'normalized_address': self.normalize_address(address),
                'address_hash': self.compute_address_hash(self.normalize_address(address)),
                'latitude': None,
                'longitude': None,
                'formatted_address': None,
                'geocoding_status': 'error',
                'geocoding_confidence': 0.0,
                'geocoder_used': 'none',
                'error': str(e)
            }
    
    def generate_address_variations(self, address: str) -> list:
        """
        Generate address variations for better matching
        
        Args:
            address: Original address
            
        Returns:
            List of address variations
        """
        variations = [address]  # Start with original
        
        # Extract postcode for UK addresses
        postcode_match = re.search(r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})', address, re.IGNORECASE)
        postcode = postcode_match.group(1) if postcode_match else None
        
        if postcode:
            # For UK addresses, add UK context
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
    
    def validate_address_format(self, address: str) -> Dict[str, Any]:
        """
        Validate address format and provide suggestions
        
        Args:
            address: Address to validate
            
        Returns:
            Validation result with suggestions
        """
        validation_result = {
            'is_valid': True,
            'issues': [],
            'suggestions': []
        }
        
        if not address or len(address.strip()) < 5:
            validation_result['is_valid'] = False
            validation_result['issues'].append('Address too short')
            return validation_result
        
        # Check for UK postcode pattern
        postcode_pattern = r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})'
        if not re.search(postcode_pattern, address, re.IGNORECASE):
            validation_result['issues'].append('No UK postcode found')
            validation_result['suggestions'].append('Add UK postcode for better geocoding')
        
        # Check for common issues
        if re.search(r'\b\d+\s*(apt|apartment|unit|flat)\b', address, re.IGNORECASE):
            validation_result['suggestions'].append('Consider removing unit numbers for better property matching')
        
        return validation_result
