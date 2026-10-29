import { test } from "node:test";
import assert from "node:assert/strict";
import { cercanos, distanciaM, fmtDist, limpiarDireccion, lindaDireccion, lugaresUsig, minutosCaminando, pareceDireccion } from "../lib/geo.ts";

test("what the dispatcher types: an address or just a search", () => {
  for (const q of ["Corrientes 1234", "av cordoba 2300", "Pueyrredón 900", "corrientes y callao", "Av. Cabildo 2040 piso 3", "Larrea esq Viamonte"]) assert.ok(pareceDireccion(q), q);
  for (const q of ["Once", "11", "Sede", "Villa Crespo", "Bolso 2", ""]) assert.ok(!pareceDireccion(q), q);
});

test("floor and apartment are dropped before looking the address up", () => {
  assert.equal(limpiarDireccion("Av. Cabildo 2040 piso 3"), "Av. Cabildo 2040");
  assert.equal(limpiarDireccion("Larrea 750, Dto B"), "Larrea 750");
  assert.equal(limpiarDireccion("Tucumán 2200 1° A"), "Tucumán 2200");
  assert.equal(limpiarDireccion("Corrientes 1234"), "Corrientes 1234");
});

test("City addresses read like people write them", () => {
  assert.equal(lindaDireccion("CORRIENTES AV. 1234, CABA"), "Av. Corrientes 1234");
  assert.equal(lindaDireccion("PUEYRREDON, HONORIO, DR. AV. 900, CABA"), "Av. Honorio Pueyrredon 900");
  assert.equal(lindaDireccion("CORRIENTES AV. y CALLAO AV., CABA"), "Av. Corrientes y Callao");
  assert.equal(lindaDireccion("LARREA 750, CABA"), "Larrea 750");
});

test("USIG answer: City first, coordinates as numbers, places without coordinates skipped", () => {
  const l = lugaresUsig({ direccionesNormalizadas: [
    { direccion: "Corrientes 1234, Moreno", cod_partido: "moreno", coordenadas: { x: -58.7664529, y: -34.6516997 } },
    { direccion: "CORRIENTES AV. 1234, CABA", cod_partido: "caba", coordenadas: { x: "-58.384222", y: "-34.603939" } },
    { direccion: "Pueyrredón 900, Escobar", cod_partido: "escobar", coordenadas: { x: "", y: "" } },
  ] });
  assert.equal(l.length, 2);
  assert.deepEqual([l[0].texto, l[0].lat, l[0].lng, l[0].caba], ["Av. Corrientes 1234", -34.603939, -58.384222, true]);
  assert.equal(l[1].caba, false);
  assert.deepEqual(lugaresUsig({ errorMessage: "Calle inexistente" }), []);
});

test("distances", () => {
  const obelisco = { lat: -34.60372, lng: -58.38159 }, congreso = { lat: -34.60961, lng: -58.39243 };
  const d = distanciaM(obelisco, congreso);
  assert.ok(d > 1100 && d < 1250, String(d));
  assert.equal(fmtDist(347), "350 m");
  assert.equal(fmtDist(4), "10 m");
  assert.equal(fmtDist(1180), "1,2 km");
  assert.equal(minutosCaminando(800), 13);
});

test("nearest available bags first; closer unavailable ones are shown apart", () => {
  const e = { lat: -34.6037, lng: -58.3816 };
  const p = (m: number) => ({ lat: e.lat + m / 111_000, lng: e.lng }); // m meters north
  const { disponibles, noDisponibles, sinUbicar } = cercanos(e, [
    { x: "lejos", p: p(2000), usable: true },
    { x: "cerca", p: p(300), usable: true },
    { x: "cerrado", p: p(100), usable: false },
    { x: "fuera-lejos", p: p(5000), usable: false },
    { x: "sin-dir", p: null, usable: true },
  ], 5);
  assert.deepEqual(disponibles.map((d) => d.x), ["cerca", "lejos"]);
  assert.deepEqual(noDisponibles.map((d) => d.x), ["cerrado"]);
  assert.equal(sinUbicar, 1);
});
