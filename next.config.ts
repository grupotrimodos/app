import type { NextConfig } from "next";

// La API Python (DECA y ARGON) vive en api/index.py. En local corre aparte con uvicorn (puerto 8000);
// en Vercel es una función Python del mismo proyecto y recibe la ruta original (/api/deca, argon, rrhh, chofer).
// Toda ruta nueva de la API Python necesita aquí su rewrite (un test lo comprueba).
const PY = process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "";

const nextConfig: NextConfig = {
  // DECA tiene que abrirse en /deca/ (con barra): es el ámbito de su service worker (funciona sin cobertura).
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return {
      // La PWA de DECA está en public/deca: /deca y /deca/ abren su index.html.
      beforeFiles: [
        { source: "/deca", destination: "/deca/index.html" },   // index.html redirige solo a /deca/
        { source: "/deca/", destination: "/deca/index.html" },
      ],
      afterFiles: [
        { source: "/api/deca/:path*", destination: PY ? `${PY}/api/deca/:path*` : "/api/" },
        { source: "/api/argon/:path*", destination: PY ? `${PY}/api/argon/:path*` : "/api/" },
        { source: "/api/rrhh/:path*", destination: PY ? `${PY}/api/rrhh/:path*` : "/api/" },
        { source: "/api/chofer/:path*", destination: PY ? `${PY}/api/chofer/:path*` : "/api/" },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      { source: "/deca/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/deca/manifest.webmanifest", headers: [{ key: "Content-Type", value: "application/manifest+json" }] },
    ];
  },
};

export default nextConfig;
