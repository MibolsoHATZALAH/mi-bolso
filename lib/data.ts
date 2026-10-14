"use client";
// Firestore access. Layout (see firestore.rules):
//   users/{uid}                   profile
//   users/{uid}/bolso/actual      the whole inventory (small: catalog + values)
//   users/{uid}/movimientos/{id}  history entries
import {
  doc, collection, getDoc, setDoc, onSnapshot, query, orderBy, limit as qLimit,
  serverTimestamp, writeBatch, Timestamp, type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { fb } from "./firebase";
import { emptyBolso, type Bolso, type Cambio, type Movimiento, type TipoMov } from "./inventory";

const bolsoRef = (uid: string) => doc(fb().db, "users", uid, "bolso", "actual");
const movsCol = (uid: string) => collection(fb().db, "users", uid, "movimientos");

export async function ensureProfile(user: User) {
  const ref = doc(fb().db, "users", user.uid);
  const snap = await getDoc(ref).catch(() => null);
  await setDoc(ref, {
    nombre: user.displayName ?? "",
    email: user.email ?? "",
    foto: user.photoURL ?? "",
    ultimoAcceso: serverTimestamp(),
    ...(snap && snap.exists() ? {} : { creado: serverTimestamp() }),
  }, { merge: true });
}

/** Live inventory. Creates the default bag the first time a volunteer signs in. */
export function subscribeBolso(uid: string, next: (b: Bolso) => void, onError: (e: Error) => void): Unsubscribe {
  let created = false;
  return onSnapshot(bolsoRef(uid), (snap) => {
    if (!snap.exists()) {
      if (!snap.metadata.fromCache && !created) { created = true; setDoc(bolsoRef(uid), { ...emptyBolso(), actualizado: serverTimestamp() }).catch(onError); }
      else if (snap.metadata.fromCache) next(emptyBolso()); // offline first launch: show the default list
      return;
    }
    const d = snap.data();
    next({ schema: d.schema, catalog: d.catalog, valores: d.valores ?? {}, cant: d.cant ?? {}, venc: d.venc ?? {} });
  }, onError);
}

export function subscribeMovimientos(uid: string, max: number, next: (m: Movimiento[]) => void, onError: (e: Error) => void): Unsubscribe {
  const q = query(movsCol(uid), orderBy("t", "desc"), qLimit(max));
  return onSnapshot(q, (snap) => {
    next(snap.docs.map((d) => {
      const x = d.data({ serverTimestamps: "estimate" });
      return { id: d.id, t: (x.t as Timestamp)?.toDate?.() ?? new Date(), tipo: x.tipo, nota: x.nota ?? "", cambios: x.cambios ?? [] };
    }));
  }, onError);
}

export function newMovimientoId(uid: string) { return doc(movsCol(uid)).id; }

/**
 * Saves the inventory and (optionally) one history entry in a single atomic batch.
 * `mov.id` lets manual edits keep updating the same "ajuste" entry for a few minutes.
 */
export async function saveBolso(uid: string, bolso: Bolso, mov?: { id?: string; tipo: TipoMov; nota?: string; cambios: Cambio[] }) {
  const batch = writeBatch(fb().db);
  batch.set(bolsoRef(uid), { ...bolso, actualizado: serverTimestamp() });
  if (mov) {
    const ref = mov.id ? doc(movsCol(uid), mov.id) : doc(movsCol(uid));
    if (mov.cambios.length) batch.set(ref, { tipo: mov.tipo, nota: mov.nota ?? "", cambios: mov.cambios, t: serverTimestamp() });
    else batch.delete(ref);
  }
  await batch.commit();
}

/** Replaces the inventory with an imported backup and copies its history over. */
export async function importBackup(uid: string, bolso: Bolso, historial: Omit<Movimiento, "id">[]) {
  await saveBolso(uid, bolso);
  for (let i = 0; i < historial.length; i += 400) {
    const batch = writeBatch(fb().db);
    for (const h of historial.slice(i, i + 400)) {
      batch.set(doc(movsCol(uid)), { tipo: h.tipo, nota: h.nota, cambios: h.cambios, t: Timestamp.fromDate(h.t), importado: true });
    }
    await batch.commit();
  }
}
