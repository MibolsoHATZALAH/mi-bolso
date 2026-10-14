"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { fb, firebaseConfigured } from "@/lib/firebase";
import { ensureProfile } from "@/lib/data";
import InventoryApp from "@/components/InventoryApp";

export default function Page() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured) { setUser(null); return; }
    return onAuthStateChanged(fb().auth, (u) => {
      setUser(u);
      if (u) ensureProfile(u).catch(() => {});
    });
  }, []);

  async function login() {
    setError("");
    const { auth, google } = fb();
    try {
      await signInWithPopup(auth, google);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/popup-blocked") return signInWithRedirect(auth, google);
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setError("No se pudo iniciar sesión. Probá de nuevo.");
    }
  }

  if (user === undefined) return <div className="splash">Cargando…</div>;

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>Mi Bolso</h1>
          <p>Inventario de tu bolso de paramédico: lo que falta, lo que usaste en cada emergencia y lo que repusiste.</p>
          {firebaseConfigured ? (
            <button className="gbtn" onClick={login} id="login">
              <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              Entrar con Google
            </button>
          ) : (
            <p className="err">Falta configurar Firebase: cargá las variables NEXT_PUBLIC_FIREBASE_* (ver README).</p>
          )}
          {error && <p className="err">{error}</p>}
        </div>
      </div>
    );
  }

  return <InventoryApp user={user} onSignOut={() => signOut(fb().auth)} />;
}
