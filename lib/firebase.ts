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

const SIN_CACHE = "firestore-sin-cache";
/**
 * Chrome sometimes leaves the offline cache (IndexedDB) stuck: opening it never finishes, Firestore waits for it
 * forever and the app stays on "Cargando…" (seen after a crash or with an old window of the app still open).
 * If the cache doesn't open within a few seconds, reload once without it (this tab only; the next visit tries again).
 */
function vigilarCache(projectId: string) {
  if (typeof indexedDB === "undefined") return;
  let listo = false;
  const t = setTimeout(() => {
    if (listo) return;
    try { sessionStorage.setItem(SIN_CACHE, "1"); } catch { return; }
    location.reload();
  }, 6000);
  try {
    const q = indexedDB.open(`firestore/[DEFAULT]/${projectId}/main`);
    const fin = () => { listo = true; clearTimeout(t); };
    q.onsuccess = () => { fin(); q.result.close(); };
    q.onerror = fin; // an error is reported by Firestore itself, which then works without the cache
  } catch { listo = true; clearTimeout(t); }
}

let cached: { app: FirebaseApp; auth: Auth; db: Firestore; google: GoogleAuthProvider } | null = null;

export function fb() {
  if (cached) return cached;
  const app = getApps()[0] ?? initializeApp(config);
  let db: Firestore;
  const sinCache = (() => { try { return sessionStorage.getItem(SIN_CACHE) === "1"; } catch { return false; } })();
  try {
    if (sinCache) throw new Error("memoria");
    // offline cache: the bag can be updated without signal and syncs when the connection comes back
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    vigilarCache(config.projectId);
  } catch {
    db = getFirestore(app); // in-memory cache only
  }
  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: "select_account" });
  cached = { app, auth: getAuth(app), db, google };
  return cached;
}
