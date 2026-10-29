import { test } from "node:test";
import assert from "node:assert/strict";
import { disponibilidad, leerHorario, textoDisponibilidad, type Horario } from "../lib/horario.ts";

// Buenos Aires is UTC-3 all year: build instants from local BA time
const ba = (iso: string) => new Date(iso + "-03:00");
// 2026-10-12 is a Monday
const LUN = "2026-10-12", MAR = "2026-10-13", JUE = "2026-10-15", VIE = "2026-10-16", SAB = "2026-10-17", DOM = "2026-10-18";
const abierto = (h: string, when: string) => disponibilidad(leerHorario(h), ba(when)).estado;
const franjasDe = (h: Horario) => (h.tipo === "franjas" ? h.franjas : []);

test("every schedule in the institution's spreadsheet is understood", () => {
  const todos = [
    "Lunes a Jueves 9 a 17 hs", "24 hs", "L a J de 7 a 22 y V de 7 a 16", "L a D de 8 a 12 y 19 a 20",
    "L a V 7 a 23, S 8 a 21 y D 8 a 12 y 16 a 21", "L a D de 8 a 21 hs", "8 a 20 hs", "L a D de 7 a 20",
    "L a L de 6 a 22 hs", "L a J de 10 a 18:30, V de 10 a 16", "6 a 22", "L a V de 9:30 a 17 hs", "L a J 7:30 a 18 hs",
    "D a V hasta 16 hs", "L a J 09:30 a 19:00 hs", "L a L de 6 a 23 hs", "8 a 20", "9 a 17", "6:30 a 21", "24 hs en temporada",
  ];
  for (const h of todos) assert.equal(leerHorario(h).tipo, "franjas", h);
  assert.equal(leerHorario("A confirmar").tipo, "desconocido");
  assert.equal(leerHorario("").tipo, "desconocido");
});

test("24 hs is always available", () => {
  const h = leerHorario("24 hs");
  assert.ok(h.tipo === "franjas" && h.siempre);
  assert.equal(abierto("24 hs", `${DOM}T03:00`), "abierto");
  assert.equal(textoDisponibilidad(disponibilidad(h, ba(`${MAR}T03:00`))), "Disponible las 24 hs");
});

test("L a J de 7 a 22 y V de 7 a 16", () => {
  const h = "L a J de 7 a 22 y V de 7 a 16";
  assert.equal(abierto(h, `${LUN}T06:59`), "cerrado");
  assert.equal(abierto(h, `${LUN}T07:00`), "abierto");
  assert.equal(abierto(h, `${JUE}T21:59`), "abierto");
  assert.equal(abierto(h, `${JUE}T22:00`), "cerrado");
  assert.equal(abierto(h, `${VIE}T15:00`), "abierto");
  assert.equal(abierto(h, `${VIE}T17:00`), "cerrado");
  assert.equal(abierto(h, `${SAB}T12:00`), "cerrado");
  const d = disponibilidad(leerHorario(h), ba(`${VIE}T17:00`));
  assert.equal(textoDisponibilidad(d, ba(`${VIE}T17:00`)), "Abre el lunes a las 7:00");
  const d2 = disponibilidad(leerHorario(h), ba(`${JUE}T10:00`));
  assert.equal(textoDisponibilidad(d2, ba(`${JUE}T10:00`)), "Disponible ahora · hasta las 22:00");
});

test("several slots and days: L a V 7 a 23, S 8 a 21 y D 8 a 12 y 16 a 21", () => {
  const h = "L a V 7 a 23, S 8 a 21 y D 8 a 12 y 16 a 21";
  assert.equal(abierto(h, `${SAB}T20:30`), "abierto");
  assert.equal(abierto(h, `${SAB}T22:00`), "cerrado");
  assert.equal(abierto(h, `${DOM}T13:00`), "cerrado");
  assert.equal(abierto(h, `${DOM}T16:30`), "abierto");
  assert.equal(abierto(h, `${MAR}T22:30`), "abierto");
  const d = disponibilidad(leerHorario(h), ba(`${DOM}T13:00`));
  assert.equal(textoDisponibilidad(d, ba(`${DOM}T13:00`)), "Abre hoy a las 16:00");
});

test("L a D de 8 a 12 y 19 a 20 (two slots every day)", () => {
  const h = "L a D de 8 a 12 y 19 a 20";
  assert.equal(abierto(h, `${MAR}T11:00`), "abierto");
  assert.equal(abierto(h, `${MAR}T15:00`), "cerrado");
  assert.equal(abierto(h, `${DOM}T19:30`), "abierto");
});

test("no days written = every day; L a L = every day; D a V hasta 16", () => {
  assert.equal(abierto("6 a 22", `${SAB}T21:00`), "abierto");
  assert.equal(abierto("6 a 22", `${SAB}T23:00`), "cerrado");
  assert.equal(abierto("L a L de 6 a 23 hs", `${DOM}T22:30`), "abierto");
  assert.equal(abierto("D a V hasta 16 hs", `${DOM}T10:00`), "abierto");
  assert.equal(abierto("D a V hasta 16 hs", `${VIE}T16:30`), "cerrado");
  assert.equal(abierto("D a V hasta 16 hs", `${SAB}T10:00`), "cerrado");
  assert.equal(franjasDe(leerHorario("L a J 09:30 a 19:00 hs"))[0].desde, 570);
});

test("unknown schedules never hide a bag", () => {
  assert.equal(abierto("A confirmar", `${SAB}T03:00`), "desconocido");
  assert.equal(abierto("", `${SAB}T03:00`), "desconocido");
});

test("past midnight", () => {
  const h = "V de 20 a 2";
  assert.equal(abierto(h, `${VIE}T23:00`), "abierto");
  assert.equal(abierto(h, `${SAB}T01:30`), "abierto");
  assert.equal(abierto(h, `${SAB}T02:30`), "cerrado");
});

test("how a schedule reads back in the Horarios table", async () => {
  const { describirHorario } = await import("../lib/horario.ts");
  const d = (t: string) => describirHorario(leerHorario(t));
  assert.equal(d("24 hs"), "Todos los días, las 24 hs");
  assert.equal(d("L a J de 7 a 22 y V de 7 a 16"), "Lun a Jue 7 a 22 · Vie 7 a 16 · Sáb y Dom cerrado");
  assert.equal(d("L a V 9:30 a 18"), "Lun a Vie 9:30 a 18 · Sáb y Dom cerrado");
  assert.equal(d("6 a 22"), "Todos los días 6 a 22");
  assert.equal(d("L a D de 8 a 12 y 19 a 20"), "Todos los días 8 a 12 y 19 a 20");
  assert.equal(d("A confirmar"), "");
  assert.equal(d(""), "");
});
