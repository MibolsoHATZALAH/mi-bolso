"use client";
// Mi Bolso (personal) lives at /personal/ so its installed app doesn't swallow /bolsos/ on Android
// (an installed web app owns every page under its scope). Old links and old home-screen icons land
// here and are sent on, keeping #hash and ?query.
import { useEffect } from "react";

const DESTINO = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/personal/`;

export default function Raiz() {
  useEffect(() => { window.location.replace(DESTINO + window.location.search + window.location.hash); }, []);
  return <div className="splash"><a href={DESTINO}>Abrir Mi Bolso</a></div>;
}
