import * as admin from 'firebase-admin';
import path from 'path';

// Using the provided service account key
const serviceAccountPath = path.resolve(__dirname, 'firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

export const auth = admin.auth();
