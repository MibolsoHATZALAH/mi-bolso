/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // signInWithPopup needs the opener to stay reachable from the Google popup
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }] }];
  },
};
export default nextConfig;
