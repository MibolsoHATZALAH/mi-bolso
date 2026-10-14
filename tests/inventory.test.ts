import { test } from "node:test";
import assert from "node:assert/strict";
import { applySheet, emptyBolso, mergeCambio, parseLegacyBackup, rows, setCant, setValue, statusOf, findItem } from "../lib/inventory.ts";

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
