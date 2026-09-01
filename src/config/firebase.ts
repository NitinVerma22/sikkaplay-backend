import * as admin from 'firebase-admin';

// Initialize Firebase using the JSON string from the environment variable
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  console.error('WARNING: FIREBASE_SERVICE_ACCOUNT_JSON environment variable is missing. Firebase features will fail.');
}

let parsedCredentials;
try {
  if (serviceAccountJson) {
    parsedCredentials = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(parsedCredentials),
      storageBucket: 'sikkaplay.firebasestorage.app',
    });
  } else {
    // Mock initialization to avoid crashing the server locally
    admin.initializeApp({ projectId: 'demo-project' });
  }
} catch (error) {
  console.error('FATAL ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON. Ensure it is valid JSON.');
}

export const auth = admin.auth();
export const storage = admin.storage();
