// Fills "entrecalles" (cross streets) for every shared bag from the City's official street map.
//  1. the bag's address is located with the City's address service (USIG normalizador)
//  2. in the official street map (callejero, one segment per block with its door numbers)
//     the block holding that number is found, and the streets touching both ends of it are the cross streets.
// GitHub Actions → "Entrecalles" (dry run by default). Never overwrites a value someone typed, unless "reemplazar".
//   FIREBASE_SERVICE_ACCOUNT="$(cat clave.json)" node --experimental-strip-types scripts/entrecalles.ts [--guardar] [--reemplazar]
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const guardar = process.argv.includes("--guardar"), reemplazar = process.argv.includes("--reemplazar");
const CALLEJERO = "https://data.buenosaires.gob.ar/dataset/calles/resource/2941f731-0a2e-4391-b8c9-a2912a80c081/download";
const USIG = "https://servicios.usig.buenosaires.gob.ar/normalizar/";

type Geo = { type: string; coordinates: number[][] | number[][][] };
type Feature = { properties: Record<string, unknown>; geometry: Geo | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\bAV(ENIDA)?\b\.?/g, "").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const PEQ = new Set(["de", "del", "la", "las", "los", "y", "e", "el"]);
// the City's map writes names without accents
const ACENTOS: Record<string, string> = Object.fromEntries(
  ("Córdoba Tucumán Morón Pueyrredón Azcuénaga Agüero Seguí Concepción Católica República Amenábar Gómez Valentín Jaurès José Tomás María " +
   "Junín Díaz Vélez Güemes México Perú Álvarez Gutiérrez Rodríguez Fernández González Martínez Pérez Sánchez López García Ramón Bolívar " +
   "Echeverría Galván Núñez Añasco Gascón Aráoz Olazábal Iberá Sáenz Maipú Paraná Andrés Lambaré Ángel Belén Darwin Guzmán Hernández " +
   "Jiménez Martín Medrano Muñiz Nicolás Ramírez Sarmiento Tomás Ávila Sánchez Ayacucho Alcorta Cerviño Ecuador Larrea Viamonte " +
   "Agustín Joaquín Julián Sebastián Lucía Inés Ríos Zuviría Méndez Juárez Castañeda Ocampo Bustamante Peña Mitre Varela Catamarca Jujuy")
    .split(/\s+/).map((w) => [w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), w]),
);
const TITULOS = /(^|\s)(pres|presidente|gral|general|dr|doctor|ing|cnel|coronel|tte|teniente|pte|cap|capitan|almte|almirante|mons|gdor|int|pbro|cmte|comodoro|sgto|brig|mcal|mariscal|cdte|prof|arq)\.?(?=\s|$)/g;
function lindo(nombre: string) {
  let s = nombre.toLowerCase().replace(/\./g, ". ").replace(/\s+/g, " ").trim();
  let av = false;
  s = s.replace(/(^|\s)av(enida)?\.?(?=\s|$)/g, () => { av = true; return " "; }).replace(TITULOS, " ").replace(/\s+/g, " ").trim();
  s = s.split(" ").map((w, i) => {
    if (i > 0 && PEQ.has(w)) return w;
    const k = w.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return ACENTOS[k] ?? w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
  return (av ? "Av. " : "") + s;
}
// Short everyday name: "ANCHORENA, TOMAS MANUEL DE, DR." → "Anchorena"; "GOMEZ, VALENTIN" → "Valentín Gómez" (one given name is kept)
function nombreCorto(p: Record<string, unknown>) {
  const mapa = String(prop(p, "nom_mapa") ?? ""), ofi = String(prop(p, "nomoficial", "nom_oficial", "nombre") ?? "");
  const av = /(^|[\s.])av(enida)?\b/i.test(mapa) || /(^|[\s.,])av(enida)?\b/i.test(ofi) ? "Av. " : "";
  const partes = ofi.split(",").map((x) => x.replace(/\bav(enida)?\b\.?/gi, " ").trim()).filter(Boolean);
  if (partes.length >= 2) {
    const apellido = lindo(partes[0]), nombres = lindo(partes[1]);
    const unNombre = nombres && !/\./.test(partes[1]) && nombres.split(" ").length === 1 && !/^(Av\.)/.test(nombres);
    return av + (unNombre ? `${nombres} ${apellido}` : apellido);
  }
  const l = lindo(mapa || ofi);
  return l.startsWith("Av. ") ? l : av + l;
}
// a few streets everybody calls by more than the surname
const CONOCIDAS: Record<string, string> = { "Paz": "General Paz", "Díaz": "Coronel Díaz", "Justo": "Juan B. Justo", "Alberdi": "Juan B. Alberdi", "Alem": "Leandro N. Alem", "Rawson": "Guillermo Rawson" };
function nombreCalle(p: Record<string, unknown>) {
  const n = nombreCorto(p), av = n.startsWith("Av. ") ? "Av. " : "", base = n.replace(/^Av\. /, "");
  return CONOCIDAS[base] ? av + CONOCIDAS[base] : n;
}
const prop = (p: Record<string, unknown>, ...ks: string[]) => {
  for (const k of ks) for (const kk of Object.keys(p)) if (kk.toLowerCase() === k) return p[kk];
  return undefined;
};
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

function extremos(g: Geo | null): [number[], number[]] | null {
  if (!g) return null;
  if (g.type === "LineString") { const c = g.coordinates as number[][]; return [c[0], c[c.length - 1]]; }
  if (g.type === "MultiLineString") { const c = g.coordinates as number[][][]; return [c[0][0], c[c.length - 1][c[c.length - 1].length - 1]]; }
  return null;
}
const metros = (a: number[], b: number[]) => {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
};

// ---------- official street map ----------
console.log("Bajando el callejero oficial de la Ciudad…");
const res = await fetch(CALLEJERO, { redirect: "follow" });
if (!res.ok) throw new Error(`callejero: HTTP ${res.status}`);
const gj = (await res.json()) as { features: Feature[] };
const tramos = gj.features.filter((f) => f.geometry);
console.log(`Callejero: ${tramos.length} cuadras. Ejemplos: ${tramos.slice(0, 4).map((t) => `${prop(t.properties, "nomoficial")} → ${prop(t.properties, "nom_mapa")}`).join(" | ")}`);

// all street names in the map, to recover typos ("Bologne Sur Mer" → "BOULOGNE SUR MER")
const lev = (a: string, b: string) => {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return d[b.length];
};
const nombresCalles = new Map<string, string>(); // normalized → code
for (const t of tramos) {
  const c = String(prop(t.properties, "codigo") ?? "");
  for (const n of [prop(t.properties, "nom_mapa"), String(prop(t.properties, "nomoficial") ?? "").split(",")[0]]) if (n) nombresCalles.set(norm(String(n)), c);
}
function corregirCalle(calle: string) {
  const n = norm(calle); if (nombresCalles.has(n)) return null;
  let mejor = "", dist = 99;
  for (const k of nombresCalles.keys()) { const x = lev(n, k); if (x < dist) { dist = x; mejor = k; } }
  return dist <= Math.max(1, Math.floor(n.length / 6)) ? mejor : null;
}

const codigo = (p: Record<string, unknown>) => String(prop(p, "codigo", "cod_calle", "id_calle") ?? "");
// the short name printed on the City map ("AGUERO", "AV. CORDOBA") reads better than the cadastral one
const nombreTramo = (p: Record<string, unknown>) => String(prop(p, "nom_mapa") || prop(p, "nomoficial", "nom_oficial", "nombre") || "");
const alturas = (p: Record<string, unknown>) =>
  ["alt_izqini", "alt_izqfin", "alt_derini", "alt_derfin"].map((k) => num(prop(p, k))).filter((n) => Number.isFinite(n) && n > 0);

// endpoint index: ~11 m grid cells
const celda = (c: number[]) => `${Math.round(c[0] * 10000)},${Math.round(c[1] * 10000)}`;
const indice = new Map<string, number[]>();
tramos.forEach((f, i) => {
  const e = extremos(f.geometry); if (!e) return;
  for (const c of e) { const k = celda(c); if (!indice.has(k)) indice.set(k, []); indice.get(k)!.push(i); }
});
function callesEn(punto: number[], excluir: (p: Record<string, unknown>) => boolean) {
  const [x, y] = [Math.round(punto[0] * 10000), Math.round(punto[1] * 10000)];
  const cuenta = new Map<string, number>(); // name → blocks touching this corner (2 = the street goes through)
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const i of indice.get(`${x + dx},${y + dy}`) ?? []) {
      const t = tramos[i], e = extremos(t.geometry)!;
      if (excluir(t.properties)) continue;
      if (Math.min(metros(e[0], punto), metros(e[1], punto)) > 8) continue;
      const n = nombreCalle(t.properties); if (n) cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
    }
  }
  // a street that goes through the corner beats one that just ends there; an avenue beats both
  let xs = [...cuenta.keys()];
  if (xs.some((n) => n.startsWith("Av. "))) xs = xs.filter((n) => n.startsWith("Av. "));
  const max = Math.max(0, ...xs.map((n) => cuenta.get(n)!));
  return xs.filter((n) => cuenta.get(n) === max);
}

