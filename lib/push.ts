"use client";
// Push alarms (app closed). Each phone that turns them on stores its token in users/{uid}/push/{token};
// the daily job (scripts/alarmas.ts) reads them with admin access and sends the alarms.
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, setDoc, serverTimestamp, arrayUnion } from "firebase/firestore";
import type { User } from "firebase/auth";
import { fb } from "./firebase";
import { VAPID_KEY } from "./config";
import { sonarAlarma } from "./sonido";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SW = `${BASE}/firebase-messaging-sw.js`;
const LS = "alarmas-token";

export type EstadoPush = "cargando" | "instalar" | "no" | "apagado" | "bloqueado" | "activo";

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const instalada = () => (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

export async function estadoPush(): Promise<EstadoPush> {
  if (!VAPID_KEY) return "no";
  const ok = "serviceWorker" in navigator && "Notification" in window && "PushManager" in window && (await isSupported().catch(() => false));
  if (!ok) return esIOS() && !instalada() ? "instalar" : "no";
  if (Notification.permission === "denied") return "bloqueado";
  if (Notification.permission === "granted") { try { if (localStorage.getItem(LS)) return "activo"; } catch {} }
  return "apagado";
}

async function registro() {
  const reg = await navigator.serviceWorker.register(SW, { scope: `${BASE}/` });
  await navigator.serviceWorker.ready;
  return reg;
}

/** Asks for permission (must run from a tap), gets this phone's token and saves it. */
export async function activarPush(user: User, app: "personal" | "bolsos"): Promise<EstadoPush> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "bloqueado" : "apagado";
  await guardarToken(user, app);
  return "activo";
}

/** Refreshes and saves the token (tokens can change; cheap to repeat on every visit). */
export async function guardarToken(user: User, app: "personal" | "bolsos") {
  const reg = await registro();
  const token = await getToken(getMessaging(fb().app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("sin token");
  await setDoc(doc(fb().db, "users", user.uid, "push", token), {
    token, email: (user.email ?? "").toLowerCase(), nombre: user.displayName ?? "", apps: arrayUnion(app),
    ua: navigator.userAgent.slice(0, 200), actualizado: serverTimestamp(),
  }, { merge: true });
  try { localStorage.setItem(LS, token); } catch {}
  return token;
}

/** While the app is open, a push arrives here instead of the system: sound + notification. */
export function escucharPush(): () => void {
  let off = () => {};
  isSupported().then((ok) => {
    if (!ok) return;
    off = onMessage(getMessaging(fb().app), async (p) => {
      sonarAlarma();
      const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
      reg?.showNotification(p.notification?.title ?? "Bolsos", { body: p.notification?.body, icon: `${BASE}/icon-192.png`, tag: p.data?.tag });
    });
  }).catch(() => {});
  return () => off();
}

export async function probarPush() {
  const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`) ?? (await registro());
  await reg.showNotification("Alarma de prueba", { body: "Así te van a llegar las alarmas de vencimientos y faltantes.", icon: `${BASE}/icon-192.png` });
  sonarAlarma(1);
}
