"use client";
import { useEffect, useMemo, useState } from "react";
import { OPTS, groupBySection, rows, valText, type Bolso, type Draft } from "@/lib/inventory";
import { Stepper } from "./Controls";

/** Full-screen sheet for "Registrar uso" (kind=uso) and "Reponer" (kind=repo). */
export default function Sheet({ bolso, kind, onClose, onSave }: {
  bolso: Bolso; kind: "uso" | "repo"; onClose: () => void;
  onSave: (draft: Draft, draftVenc: Record<string, string>, nota: string) => void;
}) {
  const uso = kind === "uso";
  const [draft, setDraft] = useState<Draft>({});
  const [draftVenc, setDraftVenc] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [nota, setNota] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", esc); };
  }, [onClose]);

  const list = useMemo(() => {
    const all = rows(bolso);
    const needle = q.trim().toLowerCase();
    if (needle) return all.filter((x) => x.it.nombre.toLowerCase().includes(needle));
    if (uso) return all;
    return all.filter((x) => x.st.level === "bad" || x.st.level === "warn" || x.it.id in draft || x.it.id in draftVenc);
  }, [bolso, q, uso, draft, draftVenc]);

  const set = (id: string, v: true | number | string | undefined) =>
    setDraft((d) => { const n = { ...d }; if (v === undefined || v === 0) delete n[id]; else n[id] = v; return n; });

  const count = Object.keys(draft).length + Object.keys(draftVenc).filter((k) => !(k in draft)).length;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="sheet-head">
        <div className="t"><h2 id="sheet-title">{uso ? "Registrar uso" : "Reponer"}</h2><button className="btn" onClick={onClose}>Cancelar</button></div>
        <p>{uso ? "Marcá lo que usaste en la atención. Se descuenta del inventario." : "Marcá lo que repusiste. Abajo aparecen los faltantes; buscá arriba para reponer otra cosa."}</p>
        <input type="search" id="sheet-q" placeholder="Buscar elemento…" aria-label="Buscar elemento" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="sheet-body"><div className="inner">
        {!list.length && <p className="none">{q ? "No hay elementos con ese nombre." : uso ? "" : "No hay faltantes. Buscá arriba si querés reponer algo puntual."}</p>}
        {groupBySection(list).map((g) => (
          <section className="cat" key={g.s.id}>
            <div className="cat-head"><h3>{g.s.nombre}</h3></div>
            <ul className="rows">
              {g.items.map(({ c, it, st }) => {
                const d = draft[it.id];
                const picked = d !== undefined || it.id in draftVenc;
                return (
                  <li key={it.id} className={`row ${picked ? "picked" : ""}`}>
                    <div className="name">
                      <span>{it.nombre}</span>
                      <span className="sub">
                        <span className="of">{c.nombre}</span>
                        {it.tipo === "cant"
                          ? <span className="of">hay {bolso.cant[it.id] ?? "—"}{it.min ? ` · mín. ${it.min}` : ""}</span>
                          : <span className="of">ahora {valText(it, bolso.valores[it.id])}</span>}
                        {!uso && c.vence && (
                          <>
                            <label htmlFor={`dv-${it.id}`}>Nuevo vencimiento</label>
                            <input type="date" id={`dv-${it.id}`} value={draftVenc[it.id] ?? bolso.venc[it.id] ?? ""}
                              onChange={(e) => setDraftVenc((v) => ({ ...v, [it.id]: e.target.value }))} />
                          </>
                        )}
                        {!uso && st.motivo && st.level !== "none" && <span className={`pill ${st.level}`}>{st.motivo}</span>}
                      </span>
                    </div>
                    <div className="opts" style={{ alignItems: "center" }}>
                      {it.tipo === "cant" && (<><span className="of">{uso ? "usé" : "agrego"}</span>
                        <Stepper id={`dq-${it.id}`} value={typeof d === "number" ? d : 0} onChange={(n) => set(it.id, n ?? 0)} /></>)}
                      {it.tipo === "nivel" && OPTS.nivel.map(([o, cls]) => (
                        <button key={o} className={`opt ${cls} ${d === o ? "on" : ""}`} aria-pressed={d === o} onClick={() => set(it.id, d === o ? undefined : o)}>{o}</button>
                      ))}
                      {it.tipo === "sn" && (
                        <button className={`toggle ${d ? "on" : ""}`} aria-pressed={!!d} onClick={() => set(it.id, d ? undefined : true)}>
                          {uso ? (d ? "Usado ✓" : "Usé") : d ? "Repuesto ✓" : "Repuse"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div></div>
      <div className="sheet-foot"><div className="inner">
        <input id="sheet-note" placeholder="Nota (opcional): tipo de atención, lugar…" aria-label="Nota" value={nota} onChange={(e) => setNota(e.target.value)} />
        <div className="acts">
          <button className="btn primary" id="sheet-save" disabled={!count} onClick={() => onSave(draft, draftVenc, nota.trim())}>
            {uso ? "Guardar uso" : "Guardar reposición"}{count ? ` (${count})` : ""}
          </button>
        </div>
      </div></div>
    </div>
  );
}
