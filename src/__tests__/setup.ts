// Setup file for Jest
// We mock external services (Firebase, etc.) if needed so tests don't fail without keys.

// Mock dotenv config so tests think they have basic env vars
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.GEMINI_API_KEY = 'test_key';
process.env.FIREBASE_PROJECT_ID = 'test_project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = 'test_key';
process.env.CLOUDINARY_URL = 'cloudinary://test:test@test';
