/**
 * Environment Variables Configuration
 * Centralized access to environment variables with validation
 */

class EnvConfig {
  // Backend API
  get backendUrl(): string {
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
  }

  // Mapbox
  get mapboxToken(): string {
    const token = import.meta.env.VITE_MAPBOX_TOKEN || '';
    if (!token) {
      console.warn('⚠️ VITE_MAPBOX_TOKEN is not set. Map features may not work.');
    }
    return token;
  }

  // AI Services (optional)
  get openaiApiKey(): string | undefined {
    return import.meta.env.VITE_OPENAI_API_KEY;
  }

  get googleGeocodingApiKey(): string | undefined {
    return import.meta.env.VITE_GOOGLE_GEOCODING_API_KEY;
  }

  get googleClientId(): string | undefined {
    return import.meta.env.VITE_GOOGLE_CLIENT_ID;
  }

  get anthropicApiKey(): string | undefined {
    return import.meta.env.VITE_ANTHROPIC_API_KEY;
  }

  get cohereApiKey(): string | undefined {
    return import.meta.env.VITE_COHERE_API_KEY;
  }

  // Environment checks
  get isDevelopment(): boolean {
    return import.meta.env.DEV;
  }

  get isProduction(): boolean {
    return import.meta.env.PROD;
  }

  get mode(): string {
    return import.meta.env.MODE;
  }

  /**
   * Validate required environment variables
   */
  validateRequired(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    if (!this.mapboxToken) {
      missing.push('VITE_MAPBOX_TOKEN');
    }

    const valid = missing.length === 0;

    if (!valid) {
      console.error('❌ Missing required environment variables:', missing);
      console.info('📝 Copy .env.example to .env.local and add your API keys');
    }

    return { valid, missing };
  }

  /**
   * Log current environment configuration (safe for debugging)
   */
  logConfig(): void {
    console.group('🔧 Environment Configuration');
    console.log('Mode:', this.mode);
    console.log('Backend URL:', this.backendUrl);
    console.log('Mapbox Token:', this.mapboxToken ? '✅ Set' : '❌ Missing');
    console.log('OpenAI API Key:', this.openaiApiKey ? '✅ Set' : '⚠️ Not set (optional)');
    console.log('Google Geocoding API:', this.googleGeocodingApiKey ? '✅ Set' : '⚠️ Not set (optional)');
    console.log('Google OAuth Client ID:', this.googleClientId ? '✅ Set' : '⚠️ Not set (optional - for Google sign-in)');
    console.log('Anthropic API:', this.anthropicApiKey ? '✅ Set' : '⚠️ Not set (optional)');
    console.log('Cohere API:', this.cohereApiKey ? '✅ Set' : '⚠️ Not set (optional)');
    console.groupEnd();
  }

  /**
   * Get all environment variables as an object (for debugging)
   */
  getAll(): Record<string, any> {
    return {
      mode: this.mode,
      isDevelopment: this.isDevelopment,
      isProduction: this.isProduction,
      backendUrl: this.backendUrl,
      hasMapboxToken: !!this.mapboxToken,
      hasOpenaiKey: !!this.openaiApiKey,
      hasGoogleGeocodingKey: !!this.googleGeocodingApiKey,
      hasGoogleClientId: !!this.googleClientId,
      hasAnthropicKey: !!this.anthropicApiKey,
      hasCohereKey: !!this.cohereApiKey,
    };
  }
}

// Export singleton instance
export const env = new EnvConfig();

// Validate on load in development
if (env.isDevelopment) {
  env.validateRequired();
  env.logConfig();
}

