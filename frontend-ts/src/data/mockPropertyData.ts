// Centralized mock property data for the application
// This file contains all property data used by both the map and chat interfaces
// When connecting to a real backend, replace this with API calls

export interface PropertyData {
  id: number;
  address: string;
  postcode: string;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  price: number;
  square_feet: number;
  days_on_market: number;
  latitude: number;
  longitude: number;
  summary: string;
  features: string;
  condition: number;
  similarity: number;
  image: string;
  agent: {
    name: string;
    company: string;
  };
}

export const mockPropertyData: PropertyData[] = [
  {
    id: 1,
    address: "24 Runthorpe Road, Clifton, Bristol",
    postcode: "BS8 2AB",
    property_type: "Semi-Detached",
    bedrooms: 3,
    bathrooms: 2,
    price: 450000,
    square_feet: 1200,
    days_on_market: 45,
    latitude: 51.4600,
    longitude: -2.6100,
    summary: "Beautiful 3-bedroom semi-detached house in Clifton",
    features: "Garden, Parking, Modern Kitchen",
    condition: 8,
    similarity: 95,
    image: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 2,
    address: "15 Clifton Park, Clifton, Bristol",
    postcode: "BS8 3CD",
    property_type: "Detached",
    bedrooms: 3,
    bathrooms: 2,
    price: 550000,
    square_feet: 1400,
    days_on_market: 23,
    latitude: 51.4610,
    longitude: -2.6120,
    summary: "Stunning 3-bedroom detached house with garden",
    features: "Large Garden, Garage, En-suite",
    condition: 9,
    similarity: 92,
    image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 3,
    address: "8 Clifton Road, Clifton, Bristol",
    postcode: "BS8 4EF",
    property_type: "Terraced",
    bedrooms: 3,
    bathrooms: 1,
    price: 380000,
    square_feet: 1100,
    days_on_market: 67,
    latitude: 51.4625,
    longitude: -2.6129,
    summary: "Charming 3-bedroom terraced house",
    features: "Period Features, Close to Station",
    condition: 7,
    similarity: 88,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 4,
    address: "42 Clifton Hill, Clifton, Bristol",
    postcode: "BS8 4JX",
    property_type: "Semi-Detached",
    bedrooms: 2,
    bathrooms: 1,
    price: 320000,
    square_feet: 850,
    days_on_market: 34,
    latitude: 51.4685,
    longitude: -2.6149,
    summary: "Modern 2-bedroom semi-detached house",
    features: "Off-street Parking, Garden, Modern Bathroom",
    condition: 8,
    similarity: 90,
    image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 5,
    address: "17 Clifton Village, Clifton, Bristol",
    postcode: "BS8 4AB",
    property_type: "Terraced",
    bedrooms: 3,
    bathrooms: 1,
    price: 360000,
    square_feet: 1050,
    days_on_market: 56,
    latitude: 51.4705,
    longitude: -2.6179,
    summary: "Victorian 3-bedroom terraced house",
    features: "Period Features, High Ceilings, Garden",
    condition: 6,
    similarity: 85,
    image: "https://images.unsplash.com/photo-1600566753190-17f63ba4f6fd?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 6,
    address: "9 Clifton Gardens, Clifton, Bristol",
    postcode: "BS8 4EF",
    property_type: "Semi-Detached",
    bedrooms: 3,
    bathrooms: 2,
    price: 480000,
    square_feet: 1300,
    days_on_market: 28,
    latitude: 51.4725,
    longitude: -2.6209,
    summary: "Contemporary 3-bedroom semi-detached house",
    features: "Open Plan Living, Garden, Parking",
    condition: 9,
    similarity: 93,
    image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  // Add more diverse properties for testing
  {
    id: 7,
    address: "12 Harbourside, Bristol",
    postcode: "BS1 5AB",
    property_type: "Apartment",
    bedrooms: 2,
    bathrooms: 2,
    price: 380000,
    square_feet: 1100,
    days_on_market: 23,
    latitude: 51.4500,
    longitude: -2.6000,
    summary: "Modern 2-bedroom apartment with harbour views",
    features: "Harbour Views, Balcony, Underground Parking",
    condition: 9,
    similarity: 89,
    image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Lisa Chen",
      company: "harbourhomes"
    }
  },
  {
    id: 8,
    address: "25 Harbourside, Bristol",
    postcode: "BS1 5CD",
    property_type: "Apartment",
    bedrooms: 3,
    bathrooms: 2,
    price: 520000,
    square_feet: 1400,
    days_on_market: 15,
    latitude: 51.4510,
    longitude: -2.6010,
    summary: "Luxury 3-bedroom apartment with panoramic harbour views",
    features: "Panoramic Harbour Views, Private Balcony, Concierge",
    condition: 10,
    similarity: 96,
    image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Michael Brown",
      company: "harbourhomes"
    }
  },
  {
    id: 9,
    address: "8 Redland Road, Redland, Bristol",
    postcode: "BS6 6AB",
    property_type: "Semi-Detached",
    bedrooms: 4,
    bathrooms: 2,
    price: 650000,
    square_feet: 1600,
    days_on_market: 8,
    latitude: 51.4700,
    longitude: -2.5800,
    summary: "Spacious 4-bedroom semi-detached family home",
    features: "Garden, Parking, Period Features, Modern Kitchen",
    condition: 9,
    similarity: 92,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "David Thompson",
      company: "redlandproperties"
    }
  },
  {
    id: 10,
    address: "15 Montpelier Hill, Montpelier, Bristol",
    postcode: "BS6 5EF",
    property_type: "Terraced",
    bedrooms: 2,
    bathrooms: 1,
    price: 320000,
    square_feet: 900,
    days_on_market: 45,
    latitude: 51.4720,
    longitude: -2.5820,
    summary: "Charming 2-bedroom Victorian terraced house",
    features: "Period Features, High Ceilings, Garden",
    condition: 7,
    similarity: 85,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Sarah Wilson",
      company: "montpelierestates"
    }
  },
  {
    id: 11,
    address: "22 Bedminster Parade, Bedminster, Bristol",
    postcode: "BS3 4GH",
    property_type: "Detached",
    bedrooms: 3,
    bathrooms: 3,
    price: 480000,
    square_feet: 1300,
    days_on_market: 30,
    latitude: 51.4400,
    longitude: -2.5900,
    summary: "Modern 3-bedroom detached house with en-suite",
    features: "En-suite, Garage, Garden, Modern Kitchen",
    condition: 8,
    similarity: 88,
    image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "James Roberts",
      company: "bedminsterhomes"
    }
  },
  {
    id: 12,
    address: "7 Stokes Croft, Stokes Croft, Bristol",
    postcode: "BS1 3IJ",
    property_type: "Apartment",
    bedrooms: 1,
    bathrooms: 1,
    price: 280000,
    square_feet: 600,
    days_on_market: 20,
    latitude: 51.4630,
    longitude: -2.5900,
    summary: "Stylish 1-bedroom apartment in vibrant area",
    features: "Modern Design, Balcony, Lift Access",
    condition: 8,
    similarity: 82,
    image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Emma Davis",
      company: "stokescroftproperties"
    }
  },
  {
    id: 13,
    address: "33 Easton Way, Easton, Bristol",
    postcode: "BS5 6KL",
    property_type: "Terraced",
    bedrooms: 4,
    bathrooms: 2,
    price: 420000,
    square_feet: 1500,
    days_on_market: 35,
    latitude: 51.4600,
    longitude: -2.5700,
    summary: "Victorian 4-bedroom terraced house with character",
    features: "Period Features, Garden, Parking, High Ceilings",
    condition: 7,
    similarity: 87,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Tom Anderson",
      company: "eastonhomes"
    }
  },
  {
    id: 14,
    address: "18 Hotwells Road, Hotwells, Bristol",
    postcode: "BS8 4MN",
    property_type: "Semi-Detached",
    bedrooms: 3,
    bathrooms: 1,
    price: 390000,
    square_feet: 1200,
    days_on_market: 25,
    latitude: 51.4480,
    longitude: -2.5950,
    summary: "3-bedroom semi-detached house near harbour",
    features: "Harbour Views, Garden, Period Features",
    condition: 8,
    similarity: 86,
    image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Rachel Green",
      company: "hotwellsproperties"
    }
  },
  {
    id: 15,
    address: "5 Cotham Hill, Cotham, Bristol",
    postcode: "BS6 6OP",
    property_type: "Detached",
    bedrooms: 5,
    bathrooms: 4,
    price: 850000,
    square_feet: 2000,
    days_on_market: 10,
    latitude: 51.4750,
    longitude: -2.5780,
    summary: "Luxury 5-bedroom detached house with multiple bathrooms",
    features: "Multiple Bathrooms, Large Garden, Garage, Study, En-suite",
    condition: 10,
    similarity: 95,
    image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Mark Johnson",
      company: "cothamestates"
    }
  }
  // Note: This is a subset of the full 75 properties for brevity
  // The full dataset would include all 75 properties from the SquareMap component
  // When implementing, you can either:
  // 1. Include all 75 properties here
  // 2. Move the full dataset from SquareMap.tsx to this file
  // 3. Create a separate data file with the complete dataset
];
