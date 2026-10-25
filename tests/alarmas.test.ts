import { test } from "node:test";
import assert from "node:assert/strict";
import { planificar, hoyAR, repartirTokens, type Compartido } from "../lib/alarmas.ts";
import { alertasVenc, emptyBolso, setCant, setValue, setVenc, textoVenc } from "../lib/inventory.ts";

const now = new Date(2026, 9, 14, 12, 0, 0);
const hoy = "2026-10-14";
const ymd = (d: number) => { const x = new Date(now); x.setDate(x.getDate() + d); return x.toLocaleDateString("sv"); };

test("expiry alarm: expired and within 30 days count, later dates and items not in the bag don't", () => {
  let b = emptyBolso();
  b = setVenc(b, "fm4", ymd(-2))!.next;   // epinefrina vencida
  b = setVenc(b, "fm1", ymd(10))!.next;   // aspirineta en 10 días
  b = setVenc(b, "fm2", ymd(45))!.next;   // carbón: lejos
  b = setVenc(b, "fm3", ymd(5))!.next;    // glucogel...
  b = setCant(b, "fm3", 0)!.next;         // ...pero no hay: no alarma
  b = setVenc(b, "fm5", ymd(3))!.next;
  b = setValue(b, "fm5", "NO")!.next;     // clorhexidina falta: no alarma
  const a = alertasVenc(b, now);
  assert.deepEqual(a.map((x) => [x.it.nombre, x.dias]), [["Epinefrina", -2], ["Aspirineta (AAS)", 10]]);
  assert.equal(textoVenc(a[0]), "vencido hace 2 días");
  assert.equal(textoVenc({ dias: 0 }), "vence hoy");
});

function compartido(id: string, nombre: string, f: (b: ReturnType<typeof emptyBolso>) => ReturnType<typeof emptyBolso>, extra: Partial<Compartido> = {}): Compartido {
  return { id, nombre, bolso: f(emptyBolso()), ...extra };
}

