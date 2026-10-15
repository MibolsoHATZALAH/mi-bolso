// Copies the item list of the institution's bags (the one most of them use) to personal "Mi Bolso" bags.
// Each person keeps what they had loaded for the items both lists share.
// GitHub Actions → "Lista a Mi Bolso" (dry run by default).
//   FIREBASE_SERVICE_ACCOUNT="$(cat clave.json)" node --experimental-strip-types scripts/lista-personal.ts email1,email2 [--guardar]
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { copiarLista, difLista, listaComun, mismaLista, emptyBolso, SCHEMA, type Bolso, type Catalog } from "../lib/inventory.ts";

const guardar = process.argv.includes("--guardar");
const emails = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!emails.length) { console.error("Falta el email de la cuenta de Mi Bolso."); process.exit(1); }
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT."); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();

const snap = await db.collection("bolsos").get();
const catalogs = snap.docs.map((d) => d.data().catalog as Catalog | undefined).filter((c): c is Catalog => !!c?.secciones);
const lista = listaComun(catalogs);
if (!lista) { console.error("No hay bolsos institucionales con lista."); process.exit(1); }
const iguales = catalogs.filter((c) => mismaLista(c, lista)).length;
const items = lista.secciones.flatMap((s) => s.categorias.flatMap((c) => c.items)).length;
console.log(`Lista del equipo: ${items} elementos, la usan ${iguales} de ${catalogs.length} bolsos.`);
for (const s of lista.secciones) console.log(`  ${s.nombre}: ${s.categorias.map((c) => `${c.nombre} (${c.items.length})`).join(", ")}`);

const users = await db.collection("users").get();
for (const email of emails) {
  const u = users.docs.find((d) => String(d.data().email ?? "").toLowerCase() === email);
  if (!u) { console.log(`\n✗ ${email}: nunca entró a Mi Bolso.`); continue; }
  const ref = db.doc(`users/${u.id}/bolso/actual`);
  const d = (await ref.get()).data();
  const actual: Bolso = d ? { schema: d.schema ?? SCHEMA, catalog: d.catalog, valores: d.valores ?? {}, cant: d.cant ?? {}, venc: d.venc ?? {} } : emptyBolso();
  if (mismaLista(actual.catalog, lista)) { console.log(`\n✓ ${email}: ya tiene la lista del equipo.`); continue; }
  const dif = difLista(actual, lista);
  const next = copiarLista(actual, { ...actual, catalog: lista });
  console.log(`\n→ ${email}: se agregan ${dif.nuevos.length}, se quitan ${dif.quitados.length}.`);
  if (dif.nuevos.length) console.log(`  Nuevos: ${dif.nuevos.join(", ")}`);
  if (dif.quitados.length) console.log(`  Se quitan: ${dif.quitados.join(", ")}`);
  if (dif.conDatos.length) console.log(`  (de esos tenía datos cargados: ${dif.conDatos.join(", ")})`);
  if (guardar) {
    const batch = db.batch();
    batch.set(ref, { ...next, actualizado: FieldValue.serverTimestamp() });
    batch.set(db.collection(`users/${u.id}/movimientos`).doc(), { tipo: "ajuste", nota: "Lista copiada de los bolsos de la institución", cambios: [], t: FieldValue.serverTimestamp() });
    await batch.commit();
    console.log("  Guardado.");
  }
}
if (!guardar) console.log("\n(prueba: no se guardó nada)");
