/**
 * Backend API Service
 * Central service for all Flask backend communications
 * This keeps API keys secure on the backend
 */

import { env } from '@/config/env';

const BACKEND_URL = env.backendUrl;

// OPTIMIZATION: Preconnect to backend immediately when module loads
// This establishes TCP connection + TLS handshake before first request
if (typeof window !== 'undefined' && BACKEND_URL) {
  const preconnectLink = document.createElement('link');
  preconnectLink.rel = 'preconnect';
  preconnectLink.href = BACKEND_URL;
  preconnectLink.crossOrigin = 'use-credentials';
  document.head.appendChild(preconnectLink);
  
  // Also add dns-prefetch as fallback
  const dnsPrefetch = document.createElement('link');
  dnsPrefetch.rel = 'dns-prefetch';
  dnsPrefetch.href = BACKEND_URL;
  document.head.appendChild(dnsPrefetch);
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
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

// Project interfaces
export interface ProjectData {
  id: string;
  user_id: number;
  client_name: string;
  client_logo_url?: string;
  title: string;
  description?: string;
  status: 'active' | 'negotiating' | 'archived';
  tags: string[];
  tool?: string;
  budget_min?: number;
  budget_max?: number;
  due_date?: string;
  thumbnail_url?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectData {
  client_name: string;
  client_logo_url?: string;
  title: string;
  description?: string;
  status?: 'active' | 'negotiating' | 'archived';
  tags?: string[];
  tool?: string;
  budget_min?: number;
  budget_max?: number;
  due_date?: string;
  thumbnail_url?: string;
  message_count?: number;
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
      

        // Add timeout for file/document requests (30 seconds - longer than auth check)
      // Only add timeout if no abort signal is already provided
      const hasExistingSignal = options.signal;
      const controller = hasExistingSignal ? undefined : new AbortController();
      const timeoutId = controller ? setTimeout(() => controller.abort(), 30000) : null;
      
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // ← CRITICAL: Include session cookies
        headers,
        signal: controller?.signal || options.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle 401 Unauthorized - clear auth state
        if (response.status === 401) {
          console.warn(`🔒 401 Unauthorized on ${endpoint} - clearing auth state`);
          localStorage.removeItem('isAuthenticated');
          // Return error with status code so caller can handle it
          return {
            success: false,
            error: errorData.error || 'Authentication required',
            statusCode: 401
          };
        }
        
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        data,
      };
    } catch (error) {
      // Handle timeout
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`⏱️ Request to ${endpoint} timed out after 30 seconds`);
        return {
          success: false,
          error: 'Request timeout - backend server not responding'
        };
      }
      
      console.error(`API Error [${endpoint}]:`, error);
      
      // Check if error message indicates 401
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      if (errorMessage.includes('401') || errorMessage.includes('Authentication required') || errorMessage.includes('Unauthorized')) {
        console.warn(`🔒 401 detected on ${endpoint} - clearing auth state`);
        localStorage.removeItem('isAuthenticated');
        return {
          success: false,
          error: errorMessage,
          statusCode: 401
        };
      }
      
      return {
        success: false,
        error: errorMessage,
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

  /**
   * Resolve block_id (e.g. chunk_<uuid>_block_1) to bbox for citation highlighting.
   * When citedText is provided, returns sub-level (line) bbox so the correct phrase is highlighted.
   */
  async resolveCitationBlockBbox(
    blockId: string,
    citedText?: string | null
  ): Promise<ApiResponse<{
    doc_id: string;
    chunk_id: string;
    block_index: number;
    page: number;
    bbox: { left: number; top: number; width: number; height: number; page?: number };
  }>> {
    return this.fetchApi('/api/citation/block-bbox', {
      method: 'POST',
      body: JSON.stringify({ block_id: blockId, cited_text: citedText || undefined }),
    });
  }

  async chatCompletion(messages: any[]) {
    return this.fetchApi('/api/llm/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });
  }

  /**
   * Submit chat feedback (thumbs down) - sends to connect@solosway.co via backend
   */
  async submitChatFeedback(payload: {
    category: string;
    details?: string;
    messageId?: string;
    conversationSnippet?: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    return this.fetchApi('/api/chat-feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
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
    const baseUrl = this.baseUrl || BACKEND_URL;
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
    documentIds?: string[],
    onReasoningStep?: (step: { step: string; message: string; details: any; action_type?: string; count?: number }) => void,
    onReasoningContext?: (context: { message: string; moment: string }) => void,
    onCitation?: (citation: { citation_number: string; data: any }) => void,
    onExecutionEvent?: (event: { type: string; description: string; metadata?: any; timestamp: number; event_id: string; parent_event_id?: string }) => void,  // NEW: Execution trace events
    citationContext?: { // Structured citation metadata (hidden from user, for LLM)
      document_id: string;
      page_number: number;
      bbox: { left: number; top: number; width: number; height: number };
      cited_text: string;
      original_filename: string;
      block_id?: string;
      source_message_text?: string;
    } | null,
    responseMode?: 'fast' | 'detailed' | 'full', // NEW: Response mode for file attachments
    attachmentContext?: { // NEW: Context from attached files (extracted text)
      texts: string[];
      pageTexts: string[][];
      filenames: string[];
      tempFileIds: string[];
    } | null,
    // AGENT-NATIVE: Callback for agent actions (open document, highlight, navigate, save)
    onAgentAction?: (action: { action: string; params: any }) => void,
    // AGENT MODE: Whether the user is in Agent mode (enables LLM tool-based actions)
    isAgentMode?: boolean,
    // MODEL SELECTION: User-selected LLM model
    model?: 'gpt-4o-mini' | 'gpt-4o' | 'claude-sonnet' | 'claude-opus',
    // EXTENDED THINKING: Callback for streaming thinking chunks (Claude models)
    onThinkingChunk?: (chunk: string) => void,
    onThinkingComplete?: (fullThinking: string) => void,
    // PLAN MODE: Callbacks for plan generation
    onPlanChunk?: (chunk: string) => void,
    onPlanComplete?: (planId: string, fullPlan: string, isUpdate?: boolean) => void,
    // PLAN MODE: Whether to generate a plan before execution
    planMode?: boolean,
    // PLAN UPDATE: Existing plan content for updates (when user provides follow-up)
    existingPlan?: string,
    // STREAMED TITLE: Chat title streamed from backend (so everything shown to user is streamed)
    onTitleChunk?: (token: string) => void
  ): Promise<void> {
    const baseUrl = this.baseUrl || BACKEND_URL;
    const url = `${baseUrl}/api/llm/query/stream`;
    
    const requestBody: Record<string, any> = {
      query,
      propertyId,
      messageHistory,
      sessionId: sessionId || `session_${Date.now()}`,
      documentIds: documentIds || undefined,
      citationContext: citationContext || undefined, // Pass citation context to backend
      responseMode: responseMode || undefined, // NEW: Pass response mode for attachment queries
      attachmentContext: attachmentContext || undefined, // NEW: Pass extracted text from attachments
      isAgentMode: isAgentMode ?? false, // AGENT MODE: Pass to backend for tool binding
      model: model || 'gpt-4o-mini', // MODEL SELECTION: User-selected LLM model
      planMode: planMode ?? false, // PLAN MODE: Generate plan before execution
      existingPlan: existingPlan || undefined // PLAN UPDATE: Existing plan for follow-up updates
    };
    
    if (import.meta.env.DEV) {
      console.log('🌐 backendApi.queryDocumentsStreamFetch: Sending request with documentIds:', documentIds, 'full body:', requestBody);
    }
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: abortSignal, // Add abort signal support
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        console.error('❌ backendApi: HTTP error:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText.substring(0, 500)
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        console.error('❌ backendApi: Response body is not readable');
        throw new Error('Response body is not readable');
      }
      
      console.log('✅ backendApi: Stream reader created, starting to read...');

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
        
        if (done) {
          console.log('✅ backendApi: Stream finished (done=true)');
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Log first chunk for debugging
        if (buffer.length < 200) {
          console.log('📦 backendApi: Received chunk:', chunk.substring(0, 100));
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              const data = JSON.parse(jsonStr);
              
              switch (data.type) {
                case 'status':
                  onStatus?.(data.message);
                  break;
                case 'reasoning_step':
                  if (onReasoningStep) {
                    onReasoningStep({
                      step: data.step,
                      action_type: data.action_type || 'analysing',
                      message: data.message,
                      count: data.count,
                      details: data.details || {}
                    });
                  }
                  break;
                case 'reasoning_context':
                  if (onReasoningContext) {
                    onReasoningContext({
                      message: data.message,
                      moment: data.moment
                    });
                  }
                  break;
                case 'citation':
                  if (onCitation) {
                    onCitation({
                      citation_number: String(data.citation_number),
                      data: data.data
                    });
                  }
                  break;
                case 'title_chunk':
                  if (onTitleChunk) {
                    onTitleChunk(data.token ?? '');
                  }
                  break;
                case 'token':
                  accumulatedText += data.token;
                  onToken(data.token);
                  // Log first few tokens for debugging
                  if (accumulatedText.length < 100) {
                    console.log('📝 backendApi: Received token:', data.token.substring(0, 50));
                  }
                  break;
                case 'execution_event':
                  // NEW: Handle execution trace events
                  if (onExecutionEvent && data.payload) {
                    onExecutionEvent(data.payload);
                  }
                  break;
                case 'documents_found':
                  onStatus?.(`Found ${data.count} relevant document(s)`);
                  break;
                case 'agent_action':
                  // AGENT-NATIVE: Handle agent actions (open_document, highlight_bbox, navigate_to_property, save_to_writing)
                  if (onAgentAction) {
                    onAgentAction({
                      action: data.action,
                      params: data.params || {}
                    });
                  }
                  break;
                case 'prepare_document':
                  // EARLY DOCUMENT PREPARATION: Start loading document before answer is generated
                  // This allows faster document display when open_document action comes later
                  if (onAgentAction) {
                    onAgentAction({
                      action: 'prepare_document',
                      params: {
                        doc_id: data.doc_id,
                        filename: data.filename,
                        download_url: data.download_url
                      }
                    });
                  }
                  break;
                case 'thinking_chunk':
                  // EXTENDED THINKING: Stream Claude's thinking process in real-time
                  if (onThinkingChunk) {
                    onThinkingChunk(data.content || '');
                  }
                  break;
                case 'thinking_complete':
                  // EXTENDED THINKING: Signal that thinking is complete
                  if (onThinkingComplete) {
                    onThinkingComplete(data.content || '');
                  }
                  break;
                case 'plan_chunk':
                  // PLAN MODE: Stream plan content chunk
                  if (onPlanChunk) {
                    onPlanChunk(data.content || '');
                  }
                  break;
                case 'plan_complete':
                  // PLAN MODE: Plan generation complete, ready for build
                  if (onPlanComplete) {
                    onPlanComplete(data.plan_id, data.full_plan || '', data.is_update || false);
                  }
                  break;
                case 'complete':
                  console.log('✅ backendApi: Received complete event:', {
                    hasData: !!data.data,
                    dataKeys: data.data ? Object.keys(data.data) : [],
                    hasSummary: !!data.data?.summary,
                    summaryLength: data.data?.summary?.length || 0,
                    summaryPreview: data.data?.summary?.substring(0, 100) || 'N/A',
                    citationsCount: data.data?.citations ? Object.keys(data.data.citations).length : 0,
                    fullData: data.data // Include full data for debugging
                  });
                  onComplete(data.data);
                  return;
                case 'error':
                  onError(data.message);
                  return;
              }
            } catch (e) {
              console.warn('⚠️ backendApi: Failed to parse SSE data:', {
                line: line.substring(0, 200),
                error: e instanceof Error ? e.message : String(e)
              });
            }
          }
        }
      }
    } catch (error) {
      // Don't call onError if it was aborted (user cancelled)
      if (error instanceof Error && error.message === 'Request aborted') {
        console.log('ℹ️ backendApi: Request aborted by user');
        return; // Silently return on abort
      }
      
      // Handle incomplete chunked encoding gracefully (network interruption)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isNetworkError = errorMessage.includes('ERR_INCOMPLETE_CHUNKED_ENCODING') || 
                            errorMessage.includes('Failed to fetch') ||
                            errorMessage.includes('network error');
      
      if (isNetworkError) {
        console.warn('⚠️ backendApi: Network error during streaming (connection interrupted):', errorMessage);
        onError('Connection interrupted. Please try again.');
      } else {
        console.error('❌ backendApi: Error in queryDocumentsStreamFetch:', {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined
        });
        onError(errorMessage);
      }
    }
  }

  /**
   * Build Plan - Execute a previously generated research plan
   * Called when user clicks "Build" in the Plan Viewer
   */
  async buildPlan(
    planId: string,
    sessionId: string,
    query: string,
    onToken?: (token: string) => void,
    onComplete?: (data: any) => void,
    onError?: (error: string) => void,
    onReasoningStep?: (step: { step: string; message: string; details: any; action_type?: string }) => void
  ): Promise<void> {
    const baseUrl = this.baseUrl || BACKEND_URL;
    const url = `${baseUrl}/api/llm/build-plan`;
    
    const requestBody = {
      planId,
      sessionId,
      query,
      buildConfirmed: true
    };
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      if (!response.body) {
        throw new Error('No response body');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              const data = JSON.parse(jsonStr);
              
              switch (data.type) {
                case 'token':
                  accumulatedText += data.token;
                  onToken?.(data.token);
                  break;
                case 'reasoning_step':
                  onReasoningStep?.({
                    step: data.step,
                    action_type: data.action_type || 'analysing',
                    message: data.message,
                    details: data.details || {}
                  });
                  break;
                case 'complete':
                  onComplete?.(data.data || { summary: accumulatedText });
                  break;
                case 'error':
                  onError?.(data.message || 'Unknown error');
                  break;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ backendApi: Error in buildPlan:', errorMessage);
      onError?.(errorMessage);
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

  /**
   * Process temp files that were uploaded via quick-extract.
   * Links them to a property and queues full document processing pipeline.
   */
  async processTempFiles(
    tempFileIds: string[],
    propertyId: string
  ): Promise<{ success: boolean; documentIds?: string[]; error?: string }> {
    try {
      console.log(`🔄 Processing ${tempFileIds.length} temp files for property ${propertyId}`);
      
      const response = await this.fetchApi<any>('/api/documents/process-temp-files', {
        method: 'POST',
        body: JSON.stringify({
          tempFileIds,
          propertyId
        })
      });
      
      if (response.success) {
        console.log(`✅ Temp files processing queued:`, response.data);
        return {
          success: true,
          documentIds: response.data?.documentIds || response.data?.document_ids
        };
      } else {
        return {
          success: false,
          error: response.error || 'Failed to process temp files'
        };
      }
    } catch (error) {
      console.error('❌ processTempFiles error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
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

  async getAllDocuments(): Promise<ApiResponse<any>> {
    // Fetch all documents across all properties
    // Use /api/files which is the old endpoint that worked
    return this.fetchApi<any>('/api/files', {
      method: 'GET',
    });
  }

  async getProcessingQueue(): Promise<ApiResponse<any>> {
    // Get documents currently in processing queue with their detailed history
    return this.fetchApi<any>('/api/documents/processing-queue', {
      method: 'GET',
    });
  }

  async getDocuments(): Promise<ApiResponse<any>> {
    // Fetch all documents for the business using /api/files endpoint (which wraps SupabaseDocumentService)
    // This endpoint returns { success: true, data: [...] }
    return this.fetchApi<any>('/api/files', {
      method: 'GET',
    });
  }

  async getDocumentsByFolder(folderId: string): Promise<ApiResponse<any>> {
    // Fetch documents in a specific folder
    return this.fetchApi<any>(`/api/documents/folder/${folderId}`, {
      method: 'GET',
    });
  }

  async createFolder(name: string, parentId?: string, propertyId?: string): Promise<ApiResponse<any>> {
    // Create a new folder
    return this.fetchApi<any>('/api/documents/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId, property_id: propertyId }),
    });
  }

  async moveDocument(documentId: string, folderId: string | null): Promise<ApiResponse<any>> {
    // Move a document to a folder (null folderId = root)
    return this.fetchApi<any>(`/api/documents/${documentId}/move`, {
      method: 'POST',
      body: JSON.stringify({ folder_id: folderId }),
    });
  }

  // Warm up connection to backend (establishes TCP + TLS early)
  private connectionWarmedUp = false;
  async warmConnection(): Promise<void> {
    if (this.connectionWarmedUp) return;
    this.connectionWarmedUp = true;
    
    try {
      await fetch(`${BACKEND_URL}/api/health`, {
        method: 'HEAD',
        credentials: 'include'
      }).catch(() => {});
    } catch {
      // Ignore
    }
  }

  // Preload documents for a property (call on click)
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
        
        // Preload covers
        this.preloadDocumentCoversQuick(documentsToUse);
      }
    } catch (error) {
      // Silently fail
    }
  }

  // Quick preload of document covers - images, PDFs, and DOCX (all in parallel)
  private async preloadDocumentCoversQuick(docs: any[]): Promise<void> {
    if (!docs || docs.length === 0) return;
    
    if (!(window as any).__preloadedDocumentCovers) {
      (window as any).__preloadedDocumentCovers = {};
    }
    
    const backendUrl = BACKEND_URL;
    
    // Preload images and PDFs (fast)
    const preloadImageOrPdf = async (doc: any) => {
      const docId = doc.id;
      if ((window as any).__preloadedDocumentCovers[docId]) return;
      
      const fileType = doc.file_type || '';
      const fileName = (doc.original_filename || '').toLowerCase();
      const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
      
      if (!isImage && !isPDF) return;
      
      try {
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
    };
    
    // Preload DOCX files (requires upload to S3)
    const preloadDocx = async (doc: any) => {
      const docId = doc.id;
      if ((window as any).__preloadedDocumentCovers[docId]) return;
      
      const fileType = doc.file_type || '';
      const fileName = (doc.original_filename || '').toLowerCase();
      const isDOCX = 
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileType === 'application/msword' ||
        fileType.includes('word') ||
        fileType.includes('document') ||
        fileName.endsWith('.docx') ||
        fileName.endsWith('.doc');
      
      if (!isDOCX) return;
      
      try {
        let downloadUrl = doc.url || doc.download_url || doc.file_url || doc.s3_url;
        if (!downloadUrl && doc.s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
        } else if (!downloadUrl) {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
        }
        
        // Download and upload in one flow
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) return;
        
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('file', blob, doc.original_filename || 'document.docx');
        
        // Upload to get presigned URL
        const uploadResponse = await fetch(`${backendUrl}/api/documents/temp-preview`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        
        if (uploadResponse.ok) {
          const data = await uploadResponse.json();
          if (data.presigned_url) {
            (window as any).__preloadedDocumentCovers[docId] = {
              url: data.presigned_url,
              type: 'docx',
              isDocx: true,
              timestamp: Date.now()
            };
          }
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    // Fire ALL requests in parallel - images, PDFs, and DOCX all at once
    const allPromises = [
      ...docs.map(preloadImageOrPdf),
      ...docs.map(preloadDocx)
    ];
    
    await Promise.allSettled(allPromises);
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

  async deleteProperty(propertyId: string): Promise<ApiResponse<any>> {
    return this.fetchApi(`/api/properties/${propertyId}`, {
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
   * Get key facts and summary for a document for FileViewModal.
   */
  async getDocumentKeyFacts(documentId: string): Promise<{
    success: boolean;
    data?: { key_facts: Array<{ label: string; value: string }>; summary?: string | null };
    error?: string;
  }> {
    try {
      const response = await this.fetchApi<{
        success?: boolean;
        data?: { key_facts?: Array<{ label: string; value: string }>; summary?: string | null };
      }>(`/api/documents/${documentId}/key-facts`);
      if (response?.success && response?.data) {
        // Backend returns { success, data: { key_facts, summary } }; fetchApi puts that whole body in response.data
        const inner = (response.data as { data?: { key_facts?: Array<{ label: string; value: string }>; summary?: string | null } }).data;
        const key_facts = inner?.key_facts ?? [];
        const summary = inner?.summary ?? null;
        return {
          success: true,
          data: { key_facts, summary },
        };
      }
      return { success: false, error: 'No data' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
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
   * Check if a document is a duplicate before uploading
   */
  async checkDuplicateDocument(filename: string, fileSize: number): Promise<ApiResponse<{
    is_duplicate: boolean;
    is_exact_duplicate?: boolean;
    existing_document?: any;
    existing_documents?: any[];
    message?: string;
  }>> {
    return this.fetchApi('/api/documents/check-duplicate', {
      method: 'POST',
      body: JSON.stringify({
        filename,
        file_size: fileSize
      }),
    });
  }

  /**
   * Upload document for general file uploads (NOT property-specific)
   * Triggers FULL processing pipeline: classification → extraction → embedding
   * Used by: FileManager, general document upload areas
   */
  async uploadDocument(
    file: File,
    onProgress?: (percent: number) => void
  ) {
    return new Promise<{ success: boolean; data?: any; error?: string }>((resolve) => {
    try {
      console.log(`🚀 Starting general document upload for: ${file.name}`);
      console.log(`📋 This will trigger FULL processing pipeline (classification → extraction → embedding)`);
      
      const formData = new FormData();
      formData.append('file', file);
      // NO metadata - general uploads don't have property_id

        const xhr = new XMLHttpRequest();
        const url = `${this.baseUrl}/api/documents/upload`;

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
        console.log(`✅ General document upload successful: ${file.name}`);
                console.log(`🔄 Full processing pipeline queued (classification → extraction → embedding)`);
                console.log(`📋 Document ID: ${response.document_id}`);
                // Don't set to 100% here - let frontend handle it when file appears in UI
                // Backend returns {success: true, document_id: ...} directly, not wrapped in data
                resolve({
          success: true,
          data: {
            document_id: response.document_id,
            ...response // Include all other fields
          }
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
          console.error(`❌ General document upload failed for ${file.name}: Network error`);
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
      console.error(`❌ General document upload failed for ${file.name}:`, error);
        resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
    }
    });
  }

  /**
   * Quick text extraction from file without full document processing.
   * Used for immediate AI responses when users attach files to chat.
   * 
   * Returns extracted text that can be used directly in LLM prompts,
   * plus a temp_file_id that can be used later for full processing
   * if the user decides to add the file to a project.
   */
  async quickExtractText(
    file: File,
    storeTempFile: boolean = true
  ): Promise<{
    success: boolean;
    text?: string;
    pageTexts?: string[];
    pageCount?: number;
    extractedPages?: number;
    truncated?: boolean;
    charCount?: number;
    wordCount?: number;
    tempFileId?: string;
    fileType?: string;
    filename?: string;
    error?: string;
  }> {
    try {
      console.log(`🔍 Starting quick text extraction for: ${file.name}`);
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('store_temp', storeTempFile.toString());

      const response = await fetch(`${this.baseUrl}/api/documents/quick-extract`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          // Don't set Content-Type - browser will set it with boundary for FormData
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error(`❌ Quick extraction failed: ${response.status}`, errorData);
        return {
          success: false,
          error: errorData.error || `HTTP ${response.status}`
        };
      }

      const result = await response.json();
      
      console.log(`✅ Quick extraction complete: ${result.page_count} pages, ${result.char_count} chars`);
      
      return {
        success: result.success,
        text: result.text,
        pageTexts: result.page_texts,
        pageCount: result.page_count,
        extractedPages: result.extracted_pages,
        truncated: result.truncated,
        charCount: result.char_count,
        wordCount: result.word_count,
        tempFileId: result.temp_file_id,
        fileType: result.file_type,
        filename: result.filename,
        error: result.error
      };

    } catch (error) {
      console.error(`❌ Quick extraction error for ${file.name}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Upload file via backend proxy (fallback for CORS issues)
   * Supports progress tracking via onProgress callback
   * Used for PROPERTY CARD uploads (fast pipeline with property_id)
   * 
   * @param file - The file to upload
   * @param metadata - Optional metadata including:
   *   - property_id: Link to a property
   *   - skip_processing: Don't queue processing task
   *   - project_upload: Mark as project upload
   *   - silent: Don't show global progress notification
   * @param onProgress - Progress callback (0-100)
   */
  async uploadPropertyDocumentViaProxy(
    file: File, 
    metadata?: any,
    onProgress?: (percent: number) => void
  ) {
    const isSilent = metadata?.silent === true;
    
    return new Promise<{ success: boolean; data?: any; error?: string }>((resolve) => {
    try {
      console.log(`🚀 Starting proxy upload for: ${file.name}${isSilent ? ' (silent)' : ''}`);
      
      // Dispatch upload start event for progress bar (unless silent)
      if (!isSilent) {
        window.dispatchEvent(new CustomEvent('upload-start', { 
          detail: { fileName: file.name } 
        }));
      }
      
      const formData = new FormData();
      formData.append('file', file);
      
      if (metadata) {
        Object.keys(metadata).forEach(key => {
          // Don't pass 'silent' to the backend - it's frontend-only
          if (key !== 'silent') {
            formData.append(key, metadata[key]);
          }
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
              if (onProgress) onProgress(percent);
              // Dispatch progress event for progress bar (unless silent)
              if (!isSilent) {
                window.dispatchEvent(new CustomEvent('upload-progress', { 
                  detail: { fileName: file.name, progress: percent } 
                }));
              }
            } else {
              console.log(`📊 Upload progress skipped (duplicate): ${percent}% (last: ${lastReportedProgress}%)`);
            }
          } else {
            console.log(`📊 Upload progress event: lengthComputable=${e.lengthComputable}, onProgress=${!!onProgress}, total=${e.total}, loaded=${e.loaded}`);
            // If length not computable, try to estimate progress
            if (e.loaded > 0) {
              // Estimate based on loaded bytes (rough estimate), cap at 90%
              const estimatedPercent = Math.min(Math.round((e.loaded / (e.loaded * 10)) * 100), 90);
              if (estimatedPercent > lastReportedProgress) {
                console.log(`📊 Estimated progress: ${estimatedPercent}% (${e.loaded} bytes, capped at 90%)`);
                lastReportedProgress = estimatedPercent;
                if (onProgress) onProgress(estimatedPercent);
                // Dispatch progress event for progress bar (unless silent)
                if (!isSilent) {
                  window.dispatchEvent(new CustomEvent('upload-progress', { 
                    detail: { fileName: file.name, progress: estimatedPercent } 
                  }));
                }
              }
            }
          }
        };
        
        // Track onloadstart to ensure we start at 0%
        xhr.upload.onloadstart = () => {
          console.log('📊 Upload started - setting progress to 0%');
            lastReportedProgress = 0;
          if (onProgress) onProgress(0);
        };

        // Handle completion
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
      if (response.success) {
        console.log(`✅ Proxy upload successful: ${file.name}`);
                console.log(`📋 Document ID: ${response.document_id}`);
                // Dispatch upload complete event for progress bar (unless silent)
                if (!isSilent) {
                  window.dispatchEvent(new CustomEvent('upload-complete', { 
                    detail: { 
                      fileName: file.name, 
                      documentId: response.document_id || response.data?.document_id 
                    } 
                  }));
                }
                // Backend returns {success: true, document_id: ...} directly, not wrapped in data
                resolve({
          success: true,
          data: {
            document_id: response.document_id,
            ...response
          }
                });
      } else {
        const errorMsg = response.error || 'Upload failed';
        console.error(`❌ Upload failed: ${errorMsg}`);
        // Dispatch upload error event for progress bar (unless silent)
        if (!isSilent) {
          window.dispatchEvent(new CustomEvent('upload-error', { 
            detail: { fileName: file.name, error: errorMsg } 
          }));
        }
        resolve({
          success: false,
          error: errorMsg
        });
      }
            } catch (parseError) {
              console.error(`❌ Failed to parse response: ${parseError}`);
              // Dispatch upload error event for progress bar (unless silent)
              if (!isSilent) {
                window.dispatchEvent(new CustomEvent('upload-error', { 
                  detail: { fileName: file.name, error: 'Failed to parse server response' } 
                }));
              }
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
            // Dispatch upload error event for progress bar (unless silent)
            if (!isSilent) {
              window.dispatchEvent(new CustomEvent('upload-error', { 
                detail: { fileName: file.name, error: errorMessage } 
              }));
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
          // Dispatch upload error event for progress bar (unless silent)
          if (!isSilent) {
            window.dispatchEvent(new CustomEvent('upload-error', { 
              detail: { fileName: file.name, error: 'Network error during upload' } 
            }));
          }
          resolve({
            success: false,
            error: 'Network error during upload'
          });
        };

        // Handle abort
        xhr.onabort = () => {
          console.log(`⚠️ Upload aborted for ${file.name}`);
          // Dispatch upload error event for progress bar (unless silent)
          if (!isSilent) {
            window.dispatchEvent(new CustomEvent('upload-error', { 
              detail: { fileName: file.name, error: 'Upload was aborted' } 
            }));
          }
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
    lastName?: string;
    companyName: string;
  }) {
    return this.fetchApi('/api/signup', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async signInWithGoogle(credential: string) {
    return this.fetchApi('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
  }

  async checkAuth() {
    try {
      // Use AbortController for proper timeout handling
      // 15 second timeout to allow for slow database queries (Supabase + PostgreSQL)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      console.log('🔍 checkAuth: Starting auth check request...');
      const response = await fetch(`${this.baseUrl}/api/dashboard`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log(`📊 checkAuth: Response status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ checkAuth: Authentication successful');
        return {
          success: true,
          data: data
        };
      } else {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        console.log(`❌ checkAuth: Authentication failed - ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          statusCode: response.status // Include status code for AuthGuard to check
        };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('⏱️ checkAuth: Request timed out after 15 seconds');
        return {
          success: false,
          error: 'Request timeout - backend server not responding (database queries may be slow)'
        };
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('❌ checkAuth: Request error:', errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }
  }

  async logout() {
    try {
      const response = await fetch(`${this.baseUrl}/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        return {
          success: true,
          message: 'Logged out successfully'
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
    coordinates: { lat: number; lng: number },
    formattedAddress?: string
  ): Promise<ApiResponse> {
    return this.fetchApi('/api/properties/create', {
      method: 'POST',
      body: JSON.stringify({
        address,
        formatted_address: formattedAddress || address,
        normalized_address: (formattedAddress || address).toLowerCase(),
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
   * Add team member access to a property
   */
  async addPropertyAccess(propertyId: string, email: string, accessLevel: string = 'viewer'): Promise<ApiResponse> {
    return this.fetchApi(`/api/properties/${propertyId}/access`, {
      method: 'POST',
      body: JSON.stringify({ email, access_level: accessLevel })
    });
  }

  /**
   * Get list of all users with access to a property
   */
  async getPropertyAccess(propertyId: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/properties/${propertyId}/access`, {
      method: 'GET'
    });
  }

  /**
   * Remove team member access from a property
   */
  async removePropertyAccess(propertyId: string, accessId: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/properties/${propertyId}/access/${accessId}`, {
      method: 'DELETE'
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
   * Update property details fields
   */
  async updatePropertyDetails(propertyId: string, updates: Partial<{
    number_bedrooms?: number | null;
    number_bathrooms?: number | null;
    size_sqft?: number | null;
    asking_price?: number | null;
    sold_price?: number | null;
    rent_pcm?: number | null;
    tenure?: string | null;
    epc_rating?: string | null;
    condition?: string | null;
    other_amenities?: string | null;
    notes?: string | null;
  }>): Promise<ApiResponse> {
    return this.fetchApi(`/api/properties/${propertyId}/update-details`, {
      method: 'PUT',
      body: JSON.stringify({ updates })
    });
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/documents/${documentId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Delete a folder
   */
  async deleteFolder(folderId: string): Promise<ApiResponse> {
    return this.fetchApi(`/api/documents/folders/${folderId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Reprocess a document to extract BBOX coordinates for citation highlighting
   * @param documentId - The document UUID to reprocess
   * @param mode - 'full' (re-embed + bbox) or 'bbox_only' (update bbox, preserve embeddings)
   */
  async reprocessDocument(
    documentId: string, 
    mode: 'full' | 'bbox_only' = 'full'
  ): Promise<ApiResponse<{
    success: boolean;
    message: string;
    chunks_total: number;
    chunks_with_bbox: number;
    chunks_updated?: number;
    mode: string;
  }>> {
    return this.fetchApi(`/api/documents/${documentId}/reprocess`, {
      method: 'POST',
      body: JSON.stringify({ mode })
    });
  }

  // ---------------------------------------------------------------------------
  // Projects API
  // ---------------------------------------------------------------------------

  /**
   * Get all projects for the current user
   * @param status - Optional filter by status: 'active', 'negotiating', 'archived'
   */
  async getProjects(status?: 'active' | 'negotiating' | 'archived'): Promise<ApiResponse<{
    projects: ProjectData[];
    total: number;
  }>> {
    const params = status ? `?status=${status}` : '';
    return this.fetchApi(`/api/projects${params}`);
  }

  /**
   * Get a single project by ID
   */
  async getProject(projectId: string): Promise<ApiResponse<ProjectData>> {
    return this.fetchApi(`/api/projects/${projectId}`);
  }

  /**
   * Create a new project
   */
  async createProject(data: CreateProjectData): Promise<ApiResponse<ProjectData>> {
    return this.fetchApi('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Update an existing project
   */
  async updateProject(projectId: string, data: Partial<CreateProjectData>): Promise<ApiResponse<ProjectData>> {
    return this.fetchApi(`/api/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<ApiResponse<{ message: string }>> {
    return this.fetchApi(`/api/projects/${projectId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Add team member access to a project
   */
  async addProjectAccess(projectId: string, email: string, accessLevel: string = 'viewer'): Promise<ApiResponse> {
    return this.fetchApi(`/api/projects/${projectId}/access`, {
      method: 'POST',
      body: JSON.stringify({ email, access_level: accessLevel })
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

