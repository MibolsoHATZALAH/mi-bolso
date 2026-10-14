// Pure inventory logic: catalog, item status, sheets (uso / reposición) and history merging.
// No Firebase or React here, so it can be unit-tested with plain Node.

export type Tipo = "sn" | "cant" | "nivel";
export type Item = { id: string; nombre: string; tipo: Tipo; min?: number };
export type Categoria = { id: string; nombre: string; vence?: boolean; items: Item[] };
export type Seccion = { id: string; nombre: string; categorias: Categoria[] };
export type Catalog = { secciones: Seccion[] };

export type Bolso = {
  schema: number;
  catalog: Catalog;
  valores: Record<string, string | null>; // sn: "SI" | "NO"; nivel: "ALTO" | "MEDIO" | "BAJO" | "NO"
  cant: Record<string, number | null>;
  venc: Record<string, string | null>; // "YYYY-MM-DD"
};

export type Cambio = {
  id: string;
  nombre: string;
  tipo: Tipo;
  campo: "v" | "venc";
  de: string | number | null;
  a: string | number | null;
};
export type TipoMov = "uso" | "repo" | "ajuste";
/** `por` = display name of who did it (shared bags only). */
export type Movimiento = { id: string; t: Date; tipo: TipoMov; nota: string; cambios: Cambio[]; por?: string };

export type Level = "bad" | "warn" | "ok" | "none";
export type Status = { level: Level; motivo: string };
export type Row = { s: Seccion; c: Categoria; it: Item; st: Status };

export const SCHEMA = 3;
export const WARN_DAYS = 30;
export const OPTS: Record<"sn" | "nivel", [string, "ok" | "bad" | "warn"][]> = {
  sn: [["SI", "ok"], ["NO", "bad"]],
  nivel: [["ALTO", "ok"], ["MEDIO", "warn"], ["BAJO", "bad"], ["NO", "bad"]],
};
export const TIPOS: Record<Tipo, string> = { sn: "Sí / No", cant: "Cantidad", nivel: "Nivel (O₂)" };

/* ---------- Default catalog (from the team's original spreadsheet) ---------- */
const CANT_IDS = ["ft5", "ft6", "ft7", "ft8", "ft9", "ft12", "ft13", "fm3", "fm7", "po3", "po4", "po5", "po6", "po7", "po8", "po9", "po10", "po11", "ls2", "ls3", "lb1", "lb3"];
const MIN_DEF: Record<string, number> = { ft7: 4, lb3: 6 }; // gasas 4, guantes 6, the rest of the counted items 1

