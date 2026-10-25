"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { activarPush, escucharPush, estadoPush, guardarToken, probarPush, type EstadoPush } from "@/lib/push";

/** "Activar alarmas" row: turns on push alarms on this phone and explains what to do when it can't. */
export default function AlarmasPush({ user, app }: { user: User; app: "personal" | "bolsos" }) {
  const [estado, setEstado] = useState<EstadoPush>("cargando");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    estadoPush(app).then((e) => {
      if (!vivo) return;
      setEstado(e);
      if (e === "activo") guardarToken(user, app).catch(() => {}); // keep the token fresh
    });
    const off = escucharPush(app);
    return () => { vivo = false; off(); };
  }, [user, app]);

  if (estado === "cargando" || estado === "no") return null;

  return (
    <div className={`alarmas-push ${estado}`}>
      {estado === "activo" && (<>
        <span><b>Alarmas activadas</b> en este celular</span>
        <button className="link-btn" onClick={() => probarPush(app).catch(() => setError("No se pudo mostrar la prueba"))}>Probar</button>
      </>)}
      {estado === "apagado" && (<>
        <span>Recibí alarmas de vencimientos{app === "bolsos" ? " y faltantes" : ""} aunque la app esté cerrada.</span>
        <button className="btn primary" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { setEstado(await activarPush(user, app)); } catch { setError("No se pudo activar. Probá de nuevo."); } finally { setBusy(false); }
        }}>{busy ? "Activando…" : "Activar alarmas"}</button>
      </>)}
      {estado === "instalar" && <span>Para recibir alarmas en el iPhone: Compartir → <b>Agregar a pantalla de inicio</b>, y abrí la app desde ese ícono.</span>}
      {estado === "bloqueado" && <span>Las notificaciones están bloqueadas. Activalas en Ajustes → Notificaciones → {app === "bolsos" ? "Bolsos" : "Mi Bolso"}.</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
