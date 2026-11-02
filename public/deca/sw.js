// Service worker: solo guarda la "carcasa" de la app para que abra aunque no haya cobertura.
// Solo atiende /deca/: los datos (/api/*) y el resto de la app general NUNCA se guardan en caché.
const CACHE = "deca-v17"; // súbelo (v2, v3…) cuando cambies archivos de la carcasa
const SHELL = [
  "/deca/", "/deca/index.html", "/deca/guia.html", "/deca/styles.css", "/deca/app.js", "/deca/manifest.webmanifest",
  "/deca/vendor/jsQR.js", "/deca/icons/icon-192.png", "/deca/icons/icon-512.png", "/deca/icons/apple-touch-icon.png",
  "/deca/img/trimodos.png", "/deca/img/stinsa.png", "/deca/img/transargi.png", "/deca/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/deca/")) return;
  // Red primero (siempre la última versión si hay cobertura); caché si no hay red.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("/deca/index.html"))),
  );
});
