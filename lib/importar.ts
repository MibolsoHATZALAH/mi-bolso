// Plans the one-time load of the institution's bags (data/bolsos-instituciones.json).
// Pure logic, tested in tests/importar.test.ts; scripts/importar-bolsos.ts applies the plan.
//  - a bag that already exists (same name, or one of its "existente" names) is never created again;
//    it only gets barrio / dirección / horario filled in where they are still empty
//  - everything else is created
export type Entrada = { barrio: string; nombre: string; direccion: string; horario: string; existente?: string[] };
export type Existente = { id: string; nombre: string; barrio?: string; direccion?: string; horario?: string };
export type Plan = {
  crear: Entrada[];
  completar: { id: string; nombre: string; campos: Partial<Record<"barrio" | "direccion" | "horario", string>> }[];
  sinCambios: string[];
};

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bbolso\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function planificarImport(entradas: Entrada[], existentes: Existente[]): Plan {
  const plan: Plan = { crear: [], completar: [], sinCambios: [] };
  for (const e of entradas) {
    const claves = [e.nombre, ...(e.existente ?? [])].map(normalizar).filter(Boolean);
    const iguales = existentes.filter((x) => {
      const n = normalizar(x.nombre);
      return claves.some((k) => n === k || n.includes(k));
    });
    if (!iguales.length) { plan.crear.push(e); continue; }
    for (const x of iguales) {
      const campos: Plan["completar"][number]["campos"] = {};
      for (const k of ["barrio", "direccion", "horario"] as const) if (!(x[k] ?? "").trim() && e[k].trim()) campos[k] = e[k].trim();
      if (Object.keys(campos).length) plan.completar.push({ id: x.id, nombre: x.nombre, campos });
      else plan.sinCambios.push(x.nombre);
    }
  }
  return plan;
}
