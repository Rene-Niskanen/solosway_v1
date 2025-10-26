// Enhanced mock property hub data matching the backend schema
// This file contains comprehensive property hub data with documents for testing

export interface MockDocument {
  id: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  status: string;
  classification_type: string;
  classification_confidence: number;
  classification_timestamp: string;
  created_at: string;
  updated_at: string;
  business_id: string;
  uploaded_by_user_id: number;
  s3_path: string;
  parsed_text?: string;
  extracted_json?: string;
}

export interface MockPropertyDetails {
  property_id: string;
  property_type: string;
  size_sqft: number;
  number_bedrooms: number;
  number_bathrooms: number;
  tenure: string;
  epc_rating: string;
  condition: string;
  other_amenities: string;
  asking_price: number;
  sold_price?: number;
  rent_pcm?: number;
  last_transaction_date?: string;
  last_valuation_date?: string;
  data_sources: string[];
  data_quality_score: number;
  last_enrichment: string;
  source_documents: string[];
  created_at: string;
  updated_at: string;
  // Additional fields from schema
  size_unit: string;
  appraised_value?: number;
  notes?: string;
  transaction_date?: string;
  sold_date?: string;
  rented_date?: string;
  leased_date?: string;
  yield_percentage?: number;
  price_per_sqft?: number;
  days_on_market?: number;
  lease_details?: string;
  listed_building_grade?: string;
  property_images: any[];
  image_count: number;
  primary_image_url?: string;
  image_metadata: any;
  property_address: string;
  normalized_address: string;
  address_hash: string;
  address_source: string;
  latitude: number;
  longitude: number;
  geocoded_address: string;
  geocoding_confidence: number;
  geocoding_status: string;
  source_document_id?: string;
}

export interface MockProperty {
  id: string;
  business_id: string;
  address_hash: string;
  normalized_address: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  geocoding_status: string;
  geocoding_confidence: number;
  created_at: string;
  updated_at: string;
  last_enrichment_at: string;
  completeness_score: number;
}

export interface MockPropertyHub {
  property: MockProperty;
  property_details: MockPropertyDetails;
  documents: MockDocument[];
  document_count: number;
  completeness_score: number;
}

