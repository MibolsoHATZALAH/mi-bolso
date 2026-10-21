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
      <head>
        {/* If the phone opened an old copy of the page whose scripts no longer exist, reload once instead of showing a blank screen. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){function f(m){if(!/ChunkLoadError|Loading chunk|Loading CSS chunk/.test(String(m)))return;try{var k="recarga-"+location.pathname;var t=+sessionStorage.getItem(k)||0;if(Date.now()-t<30000)return;sessionStorage.setItem(k,Date.now());}catch(e){}location.reload();}addEventListener("error",function(e){f(e&&(e.message||(e.error&&e.error.name)))},true);addEventListener("unhandledrejection",function(e){f(e&&e.reason&&(e.reason.name+" "+e.reason.message))});})();` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
