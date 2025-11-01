"""
Extraction schemas for different document types
"""

# Subject property only schema for valuation_report and market_appraisal
SUBJECT_PROPERTY_EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "subject_property": {
            "type": "object",
            "additionalProperties": False,
            "description": "The main subject property being appraised or valued. This is typically described at the start of the document, in the 'Property Description' or 'Subject Property' section. EXCLUDE all comparable properties used for comparison.",
            "properties": {
                "property_address": {
                    "type": "string",
                    "description": "Full address of the SUBJECT property, including postcode."
                },
                "property_type": {
                    "type": "string",
                    "description": "Type of property (e.g., 'Detached House', 'Flat', 'Office')."
                },
                "size_sqft": {
                    "type": "number",
                    "description": "Total size of the property in square feet."
                },
                "size_unit": {
                    "type": "string",
                    "description": "Original unit of measurement (e.g., sqft, sqm)."
                },
                "number_bedrooms": {
                    "type": "number",
                    "description": "Number of bedrooms in the subject property."
                },
                "number_bathrooms": {
                    "type": "number",
                    "description": "Number of bathrooms in the subject property."
                },
                "tenure": {
                    "type": "string",
                    "description": "Tenure type (e.g., 'Freehold', 'Leasehold')."
                },
                "sold_price": {
                    "type": "number",
                    "description": "Sale price if the subject property was recently sold."
                },
                "asking_price": {
                    "type": "number",
                    "description": "Asking price for the subject property."
                },
                "appraised_value": {
                    "type": "number",
                    "description": "The professional appraisal value - the main valuation figure for the subject property."
                },
                "rent_pcm": {
                    "type": "number",
                    "description": "Monthly rent if applicable."
                },
                "epc_rating": {
                    "type": "string",
                    "description": "Energy Performance Certificate rating."
                },
                "condition": {
                    "type": "string",
                    "description": "Physical condition of the property (e.g., 'Good', 'Fair', 'Poor')."
                },
                "other_amenities": {
                    "type": "string",
                    "description": "Other features and amenities (e.g., 'Central heating', 'Double glazing', 'Fireplace')."
                },
                "notes": {
                    "type": "string",
                    "description": "Additional notes about the subject property."
                },
                "property_images": {
                    "type": "array",
                    "description": "List of property images extracted from the PDF. Each image must be base64-encoded.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "image": {
                                "type": "string",
                                "description": "Base64-encoded image extracted from the PDF"
                            },
                            "description": {
                                "type": "string",
                                "description": "Description of the image (e.g., 'exterior front view', 'floor plan', 'kitchen', 'bedroom')"
                            },
                            "image_type": {
                                "type": "string",
                                "description": "Type of image (e.g., 'photo', 'floor_plan', 'diagram', 'chart')"
                            },
                            "page_number": {
                                "type": "number",
                                "description": "Page number where this image appears in the document"
                            }
                        },
                        "required": ["image"]
                    }
                },
                "primary_image": {
                    "type": "string",
                    "description": "Base64-encoded image extracted from the PDF. Primary/featured property image, usually the best exterior photo or main property image."
                }
            },
            # CRITICAL: Only require the most essential fields
            "required": [
                "property_address"
            ]
        }
    },
    "required": ["subject_property"]
}


# Specialized schema for other_documents - focuses on subject property address extraction
OTHER_DOCUMENTS_EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "description": "Extract the subject property address from non-valuation documents like letters of offer, contracts, inspection reports, etc.",
    "properties": {
        "subject_property": {
            "type": "object",
            "additionalProperties": False,
            "description": "The main property referenced in this document. Look for property addresses in headers, property descriptions, or any section that identifies the specific property being discussed.",
            "properties": {
                "property_address": {
                    "type": "string",
                    "description": "Full address of the property referenced in this document. Include house number/name, street, town/city, and postcode if available. This is the PRIMARY field - extract the most complete address possible."
                },
                "property_type": {
                    "type": "string",
                    "description": "Type of property if mentioned (e.g., 'house', 'flat', 'detached house', 'apartment')."
                },
                "document_context": {
                    "type": "string",
                    "description": "Brief context about what this document relates to (e.g., 'letter of offer', 'rental agreement', 'inspection report')."
                },
                "price_information": {
                    "type": "object",
                    "properties": {
                        "asking_price": {
                            "type": "number",
                            "description": "Asking price if mentioned"
                        },
                        "rent_pcm": {
                            "type": "number",
                            "description": "Monthly rent if mentioned"
                        },
                        "deposit": {
                            "type": "number",
                            "description": "Deposit amount if mentioned"
                        }
                    }
                },
                "extraction_confidence": {
                    "type": "number",
                    "description": "Confidence level (0-1) in the address extraction accuracy"
                },
                "notes": {
                    "type": "string",
                    "description": "Any additional relevant information about the property or document"
                }
            },
            "required": ["property_address"]
        }
    },
    "required": ["subject_property"]
}

# Legacy minimal schema (kept for backward compatibility)
MINIMAL_EXTRACTION_SCHEMA = {
    "additionalProperties": False,
    "description": "Minimal extraction for non-valuation documents - extract only basic property information if available.",
    "properties": {
        "properties": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "property_address": {
                        "type": "string",
                        "description": "Property address if mentioned in the document"
                    },
                    "document_date": {
                        "type": "string",
                        "description": "Date associated with the document (YYYY-MM-DD)"
                    },
                    "document_type": {
                        "type": "string",
                        "description": "Type of document (e.g., 'floor_plan', 'inspection_report', 'contract') etc"
                    },
                    "property_type": {
                        "type": "string",
                        "description": "Property type if mentioned"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any relevant notes or observations"
                    }
                },
                "required": ["property_address", "document_date"]
            }
        }
    },
    "required": ["properties"],
    "type": "object"
}

def get_extraction_schema(classification_type: str) -> dict:
    """
    Get the appropriate extraction schema based on classification type
    
    Args:
        classification_type: The classified document type
        
    Returns:
        The appropriate extraction schema
    """
    if classification_type in ['valuation_report', 'market_appraisal']:
        return SUBJECT_PROPERTY_EXTRACTION_SCHEMA
    elif classification_type == 'other_documents':
        return OTHER_DOCUMENTS_EXTRACTION_SCHEMA
    else:
        return MINIMAL_EXTRACTION_SCHEMA
