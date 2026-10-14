/** @type {import('next').NextConfig} */
// Two targets from the same code:
//  - Vercel / `next start`: regular build.
//  - GitHub Pages: `STATIC_EXPORT=1 next build` → static files in out/, served under /mi-bolso.
const pages = process.env.STATIC_EXPORT === "1";
const basePath = pages ? process.env.BASE_PATH ?? "/mi-bolso" : "";

const nextConfig = {
  reactStrictMode: true,
  ...(pages
    ? { output: "export", basePath, trailingSlash: true, images: { unoptimized: true } }
    : {
        // signInWithPopup needs the opener to stay reachable from the Google popup
        async headers() {
          return [{ source: "/(.*)", headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }] }];
        },
      }),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default nextConfig;
