// =====================================================================
// Mk4 PWA — MODULE 8 : sw.js (service worker : app installable + hors ligne)
// Rôle : garder les fichiers de l'app sur le téléphone pour qu'elle s'ouvre
//        même sans internet (le chat, lui, a toujours besoin de Gemini).
// Règles : seuls les fichiers de CE site sont mis en cache ; les appels à
//        Gemini ne passent jamais par ici. Fichiers servis depuis le cache
//        puis mis à jour en arrière-plan (la nouvelle version s'affiche
//        à la réouverture suivante).
// Pour forcer une mise à jour chez tous : changer VERSION ci-dessous.
// =====================================================================
const VERSION = "mk4-v1";
const FICHIERS = [
  "./", "index.html", "style.css", "manifest.json",
  "app.js", "gemini.js", "memoire.js", "extraction.js", "chat.js",
  "ui.js", "demarrage.js", "voix.js",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // un par un : un fichier manquant n'empêche pas l'installation
    await Promise.all(FICHIERS.map((f) => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom !== VERSION) await caches.delete(nom);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // Gemini & co : jamais touchés
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const gardee = await cache.match(req, { ignoreSearch: true });
    const reseau = fetch(req).then((rep) => {
      if (rep && rep.ok) cache.put(req, rep.clone());
      return rep;
    }).catch(() => null);
    if (gardee) { e.waitUntil(reseau); return gardee; }  // vite depuis le cache, mise à jour en fond
    const rep = await reseau;
    if (rep) return rep;
    if (req.mode === "navigate") { const accueil = await cache.match("index.html"); if (accueil) return accueil; }
    return new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  })());
});