// ---------- address → block → cross streets ----------
type Resultado = { ok: true; texto: string; calle: string; altura: number } | { ok: false; motivo: string };
async function entrecalles(direccion: string): Promise<Resultado> {
  const m = direccion.match(/^(.*?)\s*(\d+)/); // drop "Piso 3", "1A", "/950"…
  if (!m) return { ok: false, motivo: "sin número de calle" };
  type J = { direccionesNormalizadas?: { cod_calle?: number | string; nombre_calle: string; altura: number | string; cod_partido?: string; nombre_partido?: string }[]; errorMessage?: string };
  const buscar = async (calle: string) => {
    const r = await fetch(`${USIG}?direccion=${encodeURIComponent(`${calle} ${m[2]}`)}&geocodificar=TRUE&maxOptions=10`);
    if (!r.ok) throw new Error(`normalizador HTTP ${r.status}`);
    const j = (await r.json()) as J;
    return { j, d: (j.direccionesNormalizadas ?? []).find((x) => (x.cod_partido ?? "").toLowerCase() === "caba" || /ciudad/i.test(x.nombre_partido ?? "")) };
  };
  let { j, d } = await buscar(m[1]);
  if (!d) { const c = corregirCalle(m[1]); if (c) ({ j, d } = await buscar(c)); }
  if (!d) return { ok: false, motivo: j.errorMessage ? `no encontrada (${j.errorMessage})` : "no está en la Ciudad" };
  const altura = Number(d.altura), cod = String(d.cod_calle ?? ""), nom = norm(d.nombre_calle);
  const mismaCalle = (p: Record<string, unknown>) => (cod && codigo(p) ? codigo(p) === cod : norm(nombreTramo(p)) === nom);
  const deLaCalle = tramos.filter((t) => mismaCalle(t.properties));
  if (!deLaCalle.length) return { ok: false, motivo: `calle ${d.nombre_calle} no está en el callejero` };
  const cuadra = deLaCalle.find((t) => { const a = alturas(t.properties); return a.length && Math.min(...a) <= altura && altura <= Math.max(...a); });
  if (!cuadra) return { ok: false, motivo: `no hay cuadra con el ${altura} en ${d.nombre_calle}` };
  const a = alturas(cuadra.properties), e = extremos(cuadra.geometry)!;
  // which end is the low numbers? compare with the neighbouring block that starts where this one ends
  const desdeIni = callesEn(e[0], mismaCalle), desdeFin = callesEn(e[1], mismaCalle);
  const ini = prop(cuadra.properties, "alt_izqini", "alt_derini"), fin = prop(cuadra.properties, "alt_izqfin", "alt_derfin");
  const ordenNormal = !(num(ini) > num(fin));
  const [bajo, alto] = ordenNormal ? [desdeIni, desdeFin] : [desdeFin, desdeIni];
  if (!bajo.length && !alto.length) return { ok: false, motivo: "no se encontraron calles que crucen" };
  const lado = (xs: string[]) => (xs.length ? xs.join(" / ") : "—");
  return { ok: true, texto: `entre ${lado(bajo)} y ${lado(alto)}`, calle: nombreCalle(cuadra.properties) || lindo(d.nombre_calle), altura };
}