type Raw = [string, string, Tipo?];
const RAW: { id: string; nombre: string; categorias: { id: string; nombre: string; vence?: boolean; items: Raw[] }[] }[] = [
  { id: "frontal", nombre: "Bolso frontal", categorias: [
    { id: "fh", nombre: "Herramientas", items: [["fh1", "Tijera de trauma"], ["fh2", "Jeringa 10 ml"], ["fh3", "Jeringa tuberculina"], ["fh4", "Planilla de atención / registro"], ["fh5", "Pinza de depilar"], ["fh6", "Bajalenguas adulto"], ["fh7", "Férula digital de aluminio"]] },
    { id: "ft", nombre: "Trauma", items: [["ft1", "Venda cambric ancha"], ["ft2", "Venda cambric angosta"], ["ft3", "Cinta"], ["ft4", "Torniquete"], ["ft5", "Curitas adulto"], ["ft6", "Curitas pediátricas"], ["ft7", "Gasas"], ["ft8", "Steri-Strip chico"], ["ft9", "Steri-Strip grande"], ["ft10", "Manta térmica"], ["ft11", "Cabestrillo"], ["ft12", "Apósitos"], ["ft13", "Venda elástica"]] },
    { id: "fm", nombre: "Medicamentos y desinfección", vence: true, items: [["fm1", "Aspirineta (AAS)"], ["fm2", "Carbón activado"], ["fm3", "Glucogel"], ["fm4", "Epinefrina"], ["fm5", "Clorhexidina"], ["fm6", "Solución fisiológica"], ["fm7", "Burn Free"], ["fm8", "Alcohol 70%"]] },
  ] },
  { id: "principal", nombre: "Bolsillo principal", categorias: [
    { id: "ph", nombre: "Herramientas", items: [["ph1", "Kit de parto"], ["ph2", "Pañales adulto"], ["ph3", "Bolsas para desechos"], ["ph4", "Camisolín descartable"], ["ph5", "DEA"]] },
    { id: "pb", nombre: "Bioseguridad", items: [["pb1", "Cofia"], ["pb2", "Protección de pies (botas)"], ["pb3", "Kit EPP"], ["pb4", "Férula SAM"]] },
    { id: "pi", nombre: "Inmovilización", items: [["pi1", "Férula SAM"], ["pi2", "Collarín adulto"], ["pi3", "Collarín pediátrico"]] },
    { id: "po", nombre: "Oxígeno", items: [["po1", "Carga de O₂", "nivel"], ["po2", "Regulador"], ["po3", "Cánula nasal adulto"], ["po4", "Cánula nasal pediátrica"], ["po5", "Cánula nasal neonatal"], ["po6", "Máscara facial común adulto"], ["po7", "Máscara facial común pediátrica"], ["po8", "Máscara facial común neonatal"], ["po9", "Máscara no recirculante adulto"], ["po10", "Máscara no recirculante pediátrica"], ["po11", "Máscara no recirculante neonatal"]] },
    { id: "pv", nombre: "Vía aérea", items: [["pv1", "Sonda de aspiración adulto"], ["pv2", "Sonda de aspiración pediátrica"], ["pv3", "BVM adulto"], ["pv4", "BVM pediátrico"], ["pv5", "BVM pocket"], ["pv6", "Cánula orofaríngea N° 000"], ["pv7", "Cánula orofaríngea N° 00 (rosa)"], ["pv8", "Cánula orofaríngea N° 0 (azul)"], ["pv9", "Cánula orofaríngea N° 1 (negra)"], ["pv10", "Cánula orofaríngea N° 2 (blanca)"], ["pv11", "Cánula orofaríngea N° 3 (verde)"], ["pv12", "Cánula orofaríngea N° 4 (amarilla)"], ["pv13", "Cánula orofaríngea N° 5 (roja)"], ["pv14", "Cánula orofaríngea N° 6 (naranja)"], ["pv15", "Cánulas nasofaríngeas adulto"], ["pv16", "Cánulas nasofaríngeas pediátricas"]] },
  ] },
  { id: "laterales", nombre: "Bolsillos laterales", categorias: [
    { id: "ld", nombre: "Derecho · Signos vitales", items: [["ld1", "Tensiómetro adulto"], ["ld2", "Tensiómetro pediátrico"], ["ld3", "Estetoscopio"]] },
    { id: "ls", nombre: "Izquierdo · Signos vitales", items: [["ls1", "Glucómetro"], ["ls2", "Tiras reactivas"], ["ls3", "Lancetas"], ["ls4", "Linterna LED"], ["ls5", "Pulsioxímetro"], ["ls6", "Termómetro"], ["ls7", "Acetona"], ["ls8", "Paños"], ["ls9", "Algodón"]] },
    { id: "lb", nombre: "Izquierdo · Bioseguridad", items: [["lb1", "Barbijos"], ["lb2", "Protección ocular"], ["lb3", "Guantes"], ["lb4", "Pilas AAA de repuesto"], ["lb5", "Pila CR2032"]] },
  ] },
];

export function defaultCatalog(): Catalog {
  return {
    secciones: RAW.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      categorias: s.categorias.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        ...(c.vence ? { vence: true } : {}),
        items: c.items.map(([id, nombre, tipo]) => {
          const t: Tipo = tipo ?? (CANT_IDS.includes(id) ? "cant" : "sn");
          return t === "cant" ? { id, nombre, tipo: t, min: MIN_DEF[id] ?? 1 } : { id, nombre, tipo: t };
        }),
      })),
    })),
  };
}

export function emptyBolso(): Bolso {
  return { schema: SCHEMA, catalog: defaultCatalog(), valores: {}, cant: {}, venc: {} };
}

