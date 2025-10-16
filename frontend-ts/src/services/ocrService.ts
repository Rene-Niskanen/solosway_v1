/**
 * OCR Service (Secure Backend Proxy)
 * All OCR requests now route through Flask backend to keep API keys secure
 */

import { backendApi } from './backendApi';

export interface OCRResult {
  text: string;
  confidence: number;
  error?: string;
}

class OCRService {
  /**
   * Extract text from an image via backend
   */
  async extractTextFromImage(imageFile: File): Promise<OCRResult> {
    try {
      const response = await backendApi.extractTextFromImage(imageFile);

      if (!response.success || !response.data) {
        return {
          text: '',
          confidence: 0,
          error: response.error || 'OCR processing failed',
        };
      }

      return response.data as OCRResult;
    } catch (error) {
      console.error('OCR processing error:', error);
      return {
        text: '',
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Check if OCR service is available (backend handles this)
   */
  isAvailable(): boolean {
    return true; // Backend handles availability
  }

  /**
   * Get service status
   */
  getStatus(): { available: boolean; service: string } {
    return {
      available: true,
      service: 'Backend OCR Service',
    };
  }
}

// Export singleton instance
export const ocrService = new OCRService();

// Export class for testing
export { OCRService };
