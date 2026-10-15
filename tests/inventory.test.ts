import { test } from "node:test";
import assert from "node:assert/strict";
import { applySheet, buildCopyTextVarios, emptyBolso, mergeCambio, parseLegacyBackup, resumen, rows, setCant, setValue, statusOf, findItem } from "../lib/inventory.ts";

const st = (b: ReturnType<typeof emptyBolso>, id: string) => { const f = findItem(b, id)!; return statusOf(b, f.it, f.c); };

test("default catalog has the counted items and minimums", () => {
  const b = emptyBolso();
  assert.equal(rows(b).length, 84);
  assert.equal(findItem(b, "ft7")!.it.min, 4); // gasas
  assert.equal(findItem(b, "lb3")!.it.min, 6); // guantes
  assert.equal(findItem(b, "ft5")!.it.min, 1);
  assert.equal(findItem(b, "ft4")!.it.tipo, "sn");
});

test("quantities below the minimum are missing", () => {
  let b = emptyBolso();
  b = setCant(b, "ft7", 3)!.next;
  assert.deepEqual(st(b, "ft7"), { level: "warn", motivo: "Faltan 1", falta: true }); // gasas: not vital → yellow
  b = setCant(b, "ft7", 4)!.next;
  assert.equal(st(b, "ft7").level, "ok");
});

test("uso discounts and repo restores, with history changes", () => {
  let b = emptyBolso();
  b = setCant(b, "ft7", 10)!.next;
  b = setValue(b, "ft4", "SI")!.next;
  const u = applySheet(b, "uso", { ft7: 3, ft4: true }, {});
  assert.equal(u.next.cant.ft7, 7);
  assert.equal(u.next.valores.ft4, "NO");
  assert.deepEqual(u.cambios.map((c) => [c.nombre, c.de, c.a]), [["Gasas", 10, 7], ["Torniquete", "SI", "NO"]]);
  const r = applySheet(u.next, "repo", { ft7: 3, ft4: true }, { fm4: "2027-05-01" });
  assert.equal(r.next.cant.ft7, 10);
  assert.equal(r.next.valores.ft4, "SI");
  assert.equal(r.next.venc.fm4, "2027-05-01");
});

test("manual edits merge into one adjustment and cancel out", () => {
  const b = emptyBolso();
  const c1 = setValue(b, "ft4", "SI")!;
  let list = mergeCambio([], c1.cambio);
  const c2 = setValue(c1.next, "ft4", "NO")!;
  list = mergeCambio(list, c2.cambio);
  assert.deepEqual(list.map((c) => [c.de, c.a]), [[null, "NO"]]);
  const c3 = setValue(c2.next, "ft4", "NO")!; // tap again clears it
  list = mergeCambio(list, c3.cambio);
  assert.equal(list.length, 0);
});

test("imports a backup from the single-file app", () => {
  const old = { ...emptyBolso(), valores: { ft7: "NO", ft4: "SI" }, cant: {}, venc: {}, historial: [{ t: "2026-10-13T19:00:00Z", tipo: "uso", nota: "x", cambios: [{ id: "ft4", nombre: "Torniquete", tipo: "sn", campo: "v", de: "SI", a: "NO" }] }] };
  const { bolso, historial } = parseLegacyBackup(JSON.stringify(old));
  assert.equal(bolso.cant.ft7, 0);
  assert.equal(bolso.valores.ft7, undefined);
  assert.equal(historial.length, 1);
  assert.throws(() => parseLegacyBackup("{}"));
});

test("resumen counts missing, attention and loaded items of one bag", () => {
  let b = emptyBolso();
  assert.deepEqual([resumen(b).faltan, resumen(b).cargados], [0, 0]);
  b = setCant(b, "ft7", 2)!.next;          // gasas below 4
  b = setValue(b, "ft4", "SI")!.next;      // torniquete ok
  const r = resumen(b);
  assert.equal(r.faltan, 0);               // red: vital only
  assert.equal(r.leves.length, 1);         // yellow: gasas
  assert.equal(r.cargados, 2);
  assert.equal(r.total, 84);
  b = setValue(b, "ft4", "NO")!.next;      // torniquete missing → red
  assert.deepEqual([resumen(b).faltan, resumen(b).leves.length], [1, 1]);
});