/* ---------- Dates ---------- */
function today(now = new Date()) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
export function daysTo(ymd: string | null | undefined, now = new Date()): number | null {
  if (!ymd) return null;
  return Math.round((new Date(ymd + "T00:00:00").getTime() - today(now).getTime()) / 864e5);
}
export const fmtDay = (ymd?: string | null) => { if (!ymd) return ""; const [y, m, d] = ymd.split("-"); return `${d}/${m}/${y}`; };
export const fmtDate = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
export const fmtWhen = (d: Date) => d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/* ---------- Status ---------- */
export function statusOf(b: Bolso, it: Item, c: Categoria, now = new Date()): Status {
  const dd = c.vence ? daysTo(b.venc[it.id], now) : null;
  if (it.tipo === "cant") {
    const n = b.cant[it.id];
    if (n == null) return { level: "none", motivo: "Sin cargar" };
    const min = it.min ?? 0;
    if (n === 0) return { level: "bad", motivo: "Sin stock" };
    if (min && n < min) return { level: "bad", motivo: `Faltan ${min - n}` };
    if (dd !== null && dd < 0) return { level: "bad", motivo: "Vencido" };
    if (dd !== null && dd <= WARN_DAYS) return { level: "warn", motivo: dd === 0 ? "Vence hoy" : `Vence en ${dd} d` };
    return { level: "ok", motivo: "" };
  }
  const v = b.valores[it.id] ?? null;
  if (v === "NO") return { level: "bad", motivo: "Falta" };
  if (v === "BAJO") return { level: "bad", motivo: "Carga baja" };
  // a loaded expiry date counts even if SÍ wasn't tapped yet (same rule as the expiry alarm)
  if (dd !== null && dd < 0) return { level: "bad", motivo: "Vencido" };
  if (v === "MEDIO") return { level: "warn", motivo: "Carga media" };
  if (dd !== null && dd <= WARN_DAYS) return { level: "warn", motivo: dd === 0 ? "Vence hoy" : `Vence en ${dd} d` };
  if (!v) return { level: "none", motivo: "Sin cargar" };
  return { level: "ok", motivo: "" };
}

