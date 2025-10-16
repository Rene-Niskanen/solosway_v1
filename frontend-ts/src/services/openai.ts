/**
 * OpenAI Service (Secure Backend Proxy)
 * All API calls now route through Flask backend to keep API keys secure
 */

import { backendApi } from './backendApi';

export interface QueryAnalysis {
  processedQuery: string;
  searchType: 'address' | 'area' | 'postcode' | 'landmark' | 'ambiguous';
  confidence: number;
  suggestions?: string[];
  reasoning?: string;
  extractedLocation?: string;
  searchIntent?: string;
}

export interface PropertyQueryAnalysis {
  bedrooms?: number;
  propertyType?: string[];
  priceRange?: { min?: number; max?: number };
  epcRating?: string;
  location?: string;
  features?: string[];
  searchType: 'refinement' | 'new_search';
  confidence: number;
  reasoning?: string;
  extractedCriteria?: string;
}

export class OpenAIService {
  /**
   * Analyze a location search query via backend
   */
  async analyzeQuery(query: string): Promise<QueryAnalysis> {
    try {
      const response = await backendApi.searchLocation(query);
      
      if (!response.success || !response.data) {
        console.warn('Backend location search failed, using fallback');
        return this.fallbackAnalysis(query);
      }

      return response.data as QueryAnalysis;
    } catch (error) {
      console.error('Error analyzing query:', error);
      return this.fallbackAnalysis(query);
    }
  }

  /**
   * Analyze a property search query via backend
   */
  async analyzePropertyQuery(query: string, previousResults: any[] = []): Promise<PropertyQueryAnalysis> {
    try {
      const response = await backendApi.analyzePropertyQuery(query, previousResults);
      
      if (!response.success || !response.data) {
        console.warn('Backend property analysis failed, using fallback');
        return this.fallbackPropertyAnalysis(query, previousResults);
      }

      return response.data as PropertyQueryAnalysis;
    } catch (error) {
      console.error('Error analyzing property query:', error);
      return this.fallbackPropertyAnalysis(query, previousResults);
    }
  }

  /**
   * Fallback analysis when backend is unavailable
   */
  private fallbackAnalysis(query: string): QueryAnalysis {
    const lowerQuery = query.toLowerCase().trim();
    
    // Postcode detection
    if (/^[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}$/i.test(query)) {
      return {
        processedQuery: query.toUpperCase(),
        searchType: 'postcode',
        confidence: 0.9,
        reasoning: 'Detected UK postcode format',
        extractedLocation: query.toUpperCase()
      };
    }
    
    // Address detection
    if (/\d/.test(query)) {
      return {
        processedQuery: query,
        searchType: 'address',
        confidence: 0.8,
        reasoning: 'Contains numbers, likely an address',
        extractedLocation: query
      };
    }
    
    // Area detection
    const areaKeywords = [
      'clifton', 'bishopston', 'redland', 'stokes croft', 'montpelier', 
      'st pauls', 'easton', 'bedminster', 'southville', 'windmill hill',
      'hotwells', 'kingsdown', 'cotham', 'redcliffe', 'temple meads'
    ];
    
    const isKnownArea = areaKeywords.some(keyword => 
      lowerQuery.includes(keyword)
    );
    
    if (isKnownArea) {
      return {
        processedQuery: query,
        searchType: 'area',
        confidence: 0.9,
        reasoning: 'Recognized Bristol area',
        extractedLocation: query
      };
    }
    
    // Landmark detection
    const landmarkKeywords = [
      'university', 'hospital', 'station', 'airport', 'park', 'bridge',
      'cathedral', 'museum', 'gallery', 'theatre', 'stadium'
    ];
    
    const isLandmark = landmarkKeywords.some(keyword => 
      lowerQuery.includes(keyword)
    );
    
    if (isLandmark) {
      return {
        processedQuery: query,
        searchType: 'landmark',
        confidence: 0.7,
        reasoning: 'Detected landmark keywords',
        extractedLocation: query
      };
    }
    
    // Default ambiguous
    return {
      processedQuery: query,
      searchType: 'ambiguous',
      confidence: 0.3,
      suggestions: [
        'Try: "Clifton" for Clifton area',
        'Try: "BS8" for postcode',
        'Try: "24 Runthorpe Road" for specific address',
        'Try: "Bristol University" for landmarks'
      ],
      reasoning: 'Query is ambiguous, needs clarification',
      extractedLocation: query
    };
  }