test("vital items: the team's categories and single items are red, the rest yellow", async () => {
  const { esVital, findItem, defaultCatalog } = await import("../lib/inventory.ts");
  const b = emptyBolso();
  const v = (id: string) => { const f = findItem(b, id)!; return esVital(f.it, f.c); };
  // categories: signos vitales (both side pockets), vía aérea, oxígeno
  for (const id of ["ld1", "ld3", "ls1", "ls8", "pv3", "pv16", "po1", "po11"]) assert.ok(v(id), id);
  // single items: torniquete, AAS, glucogel, burn free, guantes, lancetas, tiras reactivas
  for (const id of ["ft4", "fm1", "fm3", "fm7", "lb3", "ls3", "ls2"]) assert.ok(v(id), id);
  for (const id of ["ft7", "fh1", "fm4", "ph1", "pb1", "pi2", "lb1"]) assert.ok(!v(id), id);
  // a category the team added later, by name
  const hem = { id: "h", nombre: "Hemorragias", items: [] };
  assert.ok(esVital({ id: "x", nombre: "Venda israelí", tipo: "sn" }, hem));
  assert.ok(esVital({ id: "y", nombre: "ASA", tipo: "sn" }, defaultCatalog().secciones[0].categorias[0]));
});

test("Editar lista can mark or unmark an item as vital, and it travels to the other bags", async () => {
  const { aplicarLista } = await import("../lib/inventory.ts");
  let b = setCant(emptyBolso(), "ft7", 1)!.next;          // gasas below minimum: yellow
  assert.equal(st(b, "ft7").level, "warn");
  b = aplicarLista(b, { op: "vital", id: "ft7", vital: true });
  assert.equal(st(b, "ft7").level, "bad");
  b = aplicarLista(setValue(b, "ld3", "NO")!.next, { op: "vital", id: "ld3", vital: false });
  assert.equal(st(b, "ld3").level, "warn");
  const igual = aplicarLista(b, { op: "vital", id: "ld3", vital: false });
  assert.equal(igual, b);                                   // no change → same object (nothing to save)
});

test("restocking text for several bags lists each bag and the unloaded ones", () => {
  let a = emptyBolso();
  a = setCant(a, "ft7", 1)!.next;
  a = setValue(a, "ft4", "NO")!.next;
  let c = emptyBolso();
  c = setValue(c, "ft4", "SI")!.next;
  const t = buildCopyTextVarios([
    { nombre: "Sede", ubicacion: "Recepción", bolso: a },
    { nombre: "Auto 2", bolso: c },
    { nombre: "Templo", bolso: emptyBolso() },
  ], new Date(2026, 9, 14));
  assert.match(t, /\*Sede\* \(Recepción\)/);
  assert.match(t, /Gasas – faltan 3/);
  assert.match(t, /• Torniquete\n/);
  assert.doesNotMatch(t, /Auto 2/);
  assert.match(t, /Todavía sin inventariar: Templo/);
});

