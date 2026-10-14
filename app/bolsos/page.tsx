"use client";
import Login, { useUser } from "@/components/Login";
import BolsosGate from "@/components/BolsosApp";

export default function BolsosPage() {
  const user = useUser();
  if (user === undefined) return <div className="splash">Cargando…</div>;
  if (!user) return <Login title="Bolsos" text="Inventario de los bolsos de la institución: el estado de cada bolso, qué falta, qué se usó en cada emergencia y qué se repuso." />;
  return <BolsosGate user={user} />;
}