  /**
   * Fallback property analysis when backend is unavailable
   */
  private fallbackPropertyAnalysis(query: string, previousResults: any[] = []): PropertyQueryAnalysis {
    const lowerQuery = query.toLowerCase();
    
    // Extract bedroom count
    const bedroomMatch = lowerQuery.match(/(\d+)\s*bed/i);
    const bedrooms = bedroomMatch ? parseInt(bedroomMatch[1]) : undefined;
    
    // Extract property type
    let propertyType: string[] | undefined = undefined;
    if (lowerQuery.includes('house')) propertyType = ['Detached', 'Semi-Detached', 'Terraced'];
    if (lowerQuery.includes('flat') || lowerQuery.includes('apartment')) propertyType = ['Apartment'];
    if (lowerQuery.includes('detached')) propertyType = ['Detached'];
    if (lowerQuery.includes('semi')) propertyType = ['Semi-Detached'];
    if (lowerQuery.includes('terraced')) propertyType = ['Terraced'];
    
    // Extract price range
    let priceRange: { min?: number; max?: number } | undefined = undefined;
    if (lowerQuery.includes('under') && lowerQuery.includes('300k')) priceRange = { max: 300000 };
    if (lowerQuery.includes('300k') && lowerQuery.includes('500k')) priceRange = { min: 300000, max: 500000 };
    if (lowerQuery.includes('500k') && lowerQuery.includes('800k')) priceRange = { min: 500000, max: 800000 };
    if (lowerQuery.includes('over') && lowerQuery.includes('800k')) priceRange = { min: 800000 };
    
    // Extract EPC rating
    let epcRating: string | undefined = undefined;
    if (lowerQuery.includes('epc') && lowerQuery.includes('a')) epcRating = 'A';
    if (lowerQuery.includes('epc') && lowerQuery.includes('b')) epcRating = 'B';
    if (lowerQuery.includes('epc') && lowerQuery.includes('c')) epcRating = 'C';
    if (lowerQuery.includes('epc') && lowerQuery.includes('d')) epcRating = 'D';
    if (lowerQuery.includes('epc') && lowerQuery.includes('e')) epcRating = 'E';
    
    // Extract location preferences
    let location: string | undefined = undefined;
    if (lowerQuery.includes('harbourside')) location = 'Harbourside';
    if (lowerQuery.includes('clifton')) location = 'Clifton';
    if (lowerQuery.includes('redland')) location = 'Redland';
    if (lowerQuery.includes('bedminster')) location = 'Bedminster';
    if (lowerQuery.includes('montpelier')) location = 'Montpelier';
    
    // Extract features
    const features: string[] = [];
    if (lowerQuery.includes('garden')) features.push('Garden');
    if (lowerQuery.includes('parking')) features.push('Parking');
    if (lowerQuery.includes('garage')) features.push('Garage');
    if (lowerQuery.includes('balcony')) features.push('Balcony');
    if (lowerQuery.includes('modern')) features.push('Modern');
    if (lowerQuery.includes('period')) features.push('Period Features');
    
    return {
      bedrooms,
      propertyType,
      priceRange,
      epcRating,
      location,
      features: features.length > 0 ? features : undefined,
      searchType: previousResults.length > 0 ? 'refinement' : 'new_search',
      confidence: 0.7,
      reasoning: 'Fallback rule-based analysis',
      extractedCriteria: `Extracted: ${bedrooms ? bedrooms + ' beds' : ''} ${propertyType ? propertyType.join(', ') : ''} ${priceRange ? '£' + (priceRange.min || 0) + '-' + (priceRange.max || '∞') : ''} ${epcRating ? 'EPC ' + epcRating : ''} ${location || ''} ${features.join(', ')}`.trim()
    };
  }
}

// Export singleton instance
export const openaiService = new OpenAIService();