// Mock documents data
const mockDocuments: MockDocument[] = [
  {
    id: "doc-001",
    original_filename: "33_Easton_Way_Valuation_Report.pdf",
    file_type: "pdf",
    file_size: 2048576,
    status: "completed",
    classification_type: "valuation_report",
    classification_confidence: 0.95,
    classification_timestamp: "2024-01-15T10:30:00Z",
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T10:30:00Z",
    business_id: "business-001",
    uploaded_by_user_id: 1,
    s3_path: "documents/business-001/33_Easton_Way_Valuation_Report.pdf",
    parsed_text: "Property valuation report for 33 Easton Way, Easton, Bristol...",
    extracted_json: '{"subject_property": {"property_address": "33 Easton Way, Easton, Bristol", "property_type": "Terraced", "number_bedrooms": 4, "number_bathrooms": 2, "asking_price": 420000}}'
  },
  {
    id: "doc-002",
    original_filename: "33_Easton_Way_Letter_of_Offer.docx",
    file_type: "docx",
    file_size: 512000,
    status: "completed",
    classification_type: "other_documents",
    classification_confidence: 0.88,
    classification_timestamp: "2024-01-16T14:20:00Z",
    created_at: "2024-01-16T14:00:00Z",
    updated_at: "2024-01-16T14:20:00Z",
    business_id: "business-001",
    uploaded_by_user_id: 1,
    s3_path: "documents/business-001/33_Easton_Way_Letter_of_Offer.docx",
    parsed_text: "Letter of offer for the property at 33 Easton Way...",
    extracted_json: '{"subject_property": {"property_address": "33 Easton Way, Easton, Bristol"}}'
  },
  {
    id: "doc-003",
    original_filename: "24_Runthorpe_Road_Market_Appraisal.pdf",
    file_type: "pdf",
    file_size: 1536000,
    status: "completed",
    classification_type: "market_appraisal",
    classification_confidence: 0.92,
    classification_timestamp: "2024-01-14T09:15:00Z",
    created_at: "2024-01-14T09:00:00Z",
    updated_at: "2024-01-14T09:15:00Z",
    business_id: "business-001",
    uploaded_by_user_id: 1,
    s3_path: "documents/business-001/24_Runthorpe_Road_Market_Appraisal.pdf",
    parsed_text: "Market appraisal for 24 Runthorpe Road, Clifton, Bristol...",
    extracted_json: '{"subject_property": {"property_address": "24 Runthorpe Road, Clifton, Bristol", "property_type": "Semi-Detached", "number_bedrooms": 3, "number_bathrooms": 2, "asking_price": 450000}}'
  },
  {
    id: "doc-004",
    original_filename: "15_Clifton_Park_Lease_Agreement.pdf",
    file_type: "pdf",
    file_size: 1024000,
    status: "completed",
    classification_type: "other_documents",
    classification_confidence: 0.85,
    classification_timestamp: "2024-01-13T16:45:00Z",
    created_at: "2024-01-13T16:30:00Z",
    updated_at: "2024-01-13T16:45:00Z",
    business_id: "business-001",
    uploaded_by_user_id: 1,
    s3_path: "documents/business-001/15_Clifton_Park_Lease_Agreement.pdf",
    parsed_text: "Lease agreement for 15 Clifton Park, Clifton, Bristol...",
    extracted_json: '{"subject_property": {"property_address": "15 Clifton Park, Clifton, Bristol"}}'
  },
  {
    id: "doc-005",
    original_filename: "8_Redland_Road_Survey_Report.pdf",
    file_type: "pdf",
    file_size: 2560000,
    status: "completed",
    classification_type: "other_documents",
    classification_confidence: 0.90,
    classification_timestamp: "2024-01-12T11:30:00Z",
    created_at: "2024-01-12T11:00:00Z",
    updated_at: "2024-01-12T11:30:00Z",
    business_id: "business-001",
    uploaded_by_user_id: 1,
    s3_path: "documents/business-001/8_Redland_Road_Survey_Report.pdf",
    parsed_text: "Structural survey report for 8 Redland Road, Redland, Bristol...",
    extracted_json: '{"subject_property": {"property_address": "8 Redland Road, Redland, Bristol"}}'
  }
];

