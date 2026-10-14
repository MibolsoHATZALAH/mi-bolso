// Decides which alarms the daily job sends. Pure logic (no Firebase), tested in tests/alarmas.test.ts.
//
//  - Vencimientos: every day, for any bag with medicines expired or expiring within 30 days.
//      personal bag      → its owner
//      shared bag        → management + whoever last updated that bag
//  - Faltantes (shared bags only): every FALTANTES_CADA_HORAS while the bag has missing items,
//      → management + whoever last updated that bag.
// Each person gets at most one "vencimientos" and one "faltantes" notification per run.
import { alertasVenc, resumen, textoVenc, type Bolso } from "./inventory.ts";
import { APP_URL, FALTANTES_CADA_HORAS } from "./config.ts";

export type Personal = { uid: string; bolso: Bolso; ultimoVenc?: string };
export type Compartido = {
  id: string; nombre: string; bolso: Bolso; ultimoPorEmail?: string;
  ultimoVenc?: string; ultimoFaltante?: number; // ms
};
/** Recipient: "uid:<uid>" for a personal bag's owner, "email:<email>" for shared-bag recipients. */
export type Aviso = { para: string; tipo: "venc" | "faltantes"; titulo: string; texto: string; link: string; tag: string };
export type Marca = { coleccion: "personal" | "bolso"; id: string; campo: "ultimoVenc" | "ultimoFaltante"; valor: string | number };

const lista = (xs: string[], max = 3) => xs.length <= max ? xs.join(" · ") : `${xs.slice(0, max).join(" · ")} · y ${xs.length - max} más`;

export function planificar(
  { personales, compartidos, gerencia, now, hoy }:
  { personales: Personal[]; compartidos: Compartido[]; gerencia: string[]; now: Date; hoy: string },
): { avisos: Aviso[]; marcas: Marca[] } {
  const avisos: Aviso[] = [], marcas: Marca[] = [];

  /* personal bags: expiry to the owner, once a day */
  for (const p of personales) {
    if (p.ultimoVenc === hoy) continue;
    const a = alertasVenc(p.bolso, now);
    if (!a.length) continue;
    const venc = a.filter((x) => x.dias < 0).length;
    avisos.push({
      para: `uid:${p.uid}`, tipo: "venc", tag: "venc-personal", link: `${APP_URL}/`,
      titulo: venc ? `Mi Bolso: ${venc === 1 ? "1 medicamento vencido" : `${venc} medicamentos vencidos`}` : "Mi Bolso: medicamentos por vencer",
      texto: lista(a.map((x) => `${x.it.nombre} ${textoVenc(x)}`)),
    });
    marcas.push({ coleccion: "personal", id: p.uid, campo: "ultimoVenc", valor: hoy });
  }

  /* shared bags: collect what is due per bag, then group per person */
  const gerenciaSet = [...new Set(gerencia.map((e) => e.toLowerCase()))];
  const porPersona = new Map<string, { venc: { b: Compartido; n: number; vencidos: number; items: string[] }[]; falt: { b: Compartido; n: number }[] }>();
  const de = (email: string) => {
    if (!porPersona.has(email)) porPersona.set(email, { venc: [], falt: [] });
    return porPersona.get(email)!;
  };
  for (const b of compartidos) {
    const destinatarios = [...new Set([...gerenciaSet, ...(b.ultimoPorEmail ? [b.ultimoPorEmail.toLowerCase()] : [])])];
    if (b.ultimoVenc !== hoy) {
      const a = alertasVenc(b.bolso, now);
      if (a.length) {
        const item = { b, n: a.length, vencidos: a.filter((x) => x.dias < 0).length, items: a.map((x) => `${x.it.nombre} ${textoVenc(x)}`) };
        destinatarios.forEach((e) => de(e).venc.push(item));
        marcas.push({ coleccion: "bolso", id: b.id, campo: "ultimoVenc", valor: hoy });
      }
    }
    const r = resumen(b.bolso, now);
    const debido = b.ultimoFaltante === undefined || now.getTime() - b.ultimoFaltante >= (FALTANTES_CADA_HORAS - 1) * 3600e3;
    if (r.cargados > 0 && r.faltan > 0 && debido) {
      destinatarios.forEach((e) => de(e).falt.push({ b, n: r.faltan }));
      marcas.push({ coleccion: "bolso", id: b.id, campo: "ultimoFaltante", valor: now.getTime() });
    }
  }

  for (const [email, x] of porPersona) {
    if (x.venc.length) {
      const uno = x.venc.length === 1 ? x.venc[0] : null;
      const vencidos = x.venc.reduce((s, y) => s + y.vencidos, 0);
      avisos.push({
        para: `email:${email}`, tipo: "venc", tag: "venc-bolsos",
        link: uno ? `${APP_URL}/bolsos/#b/${encodeURIComponent(uno.b.id)}` : `${APP_URL}/bolsos/`,
        titulo: uno
          ? `${uno.b.nombre}: ${uno.vencidos ? `${uno.vencidos === 1 ? "1 vencido" : `${uno.vencidos} vencidos`}` : "medicamentos por vencer"}`
          : `Vencimientos en ${x.venc.length} bolsos${vencidos ? ` (${vencidos} vencidos)` : ""}`,
        texto: uno ? lista(uno.items) : lista(x.venc.map((y) => `${y.b.nombre}: ${y.n}`), 4),
      });
    }
    if (x.falt.length) {
      const uno = x.falt.length === 1 ? x.falt[0] : null;
      avisos.push({
        para: `email:${email}`, tipo: "faltantes", tag: "faltantes-bolsos",
        link: uno ? `${APP_URL}/bolsos/#b/${encodeURIComponent(uno.b.id)}` : `${APP_URL}/bolsos/`,
        titulo: uno ? `Faltantes en ${uno.b.nombre}` : `Faltantes en ${x.falt.length} bolsos`,
        texto: uno
          ? `${uno.n === 1 ? "Falta 1 elemento" : `Faltan ${uno.n} elementos`}. Reponelo y registralo en la app.`
          : lista(x.falt.map((y) => `${y.b.nombre}: ${y.n}`), 4),
      });
    }
  }
  return { avisos, marcas };
}

/** Today's date in Buenos Aires as YYYY-MM-DD (the job runs in UTC). */
export const hoyAR = (now = new Date()) => new Date(now.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
