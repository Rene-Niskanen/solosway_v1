/**
 * BackendApi.tsx
 * React component for managing backend API connections
 * This provides a clean interface for connecting to your Flask backend
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { backendApi } from '../services/backendApi';

// Types for backend communication
interface BackendStatus {
  isConnected: boolean;
  lastChecked: Date | null;
  error: string | null;
}

interface BackendApiContextType {
  status: BackendStatus;
  testConnection: () => Promise<boolean>;
  getProperties: (query?: string) => Promise<any[]>;
  getPropertyById: (id: number) => Promise<any>;
  searchProperties: (query: string, filters?: any) => Promise<any[]>;
  analyzeQuery: (query: string, messageHistory?: any[]) => Promise<any>;
  chatCompletion: (messages: any[]) => Promise<any>;
  extractTextFromImage: (imageFile: File) => Promise<any>;
  geocodeAddress: (address: string) => Promise<any>;
  reverseGeocode: (lat: number, lng: number) => Promise<any>;
  getAnalytics: () => Promise<any>;
  getActivityFeed: () => Promise<any>;
  runMultiAgentAnalysis: (data: any) => Promise<any>;
  // New Property Hub methods
  getAllPropertyHubs: () => Promise<any[]>;
  getPropertyHub: (propertyId: string) => Promise<any>;
  searchPropertyHubs: (query: string, filters?: any) => Promise<any[]>;
  getPropertyHubDocuments: (propertyId: string) => Promise<any>;
}

const BackendApiContext = createContext<BackendApiContextType | undefined>(undefined);

export const useBackendApi = () => {
  const context = useContext(BackendApiContext);
  if (!context) {
    throw new Error('useBackendApi must be used within a BackendApiProvider');
  }
  return context;
};

interface BackendApiProviderProps {
  children: React.ReactNode;
}

export const BackendApiProvider: React.FC<BackendApiProviderProps> = ({ children }) => {
  const [status, setStatus] = useState<BackendStatus>({
    isConnected: false,
    lastChecked: null,
    error: null
  });

  // Test backend connection
  const testConnection = async (): Promise<boolean> => {
    try {
      console.log('🔗 Testing backend connection...');
      
      // Try a simple health check endpoint
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setStatus({
          isConnected: true,
          lastChecked: new Date(),
          error: null
        });
        console.log('✅ Backend connection successful');
        return true;
      } else {
        throw new Error(`Backend responded with status: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Backend connection failed:', error);
      setStatus({
        isConnected: false,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  };

  // Property-related methods
  const getProperties = async (query?: string): Promise<any[]> => {
    try {
      if (status.isConnected) {
        // If no query, get all properties; otherwise search
        const response = query 
          ? await backendApi.searchProperties(query, {})
          : await backendApi.getAllProperties();
        
        console.log(`🏠 Backend response structure:`, response);
        console.log(`🏠 Response.data:`, response.data);
        console.log(`🏠 Response.success:`, response.success);
        
        // 🔍 PHASE 1 DEBUG: Detailed API response analysis
        console.log('🔍 PHASE 1 DEBUG - Backend API Response Analysis:', {
          response_type: typeof response.data,
          response_is_array: Array.isArray(response.data),
          response_length: Array.isArray(response.data) ? response.data.length : 'not array',
          sample_property: Array.isArray(response.data) && response.data.length > 0 ? response.data[0] : null
        });
        
        if (Array.isArray(response.data) && response.data.length > 0) {
          const sampleProp = response.data[0];
          console.log('🔍 PHASE 1 DEBUG - Sample Property from API:', {
            address: sampleProp.property_address,
            sold_price: sampleProp.sold_price,
            rent_pcm: sampleProp.rent_pcm,
            asking_price: sampleProp.asking_price,
            all_keys: Object.keys(sampleProp)
          });
        }
        
        // Handle response structure
        const actualData = response.data || [];
        console.log(`🏠 Actual data array:`, actualData);
        console.log(`🏠 Fetched ${actualData.length || 0} properties from backend`);
        return actualData;
      } else {
        console.warn('⚠️ Backend not connected');
        return [];
      }
    } catch (error) {
      console.error('Error fetching properties:', error);
      return [];
    }
  };

  const getPropertyById = async (id: number): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.getPropertyNodeDetails(id.toString());
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected');
        return null;
      }
    } catch (error) {
      console.error('Error fetching property by ID:', error);
      return null;
    }
  };

  const searchProperties = async (query: string, filters?: any): Promise<any[]> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.searchProperties(query, filters);
        return response.data || [];
      } else {
        console.warn('⚠️ Backend not connected');
        return [];
      }
    } catch (error) {
      console.error('Error searching properties:', error);
      return [];
    }
  };

  // AI/LLM methods
  const analyzeQuery = async (query: string, messageHistory?: any[]): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.analyzeQuery(query, messageHistory || []);
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, using fallback analysis');
        // Simple fallback analysis
        return {
          isPropertyRelated: query.toLowerCase().includes('property') || 
                           query.toLowerCase().includes('house') ||
                           query.toLowerCase().includes('flat'),
          needsClarification: false,
          extractedCriteria: {},
          responseType: 'property_search',
          suggestedResponse: 'I can help you find properties. Please specify your requirements.'
        };
      }
    } catch (error) {
      console.error('Error analyzing query:', error);
      return {
        isPropertyRelated: false,
        needsClarification: true,
        extractedCriteria: {},
        responseType: 'clarification',
        suggestedResponse: 'I can help you find properties. Please specify your requirements.'
      };
    }
  };

  const chatCompletion = async (messages: any[]): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.chatCompletion(messages);
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, using fallback response');
        return {
          message: 'I can help you find properties. Please specify your requirements.',
          type: 'text'
        };
      }
    } catch (error) {
      console.error('Error in chat completion:', error);
      return {
        message: 'Sorry, I encountered an error. Please try again.',
        type: 'error'
      };
    }
  };

  // Image/OCR methods
  const extractTextFromImage = async (imageFile: File): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.extractTextFromImage(imageFile);
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, OCR not available');
        return {
          text: 'OCR service not available - backend not connected',
          confidence: 0
        };
      }
    } catch (error) {
      console.error('Error extracting text from image:', error);
      return {
        text: 'Error extracting text from image',
        confidence: 0
      };
    }
  };

  // Location methods
  const geocodeAddress = async (address: string): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.geocodeAddress(address);
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, using fallback geocoding');
        // Simple fallback - return Bristol coordinates
        return {
          lat: 51.4545,
          lng: -2.5879,
          address: address,
          confidence: 0.5
        };
      }
    } catch (error) {
      console.error('Error geocoding address:', error);
      return null;
    }
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.reverseGeocode(lat, lng);
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, using fallback reverse geocoding');
        return {
          address: 'Bristol, UK',
          confidence: 0.5
        };
      }
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      return null;
    }
  };

  // Analytics methods
  const getAnalytics = async (): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.getAnalytics();
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, using fallback analytics');
        return {
          totalProperties: 15,
          totalSearches: 0,
          averagePrice: 450000
        };
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      return null;
    }
  };

  const getActivityFeed = async (): Promise<any> => {
    try {
      if (status.isConnected) {
        // TODO: Implement getActivityFeed in backendApi
        console.warn('⚠️ getActivityFeed not implemented in backendApi');
        return [];
      } else {
        console.warn('⚠️ Backend not connected, using fallback activity feed');
        return [];
      }
    } catch (error) {
      console.error('Error fetching activity feed:', error);
      return [];
    }
  };

  const runMultiAgentAnalysis = async (data: any): Promise<any> => {
    try {
      if (status.isConnected) {
        // TODO: Implement runMultiAgentAnalysis in backendApi
        console.warn('⚠️ runMultiAgentAnalysis not implemented in backendApi');
        return {
          analysis: 'Multi-agent analysis not available - backend not connected',
          confidence: 0
        };
      } else {
        console.warn('⚠️ Backend not connected, multi-agent analysis not available');
        return {
          analysis: 'Multi-agent analysis not available - backend not connected',
          confidence: 0
        };
      }
    } catch (error) {
      console.error('Error running multi-agent analysis:', error);
      return null;
    }
  };

  // New Property Hub methods
  const getAllPropertyHubs = async (): Promise<any[]> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.getAllPropertyHubs();
        console.log('🏠 Property Hubs response:', response);
        // Backend response is wrapped by fetchApi, so we need response.data.properties
        if (response.data && typeof response.data === 'object' && 'properties' in response.data) {
          return Array.isArray(response.data.properties) ? response.data.properties : [];
        }
        return Array.isArray(response.data) ? response.data : [];
      } else {
        console.warn('⚠️ Backend not connected, using fallback property hubs');
        return [];
      }
    } catch (error) {
      console.error('Error fetching property hubs:', error);
      return [];
    }
  };

  const getPropertyHub = async (propertyId: string): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.getPropertyHub(propertyId);
        // Backend response is wrapped by fetchApi, so we need response.data.property
        return response.data?.property || response.data;
      } else {
        console.warn('⚠️ Backend not connected, property hub not available');
        return null;
      }
    } catch (error) {
      console.error('Error fetching property hub:', error);
      return null;
    }
  };

  const searchPropertyHubs = async (query: string, filters?: any): Promise<any[]> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.searchPropertyHubs(query, filters);
        // Backend response is wrapped by fetchApi, so we need response.data.properties
        if (response.data && typeof response.data === 'object' && 'properties' in response.data) {
          return Array.isArray(response.data.properties) ? response.data.properties : [];
        }
        return Array.isArray(response.data) ? response.data : [];
      } else {
        console.warn('⚠️ Backend not connected, using fallback property hub search');
        return [];
      }
    } catch (error) {
      console.error('Error searching property hubs:', error);
      return [];
    }
  };

  const getPropertyHubDocuments = async (propertyId: string): Promise<any> => {
    try {
      if (status.isConnected) {
        const response = await backendApi.getPropertyHubDocuments(propertyId);
        return response.data;
      } else {
        console.warn('⚠️ Backend not connected, property hub documents not available');
        return null;
      }
    } catch (error) {
      console.error('Error fetching property hub documents:', error);
      return null;
    }
  };

  // Auto-test connection on mount
  useEffect(() => {
    testConnection();
  }, []);

  const value: BackendApiContextType = {
    status,
    testConnection,
    getProperties,
    getPropertyById,
    searchProperties,
    analyzeQuery,
    chatCompletion,
    extractTextFromImage,
    geocodeAddress,
    reverseGeocode,
    getAnalytics,
    getActivityFeed,
    runMultiAgentAnalysis,
    // New Property Hub methods
    getAllPropertyHubs,
    getPropertyHub,
    searchPropertyHubs,
    getPropertyHubDocuments
  };

  return (
    <BackendApiContext.Provider value={value}>
      {children}
    </BackendApiContext.Provider>
  );
};

export default BackendApiProvider;
