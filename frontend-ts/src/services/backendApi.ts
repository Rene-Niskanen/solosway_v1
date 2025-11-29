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

// Property image interface
interface PropertyImage {
  url: string;
  filename: string;
  extracted_at: string;
  image_index: number;
  size_bytes: number;
}

// Enhanced property interface with image support
interface PropertyData {
  id: string;
  property_address: string;
  property_type?: string;
  number_bedrooms?: number;
  number_bathrooms?: number;
  size_sqft?: number;
  asking_price?: number;
  sold_price?: number;
  rent_pcm?: number;
  price_per_sqft?: number;
  yield_percentage?: number;
  condition?: string;
  tenure?: string;
  epc_rating?: string;
  other_amenities?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  geocoded_address?: string;
  geocoding_confidence?: number;
  geocoding_status?: string;
  // Property images
  property_images?: PropertyImage[];
  image_count?: number;
  primary_image_url?: string;
  has_images?: boolean;
  total_images?: number;
  image_metadata?: {
    extraction_method?: string;
    total_images?: number;
    extraction_timestamp?: string;
  };
  // Property linking
  property_id?: string;
  normalized_address?: string;
  address_hash?: string;
  address_source?: string;
  // Timestamps
  extracted_at?: string;
  created_at?: string;
  updated_at?: string;
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
      
      // Don't set Content-Type for FormData - let browser set it with boundary
      const isFormData = options.body instanceof FormData;
      const headers = isFormData 
        ? { ...options.headers } 
        : { 'Content-Type': 'application/json', ...options.headers };
      
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // ← CRITICAL: Include session cookies
        headers,
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
   * Query documents using LangGraph RAG system
   * This connects the SideChatPanel to the document Q&A system
   */
  async queryDocuments(
    query: string, 
    propertyId?: string, 
    messageHistory: any[] = [], 
    sessionId?: string
  ): Promise<ApiResponse<any>> {
    return this.fetchApi('/api/llm/query', {
      method: 'POST',
      body: JSON.stringify({ 
        query, 
        propertyId,  // From property attachment - used to find linked document
        messageHistory,
        sessionId: sessionId || `session_${Date.now()}`
      }),
    });
  }

  /**
   * Stream query documents using Server-Sent Events (SSE)
   * Returns an EventSource for real-time token streaming
   */
  queryDocumentsStream(
    query: string,
    propertyId: string | undefined,
    messageHistory: any[],
    sessionId: string,
    onToken: (token: string) => void,
    onComplete: (data: any) => void,
    onError: (error: string) => void,
    onStatus?: (message: string) => void
  ): EventSource {
    const baseUrl = this.baseUrl || 'http://localhost:5002';
    const url = `${baseUrl}/api/llm/query/stream`;
    
    // Create a POST request with SSE
    // Note: EventSource only supports GET, so we'll use fetch with streaming
    const eventSource = new EventSource(
      `${url}?query=${encodeURIComponent(query)}&propertyId=${propertyId || ''}&sessionId=${sessionId}`
    );
    
    // Use fetch with streaming instead (EventSource doesn't support POST)
    // For now, return a mock EventSource - we'll implement proper streaming with fetch
    return eventSource;
  }

  /**
   * Stream query documents using fetch with Server-Sent Events
   * Properly handles POST requests with streaming
   */
  async queryDocumentsStreamFetch(
    query: string,
    propertyId: string | undefined,
    messageHistory: any[],
    sessionId: string,
    onToken: (token: string) => void,
    onComplete: (data: any) => void,
    onError: (error: string) => void,
    onStatus?: (message: string) => void,
    abortSignal?: AbortSignal,
    documentIds?: string[]
  ): Promise<void> {
    const baseUrl = this.baseUrl || 'http://localhost:5002';
    const url = `${baseUrl}/api/llm/query/stream`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: abortSignal, // Add abort signal support
        body: JSON.stringify({
          query,
          propertyId,
          messageHistory,
          sessionId: sessionId || `session_${Date.now()}`,
          documentIds: documentIds || undefined
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      let buffer = '';
      let accumulatedText = '';

      // Set up abort handler
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          reader.cancel();
        });
      }