test("list changes replay on another bag without touching its counts", async () => {
  const { aplicarLista, copiarLista } = await import("../lib/inventory.ts");
  let otro = setCant(emptyBolso(), "ft7", 9)!.next;           // gasas: 9 in the other bag
  otro = setValue(otro, "ft4", "SI")!.next;
  otro = aplicarLista(otro, { op: "rename", id: "ft7", nombre: "Gasas estériles" });
  otro = aplicarLista(otro, { op: "min", id: "ft7", min: 10 });
  otro = aplicarLista(otro, { op: "add", catId: "ft", id: "ft-x1", nombre: "Venda israelí" });
  assert.equal(findItem(otro, "ft7")!.it.nombre, "Gasas estériles");
  assert.equal(findItem(otro, "ft7")!.it.min, 10);
  assert.equal(otro.cant.ft7, 9);
  assert.equal(findItem(otro, "ft-x1")!.it.nombre, "Venda israelí");
  otro = aplicarLista(otro, { op: "remove", id: "ft4" });
  assert.equal(findItem(otro, "ft4"), null);
  assert.equal(otro.valores.ft4, undefined);
  // unknown item / category: nothing happens (same object)
  const same = aplicarLista(otro, { op: "rename", id: "nope", nombre: "x" });
  assert.equal(same, otro);
  assert.equal(aplicarLista(otro, { op: "add", catId: "nocat", id: "z", nombre: "z" }), otro);

  // copy a whole list: shared items keep their counts, missing ones go away
  let origen = aplicarLista(emptyBolso(), { op: "remove", id: "ft7" });
  origen = aplicarLista(origen, { op: "add", catId: "fh", id: "fh-n", nombre: "Linterna" });
  let b = setCant(emptyBolso(), "ft7", 3)!.next;
  b = setCant(b, "ft5", 2)!.next;
  const c = copiarLista(b, origen);
  assert.equal(findItem(c, "ft7"), null);
  assert.equal(c.cant.ft7, undefined);
  assert.equal(c.cant.ft5, 2);
  assert.ok(findItem(c, "fh-n"));
});

test("restocking text leaves out-of-service bags apart", async () => {
  const { buildCopyTextVarios } = await import("../lib/inventory.ts");
  const a = setCant(emptyBolso(), "ft7", 1)!.next;
  const t = buildCopyTextVarios([{ nombre: "Sede", bolso: a }, { nombre: "Auto 2", bolso: a, fueraDeServicio: true }], new Date(2026, 9, 15));
  assert.match(t, /\*Sede\*/);
  assert.doesNotMatch(t, /\*Auto 2\*/);
  assert.match(t, /Fuera de servicio: Auto 2/);
});

test("team list: the list most bags use, and what copying it changes in a personal bag", async () => {
  const { listaComun, difLista, mismaLista, copiarLista } = await import("../lib/inventory.ts");
  const a = emptyBolso().catalog, b = emptyBolso().catalog;
  b.secciones[0].categorias.push({ id: "hem", nombre: "Hemorragias", items: [{ id: "h1", nombre: "Venda israelí", tipo: "sn" }] });
  const comun = listaComun([a, b, JSON.parse(JSON.stringify(b))])!;
  assert.ok(mismaLista(comun, b));
  let p = setValue(emptyBolso(), "ft4", "SI")!.next;
  p = { ...p, catalog: { secciones: p.catalog.secciones.map((s, i) => i ? s : { ...s, categorias: [...s.categorias, { id: "mia", nombre: "Mías", items: [{ id: "m1", nombre: "Linterna frontal", tipo: "sn" }] }] }) } };
  p = setValue(p, "m1", "SI")!.next;
  assert.deepEqual(difLista(p, comun), { nuevos: ["Venda israelí"], quitados: ["Linterna frontal"], conDatos: ["Linterna frontal"] });
  const n = copiarLista(p, { ...p, catalog: comun });
  assert.ok(mismaLista(n.catalog, comun));
  assert.equal(n.valores.ft4, "SI");
  assert.equal(n.valores.m1, undefined);
  assert.equal(listaComun([]), null);
});

test("team list: the same list with fields in another order counts as the same", async () => {
  const { listaComun, mismaLista } = await import("../lib/inventory.ts");
  const a = emptyBolso().catalog;
  const b = JSON.parse(JSON.stringify(a), (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  assert.ok(mismaLista(a, b));
  const c = setValue(emptyBolso(), "ft4", "SI")!.next.catalog;
  assert.ok(mismaLista(listaComun([b, a, c])!, a));
});
