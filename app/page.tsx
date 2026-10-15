"use client";
import { useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { fb } from "@/lib/firebase";
import { ensureProfile, personalStore } from "@/lib/data";
import { obtenerListaEquipo } from "@/lib/bolsos";
import type { Catalog } from "@/lib/inventory";
import InventoryApp from "@/components/InventoryApp";
import Login, { UserChip, useUser } from "@/components/Login";
import AlarmasPush from "@/components/AlarmasPush";

export default function Page() {
  const user = useUser((u) => { ensureProfile(u).catch(() => {}); });
  const store = useMemo(() => (user ? personalStore(user.uid) : null), [user]);
  // the institution's list, so this bag can use the same one (only for people in the team)
  const [listaEquipo, setListaEquipo] = useState<Catalog | null>(null);
  useEffect(() => { if (user) obtenerListaEquipo().then(setListaEquipo); }, [user]);

  if (user === undefined) return <div className="splash">Cargando…</div>;
  if (!user || !store) return <Login title="Mi Bolso" text="Inventario de tu bolso de paramédico: lo que falta, lo que usaste en cada emergencia y lo que repusiste." />;

  return <InventoryApp store={store} title="Mi Bolso" top={<UserChip user={user} onSignOut={() => signOut(fb().auth)} />} bandExtra={<AlarmasPush user={user} app="personal" />} listaEquipo={listaEquipo} />;
}