      while (true) {
        // Check if aborted
        if (abortSignal?.aborted) {
          reader.cancel();
          return; // Silently return on abort
        }
        
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case 'status':
                  onStatus?.(data.message);
                  break;
                case 'token':
                  accumulatedText += data.token;
                  onToken(data.token);
                  break;
                case 'documents_found':
                  onStatus?.(`Found ${data.count} relevant document(s)`);
                  break;
                case 'complete':
                  onComplete(data.data);
                  return;
                case 'error':
                  onError(data.message);
                  return;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', line, e);
            }
          }
        }
      }
    } catch (error) {
      // Don't call onError if it was aborted (user cancelled)
      if (error instanceof Error && error.message === 'Request aborted') {
        return; // Silently return on abort
      }
      onError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Property Search & Analysis
   */
  async getAllProperties(): Promise<ApiResponse<PropertyData[]>> {
    return this.fetchApi<PropertyData[]>('/api/properties', {
      method: 'GET',
    });
  }

  async searchProperties(query: string, filters?: any): Promise<ApiResponse<PropertyData[]>> {
    return this.fetchApi<PropertyData[]>('/api/properties/search', {
      method: 'POST',
      body: JSON.stringify({ query, filters }),
    });
  }

  /**
   * Property Hub API Methods (New)
   */
  async getAllPropertyHubs(): Promise<ApiResponse<any[]>> {
    return this.fetchApi<any[]>('/api/property-hub', {
      method: 'GET',
    });
  }

  async getPropertyHub(propertyId: string): Promise<ApiResponse<any>> {
    return this.fetchApi<any>(`/api/property-hub/${propertyId}`, {
      method: 'GET',
    });
  }

  async searchPropertyHubs(query: string, filters?: any): Promise<ApiResponse<any[]>> {
    return this.fetchApi<any[]>('/api/property-hub/search', {
      method: 'POST',
      body: JSON.stringify({ query, filters }),
    });
  }

  async getPropertyPins(): Promise<ApiResponse<any[]>> {
    return this.fetchApi<any[]>('/api/properties/pins', {
      method: 'GET',
    });
  }

  async getPropertyCardSummary(propertyId: string, useCache: boolean = true): Promise<ApiResponse<any>> {
    return this.fetchApi<any>(`/api/properties/card-summary/${propertyId}?use_cache=${useCache}`, {
      method: 'GET',
    });
  }

  async getPropertyHubDocuments(propertyId: string): Promise<ApiResponse<any>> {
    // OPTIMIZATION: Use lightweight documents endpoint (100x faster - no N+1 queries)
    return this.fetchApi<any>(`/api/properties/${propertyId}/documents`, {
      method: 'GET',
    });
  }

  // Preload documents for a property (call on hover for faster loading)
  async preloadPropertyDocuments(propertyId: string): Promise<void> {
    // Skip if already cached
    if ((window as any).__preloadedPropertyFiles?.[propertyId]) {
      return;
    }
    
    try {
      const response = await this.getPropertyHubDocuments(propertyId);
      
      let documentsToUse = null;
      if (response && response.success && response.data) {
        if (response.data.documents && Array.isArray(response.data.documents)) {
          documentsToUse = response.data.documents;
        } else if (Array.isArray(response.data)) {
          documentsToUse = response.data;
        }
      }
      
      if (documentsToUse && documentsToUse.length > 0) {
        // Cache documents
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[propertyId] = documentsToUse;
        
        // Also preload first few document covers
        this.preloadDocumentCoversQuick(documentsToUse.slice(0, 6));
      }
    } catch (error) {
      // Silently fail - this is just a preload optimization
    }
  }

  // Quick preload of document covers (first 6)
  private async preloadDocumentCoversQuick(docs: any[]): Promise<void> {
    if (!docs || docs.length === 0) return;
    
    if (!(window as any).__preloadedDocumentCovers) {
      (window as any).__preloadedDocumentCovers = {};
    }
    
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    
    const preloadPromises = docs.map(async (doc) => {
      const docId = doc.id;
      if ((window as any).__preloadedDocumentCovers[docId]) return;
      
      try {
        const fileType = doc.file_type || '';
        const fileName = (doc.original_filename || '').toLowerCase();
        const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
        
        if (!isImage && !isPDF) return;
        
        let downloadUrl = doc.url || doc.download_url || doc.file_url || doc.s3_url;
        if (!downloadUrl && doc.s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
        } else if (!downloadUrl) {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
        }
        
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) return;
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        (window as any).__preloadedDocumentCovers[docId] = {
          url,
          type: blob.type,
          timestamp: Date.now()
        };
      } catch (error) {
        // Silently fail
      }
    });
    
    await Promise.allSettled(preloadPromises);
  }

  async analyzePropertyQuery(query: string, previousResults: PropertyData[] = []): Promise<ApiResponse<any>> {
    return this.fetchApi('/api/properties/analyze', {
      method: 'POST',
      body: JSON.stringify({ query, previousResults }),
    });
  }

  async getPropertyComparables(propertyId: string, criteria?: any): Promise<ApiResponse<PropertyData[]>> {
    return this.fetchApi<PropertyData[]>(`/api/properties/${propertyId}/comparables`, {
      method: 'POST',
      body: JSON.stringify({ criteria }),
    });
  }

  /**
   * Property Node Management (for property-centric view)
   */
  async getPropertyNodes(): Promise<ApiResponse<any[]>> {
    return this.fetchApi('/api/property-nodes', {
      method: 'GET',
    });
  }

  async getPropertyNodeDetails(propertyId: string): Promise<ApiResponse<any>> {
    return this.fetchApi(`/api/property-nodes/${propertyId}`, {
      method: 'GET',
    });
  }

  /**
   * Property Image Management
   */
  async getPropertyImages(propertyId: string): Promise<ApiResponse<PropertyImage[]>> {
    return this.fetchApi<PropertyImage[]>(`/api/properties/${propertyId}/images`, {
      method: 'GET',
    });
  }

  async uploadPropertyImage(propertyId: string, imageFile: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('property_id', propertyId);

    return this.fetchApi(`/api/properties/${propertyId}/images`, {
      method: 'POST',
      body: formData,
    });
  }

  async deletePropertyImage(propertyId: string, imageId: string): Promise<ApiResponse<any>> {
    return this.fetchApi(`/api/properties/${propertyId}/images/${imageId}`, {
      method: 'DELETE',
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

  /**
   * Get presigned URL for direct S3 upload (bypasses API Gateway size limits)
   */
  async getPresignedUploadUrl(filename: string, fileType: string) {
    return this.fetchApi('/api/documents/presigned-url', {
      method: 'POST',
      body: JSON.stringify({ filename, file_type: fileType }),
    });
  }

  /**
   * Confirm successful upload and trigger processing
   */
  async confirmUpload(documentId: string, fileSize: number) {
    return this.fetchApi(`/api/documents/${documentId}/confirm-upload`, {
      method: 'POST',
      body: JSON.stringify({ file_size: fileSize }),
    });
  }

  /**
   * Upload file directly to S3 using presigned URL
   */
  async uploadToS3(presignedUrl: string, file: File): Promise<boolean> {
    try {
      const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('S3 upload error:', error);
      return false;
    }
  }

  /**
   * Legacy upload method (kept for backward compatibility)
   */
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


  async getDocumentStatus(documentId: string) {
    try {
        const response = await this.fetchApi(`/api/documents/${documentId}/status`);
        return response;
    } catch (error) {
        console.error(`❌ Failed to get document status: ${error}`);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
  }
  /**
   * New upload method using presigned URLs (recommended for large files)
   */
  async uploadPropertyDocumentWithPresignedUrl(file: File, metadata?: any) {
    try {
      console.log(`🚀 Starting presigned upload for: ${file.name}`);
      
      // Step 1: Get presigned URL
      const presignedResponse = await this.getPresignedUploadUrl(file.name, file.type);
      
      if (!presignedResponse.success) {
        throw new Error(presignedResponse.error || 'Failed to get presigned URL');
      }

      const { document_id, presigned_url } = presignedResponse.data as any;
      console.log(`✅ Got presigned URL for document: ${document_id}`);

      // Step 2: Upload directly to S3
      console.log(`📤 Uploading to S3: ${file.name} (${file.size} bytes)`);
      const s3UploadSuccess = await this.uploadToS3(presigned_url, file);
      
      if (!s3UploadSuccess) {
        throw new Error('Failed to upload file to S3');
      }
      
      console.log(`✅ File uploaded to S3 successfully`);

      // Step 3: Confirm upload and trigger processing
      console.log(`🔄 Confirming upload and starting processing...`);
      const confirmResponse = await this.confirmUpload(document_id, file.size);
      
      if (!confirmResponse.success) {
        throw new Error(confirmResponse.error || 'Failed to confirm upload');
      }

      console.log(`✅ Upload confirmed and processing started`);
      
      return {
        success: true,
        data: {
          document_id,
          task_id: (confirmResponse.data as any)?.task_id,
          message: 'File uploaded successfully and processing started'
        }
      };

    } catch (error) {
      console.error(`❌ Presigned upload failed for ${file.name}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Upload file via backend proxy (fallback for CORS issues)
   * Supports progress tracking via onProgress callback
   */
  async uploadPropertyDocumentViaProxy(
    file: File, 
    metadata?: any,
    onProgress?: (percent: number) => void
  ) {
    return new Promise<{ success: boolean; data?: any; error?: string }>((resolve) => {
    try {
      console.log(`🚀 Starting proxy upload for: ${file.name}`);
      
      const formData = new FormData();
      formData.append('file', file);
      
      if (metadata) {
        Object.keys(metadata).forEach(key => {
          formData.append(key, metadata[key]);
        });
      }

        const xhr = new XMLHttpRequest();
        const url = `${this.baseUrl}/api/documents/proxy-upload`;

        // Track upload progress - ensure events fire frequently
        let lastReportedProgress = -1; // Start at -1 to allow 0% to be reported
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress && e.total > 0) {
            // Calculate progress as a percentage, using more precision for smoother updates
            const rawPercent = (e.loaded / e.total) * 100;
            // Cap at 90% during upload - the remaining 10% will be when file appears in UI
            const cappedPercent = Math.min(rawPercent, 90);
            const percent = Math.min(Math.max(Math.round(cappedPercent), 0), 90);
            
            // Report progress if it has increased (allow 0% to be reported)
            if (percent > lastReportedProgress || (percent === 0 && lastReportedProgress === -1)) {
              console.log(`📊 Upload progress: ${percent}% (${e.loaded}/${e.total} bytes, raw: ${rawPercent.toFixed(2)}%, capped at 90%)`);
              lastReportedProgress = percent;
              // Call progress callback immediately for real-time updates
              onProgress(percent);
            } else {
              console.log(`📊 Upload progress skipped (duplicate): ${percent}% (last: ${lastReportedProgress}%)`);
            }
          } else {
            console.log(`📊 Upload progress event: lengthComputable=${e.lengthComputable}, onProgress=${!!onProgress}, total=${e.total}, loaded=${e.loaded}`);
            // If length not computable, try to estimate progress
            if (onProgress && e.loaded > 0) {
              // Estimate based on loaded bytes (rough estimate), cap at 90%
              const estimatedPercent = Math.min(Math.round((e.loaded / (e.loaded * 10)) * 100), 90);
              if (estimatedPercent > lastReportedProgress) {
                console.log(`📊 Estimated progress: ${estimatedPercent}% (${e.loaded} bytes, capped at 90%)`);
                lastReportedProgress = estimatedPercent;
                onProgress(estimatedPercent);
              }
            }
          }
        };
        
        // Track onloadstart to ensure we start at 0%
        xhr.upload.onloadstart = () => {
          console.log('📊 Upload started - setting progress to 0%');
          if (onProgress) {
            lastReportedProgress = 0;
            onProgress(0);
          }
        };

        // Handle completion
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
      if (response.success) {
        console.log(`✅ Proxy upload successful: ${file.name}`);
                // Don't set to 100% here - let frontend handle it when file appears in UI
                // Backend returns {success: true, document_id: ...} directly, not wrapped in data
                resolve({
          success: true,
          data: response.data || response // Use response.data if exists, otherwise use response itself
                });
      } else {
        throw new Error(response.error || 'Upload failed');
      }
            } catch (parseError) {
              console.error(`❌ Failed to parse response: ${parseError}`);
              resolve({
                success: false,
                error: 'Failed to parse server response'
              });
            }
          } else {
            console.error(`❌ Upload failed with status: ${xhr.status}`);
            // Try to parse error response for more details
            let errorMessage = `Upload failed with status ${xhr.status}`;
            try {
              const errorResponse = JSON.parse(xhr.responseText);
              if (errorResponse.error) {
                errorMessage = errorResponse.error;
              }
              if (errorResponse.details) {
                errorMessage += ` (${errorResponse.details})`;
              }
            } catch (e) {
              // If response isn't JSON, use status text
              errorMessage = xhr.statusText || errorMessage;
            }
            resolve({
              success: false,
              error: errorMessage
            });
          }
        };

        // Handle errors
        xhr.onerror = () => {
          console.error(`❌ Proxy upload failed for ${file.name}: Network error`);
          resolve({
            success: false,
            error: 'Network error during upload'
          });
        };

        // Handle abort
        xhr.onabort = () => {
          console.log(`⚠️ Upload aborted for ${file.name}`);
          resolve({
            success: false,
            error: 'Upload was aborted'
          });
        };

        // Set up request to include credentials (matching fetchApi behavior)
        xhr.withCredentials = true;
        
        // Set up request headers (get auth token if available)
        const token = localStorage.getItem('auth_token');
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        // Send request
        xhr.open('POST', url);
        xhr.send(formData);

    } catch (error) {
      console.error(`❌ Proxy upload failed for ${file.name}:`, error);
        resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
    }
    });
  }

  /**
   * Test S3 upload (simple test without database record)
   */
  async testS3Upload(file: File) {
    try {
      console.log(`🧪 Testing S3 upload for: ${file.name}`);
      
      const formData = new FormData();
      formData.append('file', file);

      const response = await this.fetchApi('/api/documents/test-s3', {
        method: 'POST',
        body: formData,
      });

      if (response.success) {
        console.log(`✅ S3 test upload successful: ${file.name}`);
        return {
          success: true,
          data: response.data
        };
      } else {
        throw new Error(response.error || 'S3 test upload failed');
      }

    } catch (error) {
      console.error(`❌ S3 test upload failed for ${file.name}:`, error);
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

  /**
   * Create a new property with location
   */
  async createProperty(
    address: string,
    coordinates: { lat: number; lng: number }
  ): Promise<ApiResponse> {
    return this.fetchApi('/api/properties/create', {
      method: 'POST',
      body: JSON.stringify({
        address,
        formatted_address: address,
        normalized_address: address.toLowerCase(),
        latitude: coordinates.lat,
        longitude: coordinates.lng
      })
    });
  }

  /**
   * Extract address from uploaded document
   */
  async extractAddressFromDocument(documentId: string): Promise<ApiResponse<string>> {
    return this.fetchApi<string>(`/api/documents/${documentId}/extract-address`, {
      method: 'POST'
    });
  }

  /**
   * Link document to property
   */
  async linkDocumentToProperty(documentId: string, propertyId: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/documents/${documentId}/link-property`, {
      method: 'PUT',
      body: JSON.stringify({ property_id: propertyId })
    });
  }

  /**
   * Update property custom name
   */
  async updatePropertyName(propertyId: string, customName: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/properties/${propertyId}/update-name`, {
      method: 'PUT',
      body: JSON.stringify({ custom_name: customName })
    });
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/document/${documentId}`, {
      method: 'DELETE'
    });
  }
}

// Property-related interfaces
export interface PropertyNode {
  id: string;
  address_hash: string;
  normalized_address: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  business_id: string;
  created_at: string;
  updated_at: string;
  document_count: number;
}

export interface PropertyWithDocuments {
  property: PropertyNode;
  documents: Array<{
    id: string;
    original_filename: string;
    status: string;
    classification_type: string;
    created_at: string;
  }>;
  extracted_properties: Array<any>;
  document_count: number;
  extracted_property_count: number;
}

export interface PropertyStatistics {
  total_properties: number;
  total_documents: number;
  total_extracted_properties: number;
  properties_with_documents: number;
  properties_geocoded: number;
  geocoding_percentage: number;
  document_linkage_percentage: number;
}

// Property API methods
export const getAllPropertyNodes = async (): Promise<PropertyNode[]> => {
  const response = await fetch('/api/property-nodes', {
    credentials: 'include'
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch property nodes');
  }
  return data.data;
};

export const getPropertyNodeDetails = async (propertyId: string): Promise<PropertyWithDocuments> => {
  const response = await fetch(`/api/property-nodes/${propertyId}`, {
    credentials: 'include'
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch property node details');
  }
  return data.data;
};

export const searchPropertyNodes = async (query: string, limit: number = 10): Promise<PropertyNode[]> => {
  const response = await fetch(`/api/property-nodes/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
    credentials: 'include'
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to search property nodes');
  }
  return data.data;
};

export const getPropertyNodeStatistics = async (): Promise<PropertyStatistics> => {
  const response = await fetch('/api/property-nodes/statistics', {
    credentials: 'include'
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch property node statistics');
  }
  return data.data;
};

// Export singleton instance
export const backendApi = new BackendApiService();

// Export types
export type { ApiResponse, PropertyData, PropertyImage };

