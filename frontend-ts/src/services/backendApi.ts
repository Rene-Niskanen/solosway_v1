/**
 * Backend API Service
 * Central service for all Flask backend communications
 * This keeps API keys secure on the backend
 */

import { env } from '@/config/env';

const BACKEND_URL = env.backendUrl;

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

class BackendApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = BACKEND_URL;
  }

  /**
   * Generic fetch wrapper with error handling
   */
  private async fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // ← CRITICAL: Include session cookies
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * AI Chat & Query Analysis
   */
  async analyzeQuery(query: string, messageHistory: any[] = []) {
    return this.fetchApi('/api/llm/analyze-query', {
      method: 'POST',
      body: JSON.stringify({ query, messageHistory }),
    });
  }

  async chatCompletion(messages: any[]) {
    return this.fetchApi('/api/llm/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });
  }

  /**
   * Property Search & Analysis
   */
  async getAllProperties() {
    return this.fetchApi('/api/properties', {
      method: 'GET',
    });
  }

  async searchProperties(query: string, filters?: any) {
    return this.fetchApi('/api/properties/search', {
      method: 'POST',
      body: JSON.stringify({ query, filters }),
    });
  }

  async analyzePropertyQuery(query: string, previousResults: any[] = []) {
    return this.fetchApi('/api/properties/analyze', {
      method: 'POST',
      body: JSON.stringify({ query, previousResults }),
    });
  }

  async getPropertyComparables(propertyId: string, criteria?: any) {
    return this.fetchApi(`/api/properties/${propertyId}/comparables`, {
      method: 'POST',
      body: JSON.stringify({ criteria }),
    });
  }

  /**
   * OCR & Document Processing
   */
  async extractTextFromImage(imageFile: File) {
    const formData = new FormData();
    formData.append('image', imageFile);

    return this.fetchApi('/api/ocr/extract', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for multipart/form-data
    });
  }

  async uploadPropertyDocument(file: File, metadata?: any) {
    const formData = new FormData();
    formData.append('file', file);  // Changed from 'document' to 'file'
    if (metadata) {
      formData.append('metadata', JSON.stringify(metadata));
    }

    // For FormData uploads, we need to handle this differently to avoid Content-Type conflicts
    try {
      const url = `${this.baseUrl}/api/documents/upload`;
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include', // Include session cookies
        body: formData, // Don't set Content-Type - let browser handle it
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error(`API Error [/api/documents/upload]:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Geocoding & Location Services
   */
  async geocodeAddress(address: string) {
    return this.fetchApi('/api/location/geocode', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
  }

  async reverseGeocode(lat: number, lng: number) {
    return this.fetchApi('/api/location/reverse-geocode', {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
    });
  }

  async searchLocation(query: string) {
    return this.fetchApi('/api/location/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  /**
   * Analytics & Activity Tracking
   */
  async logActivity(activity: any) {
    return this.fetchApi('/api/analytics/activity', {
      method: 'POST',
      body: JSON.stringify(activity),
    });
  }

  async getAnalytics(filters?: any) {
    const queryParams = filters ? `?${new URLSearchParams(filters)}` : '';
    return this.fetchApi(`/api/analytics${queryParams}`);
  }

  /**
   * Multi-Agent System Endpoints
   */
  async executeAgentTask(taskType: string, taskData: any) {
    return this.fetchApi('/api/agents/execute', {
      method: 'POST',
      body: JSON.stringify({ taskType, taskData }),
    });
  }

  async getAgentStatus(taskId: string) {
    return this.fetchApi(`/api/agents/status/${taskId}`);
  }

  /**
   * File Management Endpoints
   */
  async getUploadedFiles() {
    return this.fetchApi('/api/files');
  }

  async deleteFile(fileId: string) {
    return this.fetchApi(`/api/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  async downloadFile(fileId: string) {
    return this.fetchApi(`/api/files/${fileId}/download`);
  }

  async getFileDetails(fileId: string) {
    return this.fetchApi(`/api/files/${fileId}`);
  }

  /**
   * Authentication
   */
  async signUp(userData: {
    email: string;
    password: string;
    firstName: string;
    companyName: string;
  }) {
    return this.fetchApi('/api/signup', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async checkAuth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/dashboard`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          data: data
        };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Health Check
   */
  async healthCheck() {
    return this.fetchApi('/api/health');
  }

  /**
   * Check if backend is available
   */
  async isBackendAvailable(): Promise<boolean> {
    try {
      const result = await this.healthCheck();
      return result.success;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const backendApi = new BackendApiService();

// Export types
export type { ApiResponse };

