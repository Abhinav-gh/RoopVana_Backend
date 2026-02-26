import * as admin from 'firebase-admin';
import path from 'path';
import config from './env';

// Initialize Firebase Admin SDK
// In production (Render), use FIREBASE_SERVICE_ACCOUNT_KEY env var (JSON string)
// In local dev, use the service account key file
let serviceAccount: admin.ServiceAccount;

if (config.firebaseServiceAccountKey) {
  // Production: parse JSON string from env var
  try {
    serviceAccount = JSON.parse(config.firebaseServiceAccountKey) as admin.ServiceAccount;
  } catch (e) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY env var. Ensure it is valid JSON.');
    process.exit(1);
  }
} else {
  // Local dev: load from file
  const keyPath = path.resolve(__dirname, '../../roopvanabackend-firebase-adminsdk-fbsvc-e407573260.json');
  try {
    serviceAccount = require(keyPath);
  } catch (e) {
    console.error('❌ Firebase service account key file not found at:', keyPath);
    console.error('   Set FIREBASE_SERVICE_ACCOUNT_KEY env var or place the key file in the backend root.');
    process.exit(1);
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const auth = admin.auth();
export default admin;
