/* =====================================================================
 * sw.js — offline-first service worker.
 * Pre-caches the app shell; runtime-caches everything else it sees
 * (including the CDN libs: jsPDF, autotable, lz-string), so after ONE
 * online visit the whole app works with zero network — rehearsal-room
 * wifi can be as bad as it wants.
 * Bump VERSION when shipping changes, old caches are swept on activate.
 * ===================================================================== */
var VERSION = "ttm-v2";
var SHELL = [
  "./",
  "index.html",
  "tap.html",
  "css/styles.css",
  "js/data.js",
  "js/demo-data.js",
  "js/render.js",
  "js/pdf.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// cache-first with background refresh; stash anything new we fetch
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
