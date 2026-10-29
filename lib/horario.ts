// Reads the free-text opening hours of a bag ("L a J de 7 a 22 y V de 7 a 16", "24 hs", "D a V hasta 16 hs"…)
// and tells whether it is available right now in Buenos Aires. Pure logic, tested in tests/horario.test.ts.

export type Franja = { dia: number; desde: number; hasta: number }; // dia 0=domingo … 6=sábado; minutes 0–1440
export type Horario = { tipo: "desconocido" } | { tipo: "franjas"; franjas: Franja[]; siempre: boolean };
export type Disponibilidad =
  | { estado: "desconocido" }
  | { estado: "abierto"; siempre: boolean; cierra: { dia: number; min: number } | null }
  | { estado: "cerrado"; abre: { dia: number; min: number } | null };

const DIAS: [RegExp, number][] = [
  [/^(lunes|lu|l)$/, 1], [/^(martes|ma|m)$/, 2], [/^(miercoles|mi|x)$/, 3], [/^(jueves|ju|j)$/, 4],
  [/^(viernes|vi|v)$/, 5], [/^(sabados?|sa|s)$/, 6], [/^(domingos?|do|d)$/, 0],
];
const DIA = "lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|lu|ma|mi|ju|vi|sa|do|l|m|x|j|v|s|d";
const HORA = "\\d{1,2}(?:[:.]\\d{2})?";
const TOKEN = new RegExp(
  `\\b(?<d1>${DIA})\\s*a\\s*(?<d2>${DIA})\\b` +       // day range: "L a J"
  `|(?<h1>${HORA})\\s*a\\s*(?<h2>${HORA})` +           // time range: "7 a 22", "9:30 a 17"
  `|hasta\\s*(?:las\\s*)?(?<hh>${HORA})` +             // "hasta 16"
  `|\\b(?<d>${DIA})\\b`,                               // single day: "V", "sabado"
  "g",
);

const dia = (s: string) => DIAS.find(([re]) => re.test(s))?.[1] ?? -1;
const minutos = (s: string) => { const [h, m = "0"] = s.split(/[:.]/); return Math.min(1440, Number(h) * 60 + Number(m)); };
const TODOS = [0, 1, 2, 3, 4, 5, 6];

export function leerHorario(texto: string | undefined | null): Horario {
  let t = (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!t.trim() || /confirmar|consultar|\?/.test(t)) return { tipo: "desconocido" };
  t = t.replace(/\b24\s*(hs|hrs|h|horas)\b\.?/g, " 0 a 24 ")       // "24 hs" = the whole day
    .replace(/\b(hs|hrs|horas|hr)\b\.?/g, " ")
    .replace(/[(),;/]/g, " ");
  const franjas: Franja[] = [];
  let dias: number[] | null = null, ultimoFueDia = false;
  const agregarDias = (ds: number[]) => { dias = ultimoFueDia && dias ? [...new Set([...dias, ...ds])] : ds; ultimoFueDia = true; };
  const agregarFranja = (desde: number, hasta: number) => {
    for (const d of dias ?? TODOS) {
      if (hasta > desde) franjas.push({ dia: d, desde, hasta });
      else if (hasta < desde) { franjas.push({ dia: d, desde, hasta: 1440 }); franjas.push({ dia: (d + 1) % 7, desde: 0, hasta }); } // past midnight
    }
    ultimoFueDia = false;
  };
  for (const m of t.matchAll(TOKEN)) {
    const g = m.groups!;
    if (g.d1) {
      const a = dia(g.d1), b = dia(g.d2);
      if (a < 0 || b < 0) continue;
      const ds: number[] = [];
      if (a === b) ds.push(...TODOS); // "L a L" = every day
      else for (let d = a; ; d = (d + 1) % 7) { ds.push(d); if (d === b) break; }
      agregarDias(ds);
    } else if (g.h1) agregarFranja(minutos(g.h1), minutos(g.h2));
    else if (g.hh) agregarFranja(0, minutos(g.hh));
    else if (g.d) { const d = dia(g.d); if (d >= 0) agregarDias([d]); }
  }
  if (!franjas.length) return { tipo: "desconocido" };
  const siempre = TODOS.every((d) => franjas.some((f) => f.dia === d && f.desde === 0 && f.hasta >= 1440));
  return { tipo: "franjas", franjas, siempre };
}

