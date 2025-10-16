/**
 * LLM Service (Secure Backend Proxy)
 * All LLM requests now route through Flask backend to keep API keys secure
 * This supports your multi-agent backend system
 */

import { backendApi } from '../services/backendApi';

export interface LLMAnalysisResult {
  isPropertyRelated: boolean;
  needsClarification: boolean;
  extractedCriteria: {
    bedrooms?: number;
    bathrooms?: number;
    location?: string;
    priceRange?: { min?: number; max?: number };
  };
  responseType: 'property_search' | 'general_response' | 'clarification' | 'content_creation' | 'data_analysis';
  suggestedResponse?: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

// LLM Configuration (now managed by backend)
export const LLM_CONFIG = {
  provider: 'backend', // All LLM calls go through Flask backend
  note: 'LLM configuration and API keys are managed securely by the backend service',
};

/**
 * Main LLM Analysis Function
 * Routes through backend which handles multi-agent system
 */
export const analyzeQueryWithLLM = async (
  query: string,
  messageHistory: Message[]
): Promise<LLMAnalysisResult> => {
  try {
    const response = await backendApi.analyzeQuery(query, messageHistory);

    if (!response.success || !response.data) {
      console.warn('Backend LLM analysis failed, using fallback');
      return await mockLLMAnalysis(query, messageHistory);
    }

    return response.data as LLMAnalysisResult;
  } catch (error) {
    console.error('LLM analysis error:', error);
    return await mockLLMAnalysis(query, messageHistory);
  }
};

/**
 * Fallback Mock Analysis
 * Used when backend is unavailable or for development
 */
const mockLLMAnalysis = async (query: string, messageHistory: Message[]): Promise<LLMAnalysisResult> => {
  const lowerQuery = query.toLowerCase();
  
  // Simple property detection
  const propertyKeywords = [
    'property', 'properties', 'comp', 'comps', 'comparable', 'comparables', 
    'house', 'houses', 'home', 'homes', 'real estate', 'listing', 'listings', 
    'bed', 'bedroom', 'bedrooms', 'bath', 'bathroom', 'bathrooms'
  ];
  const isPropertyRelated = propertyKeywords.some(keyword => lowerQuery.includes(keyword));

  if (!isPropertyRelated) {
    // Check if it's a content creation request
    const contentKeywords = ['write', 'create', 'help me write', 'draft', 'compose', 'generate', 'refine', 'edit', 'improve', 'rewrite'];
    const isContentRequest = contentKeywords.some(keyword => lowerQuery.includes(keyword));
    
    if (isContentRequest) {
      return {
        isPropertyRelated: false,
        needsClarification: false,
        extractedCriteria: {},
        responseType: 'content_creation',
        suggestedResponse: "I can help you write property descriptions. What property details do you have?"
      };
    }
    
    return {
      isPropertyRelated: false,
      needsClarification: false,
      extractedCriteria: {},
      responseType: 'general_response',
      suggestedResponse: "Hello. How can I help you today?"
    };
  }

  // Extract criteria
  const bedroomMatch = lowerQuery.match(/(\d+)\s*(?:bed|bedroom|bedrooms)/);
  const bathroomMatch = lowerQuery.match(/(\d+)\s*(?:bath|bathroom|bathrooms)/);
  const locationMatch = lowerQuery.match(/(?:in|at|near|around)\s+([a-zA-Z\s]+?)(?:\s|$|,|\.)/);
  
  const extractedCriteria = {
    bedrooms: bedroomMatch ? parseInt(bedroomMatch[1]) : undefined,
    bathrooms: bathroomMatch ? parseInt(bathroomMatch[1]) : undefined,
    location: locationMatch ? locationMatch[1].trim().toLowerCase() : undefined,
    priceRange: undefined
  };

  // Check if needs clarification
  const vagueTerms = ['comps', 'comp', 'comparable', 'comparables', 'properties', 'property'];
  const hasVagueTerms = vagueTerms.some(term => lowerQuery.includes(term));
  const hasSpecificTerms = bedroomMatch || bathroomMatch || locationMatch || 
                          lowerQuery.includes('price') || lowerQuery.includes('value');
  
  const needsClarification = hasVagueTerms && !hasSpecificTerms;

  if (needsClarification) {
    return {
      isPropertyRelated: true,
      needsClarification: true,
      extractedCriteria: {},
      responseType: 'clarification',
      suggestedResponse: "I can help you find property comparables. Please specify: bedrooms, location, and price range."
    };
  }

  return {
    isPropertyRelated: true,
    needsClarification: false,
    extractedCriteria,
    responseType: 'property_search',
    suggestedResponse: `Found properties matching your criteria.`
  };
};
