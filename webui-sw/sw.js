/* Open WebUI Client minimal Service Worker */
const SW_VERSION = "v1";
const SHELL_CACHE = `owui-shell-${SW_VERSION}`;
const ASSET_CACHE = `owui-asset-${SW_VERSION}`;
const API_CACHE = `owui-api-${SW_VERSION}`;
const OFFLINE_URL = "/offline.html";

// Approximate cap for API entries. Native app enforces strict 100MB.
const API_MAX_ENTRIES = 500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll([OFFLINE_URL]);
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => ![SHELL_CACHE, ASSET_CACHE, API_CACHE].includes(n))
          .map((n) => caches.delete(n))
      );
    })()
  );
  self.clients.claim();
});

function isAssetRequest(req) {
  if (req.destination) {
    return ["script", "style", "image", "font"].includes(req.destination);
  }
  const url = new URL(req.url);
  return /\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot)$/i.test(url.pathname);
}

function isChatApiGet(req) {
  if (req.method !== "GET") return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  // Match: /api/v1/chats/:id (UUID-like)
  return /^\/api\/v1\/chats\/[0-9a-fA-F-]+$/.test(url.pathname);
}

async function pruneApiCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  if (keys.length <= API_MAX_ENTRIES) return;
  const toDelete = keys.length - API_MAX_ENTRIES;
  for (let i = 0; i < toDelete; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigation: Network-first with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          return res;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(OFFLINE_URL);
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Assets: Stale-while-revalidate
  if (isAssetRequest(request) && url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((networkRes) => {
            cache.put(request, networkRes.clone()).catch(() => {});
            return networkRes;
          })
          .catch(() => null);
        return cached || (await fetchPromise) || new Response("Offline asset", { status: 503 });
      })()
    );
    return;
  }

  // Conversation API: Network-first with cache fallback
  if (isChatApiGet(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        try {
          const networkRes = await fetch(request);
          if (
            networkRes.ok &&
            (networkRes.headers.get("content-type") || "").includes("application/json")
          ) {
            await cache.put(request, networkRes.clone()).catch(() => {});
            pruneApiCache().catch(() => {});
          }
          return networkRes;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: "offline" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
      })()
    );
    return;
  }

  // Default: pass-through
});

// Tip: set headers on /sw.js
//   Service-Worker-Allowed: /
//   Cache-Control: no-cache