/** Day of week (0=Sunday) and minutes since midnight in Buenos Aires, whatever the phone's time zone. */
export function ahoraBA(now = new Date()): { dia: number; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

export function disponibilidad(h: Horario, now = new Date()): Disponibilidad {
  if (h.tipo === "desconocido") return { estado: "desconocido" };
  const { dia, min } = ahoraBA(now);
  const abiertaEn = (d: number, m: number) => h.franjas.find((f) => f.dia === d && f.desde <= m && m < f.hasta);
  const f = abiertaEn(dia, min);
  if (f) {
    if (h.siempre) return { estado: "abierto", siempre: true, cierra: null };
    // follow back-to-back slots (e.g. until midnight and on from 0:00)
    let d = dia, fin = f.hasta;
    for (let i = 0; i < 7 && fin >= 1440; i++) { const sig = abiertaEn((d + 1) % 7, 0); if (!sig) break; d = (d + 1) % 7; fin = sig.hasta; }
    return { estado: "abierto", siempre: false, cierra: { dia: d, min: fin % 1440 } };
  }
  // next opening within the coming week
  for (let i = 0; i <= 7; i++) {
    const d = (dia + i) % 7;
    const prox = h.franjas.filter((x) => x.dia === d && (i > 0 || x.desde > min)).sort((a, b) => a.desde - b.desde)[0];
    if (prox) return { estado: "cerrado", abre: { dia: d, min: prox.desde } };
  }
  return { estado: "cerrado", abre: null };
}

const NOMBRES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
function cuando(x: { dia: number; min: number }, now: Date) {
  const hoy = ahoraBA(now).dia;
  const dif = (x.dia - hoy + 7) % 7;
  return dif === 0 ? `hoy a las ${hhmm(x.min)}` : dif === 1 ? `mañana a las ${hhmm(x.min)}` : `el ${NOMBRES[x.dia]} a las ${hhmm(x.min)}`;
}
/** Short texts for the card. */
export function textoDisponibilidad(d: Disponibilidad, now = new Date()): string {
  if (d.estado === "abierto") return d.siempre ? "Disponible las 24 hs" : d.cierra ? `Disponible ahora · hasta las ${hhmm(d.cierra.min)}` : "Disponible ahora";
  if (d.estado === "cerrado") return d.abre ? `Abre ${cuando(d.abre, now)}` : "Sin horario de apertura";
  return "";
}

/* ---------- how the app understood a schedule (shown next to the text in "Horarios") ---------- */
const CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const hora = (m: number) => (m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : String(m / 60));

/** "Lun a Jue 7 a 22 · Vie 7 a 16 · Sáb y Dom cerrado", "Todos los días, las 24 hs", or "" when not understood. */
export function describirHorario(h: Horario): string {
  if (h.tipo === "desconocido") return "";
  if (h.siempre) return "Todos los días, las 24 hs";
  const deDia = (d: number) => {
    const fs = h.franjas.filter((f) => f.dia === d).sort((a, b) => a.desde - b.desde);
    // merge touching slots ("0 a 24" written as two halves, past-midnight pieces)
    const m: Franja[] = [];
    for (const f of fs) { const u = m[m.length - 1]; if (u && f.desde <= u.hasta) u.hasta = Math.max(u.hasta, f.hasta); else m.push({ ...f }); }
    if (!m.length) return "cerrado";
    if (m.length === 1 && m[0].desde === 0 && m[0].hasta >= 1440) return "las 24 hs";
    return m.map((f) => `${hora(f.desde)} a ${hora(f.hasta)}`).join(" y ");
  };
  const grupos: { dias: number[]; txt: string }[] = [];
  for (const d of ORDEN) {
    const txt = deDia(d), u = grupos[grupos.length - 1];
    if (u && u.txt === txt) u.dias.push(d); else grupos.push({ dias: [d], txt });
  }
  if (grupos.length === 1) return `Todos los días ${grupos[0].txt}`;
  const nombre = (ds: number[]) => ds.length === 1 ? CORTO[ds[0]] : ds.length === 2 ? `${CORTO[ds[0]]} y ${CORTO[ds[1]]}` : `${CORTO[ds[0]]} a ${CORTO[ds[ds.length - 1]]}`;
  return grupos.map((g) => `${nombre(g.dias)} ${g.txt}`).join(" · ");
}
