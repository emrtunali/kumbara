// Offline support. The app shell is cached on install; the macro data refreshes from the network
// when online and falls back to the cache; the Excel and PDF readers are cached the first time
// they are used; the app's own files are served from the cache and refreshed in the background.
// Statements are never fetched, so they are never cached.

const VERSION = "kumbara-v3";
const SHELL = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "js/app.js", "js/sim.js", "js/charts.js", "js/parse.js", "js/categorize.js", "js/learn.js",
  "js/analysis.js", "js/insight.js", "js/plan.js", "js/simulate.js",
  "data/macro.json", "data/hicp.json", "demo/ornek-hesap-hareketleri.csv",
  "icons/icon-192.png", "icons/icon-512.png",
];
const CDN = "https://cdnjs.cloudflare.com/";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // data: network first so a monthly refresh shows up, cache when offline
  if (url.origin === location.origin && url.pathname.includes("/data/")) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  const keep = (r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; };
  // pinned CDN readers never change: cache first
  if (url.href.startsWith(CDN)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(keep)));
    return;
  }
  // our own files: answer from the cache at once, refresh it in the background for next time
  if (url.origin === location.origin) {
    const fresh = fetch(e.request).then(keep).catch(() => null);
    e.respondWith(caches.match(e.request).then((hit) => hit || fresh.then((r) => r || caches.match("index.html"))));
    e.waitUntil(fresh);
  }
});
