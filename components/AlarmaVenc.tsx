"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { alertasVenc, fmtDay, textoVenc, type Bolso } from "@/lib/inventory";
import { sonarAlarma } from "@/lib/sonido";

const hoy = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD

/** Red alarm at the top of a bag when medicines are expired or expire within 30 days. Sounds once per visit. */
export default function AlarmaVenc({ bolso, clave }: { bolso: Bolso; clave: string }) {
  const alertas = useMemo(() => alertasVenc(bolso), [bolso]);
  const key = `alarma-silencio-${clave}`;
  const [silencio, setSilencio] = useState<string | null>(null);
  const sonado = useRef(false);

  useEffect(() => { try { setSilencio(localStorage.getItem(key)); } catch {} }, [key]);
  const activa = alertas.length > 0 && silencio !== hoy();

  useEffect(() => {
    if (!activa || sonado.current) return;
    let off = false;
    const intentar = async () => {
      if (sonado.current || off) return;
      if (await sonarAlarma()) { sonado.current = true; quitar(); }
    };
    const quitar = () => { window.removeEventListener("pointerdown", intentar); window.removeEventListener("keydown", intentar); };
    intentar(); // works right away on computers; phones wait for the first tap
    window.addEventListener("pointerdown", intentar); window.addEventListener("keydown", intentar);
    return () => { off = true; quitar(); };
  }, [activa]);

  if (!activa) return null;
  const vencidos = alertas.filter((a) => a.dias < 0).length;

  return (
    <section className="alarma" role="alert">
      <div className="alarma-head">
        <span className="alarma-icon" aria-hidden="true">!</span>
        <h2>{vencidos ? (vencidos === 1 ? "1 medicamento vencido" : `${vencidos} medicamentos vencidos`) : "Medicamentos por vencer"}</h2>
      </div>
      <ul>
        {alertas.map((a) => (
          <li key={a.it.id} className={a.dias < 0 ? "venc" : ""}>
            <span>{a.it.nombre}</span>
            <span className="cuando">{textoVenc(a)} · {fmtDay(a.venc)}</span>
          </li>
        ))}
      </ul>
      <div className="alarma-acts">
        <button className="btn" onClick={() => sonarAlarma(1)}>Volver a sonar</button>
        <button className="btn" onClick={() => { try { localStorage.setItem(key, hoy()); } catch {} setSilencio(hoy()); }}>Silenciar hasta mañana</button>
      </div>
      <p className="alarma-note">Reponelos con “Reponer” y cargá la nueva fecha de vencimiento: la alarma se apaga sola.</p>
    </section>
  );
}
