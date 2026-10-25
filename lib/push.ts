"use client";
// Push alarms (app closed). Each phone that turns them on stores its token in users/{uid}/push/{token}
// with the app it belongs to (apps: ["personal"] or ["bolsos"]); the daily job (scripts/alarmas.ts)
// sends personal alarms only to "personal" tokens and shared-bag alarms only to "bolsos" tokens.
//
// The two apps are kept apart on the phone too: each registers its own service worker with its own
// scope (/mi-bolso/ and /mi-bolso/bolsos/), so each gets a different push token even in the same browser.
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, setDoc, updateDoc, serverTimestamp, arrayRemove } from "firebase/firestore";
import type { User } from "firebase/auth";
import { fb } from "./firebase";
import { VAPID_KEY } from "./config";
import { sonarAlarma } from "./sonido";

export type App = "personal" | "bolsos";
export type EstadoPush = "cargando" | "instalar" | "no" | "apagado" | "bloqueado" | "activo";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const scope = (app: App) => (app === "bolsos" ? `${BASE}/bolsos/` : `${BASE}/`);
const swUrl = (app: App) => `${scope(app)}firebase-messaging-sw.js`;
const lsKey = (app: App) => `alarmas-token-${app}`;
/** Before the apps were split both saved their token here (one token, shared by both apps in the same browser). */
const LS_VIEJO = "alarmas-token";

const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const instalada = () => (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

export async function estadoPush(app: App): Promise<EstadoPush> {
  if (!VAPID_KEY) return "no";
  const ok = "serviceWorker" in navigator && "Notification" in window && "PushManager" in window && (await isSupported().catch(() => false));
  if (!ok) return esIOS() && !instalada() ? "instalar" : "no";
  if (Notification.permission === "denied") return "bloqueado";
  if (Notification.permission === "granted" && (leer(lsKey(app)) || leer(LS_VIEJO))) return "activo";
  return "apagado";
}

async function registro(app: App) {
  const reg = await navigator.serviceWorker.register(swUrl(app), { scope: scope(app) });
  await navigator.serviceWorker.ready;
  return reg;
}
const registroActual = async (app: App) => {
  const reg = await navigator.serviceWorker.getRegistration(scope(app));
  // getRegistration returns the closest match: for "bolsos" that may still be the personal one
  return reg && reg.scope.endsWith(scope(app)) ? reg : registro(app);
};

/** Asks for permission (must run from a tap), gets this app's token and saves it. */
export async function activarPush(user: User, app: App): Promise<EstadoPush> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "bloqueado" : "apagado";
  await guardarToken(user, app);
  return "activo";
}

/** Refreshes and saves this app's token (tokens can change; cheap to repeat on every visit). */
export async function guardarToken(user: User, app: App) {
  const reg = await registro(app);
  const token = await getToken(getMessaging(fb().app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("sin token");
  const ref = (t: string) => doc(fb().db, "users", user.uid, "push", t);
  await setDoc(ref(token), {
    token, email: (user.email ?? "").toLowerCase(), nombre: user.displayName ?? "", apps: [app],
    ua: navigator.userAgent.slice(0, 200), actualizado: serverTimestamp(),
  }, { merge: true });

  // Token from before the split: it belonged to both apps. Take this app off it so it stops getting
  // this app's alarms (the other app keeps it, or replaces it the next time it is opened).
  const viejo = leer(LS_VIEJO);
  if (viejo && viejo !== token) await updateDoc(ref(viejo), { apps: arrayRemove(app) }).catch(() => {});
  if (viejo && app === "personal" && viejo === token) escribir(LS_VIEJO, null);
  escribir(lsKey(app), token);
  return token;
}

/** While the app is open, a push arrives here instead of the system: sound + notification. */
export function escucharPush(app: App): () => void {
  let off = () => {};
  isSupported().then((ok) => {
    if (!ok) return;
    off = onMessage(getMessaging(fb().app), async (p) => {
      sonarAlarma();
      const reg = await registroActual(app);
      reg.showNotification(p.notification?.title ?? (app === "bolsos" ? "Bolsos" : "Mi Bolso"), {
        body: p.notification?.body, icon: `${scope(app)}icon-192.png`, tag: p.data?.tag,
      });
    });
  }).catch(() => {});
  return () => off();
}

export async function probarPush(app: App) {
  const reg = await registroActual(app);
  await reg.showNotification("Alarma de prueba", {
    body: app === "bolsos" ? "Así te van a llegar las alarmas de faltantes y vencimientos de los bolsos." : "Así te van a llegar las alarmas de vencimientos de tu bolso.",
    icon: `${scope(app)}icon-192.png`,
  });
  sonarAlarma(1);
}
