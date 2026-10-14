import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bolsos Hatzalah",
  description: "Inventario de los bolsos de la institución: estado de cada bolso, faltantes, usos, reposiciones e historial.",
  appleWebApp: { capable: true, title: "Bolsos", statusBarStyle: "default" },
};

export default function BolsosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
