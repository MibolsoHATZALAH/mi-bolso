// Daily alarm job (GitHub Actions, .github/workflows/alarmas.yml).
// Reads every bag with admin access, decides the alarms (lib/alarmas.ts) and sends them as push
// notifications to the phones that turned alarms on (users/{uid}/push/{token}).
//
// Needs the secret FIREBASE_SERVICE_ACCOUNT (Firebase → Configuración del proyecto → Cuentas de servicio
// → Generar nueva clave privada; paste the whole JSON as a repository secret in GitHub).
// Run locally:  FIREBASE_SERVICE_ACCOUNT="$(cat clave.json)" node --experimental-strip-types scripts/alarmas.ts [--dry-run]
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { planificar, hoyAR, type Compartido, type Personal } from "../lib/alarmas.ts";
import { ADMINS, APP_URL } from "../lib/config.ts";
import type { Bolso } from "../lib/inventory.ts";

const dry = process.argv.includes("--dry-run");
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT (ver comentario al principio)."); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toBolso = (d: any): Bolso => ({ schema: d.schema, catalog: d.catalog, valores: d.valores ?? {}, cant: d.cant ?? {}, venc: d.venc ?? {} });
const now = new Date(), hoy = hoyAR(now);

const [personalSnap, bolsosSnap, equipoSnap, pushSnap, alertasSnap] = await Promise.all([
  db.collectionGroup("bolso").get(),
  db.collection("bolsos").get(),
  db.collection("equipo").get(),
  db.collectionGroup("push").get(),
  db.collection("alertas").get(),
]);
const estado = new Map(alertasSnap.docs.map((d) => [d.id, d.data()]));

const personales: Personal[] = personalSnap.docs
  .filter((d) => d.id === "actual" && d.ref.parent.parent?.parent.id === "users")
  .map((d) => { const uid = d.ref.parent.parent!.id; return { uid, bolso: toBolso(d.data()), ultimoVenc: estado.get(`personal_${uid}`)?.ultimoVenc }; });

const compartidos: Compartido[] = bolsosSnap.docs.map((d) => {
  const x = d.data(), e = estado.get(`bolso_${d.id}`) ?? {};
  return { id: d.id, nombre: x.nombre ?? "Bolso", bolso: toBolso(x), ultimoPorEmail: x.actualizadoPor?.email, ultimoVenc: e.ultimoVenc, ultimoFaltante: e.ultimoFaltante };
});

const gerencia = [...ADMINS, ...equipoSnap.docs.filter((d) => d.data().rol === "gerencia").map((d) => d.id)];
const miembros = new Set([...gerencia, ...equipoSnap.docs.map((d) => d.id)].map((e) => e.toLowerCase()));

// phones: by owner uid and by email
const tokensPorUid = new Map<string, string[]>(), tokensPorEmail = new Map<string, string[]>(), refPorToken = new Map<string, FirebaseFirestore.DocumentReference>();
for (const d of pushSnap.docs) {
  const uid = d.ref.parent.parent?.id, x = d.data(), token = x.token as string | undefined;
  if (!uid || !token) continue;
  refPorToken.set(token, d.ref);
  tokensPorUid.set(uid, [...(tokensPorUid.get(uid) ?? []), token]);
  const email = String(x.email ?? "").toLowerCase();
  if (email) tokensPorEmail.set(email, [...(tokensPorEmail.get(email) ?? []), token]);
}

const { avisos, marcas } = planificar({ personales, compartidos, gerencia, now, hoy });

// shared-bag alarms only go to people still in the team
const mensajes = avisos.flatMap((a) => {
  const [tipo, quien] = [a.para.slice(0, a.para.indexOf(":")), a.para.slice(a.para.indexOf(":") + 1)];
  if (tipo === "email" && !miembros.has(quien)) return [];
  const tokens = (tipo === "uid" ? tokensPorUid.get(quien) : tokensPorEmail.get(quien)) ?? [];
  return [...new Set(tokens)].map((token) => ({
    token,
    data: { tag: a.tag },
    webpush: {
      headers: { Urgency: "high", TTL: String(20 * 3600) },
      notification: { title: a.titulo, body: a.texto, icon: tipo === "uid" ? `${APP_URL}/icon-192.png` : `${APP_URL}/bolsos/icon-192.png`, tag: a.tag, renotify: true, requireInteraction: true },
      fcmOptions: { link: a.link },
    },
  }));
});

console.log(`${hoy}: ${personales.length} bolsos personales, ${compartidos.length} compartidos, ${pushSnap.size} celulares con alarmas.`);
for (const a of avisos) console.log(`  ${a.tipo.padEnd(9)} → ${a.para}: ${a.titulo} — ${a.texto}`);
console.log(`${avisos.length} avisos, ${mensajes.length} notificaciones a enviar.${dry ? " (prueba: no se envía nada)" : ""}`);
if (dry) process.exit(0);

let enviados = 0, borrados = 0;
for (let i = 0; i < mensajes.length; i += 500) {
  const lote = mensajes.slice(i, i + 500);
  const r = await getMessaging().sendEach(lote);
  r.responses.forEach((res, j) => {
    if (res.success) { enviados++; return; }
    const code = res.error?.code ?? "";
    console.warn(`  no enviado (${code}): ${res.error?.message}`);
    // phone uninstalled the app or turned alarms off: forget it
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      const ref = refPorToken.get(lote[j].token); if (ref) { ref.delete().catch(() => {}); borrados++; }
    }
  });
}

// remember what was sent so the next run doesn't repeat it too soon
const batch = db.batch();
for (const m of marcas) batch.set(db.collection("alertas").doc(`${m.coleccion}_${m.id}`), { [m.campo]: m.valor, actualizado: FieldValue.serverTimestamp() }, { merge: true });
if (marcas.length) await batch.commit();
console.log(`Enviadas: ${enviados}. Celulares dados de baja: ${borrados}.`);
