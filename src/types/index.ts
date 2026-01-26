// Shared types between frontend and backend

export interface GenerateImageRequest {
  prompt: string;
  language: string;
  style?: 'traditional' | 'modern' | 'fusion' | 'bridal' | 'casual';
}

export interface GenerateImageResponse {
  success: boolean;
  imageUrl?: string;
  imageData?: string; // base64 encoded image
  prompt: string;
  generationTime: number; // in milliseconds
  language: string;
  error?: string;
}

export interface SpeechToTextRequest {
  audioData: string; // base64 encoded audio
  languageCode: string; // e.g., "hi-IN", "ta-IN", "te-IN", "en-US"
}

export interface SpeechToTextResponse {
  success: boolean;
  text?: string;
  language: string;
  confidence?: number;
  error?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  services?: {
    gemini: boolean;
    speechToText: boolean;
  };
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  statusCode: number;
}

// Supported languages
export const SUPPORTED_LANGUAGES = {
  'hi-IN': 'Hindi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'pa-IN': 'Punjabi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'en-US': 'English',
  'en-IN': 'English (India)'
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;