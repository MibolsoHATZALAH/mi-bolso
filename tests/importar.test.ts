import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizar, planificarImport, type Entrada } from "../lib/importar.ts";

const data = JSON.parse(readFileSync(new URL("../data/bolsos-instituciones.json", import.meta.url), "utf8")) as { bolsos: Entrada[] };
// the bags Uriel had already loaded
const existentes = [
  { id: "a", nombre: "Base Once", ubicacion: "PB." },
  { id: "b", nombre: "Bolso Colel Ecuador" },
  { id: "c", nombre: "BOLSO SUCAT DAVID 1" },
  { id: "d", nombre: "Bolso Sucat David 2" },
  { id: "e", nombre: "Bolso Templo Lavalle 2449", horario: "ya cargado" },
];

test("normalizes names", () => {
  assert.equal(normalizar("Bolso Congregación Sefaradí"), "congregacion sefaradi");
  assert.equal(normalizar("BOLSO SUCAT DAVID 1"), "sucat david 1");
});

test("the spreadsheet list: 38 places, the 4 already loaded are completed, 34 are created", () => {
  assert.equal(data.bolsos.length, 38);
  const p = planificarImport(data.bolsos, existentes);
  assert.equal(p.crear.length, 34);
  assert.ok(!p.crear.some((e) => ["Base Once", "Kolel Jabad", "Sucath David", "Congregación Sefaradí"].includes(e.nombre)));
  // both Sucat David bags get the data; existing values are never overwritten
  assert.deepEqual(p.completar.map((c) => c.id).sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(p.completar.find((c) => c.id === "e")!.campos, { barrio: "Once", direccion: "Lavalle 2449" });
  assert.deepEqual(p.completar.find((c) => c.id === "c")!.campos, { barrio: "Once", direccion: "Tucumán 2750", horario: "6 a 22" });
  assert.ok(!p.crear.some((e) => e.nombre.includes("Melen")));
});

test("running it again creates nothing", () => {
  const p1 = planificarImport(data.bolsos, existentes);
  const despues = [...existentes.map((x) => ({ ...x, barrio: "Once", direccion: "x", horario: "x" })), ...p1.crear.map((e, i) => ({ id: `n${i}`, ...e }))];
  const p2 = planificarImport(data.bolsos, despues);
  assert.equal(p2.crear.length, 0);
  assert.equal(p2.completar.length, 0);
});
