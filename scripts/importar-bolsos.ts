// Loads the institution's bags from data/bolsos-instituciones.json (GitHub Actions: "Importar bolsos").
// Never duplicates: bags that already exist only get barrio / dirección / horario filled in where empty.
// New bags get the same list of items the existing bags use (the most recently checked bag).
//   FIREBASE_SERVICE_ACCOUNT="$(cat clave.json)" node --experimental-strip-types scripts/importar-bolsos.ts [--dry-run]
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { planificarImport, type Entrada } from "../lib/importar.ts";
import { emptyBolso } from "../lib/inventory.ts";

const dry = process.argv.includes("--dry-run");
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT."); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();

const { bolsos: entradas } = JSON.parse(readFileSync(new URL("../data/bolsos-instituciones.json", import.meta.url), "utf8")) as { bolsos: Entrada[] };
const snap = await db.collection("bolsos").get();
const existentes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as { nombre: string; barrio?: string; direccion?: string; horario?: string; catalog?: unknown; actualizado?: FirebaseFirestore.Timestamp }) }));

const plan = planificarImport(entradas, existentes);

// list of items for the new bags: the one of the most recently checked bag
const base = [...existentes].filter((x) => x.catalog).sort((a, b) => (b.actualizado?.toMillis() ?? 0) - (a.actualizado?.toMillis() ?? 0))[0];
const vacio = emptyBolso();
const catalog = base?.catalog ?? vacio.catalog;

console.log(`Bolsos cargados hoy: ${existentes.length} (${existentes.map((x) => x.nombre).join(", ")})`);
console.log(`Lista de elementos para los nuevos: la de "${base?.nombre ?? "lista estándar"}"`);
console.log(`\nSe completan ${plan.completar.length} existentes:`);
for (const c of plan.completar) console.log(`  · ${c.nombre}: ${Object.entries(c.campos).map(([k, v]) => `${k} = ${v}`).join(" | ")}`);
if (plan.sinCambios.length) console.log(`Sin cambios: ${plan.sinCambios.join(", ")}`);
console.log(`\nSe crean ${plan.crear.length} bolsos nuevos:`);
for (const e of plan.crear) console.log(`  + [${e.barrio}] ${e.nombre} — ${e.direccion || "(sin dirección)"} — ${e.horario || "(sin horario)"}`);
if (dry) { console.log("\n(prueba: no se guardó nada)"); process.exit(0); }

const batch = db.batch();
for (const c of plan.completar) batch.update(db.collection("bolsos").doc(c.id), c.campos);
for (const e of plan.crear) {
  batch.set(db.collection("bolsos").doc(), {
    schema: vacio.schema, catalog, valores: {}, cant: {}, venc: {},
    nombre: e.nombre, barrio: e.barrio, direccion: e.direccion, horario: e.horario, ubicacion: "",
    creado: FieldValue.serverTimestamp(), actualizado: null, actualizadoPor: null, importado: true,
  });
}
await batch.commit();
console.log(`\nListo: ${plan.crear.length} creados, ${plan.completar.length} completados.`);
