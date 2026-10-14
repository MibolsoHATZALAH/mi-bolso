"use client";
import { useMemo } from "react";
import { signOut } from "firebase/auth";
import { fb } from "@/lib/firebase";
import { ensureProfile, personalStore } from "@/lib/data";
import InventoryApp from "@/components/InventoryApp";
import Login, { UserChip, useUser } from "@/components/Login";

export default function Page() {
  const user = useUser((u) => { ensureProfile(u).catch(() => {}); });
  const store = useMemo(() => (user ? personalStore(user.uid) : null), [user]);

  if (user === undefined) return <div className="splash">Cargando…</div>;
  if (!user || !store) return <Login title="Mi Bolso" text="Inventario de tu bolso de paramédico: lo que falta, lo que usaste en cada emergencia y lo que repusiste." />;

  return <InventoryApp store={store} title="Mi Bolso" top={<UserChip user={user} onSignOut={() => signOut(fb().auth)} />} />;
}