// Mock property hub data matching backend schema
export const mockPropertyHubData: MockPropertyHub[] = [
  {
    property: {
      id: "prop-001",
      business_id: "business-001",
      address_hash: "hash_33_easton_way_easton_bristol",
      normalized_address: "33 Easton Way, Easton, Bristol",
      formatted_address: "33 Easton Way, Easton, Bristol BS5 6KL",
      latitude: 51.4600,
      longitude: -2.5700,
      geocoding_status: "success",
      geocoding_confidence: 0.95,
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-16T14:20:00Z",
      last_enrichment_at: "2024-01-16T14:20:00Z",
      completeness_score: 0.85
    },
    property_details: {
      property_id: "prop-001",
      property_type: "Terraced",
      size_sqft: 1500,
      number_bedrooms: 4,
      number_bathrooms: 2,
      tenure: "Freehold",
      epc_rating: "C",
      condition: "Good",
      other_amenities: "Period Features, Garden, Parking, High Ceilings",
      asking_price: 420000,
      sold_price: undefined,
      rent_pcm: undefined,
      last_transaction_date: undefined,
      last_valuation_date: "2024-01-15",
      data_sources: ["doc-001", "doc-002"],
      data_quality_score: 0.85,
      last_enrichment: "2024-01-16T14:20:00Z",
      source_documents: ["doc-001", "doc-002"],
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-16T14:20:00Z",
      size_unit: "sqft",
      appraised_value: 420000,
      notes: "Victorian terraced house with period features",
      transaction_date: undefined,
      sold_date: undefined,
      rented_date: undefined,
      leased_date: undefined,
      yield_percentage: undefined,
      price_per_sqft: 280,
      days_on_market: 35,
      lease_details: undefined,
      listed_building_grade: undefined,
      property_images: [
        {
          url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          filename: "property_001_main.jpg",
          extracted_at: "2024-01-15T10:30:00Z",
          size_bytes: 245760
        }
      ],
      image_count: 1,
      primary_image_url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
      image_metadata: {
        extraction_method: "llamaparse",
        total_images: 1,
        extraction_timestamp: "2024-01-15T10:30:00Z"
      },
      property_address: "33 Easton Way, Easton, Bristol",
      normalized_address: "33 Easton Way, Easton, Bristol",
      address_hash: "hash_33_easton_way_easton_bristol",
      address_source: "filename",
      latitude: 51.4600,
      longitude: -2.5700,
      geocoded_address: "33 Easton Way, Easton, Bristol BS5 6KL, UK",
      geocoding_confidence: 0.95,
      geocoding_status: "success",
      source_document_id: "doc-001"
    },
    documents: [
      mockDocuments[0], // Valuation Report
      mockDocuments[1]  // Letter of Offer
    ],
    document_count: 2,
    completeness_score: 0.85
  },
  {
    property: {
      id: "prop-002",
      business_id: "business-001",
      address_hash: "hash_24_runthorpe_road_clifton_bristol",
      normalized_address: "24 Runthorpe Road, Clifton, Bristol",
      formatted_address: "24 Runthorpe Road, Clifton, Bristol BS8 2AB",
      latitude: 51.4600,
      longitude: -2.6100,
      geocoding_status: "success",
      geocoding_confidence: 0.92,
      created_at: "2024-01-14T09:00:00Z",
      updated_at: "2024-01-14T09:15:00Z",
      last_enrichment_at: "2024-01-14T09:15:00Z",
      completeness_score: 0.78
    },
    property_details: {
      property_id: "prop-002",
      property_type: "Semi-Detached",
      size_sqft: 1200,
      number_bedrooms: 3,
      number_bathrooms: 2,
      tenure: "Freehold",
      epc_rating: "B",
      condition: "Excellent",
      other_amenities: "Garden, Parking, Modern Kitchen",
      asking_price: 450000,
      sold_price: undefined,
      rent_pcm: undefined,
      last_transaction_date: undefined,
      last_valuation_date: "2024-01-14",
      data_sources: ["doc-003"],
      data_quality_score: 0.78,
      last_enrichment: "2024-01-14T09:15:00Z",
      source_documents: ["doc-003"],
      created_at: "2024-01-14T09:00:00Z",
      updated_at: "2024-01-14T09:15:00Z",
      size_unit: "sqft",
      appraised_value: 450000,
      notes: "Beautiful 3-bedroom semi-detached house in Clifton",
      transaction_date: undefined,
      sold_date: undefined,
      rented_date: undefined,
      leased_date: undefined,
      yield_percentage: undefined,
      price_per_sqft: 375,
      days_on_market: 45,
      lease_details: undefined,
      listed_building_grade: undefined,
      property_images: [
        {
          url: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          filename: "property_002_main.jpg",
          extracted_at: "2024-01-14T09:15:00Z",
          size_bytes: 198432
        }
      ],
      image_count: 1,
      primary_image_url: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
      image_metadata: {
        extraction_method: "llamaparse",
        total_images: 1,
        extraction_timestamp: "2024-01-14T09:15:00Z"
      },
      property_address: "24 Runthorpe Road, Clifton, Bristol",
      normalized_address: "24 Runthorpe Road, Clifton, Bristol",
      address_hash: "hash_24_runthorpe_road_clifton_bristol",
      address_source: "filename",
      latitude: 51.4600,
      longitude: -2.6100,
      geocoded_address: "24 Runthorpe Road, Clifton, Bristol BS8 2AB, UK",
      geocoding_confidence: 0.92,
      geocoding_status: "success",
      source_document_id: "doc-003"
    },
    documents: [
      mockDocuments[2] // Market Appraisal
    ],
    document_count: 1,
    completeness_score: 0.78
  },
  {
    property: {
      id: "prop-003",
      business_id: "business-001",
      address_hash: "hash_15_clifton_park_clifton_bristol",
      normalized_address: "15 Clifton Park, Clifton, Bristol",
      formatted_address: "15 Clifton Park, Clifton, Bristol BS8 3CD",
      latitude: 51.4610,
      longitude: -2.6120,
      geocoding_status: "success",
      geocoding_confidence: 0.88,
      created_at: "2024-01-13T16:30:00Z",
      updated_at: "2024-01-13T16:45:00Z",
      last_enrichment_at: "2024-01-13T16:45:00Z",
      completeness_score: 0.65
    },
    property_details: {
      property_id: "prop-003",
      property_type: "Detached",
      size_sqft: 1400,
      number_bedrooms: 3,
      number_bathrooms: 2,
      tenure: "Freehold",
      epc_rating: "A",
      condition: "Excellent",
      other_amenities: "Large Garden, Garage, En-suite",
      asking_price: 550000,
      sold_price: undefined,
      rent_pcm: undefined,
      last_transaction_date: undefined,
      last_valuation_date: undefined,
      data_sources: ["doc-004"],
      data_quality_score: 0.65,
      last_enrichment: "2024-01-13T16:45:00Z",
      source_documents: ["doc-004"],
      created_at: "2024-01-13T16:30:00Z",
      updated_at: "2024-01-13T16:45:00Z",
      size_unit: "sqft",
      appraised_value: undefined,
      notes: "Stunning 3-bedroom detached house with garden",
      transaction_date: undefined,
      sold_date: undefined,
      rented_date: undefined,
      leased_date: undefined,
      yield_percentage: undefined,
      price_per_sqft: 393,
      days_on_market: 23,
      lease_details: "Lease agreement available",
      listed_building_grade: undefined,
      property_images: [
        {
          url: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          filename: "property_003_main.jpg",
          extracted_at: "2024-01-13T16:45:00Z",
          size_bytes: 187654
        }
      ],
      image_count: 1,
      primary_image_url: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
      image_metadata: {
        extraction_method: "llamaparse",
        total_images: 1,
        extraction_timestamp: "2024-01-13T16:45:00Z"
      },
      property_address: "15 Clifton Park, Clifton, Bristol",
      normalized_address: "15 Clifton Park, Clifton, Bristol",
      address_hash: "hash_15_clifton_park_clifton_bristol",
      address_source: "filename",
      latitude: 51.4610,
      longitude: -2.6120,
      geocoded_address: "15 Clifton Park, Clifton, Bristol BS8 3CD, UK",
      geocoding_confidence: 0.88,
      geocoding_status: "success",
      source_document_id: "doc-004"
    },
    documents: [
      mockDocuments[3] // Lease Agreement
    ],
    document_count: 1,
    completeness_score: 0.65
  },
  {
    property: {
      id: "prop-004",
      business_id: "business-001",
      address_hash: "hash_8_redland_road_redland_bristol",
      normalized_address: "8 Redland Road, Redland, Bristol",
      formatted_address: "8 Redland Road, Redland, Bristol BS6 6AB",
      latitude: 51.4700,
      longitude: -2.5800,
      geocoding_status: "success",
      geocoding_confidence: 0.90,
      created_at: "2024-01-12T11:00:00Z",
      updated_at: "2024-01-12T11:30:00Z",
      last_enrichment_at: "2024-01-12T11:30:00Z",
      completeness_score: 0.72
    },
    property_details: {
      property_id: "prop-004",
      property_type: "Semi-Detached",
      size_sqft: 1600,
      number_bedrooms: 4,
      number_bathrooms: 2,
      tenure: "Freehold",
      epc_rating: "B",
      condition: "Good",
      other_amenities: "Garden, Parking, Period Features, Modern Kitchen",
      asking_price: 650000,
      sold_price: undefined,
      rent_pcm: undefined,
      last_transaction_date: undefined,
      last_valuation_date: undefined,
      data_sources: ["doc-005"],
      data_quality_score: 0.72,
      last_enrichment: "2024-01-12T11:30:00Z",
      source_documents: ["doc-005"],
      created_at: "2024-01-12T11:00:00Z",
      updated_at: "2024-01-12T11:30:00Z",
      size_unit: "sqft",
      appraised_value: undefined,
      notes: "Spacious 4-bedroom semi-detached family home",
      transaction_date: undefined,
      sold_date: undefined,
      rented_date: undefined,
      leased_date: undefined,
      yield_percentage: undefined,
      price_per_sqft: 406,
      days_on_market: 8,
      lease_details: undefined,
      listed_building_grade: undefined,
      property_images: [
        {
          url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          filename: "property_004_main.jpg",
          extracted_at: "2024-01-12T11:30:00Z",
          size_bytes: 223456
        }
      ],
      image_count: 1,
      primary_image_url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
      image_metadata: {
        extraction_method: "llamaparse",
        total_images: 1,
        extraction_timestamp: "2024-01-12T11:30:00Z"
      },
      property_address: "8 Redland Road, Redland, Bristol",
      normalized_address: "8 Redland Road, Redland, Bristol",
      address_hash: "hash_8_redland_road_redland_bristol",
      address_source: "filename",
      latitude: 51.4700,
      longitude: -2.5800,
      geocoded_address: "8 Redland Road, Redland, Bristol BS6 6AB, UK",
      geocoding_confidence: 0.90,
      geocoding_status: "success",
      source_document_id: "doc-005"
    },
    documents: [
      mockDocuments[4] // Survey Report
    ],
    document_count: 1,
    completeness_score: 0.72
  }
];

