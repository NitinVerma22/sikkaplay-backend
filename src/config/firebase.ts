import * as admin from 'firebase-admin';
import path from 'path';

// Using the provided service account key from the src directory (since tsc doesn't copy json)
const serviceAccountPath = path.resolve(process.cwd(), 'src/config/firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

export const auth = admin.auth();
