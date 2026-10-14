"use client";
// Firebase is initialised lazily in the browser only (Next pre-renders client components on the server).
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from "firebase/firestore";

// Public web-client config of the "mibolsohatzalah" Firebase project (safe to commit: access is
// enforced by firestore.rules). NEXT_PUBLIC_FIREBASE_* env vars override it, e.g. for a test project.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBeBDv_KcIOCTjuqajjXSDLXxGJUo0bBU0",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "mibolsohatzalah.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "mibolsohatzalah",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "mibolsohatzalah.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "783360125991",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:783360125991:web:cd6971d08cd5aad58fb202",
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let cached: { app: FirebaseApp; auth: Auth; db: Firestore; google: GoogleAuthProvider } | null = null;

export function fb() {
  if (cached) return cached;
  const app = getApps()[0] ?? initializeApp(config);
  let db: Firestore;
  try {
    // offline cache: the bag can be updated without signal and syncs when the connection comes back
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    db = getFirestore(app);
  }
  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: "select_account" });
  cached = { app, auth: getAuth(app), db, google };
  return cached;
}