// Helper function to transform property hub data for frontend compatibility
export const transformPropertyHubForFrontend = (hub: MockPropertyHub) => {
  const property = hub.property;
  const details = hub.property_details;
  
  return {
    id: property.id,
    address: property.formatted_address,
    postcode: property.formatted_address.split(',').pop()?.trim() || '',
    property_type: details.property_type,
    bedrooms: details.number_bedrooms,
    bathrooms: details.number_bathrooms,
    price: details.asking_price || details.sold_price || details.rent_pcm || 0,
    square_feet: details.size_sqft,
    days_on_market: details.days_on_market || 0,
    latitude: property.latitude,
    longitude: property.longitude,
    summary: details.notes || `${details.property_type} property in ${property.formatted_address}`,
    features: details.other_amenities,
    condition: details.condition === 'Excellent' ? 10 : details.condition === 'Good' ? 8 : 6,
    similarity: Math.round(hub.completeness_score * 100),
    image: details.primary_image_url || "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Tom Anderson",
      company: "eastonhomes"
    },
    // New fields for property hub
    documentCount: hub.document_count,
    completenessScore: hub.completeness_score,
    propertyHub: hub,
    // Additional property details
    epc_rating: details.epc_rating,
    tenure: details.tenure,
    last_valuation_date: details.last_valuation_date,
    data_quality_score: details.data_quality_score,
    geocoding_confidence: property.geocoding_confidence,
    created_at: property.created_at,
    updated_at: property.updated_at
  };
};

// Export transformed data for easy use
export const mockPropertyDataTransformed = mockPropertyHubData.map(transformPropertyHubForFrontend);
