"""
Filename Address Service extraction 
Extracts the address from the document filenames
"""

import re 
import logging 
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class FilenameAddressService:
    """Extract property addresses from document filenames if they exist"""

    def __init__(self):
        # UK postcodes to start with
        self.postcode_pattern = r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})'

        # Common seperators in filename
        self.separators = [' - ', '_', ' ', '-']

    def extract_address_from_filename(self, filename: str) -> Optional[str]:
        """
        Extract property address from filename

        Examples: 
            - "123_Main_Street_London_SW1A_1AA.pdf  -> "123 Main Street London SW1A 1AA"
            - "Hill House - Saffron Walden - CB11 4EX.docx" → "Hill House Saffron Walden CB11 4EX"
            - "Valuation_Report.pdf" → None (no address)

        Args:
            filename: Original document filename

        Returns:
            Extracted address or None
        """

        try:
            # remove file extraction 
            name_without_ext = filename.rsplit('.', 1)[0]

            # Check if filename contains a UK postcode 
            postcode_match = re.search(self.postcode_pattern, name_without_ext, re.IGNORECASE)

            if not postcode_match:
                logger.debug(f"No UK postcode found in filename: {filename}")
                return None
            
            # Replace the common seperators with spaces
            cleaned = name_without_ext
            for separator in self.separators:
                cleaned = cleaned.replace(separator, ' ')

            # Remove common prefixes
            prefixes = [
                'valuation report', 'market appraisal', 'appraisal',
                'valuation', 'report', 'lease', 'contract', 'agreement'
            ]
            for prefix in prefixes:
                pattern = r'^' + re.escape(prefix) + r'\s+'
                cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)

            # clean extra whitespaces
            cleaned = re.sub(r'\s+', ' ', cleaned).strip()

            # Validate the extracted address has some substance
            if len(cleaned) < 10:
                logger.debug(f"Extracted address too short: {cleaned}")
                return None

            logger.info(f"Extracted address from filename: {filename} -> {cleaned}")
            return cleaned
        
        except Exception as e:
            logger.error(f"Error extracting address from filename: {e}")
            return None

    
    def confidence_score(self, address: str) -> float:
        """
        Calculate the confidence score for the filename-based extraction 

        Args:
            address: Extracted address from filename

        Returns:
            confidence score (0.0 to 1.0)
        """
        if not address:
            return 0.0
        
        confidence = 0.2 # Base confidence for any extracted address 

        # Higher confidence if postcode is well-formatted
        if re.search(self.postcode_pattern, address):
            confidence += 0.2

        # Higher confidence if address has multiple parts (house number, street, town)
        parts = address.split(',')
        if len(parts) >= 2:
            confidence += 0.2

        # Higher confidence if address is reasonably long 
        if len(address) > 20:
            confidence += 0.1

        return min(1.0, confidence)








