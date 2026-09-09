import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  // eslint-disable-next-line no-console
  console.error(
    'Firebase config is missing. Copy .env.example to .env and fill in your Firebase project values.'
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/**
 * Creating a new staff account from the Admin panel with the normal client SDK would sign the
 * admin OUT and sign the new user IN (Firebase Auth quirk). To avoid that, we spin up a second,
 * throwaway Firebase App instance just for the createUser call, then tear it down immediately.
 * The admin's own session (on the default `auth` instance) is never touched.
 */
export function getSecondaryAuth() {
  const name = 'secondary';
  const existing = getApps().find((a) => a.name === name);
  const secondaryApp = existing ?? initializeApp(firebaseConfig, name);
  return { secondaryApp, secondaryAuth: getAuth(secondaryApp) };
}

export async function disposeSecondaryApp(secondaryApp: ReturnType<typeof initializeApp>) {
  try {
    await deleteApp(secondaryApp);
  } catch {
    // ignore
  }
}