export function rows(b: Bolso, now = new Date()): Row[] {
  const out: Row[] = [];
  for (const s of b.catalog.secciones) for (const c of s.categorias) for (const it of c.items) out.push({ s, c, it, st: statusOf(b, it, c, now) });
  return out;
}
export function findItem(b: Bolso, id: string) {
  for (const s of b.catalog.secciones) for (const c of s.categorias) for (const it of c.items) if (it.id === id) return { s, c, it };
  return null;
}
export function groupBySection<T extends { s: Seccion }>(list: T[]) {
  const g = new Map<string, { s: Seccion; items: T[] }>();
  for (const x of list) { if (!g.has(x.s.id)) g.set(x.s.id, { s: x.s, items: [] }); g.get(x.s.id)!.items.push(x); }
  return [...g.values()];
}
export const valText = (it: Item, v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : it.tipo === "cant" ? String(v) : v === "SI" ? "SÍ" : String(v);

/* ---------- Edits ---------- */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Manual change of one item's value (tap SÍ/NO, +/−). Tapping the selected option again clears it. */
export function setValue(b: Bolso, id: string, v: string): { next: Bolso; cambio: Cambio } | null {
  const f = findItem(b, id); if (!f) return null;
  const de = b.valores[id] ?? null, a = de === v ? null : v;
  const next = clone(b); next.valores[id] = a;
  return { next, cambio: { id, nombre: f.it.nombre, tipo: f.it.tipo, campo: "v", de, a } };
}
export function setCant(b: Bolso, id: string, n: number | null): { next: Bolso; cambio: Cambio } | null {
  const f = findItem(b, id); if (!f) return null;
  const de = b.cant[id] ?? null;
  const a = n === null || Number.isNaN(n) ? null : Math.max(0, Math.round(n));
  if (de === a) return null;
  const next = clone(b); next.cant[id] = a;
  return { next, cambio: { id, nombre: f.it.nombre, tipo: "cant", campo: "v", de, a } };
}
export function setVenc(b: Bolso, id: string, ymd: string | null): { next: Bolso; cambio: Cambio } | null {
  const f = findItem(b, id); if (!f) return null;
  const de = b.venc[id] ?? null, a = ymd || null;
  if (de === a) return null;
  const next = clone(b); next.venc[id] = a;
  return { next, cambio: { id, nombre: f.it.nombre, tipo: f.it.tipo, campo: "venc", de, a } };
}

/** Folds a new manual change into the open "ajuste" entry; a change back to the original value drops out. */
export function mergeCambio(list: Cambio[], ch: Cambio): Cambio[] {
  const out = list.map((x) => ({ ...x }));
  const k = out.find((x) => x.id === ch.id && x.campo === ch.campo);
  if (k) { k.a = ch.a; return k.de === k.a ? out.filter((x) => x !== k) : out; }
  return ch.de === ch.a ? out : [...out, ch];
}

export type Draft = Record<string, true | number | string>; // sn: true; cant: amount; nivel: new level
/** Applies the "Registrar uso" (uso) or "Reponer" (repo) sheet. */
export function applySheet(b: Bolso, kind: "uso" | "repo", draft: Draft, draftVenc: Record<string, string>) {
  const uso = kind === "uso", next = clone(b), cambios: Cambio[] = [];
  for (const [id, d] of Object.entries(draft)) {
    const f = findItem(b, id); if (!f) continue; const it = f.it;
    if (it.tipo === "cant") {
      const n = Number(d) || 0; if (!n) continue;
      const de = b.cant[id] ?? 0, a = uso ? Math.max(0, de - n) : de + n;
      next.cant[id] = a; cambios.push({ id, nombre: it.nombre, tipo: "cant", campo: "v", de, a });
    } else {
      const de = b.valores[id] ?? null;
      const a = it.tipo === "nivel" ? String(d) : uso ? "NO" : "SI";
      if (de === a) continue;
      next.valores[id] = a; cambios.push({ id, nombre: it.nombre, tipo: it.tipo, campo: "v", de, a });
    }
  }
  if (!uso) for (const [id, ymd] of Object.entries(draftVenc)) {
    const f = findItem(b, id); if (!f) continue;
    const de = b.venc[id] ?? null, a = ymd || null;
    if (de === a) continue;
    next.venc[id] = a; cambios.push({ id, nombre: f.it.nombre, tipo: f.it.tipo, campo: "venc", de, a });
  }
  return { next, cambios };
}

/* ---------- Catalog editing ---------- */
export function renameItem(b: Bolso, id: string, nombre: string) {
  const next = clone(b), f = findItem(next, id); if (!f || !nombre.trim()) return b;
  f.it.nombre = nombre.trim(); return next;
}
export function setTipo(b: Bolso, id: string, tipo: Tipo) {
  const next = clone(b), f = findItem(next, id); if (!f) return b;
  f.it.tipo = tipo;
  if (tipo === "cant") f.it.min = f.it.min ?? 1; else delete f.it.min;
  delete next.valores[id]; delete next.cant[id];
  return next;
}
export function setMin(b: Bolso, id: string, min: number | null) {
  const next = clone(b), f = findItem(next, id); if (!f) return b;
  if (!min) delete f.it.min; else f.it.min = Math.max(0, Math.round(min));
  return next;
}
export function addItem(b: Bolso, catId: string, nombre: string, newId: string) {
  const next = clone(b);
  for (const s of next.catalog.secciones) for (const c of s.categorias) if (c.id === catId && nombre.trim()) c.items.push({ id: newId, nombre: nombre.trim(), tipo: "sn" });
  return next;
}
export function removeItem(b: Bolso, id: string) {
  const next = clone(b);
  for (const s of next.catalog.secciones) for (const c of s.categorias) c.items = c.items.filter((x) => x.id !== id);
  delete next.valores[id]; delete next.cant[id]; delete next.venc[id];
  return next;
}

/* ---------- Copy text for restocking ---------- */
export function buildCopyText(b: Bolso, now = new Date(), titulo = "Bolso paramédico") {
  const all = rows(b, now);
  const bad = all.filter((x) => x.st.level === "bad"), warn = all.filter((x) => x.st.level === "warn");
  let t = `${titulo} – reposición al ${fmtDate(now)}\n`;
  for (const g of groupBySection(bad)) {
    t += `\n${g.s.nombre.toUpperCase()}\n`;
    for (const x of g.items) {
      const extra = x.it.tipo === "cant" && x.it.min ? ` – faltan ${Math.max(0, x.it.min - (b.cant[x.it.id] ?? 0))}` : x.st.motivo !== "Falta" ? ` (${x.st.motivo.toLowerCase()})` : "";
      t += `• ${x.it.nombre}${extra}\n`;
    }
  }
  if (warn.length) { t += `\nATENCIÓN\n`; for (const x of warn) t += `• ${x.it.nombre} (${x.st.motivo.toLowerCase()})\n`; }
  return t.trim();
}

/* ---------- Import from the previous single-file app (backup JSON) ---------- */
type LegacyCambio = { id: string; nombre: string; tipo?: Tipo; campo?: "v" | "venc"; de: unknown; a: unknown };
type Legacy = { schema?: number; catalog?: Catalog; valores?: Record<string, string | null>; cant?: Record<string, number | null>; venc?: Record<string, string | null>; historial?: { t: string; tipo: TipoMov; nota?: string; cambios: LegacyCambio[] }[] };

export function parseLegacyBackup(text: string): { bolso: Bolso; historial: Omit<Movimiento, "id">[] } {
  const d = JSON.parse(text) as Legacy;
  if (!d || !d.catalog || !Array.isArray(d.catalog.secciones)) throw new Error("No es una copia de Mi Bolso");
  const bolso: Bolso = { schema: SCHEMA, catalog: d.catalog, valores: { ...(d.valores ?? {}) }, cant: { ...(d.cant ?? {}) }, venc: { ...(d.venc ?? {}) } };
  // older copies stored counted items as SÍ/NO: move them over
  for (const s of bolso.catalog.secciones) for (const c of s.categorias) for (const it of c.items) {
    if (it.tipo === "cant" && it.id in bolso.valores) {
      if (bolso.valores[it.id] === "NO" && bolso.cant[it.id] == null) bolso.cant[it.id] = 0;
      delete bolso.valores[it.id];
    }
    if (it.tipo === "cant" && it.min == null) it.min = MIN_DEF[it.id] ?? 1;
  }
  const historial = (d.historial ?? []).map((h) => ({
    t: new Date(h.t),
    tipo: h.tipo,
    nota: h.nota ?? "",
    cambios: (h.cambios ?? []).map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo ?? "sn", campo: c.campo ?? "v", de: (c.de ?? null) as Cambio["de"], a: (c.a ?? null) as Cambio["a"] })),
  }));
  return { bolso, historial };
}

