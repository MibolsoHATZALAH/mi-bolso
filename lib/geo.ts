// "Bolsos cercanos": turns the emergency's address into a point and ranks the bags by distance.
// Addresses are located with the City's official address service (USIG normalizador, covers CABA and
// the Greater Buenos Aires partidos), with OpenStreetMap (Nominatim) as a fallback.
// The pure parts (no fetch, no localStorage) are tested in tests/geo.test.ts.

export type Punto = { lat: number; lng: number };
export type Lugar = Punto & { texto: string; caba: boolean };

const USIG = "https://servicios.usig.buenosaires.gob.ar/normalizar/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** "Corrientes 1234", "av cordoba 2300", "corrientes y callao" → yes. "Once", "11", "Sede", "Bolso 2" → no. */
export function pareceDireccion(q: string): boolean {
  const t = q.trim();
  if (!/\p{L}{3,}/u.test(t)) return false;
  return /\p{L}.*\s\d{2,5}\b/u.test(t) || /\p{L}{3,}.*\s(y|e|esq\.?|esquina)\s+\p{L}{3,}/iu.test(t);
}

/** Drops floor / apartment ("Piso 3", "Dto B", "1° A") so only street + number is looked up. */
export const limpiarDireccion = (d: string) =>
  d.replace(/\s*[,(-]?\s*(piso|p\.|dpto|depto|dto|departamento|of(icina)?|local|pb|timbre)\b.*$/i, "").replace(/\s+\d+\s*°.*$/, "").trim();

/** Straight-line distance in meters. */
export function distanciaM(a: Punto, b: Punto): number {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const fmtDist = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
/** Rough walking time (straight line × 1.3 for the street grid, 80 m/min). */
export const minutosCaminando = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));

const PEQ = new Set(["de", "del", "la", "las", "los", "y", "e", "el"]);
/** "CORRIENTES AV. 1234, CABA" → "Av. Corrientes 1234"; "PUEYRREDON, HONORIO, DR. AV. 900, CABA" → "Av. Honorio Pueyrredon 900". */
export function lindaDireccion(s: string): string {
  let t = s.replace(/,\s*CABA\s*$/i, "").trim();
  const av = /\bAV(ENIDA)?\.?(?=\s|,|$)/i.test(t);
  t = t.replace(/\bAV(ENIDA)?\.?(?=\s|,|$)/gi, " ").replace(/\b(DR|GRAL|PRES|ING|CNEL|TTE|PTE)\.\s*/gi, " ");
  // "APELLIDO, NOMBRE 900" → "Nombre Apellido 900"
  const m = t.match(/^([^,\d]+),\s*([^,\d]+?)\s*,?\s*(\d.*)?$/);
  if (m) t = `${m[2]} ${m[1]} ${m[3] ?? ""}`;
  t = t.replace(/\s+/g, " ").trim().toLowerCase().split(" ")
    .map((w, i) => (i > 0 && PEQ.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ")
    .replace(/ Y /g, " y ");
  return (av ? "Av. " : "") + t;
}

type UsigJson = {
  errorMessage?: string;
  direccionesNormalizadas?: { direccion: string; cod_partido?: string; nombre_partido?: string; coordenadas?: { x: string | number; y: string | number } | null }[];
};
/** USIG answer → places with coordinates, City first, no duplicates. */
export function lugaresUsig(j: UsigJson): Lugar[] {
  const out: Lugar[] = [];
  for (const d of j.direccionesNormalizadas ?? []) {
    const lng = Number(d.coordenadas?.x), lat = Number(d.coordenadas?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    const caba = (d.cod_partido ?? "").toLowerCase() === "caba" || /ciudad|caba/i.test(d.nombre_partido ?? "");
    const texto = caba ? lindaDireccion(d.direccion) : d.direccion;
    if (out.some((o) => o.texto === texto)) continue;
    out.push({ lat, lng, texto, caba });
  }
  return out.sort((a, b) => Number(b.caba) - Number(a.caba));
}

/** Candidates for an address typed by the dispatcher (several when the street name is ambiguous). */
export async function buscarLugares(q: string, signal?: AbortSignal): Promise<Lugar[]> {
  const dir = limpiarDireccion(q);
  try {
    const r = await fetch(`${USIG}?geocodificar=TRUE&srid=4326&maxOptions=8&direccion=${encodeURIComponent(dir)}`, { signal });
    if (r.ok) { const l = lugaresUsig(await r.json()); if (l.length) return l.slice(0, 5); }
  } catch (e) { if ((e as Error).name === "AbortError") throw e; }
  // fallback: OpenStreetMap, limited to Argentina
  const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=3&countrycodes=ar&accept-language=es&q=${encodeURIComponent(`${dir}, Buenos Aires`)}`, { signal });
  if (!r.ok) return [];
  const xs = (await r.json()) as { lat: string; lon: string; display_name: string }[];
  return xs.map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), texto: x.display_name.split(",").slice(0, 3).join(","), caba: /Ciudad Autónoma/.test(x.display_name) }))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
}

/* ---------- where each bag is (cached on the phone; management also saves it on the bag) ---------- */
const CACHE = "geo-v1:";
type Guardado = { p: Punto | null; t: number };
function leerCache(dir: string): Guardado | null { try { const s = localStorage.getItem(CACHE + dir.toLowerCase()); return s ? JSON.parse(s) : null; } catch { return null; } }
function escribirCache(dir: string, p: Punto | null) { try { localStorage.setItem(CACHE + dir.toLowerCase(), JSON.stringify({ p, t: Date.now() })); } catch {} }

/** A bag's point from its address. `enCiudad` = the bag's neighborhood is in CABA (not "Otros"). */
export async function ubicarBolso(direccion: string, enCiudad: boolean): Promise<Punto | null> {
  const dir = limpiarDireccion(direccion);
  if (!dir || !/\d/.test(dir)) return null;
  const c = leerCache(dir);
  if (c && (c.p || Date.now() - c.t < 864e5)) return c.p; // a failed lookup is retried after a day
  try {
    const l = await buscarLugares(dir);
    const p = (enCiudad ? l.find((x) => x.caba) : l[0]) ?? l[0] ?? null;
    const punto = p ? { lat: p.lat, lng: p.lng } : null;
    escribirCache(dir, punto);
    return punto;
  } catch { return null; }
}

/** Google Maps walking directions from the emergency to the bag. */
export const linkComoLlegar = (desde: Punto, hasta: Punto) =>
  `https://www.google.com/maps/dir/?api=1&origin=${desde.lat},${desde.lng}&destination=${hasta.lat},${hasta.lng}&travelmode=walking`;

/** Bags ranked by distance; `usable` ones (in service and open now) come first in their own list. */
export function cercanos<T>(punto: Punto, items: { x: T; p: Punto | null; usable: boolean }[], max = 5) {
  const conDist = items.filter((i) => i.p).map((i) => ({ ...i, m: distanciaM(punto, i.p!) })).sort((a, b) => a.m - b.m);
  const disponibles = conDist.filter((i) => i.usable).slice(0, max);
  const lejosDelPrimero = disponibles[0]?.m ?? Infinity;
  // not usable but closer than the nearest usable one: worth knowing (e.g. closed now, out of service)
  const noDisponibles = conDist.filter((i) => !i.usable && i.m < lejosDelPrimero).slice(0, 3);
  return { disponibles, noDisponibles, sinUbicar: items.filter((i) => !i.p).length };
}