test("shared bags: missing items go to management + last reviewer, every 48 h", () => {
  const sede = compartido("sede", "Sede", (b) => setCant(b, "ft7", 1)!.next, { ultimoPorEmail: "Ana@gmail.com" });
  const auto = compartido("auto", "Auto 2", (b) => setValue(b, "ft4", "SI")!.next, { ultimoPorEmail: "beto@gmail.com" }); // complete
  const vacio = compartido("vacio", "Templo", (b) => b); // never loaded: no alarm
  const r = planificar({ personales: [], compartidos: [sede, auto, vacio], gerencia: ["jefe@gmail.com"], now, hoy });
  const falt = r.avisos.filter((a) => a.tipo === "faltantes");
  assert.deepEqual(falt.map((a) => a.para).sort(), ["email:ana@gmail.com", "email:jefe@gmail.com"]);
  assert.equal(falt[0].titulo, "Faltantes en Sede");
  assert.match(falt[0].link, /bolsos\/#b\/sede$/);
  assert.deepEqual(r.marcas.map((m) => [m.id, m.campo]), [["sede", "ultimoFaltante"]]);

  // 30 h later: not yet; 47+ h later: again
  const r2 = planificar({ personales: [], compartidos: [{ ...sede, ultimoFaltante: now.getTime() - 30 * 3600e3 }], gerencia: ["jefe@gmail.com"], now, hoy });
  assert.equal(r2.avisos.length, 0);
  const r3 = planificar({ personales: [], compartidos: [{ ...sede, ultimoFaltante: now.getTime() - 47.5 * 3600e3 }], gerencia: ["jefe@gmail.com"], now, hoy });
  assert.equal(r3.avisos.length, 2);
});

test("several bags are grouped in one notification per person", () => {
  const a = compartido("a", "Sede", (b) => setCant(b, "ft7", 1)!.next);
  const c = compartido("c", "Auto 2", (b) => setValue(b, "ft4", "NO")!.next);
  const r = planificar({ personales: [], compartidos: [a, c], gerencia: ["jefe@gmail.com"], now, hoy });
  assert.equal(r.avisos.length, 1);
  assert.equal(r.avisos[0].titulo, "Faltantes en 2 bolsos");
  assert.equal(r.avisos[0].texto, "Sede: 1 · Auto 2: 1");
});

test("expiry: daily, personal to the owner and shared to management, once per day", () => {
  const personal = { uid: "u1", bolso: setVenc(emptyBolso(), "fm4", ymd(-1))!.next };
  const sede = compartido("sede", "Sede", (b) => setVenc(b, "fm1", ymd(20))!.next, { ultimoPorEmail: "ana@gmail.com" });
  const r = planificar({ personales: [personal], compartidos: [sede], gerencia: ["jefe@gmail.com"], now, hoy });
  const v = r.avisos.filter((x) => x.tipo === "venc");
  assert.deepEqual(v.map((x) => x.para).sort(), ["email:ana@gmail.com", "email:jefe@gmail.com", "uid:u1"]);
  assert.equal(v.find((x) => x.para === "uid:u1")!.titulo, "Mi Bolso: 1 medicamento vencido");
  assert.equal(v.find((x) => x.para === "uid:u1")!.texto, "Epinefrina venció ayer");
  assert.equal(v.find((x) => x.para === "email:jefe@gmail.com")!.titulo, "Sede: medicamentos por vencer");
  // already sent today
  const r2 = planificar({ personales: [{ ...personal, ultimoVenc: hoy }], compartidos: [{ ...sede, ultimoVenc: hoy }], gerencia: ["jefe@gmail.com"], now, hoy });
  assert.equal(r2.avisos.length, 0);
});

test("date in Buenos Aires", () => {
  assert.equal(hoyAR(new Date("2026-10-15T02:00:00Z")), "2026-10-14");
  assert.equal(hoyAR(new Date("2026-10-15T12:00:00Z")), "2026-10-15");
});

test("an expired date marks the item even before SÍ is tapped", async () => {
  const { statusOf, findItem } = await import("../lib/inventory.ts");
  const b = setVenc(emptyBolso(), "fm4", ymd(-1))!.next;
  const f = findItem(b, "fm4")!;
  assert.deepEqual(statusOf(b, f.it, f.c, now), { level: "bad", motivo: "Vencido" });
  const n = setValue(b, "fm4", "NO")!.next;
  // epinefrina is not on the vital list: missing is yellow
  assert.deepEqual(statusOf(n, f.it, f.c, now), { level: "warn", motivo: "Falta", falta: true });
});

test("out-of-service bags get no alarms", () => {
  const sede = compartido("sede", "Sede", (b) => setVenc(setCant(b, "ft7", 1)!.next, "fm4", ymd(-1))!.next, { fueraDeServicio: true });
  const r = planificar({ personales: [], compartidos: [sede], gerencia: ["jefe@gmail.com"], now, hoy });
  assert.equal(r.avisos.length, 0);
  assert.equal(r.marcas.length, 0);
});

test("each app's alarms only reach that app's phones", () => {
  const { porUid, porEmail } = repartirTokens([
    { uid: "u1", token: "personal-iphone", email: "Uri@gmail.com", apps: ["personal"] },
    { uid: "u1", token: "bolsos-iphone", email: "Uri@gmail.com", apps: ["bolsos"] },
    { uid: "u1", token: "viejo-compartido", email: "uri@gmail.com", apps: [] },      // replaced by both apps
    { uid: "u2", token: "ana-bolsos", email: "ana@gmail.com", apps: ["bolsos"] },
    { uid: "u3", token: "sin-app", email: "x@gmail.com" },
  ]);
  assert.deepEqual(porUid.get("u1"), ["personal-iphone"]);          // personal expiry alarms
  assert.deepEqual(porEmail.get("uri@gmail.com"), ["bolsos-iphone"]); // shared-bag missing / expiry alarms
  assert.equal(porUid.get("u2"), undefined);                          // Ana only uses the shared-bags app
  assert.deepEqual(porEmail.get("ana@gmail.com"), ["ana-bolsos"]);
  assert.equal(porUid.get("u3"), undefined);
  assert.equal(porEmail.get("x@gmail.com"), undefined);
});
