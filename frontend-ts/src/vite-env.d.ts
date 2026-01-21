/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Backend API
  readonly VITE_BACKEND_URL: string;
  
  // Mapbox
  readonly VITE_MAPBOX_TOKEN: string;
  
  // AI Services (optional - for direct API calls)
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_GOOGLE_GEOCODING_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_COHERE_API_KEY?: string;
  
  // Google OAuth (optional)
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