/* ---------- Summary of one bag (for the list of shared bags) ---------- */
export type Resumen = { faltan: number; atencion: number; cargados: number; total: number; bad: Row[]; warn: Row[] };
export function resumen(b: Bolso, now = new Date()): Resumen {
  const all = rows(b, now);
  const bad = all.filter((x) => x.st.level === "bad"), warn = all.filter((x) => x.st.level === "warn");
  return { faltan: bad.length, atencion: warn.length, cargados: all.filter((x) => x.st.level !== "none").length, total: all.length, bad, warn };
}

/** One restocking text for several bags (management view). Bags never loaded are listed apart. */
export function buildCopyTextVarios(bolsos: { nombre: string; ubicacion?: string; bolso: Bolso }[], now = new Date()) {
  let t = `Bolsos – reposición al ${fmtDate(now)}\n`;
  const sinCargar: string[] = [];
  let algo = false;
  for (const x of bolsos) {
    const r = resumen(x.bolso, now);
    if (!r.cargados) { sinCargar.push(x.nombre); continue; }
    if (!r.faltan && !r.atencion) continue;
    algo = true;
    t += `\n*${x.nombre}*${x.ubicacion ? ` (${x.ubicacion})` : ""}\n`;
    for (const y of r.bad) {
      const extra = y.it.tipo === "cant" && y.it.min && y.st.motivo.startsWith("Faltan") ? ` – faltan ${Math.max(0, y.it.min - (x.bolso.cant[y.it.id] ?? 0))}` : y.st.motivo !== "Falta" ? ` (${y.st.motivo.toLowerCase()})` : "";
      t += `• ${y.it.nombre}${extra}\n`;
    }
    for (const y of r.warn) t += `• ${y.it.nombre} (${y.st.motivo.toLowerCase()})\n`;
  }
  if (!algo) t += `\nNo falta nada en los bolsos revisados.\n`;
  if (sinCargar.length) t += `\nTodavía sin inventariar: ${sinCargar.join(", ")}\n`;
  return t.trim();
}

/* ---------- Expiry alarm ---------- */
export type AlertaVenc = { s: Seccion; c: Categoria; it: Item; venc: string; dias: number };
/** Items with an expiry date that is past or within WARN_DAYS. Items not in the bag (0 / NO) don't count. */
export function alertasVenc(b: Bolso, now = new Date()): AlertaVenc[] {
  const out: AlertaVenc[] = [];
  for (const s of b.catalog.secciones) for (const c of s.categorias) {
    if (!c.vence) continue;
    for (const it of c.items) {
      const venc = b.venc[it.id]; if (!venc) continue;
      const dias = daysTo(venc, now); if (dias === null || dias > WARN_DAYS) continue;
      if (it.tipo === "cant" ? b.cant[it.id] === 0 : b.valores[it.id] === "NO") continue;
      out.push({ s, c, it, venc, dias });
    }
  }
  return out.sort((x, y) => x.dias - y.dias);
}
export const textoVenc = (a: { dias: number }) =>
  a.dias < 0 ? (a.dias === -1 ? "venció ayer" : `vencido hace ${-a.dias} días`) : a.dias === 0 ? "vence hoy" : a.dias === 1 ? "vence mañana" : `vence en ${a.dias} días`;
