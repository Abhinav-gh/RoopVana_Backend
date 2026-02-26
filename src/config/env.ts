import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

interface Config {
  port: number;
  nodeEnv: string;
  geminiApiKey: string;
  googleCloudProjectId: string;
  googleApplicationCredentials: string;
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  gcsBucketName?: string;
  enableTranslation: boolean;
  firebaseServiceAccountKey: string;
  maxGenerationsPerUserPerDay: number;
  adminEmails: string[];
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID || '',
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(','),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10),
  gcsBucketName: process.env.GCS_BUCKET_NAME,
  enableTranslation: process.env.ENABLE_TRANSLATION === 'true',
  firebaseServiceAccountKey: process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '',
  maxGenerationsPerUserPerDay: parseInt(process.env.MAX_GENERATIONS_PER_USER_PER_DAY || '10', 10),
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
};

// Validate required environment variables
const requiredEnvVars = ['GEMINI_API_KEY'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error('Please copy .env.example to .env and fill in the values');
    process.exit(1);
  }
}

export default config;