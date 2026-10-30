"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { activarPush, escucharPush, estadoPush, guardarToken, probarPush, type EstadoPush } from "@/lib/push";

const ses = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const setSes = (k: string) => { try { sessionStorage.setItem(k, "1"); } catch {} };

/**
 * Alarms are on by default as far as a phone allows it: browsers only let a page turn notifications on after
 * the person says yes, so
 *  - if this phone already said yes (e.g. in the other app), they are turned on silently;
 *  - otherwise a big "Activá las alarmas" card comes up every time the app is opened until they do it
 *    ("Ahora no" hides it until the next time the app is opened).
 * Below it, the usual row with the state (and "Probar").
 */
export default function AlarmasPush({ user, app }: { user: User; app: "personal" | "bolsos" }) {
  const [estado, setEstado] = useState<EstadoPush>("cargando");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clave = `alarmas-ahora-no-${app}`;
  const [ahoraNo, setAhoraNo] = useState(() => typeof window !== "undefined" && !!ses(clave));

  useEffect(() => {
    let vivo = true;
    estadoPush(app).then(async (e) => {
      if (!vivo) return;
      if (e === "permitido") {
        try { await guardarToken(user, app); if (vivo) setEstado("activo"); } catch { if (vivo) setEstado("apagado"); }
        return;
      }
      setEstado(e);
      if (e === "activo") guardarToken(user, app).catch(() => {}); // keep the token fresh
    });
    const off = escucharPush(app);
    return () => { vivo = false; off(); };
  }, [user, app]);

  if (estado === "cargando" || estado === "no" || estado === "permitido") return null;

  const activar = async () => {
    setBusy(true); setError("");
    try { setEstado(await activarPush(user, app)); } catch { setError("No se pudo activar. Probá de nuevo."); } finally { setBusy(false); }
  };
  const que = app === "bolsos" ? "cuando a un bolso le falte algo o tenga algo por vencer" : "cuando algo de tu bolso esté por vencer";
  const nombreApp = app === "bolsos" ? "Bolsos" : "Mi Bolso";
  const aviso = !ahoraNo && (estado === "apagado" || estado === "instalar");

  return (
    <>
      <div className={`alarmas-push ${estado}`}>
        {estado === "activo" && (<>
          <span><b>Alarmas activadas</b> en este celular</span>
          <button className="link-btn" onClick={() => probarPush(app).catch(() => setError("No se pudo mostrar la prueba"))}>Probar</button>
        </>)}
        {estado === "apagado" && (<>
          <span><b>Alarmas apagadas.</b> Activalas para enterarte {que}, aunque la app esté cerrada.</span>
          <button className="btn primary" disabled={busy} onClick={activar}>{busy ? "Activando…" : "Activar alarmas"}</button>
        </>)}
        {estado === "instalar" && <span>Para recibir alarmas en el iPhone: Compartir → <b>Agregar a pantalla de inicio</b>, y abrí la app desde ese ícono.</span>}
        {estado === "bloqueado" && <span><b>Alarmas bloqueadas.</b> Activalas en Ajustes → Notificaciones → {nombreApp}.</span>}
        {error && <span className="err">{error}</span>}
      </div>

      {aviso && (
        <div className="alarmas-aviso" role="dialog" aria-modal="true" aria-labelledby={`aa-${app}`}>
          <div className="alarmas-aviso-card">
            <div className="alarmas-aviso-ico" aria-hidden="true">🔔</div>
            <h2 id={`aa-${app}`}>Activá las alarmas</h2>
            {estado === "apagado" ? (<>
              <p>Te avisamos {que}, aunque la app esté cerrada. Tocá el botón y después <b>Permitir</b>.</p>
              <button className="btn primary grande" disabled={busy} onClick={activar}>{busy ? "Activando…" : "Activar alarmas"}</button>
            </>) : (
              <p>En el iPhone las alarmas funcionan sólo con la app instalada: tocá Compartir → <b>Agregar a pantalla de inicio</b> y abrí {nombreApp} desde ese ícono.</p>
            )}
            {error && <p className="err">{error}</p>}
            <button className="link-btn" onClick={() => { setSes(clave); setAhoraNo(true); }}>Ahora no</button>
          </div>
        </div>
      )}
    </>
  );
}
