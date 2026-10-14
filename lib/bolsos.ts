"use client";
// Shared bags of the institution. Layout (see firestore.rules):
//   bolsos/{id}                    one bag: nombre, ubicacion + the same inventory fields as a personal bag
//   bolsos/{id}/movimientos/{id}   its history, each entry signed with who did it (por)
//   equipo/{email}                 who may use the shared bags: rol "voluntario" | "gerencia"
//   solicitudes/{email}            access requests from people who signed in but are not in the team yet
import {
  doc, collection, onSnapshot, query, orderBy, limit as qLimit, serverTimestamp, writeBatch,
  setDoc, updateDoc, deleteDoc, Timestamp, type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { fb } from "./firebase";
import { emptyBolso, type Bolso, type Movimiento } from "./inventory";
import type { Store } from "./data";

/** Always allowed in, with the management role. Keep in sync with ADMINS in firestore.rules. */
export const ADMINS = ["urielchirazi@gmail.com"];

export type Rol = "voluntario" | "gerencia";
export type Acceso = { estado: "cargando" } | { estado: "pendiente" } | { estado: "miembro"; rol: Rol };
export type Miembro = { email: string; rol: Rol; nombre: string };
export type Solicitud = { email: string; nombre: string; foto: string; t: Date };
export type BolsoInst = { id: string; nombre: string; ubicacion: string; bolso: Bolso; actualizado: Date | null; por: string };

export const emailDe = (u: User) => (u.email ?? "").trim().toLowerCase();
export const esAdmin = (u: User) => ADMINS.includes(emailDe(u));
const nombreDe = (u: User) => u.displayName || u.email || "";
const db = () => fb().db;
const bolsoRef = (id: string) => doc(db(), "bolsos", id);
const movsCol = (id: string) => collection(db(), "bolsos", id, "movimientos");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBolso(d: Record<string, any>): Bolso {
  return { schema: d.schema, catalog: d.catalog, valores: d.valores ?? {}, cant: d.cant ?? {}, venc: d.venc ?? {} };
}

/* ---------- Access ---------- */
/** Follows the viewer's place in the team. Someone not in it gets an access request filed for them. */
export function subscribeAcceso(user: User, next: (a: Acceso) => void, onError: (e: Error) => void): Unsubscribe {
  const email = emailDe(user);
  if (esAdmin(user)) { next({ estado: "miembro", rol: "gerencia" }); return () => {}; }
  let pedido = false;
  return onSnapshot(doc(db(), "equipo", email), (snap) => {
    if (snap.exists()) { next({ estado: "miembro", rol: snap.data().rol === "gerencia" ? "gerencia" : "voluntario" }); return; }
    if (snap.metadata.fromCache) return; // wait for the server's answer
    next({ estado: "pendiente" });
    if (!pedido) {
      pedido = true;
      setDoc(doc(db(), "solicitudes", email), { email, nombre: nombreDe(user), foto: user.photoURL ?? "", uid: user.uid, t: serverTimestamp() }).catch(onError);
    }
  }, onError);
}

/* ---------- Team (management) ---------- */
export function subscribeEquipo(next: (m: Miembro[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(collection(db(), "equipo"), (snap) => {
    next(snap.docs.map((d) => ({ email: d.id, rol: d.data().rol === "gerencia" ? "gerencia" : "voluntario", nombre: d.data().nombre ?? "" } as Miembro))
      .sort((a, b) => (a.nombre || a.email).localeCompare(b.nombre || b.email, "es")));
  }, onError);
}
export function subscribeSolicitudes(next: (s: Solicitud[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(collection(db(), "solicitudes"), (snap) => {
    next(snap.docs.map((d) => {
      const x = d.data({ serverTimestamps: "estimate" });
      return { email: d.id, nombre: x.nombre ?? "", foto: x.foto ?? "", t: (x.t as Timestamp)?.toDate?.() ?? new Date() };
    }).sort((a, b) => b.t.getTime() - a.t.getTime()));
  }, onError);
}
export async function aprobar(s: { email: string; nombre: string }, rol: Rol, por: User) {
  const batch = writeBatch(db());
  batch.set(doc(db(), "equipo", s.email), { rol, nombre: s.nombre, agregadoPor: emailDe(por), agregado: serverTimestamp() });
  batch.delete(doc(db(), "solicitudes", s.email));
  await batch.commit();
}
export const rechazar = (email: string) => deleteDoc(doc(db(), "solicitudes", email));
export async function agregarMiembro(email: string, rol: Rol, por: User) {
  const e = email.trim().toLowerCase();
  const batch = writeBatch(db());
  batch.set(doc(db(), "equipo", e), { rol, nombre: "", agregadoPor: emailDe(por), agregado: serverTimestamp() });
  batch.delete(doc(db(), "solicitudes", e));
  await batch.commit();
}
export const cambiarRol = (email: string, rol: Rol) => updateDoc(doc(db(), "equipo", email), { rol });
export const quitarMiembro = (email: string) => deleteDoc(doc(db(), "equipo", email));

/* ---------- Bags ---------- */
export function subscribeBolsos(next: (b: BolsoInst[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(collection(db(), "bolsos"), (snap) => {
    next(snap.docs.map((d) => {
      const x = d.data({ serverTimestamps: "estimate" });
      return { id: d.id, nombre: x.nombre ?? "Bolso", ubicacion: x.ubicacion ?? "", bolso: toBolso(x),
        actualizado: (x.actualizado as Timestamp)?.toDate?.() ?? null, por: x.actualizadoPor?.nombre ?? "" };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })));
  }, onError);
}
export async function crearBolso(nombre: string, ubicacion: string, copiarDe?: Bolso) {
  const ref = doc(collection(db(), "bolsos"));
  const base = emptyBolso();
  if (copiarDe) base.catalog = JSON.parse(JSON.stringify(copiarDe.catalog));
  await setDoc(ref, { ...base, nombre: nombre.trim(), ubicacion: ubicacion.trim(), creado: serverTimestamp(), actualizado: null, actualizadoPor: null });
  return ref.id;
}
export const editarBolso = (id: string, datos: { nombre: string; ubicacion: string }) =>
  updateDoc(bolsoRef(id), { nombre: datos.nombre.trim(), ubicacion: datos.ubicacion.trim() });
export const borrarBolso = (id: string) => deleteDoc(bolsoRef(id));

/** The inventory screen's store for one shared bag. Every change is signed with the person's name. */
export function bolsoStore(id: string, user: User): Store {
  const por = { uid: user.uid, nombre: nombreDe(user), email: emailDe(user) };
  return {
    subscribe: (next, onError) => onSnapshot(bolsoRef(id), (snap) => {
      if (!snap.exists()) { if (!snap.metadata.fromCache) onError(new Error("Este bolso ya no existe")); return; }
      next(toBolso(snap.data()));
    }, onError),
    subscribeMovs: (max, next, onError) => onSnapshot(query(movsCol(id), orderBy("t", "desc"), qLimit(max)), (snap) => {
      next(snap.docs.map((d) => {
        const x = d.data({ serverTimestamps: "estimate" });
        return { id: d.id, t: (x.t as Timestamp)?.toDate?.() ?? new Date(), tipo: x.tipo, nota: x.nota ?? "", cambios: x.cambios ?? [], por: x.por?.nombre ?? "" } as Movimiento;
      }));
    }, onError),
    newMovId: () => doc(movsCol(id)).id,
    async save(b, mov, fields) {
      const batch = writeBatch(db());
      const meta = { actualizado: serverTimestamp(), actualizadoPor: por };
      if (fields) {
        // only the items that changed: two people working on the same bag don't overwrite each other
        const upd: Record<string, any> = { ...meta }; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const ch of fields) {
          const campo = ch.campo === "venc" ? "venc" : ch.tipo === "cant" ? "cant" : "valores";
          upd[`${campo}.${ch.id}`] = (b[campo] as Record<string, unknown>)[ch.id] ?? null;
        }
        batch.update(bolsoRef(id), upd);
      } else {
        batch.update(bolsoRef(id), { schema: b.schema, catalog: b.catalog, valores: b.valores, cant: b.cant, venc: b.venc, ...meta });
      }
      if (mov) {
        const ref = mov.id ? doc(movsCol(id), mov.id) : doc(movsCol(id));
        if (mov.cambios.length) batch.set(ref, { tipo: mov.tipo, nota: mov.nota ?? "", cambios: mov.cambios, t: serverTimestamp(), por });
        else batch.delete(ref);
      }
      await batch.commit();
    },
  };
}