// ---------- bags ----------
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT."); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const snap = await db.collection("bolsos").get();
console.log(`\n${snap.size} bolsos.\n`);
const batch = db.batch(); let cambios = 0;
for (const doc of snap.docs.sort((a, b) => String(a.data().nombre).localeCompare(String(b.data().nombre), "es"))) {
  const x = doc.data(), nombre = String(x.nombre ?? ""), dir = String(x.direccion ?? "").trim(), actual = String(x.entrecalles ?? "").trim();
  if (!dir) { console.log(`· ${nombre}: sin dirección`); continue; }
  const r = await entrecalles(dir).catch((e) => ({ ok: false as const, motivo: String(e) }));
  if (!r.ok) { console.log(`✗ ${nombre} — ${dir}: ${r.motivo}`); continue; }
  const nota = actual && !reemplazar ? ` (ya tenía: "${actual}", no se cambia)` : "";
  console.log(`✓ ${nombre} — ${dir} → ${r.calle} ${r.altura} ${r.texto}${nota}`);
  if (!actual || reemplazar) { batch.update(doc.ref, { entrecalles: r.texto }); cambios++; }
}
if (guardar && cambios) { await batch.commit(); console.log(`\nGuardado: ${cambios} bolsos con entrecalles.`); }
else console.log(guardar ? "\nNada para guardar." : `\n(prueba: no se guardó nada; se completarían ${cambios})`);
