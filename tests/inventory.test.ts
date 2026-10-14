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
  assert.deepEqual(st(b, "ft7"), { level: "bad", motivo: "Faltan 1" });
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
  assert.equal(r.faltan, 1);
  assert.equal(r.cargados, 2);
  assert.equal(r.total, 84);
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
