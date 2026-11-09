import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const env = import.meta.env;

export const configOk = Boolean(
  env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || 'missing',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'missing',
  appId: env.VITE_FIREBASE_APP_ID || 'missing',
});

export const auth = getAuth(app);
export const db = getFirestore(app);

// Everyone signs in anonymously. The invite code (checked by Firestore rules) is what lets them in.
export function ensureUser() {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(
      auth,
      async (user) => {
        off();
        if (user) return resolve(user);
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user);
        } catch (e) {
          reject(e);
        }
      },
      reject
    );
  });
}
