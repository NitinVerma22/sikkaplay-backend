import * as admin from 'firebase-admin';

// Initialize Firebase using the JSON string from the environment variable
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  console.error('FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_JSON environment variable is missing.');
  process.exit(1);
}

let parsedCredentials;
try {
  parsedCredentials = JSON.parse(serviceAccountJson);
} catch (error) {
  console.error('FATAL ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON. Ensure it is valid JSON.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(parsedCredentials),
  storageBucket: 'sikkaplay.firebasestorage.app',
});

export const auth = admin.auth();
export const storage = admin.storage();
