"use client";
import { useState } from "react";
import { fmtDay, fmtWhen, type Cambio, type Movimiento } from "@/lib/inventory";

const LBL: Record<string, [string, string]> = { uso: ["Uso en emergencia", "bad"], repo: ["Reposición", "ok"], ajuste: ["Ajuste manual", "info"] };

function changeText(ch: Cambio) {
  if (ch.campo === "venc") return <>{ch.nombre}: vence {ch.de ? fmtDay(String(ch.de)) : "—"} → {ch.a ? fmtDay(String(ch.a)) : "—"}</>;
  const f = (v: Cambio["de"]) => (v == null || v === "" ? "—" : ch.tipo === "cant" ? String(v) : v === "SI" ? "SÍ" : String(v));
  return <>{ch.nombre}: <span className="num">{f(ch.de)} → {f(ch.a)}</span></>;
}

export default function History({ movs, hasMore, onMore, onImport }: {
  movs: Movimiento[]; hasMore: boolean; onMore: () => void; onImport?: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (t: string) => { if (!onImport) return; setBusy(true); try { await onImport(t); setText(""); } finally { setBusy(false); } };

  return (
    <>
      {!movs.length && <p className="none" style={{ marginTop: 12 }}>Todavía no hay movimientos. Cada uso, reposición o cambio queda registrado acá con fecha y hora.</p>}
      {!!movs.length && (
        <ul className="hist">
          {movs.map((h) => {
            const [l, cls] = LBL[h.tipo] ?? [h.tipo, "info"];
            return (
              <li key={h.id}>
                <div className="h-top"><span className={`pill ${cls}`}>{l}</span><span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>{fmtWhen(h.t)}{h.por ? <span className="h-por"> · {h.por}</span> : null}</span></div>
                {h.nota && <div className="h-note">{h.nota}</div>}
                <div className="h-items">{h.cambios.map((ch, i) => <span key={i}>{changeText(ch)}</span>)}</div>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && <div className="toolbar"><button className="btn" onClick={onMore}>Ver más movimientos</button></div>}

      {onImport && <section className="backup">
        <h3>Importar de la app anterior</h3>
        <p>Si ya venías usando Mi Bolso antes, abrí la <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/anterior/`}>versión anterior</a> en este mismo celular, andá a Historial → “Copiar como texto” y pegalo acá abajo. Reemplaza el inventario actual y suma su historial.</p>
        <div className="acts">
          <label className="btn" htmlFor="bk-file" style={{ display: "inline-flex", alignItems: "center" }}>Elegir archivo de copia</label>
          <input type="file" id="bk-file" accept=".json,application/json,text/plain" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(run); e.target.value = ""; }} />
        </div>
        <textarea className="copy-fallback" id="bk-text" placeholder="…o pegá acá el texto de la copia" aria-label="Texto de la copia" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="acts"><button className="btn" disabled={!text.trim() || busy} onClick={() => run(text)}>{busy ? "Importando…" : "Importar texto"}</button></div>
      </section>}
    </>
  );
}
