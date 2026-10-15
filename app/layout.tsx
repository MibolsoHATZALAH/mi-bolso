import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mi Bolso Paramédico",
  description: "Inventario del bolso de paramédicos: faltantes, usos en emergencias, reposiciones e historial.",
  appleWebApp: { capable: true, title: "Mi Bolso", statusBarStyle: "default" },
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/manifest.webmanifest`,
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#EEF1F6" }, { media: "(prefers-color-scheme: dark)", color: "#05060A" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
