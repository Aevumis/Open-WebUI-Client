# Open WebUI Client Service Worker deployment

This folder contains a minimal Service Worker (`sw.js`) and offline fallback page (`offline.html`) that you can mount at the root of your Open WebUI origin to enable:

- Offline app shell (`offline.html`) for navigations
- Caching of conversation API GET responses at `/api/v1/chats/:id`
- Stale-while-revalidate caching for static assets (scripts/styles/images/fonts)

The Expo app registers `sw.js` automatically via the injected script in `components/OpenWebUIView.tsx`.

---

## Files

- `sw.js`
  - Registers caches for shell, assets, and conversation API
  - Network-first for navigation and API; uses offline fallback / cached API when offline
  - Adds a simple entry-count limit for API cache (native app still enforces strict 100 MB on-device)
- `offline.html`
  - Simple offline fallback page for navigations

Required headers on `/sw.js` response:
- `Service-Worker-Allowed: /`
- `Cache-Control: no-cache`
- Optional diagnostic header: `X-SW-Served-By: sidecar`

---

## Deploy behind Traefik (sidecar static server)

You can serve `sw.js` and `offline.html` through a tiny static server (e.g., Caddy) without changing your Open WebUI container.

1) Copy these files to your server, e.g., `/opt/openwebui-sw/`:

```
/opt/openwebui-sw/
  ├─ sw.js
  └─ offline.html
```

2) Add a "static sidecar" service to your Docker Compose stack that only serves `/sw.js` and `/offline.html`, routed by Traefik. Example:

```yaml
services:
  sw_static:
    image: caddy:2-alpine
    command: ["caddy", "file-server", "--root", "/srv", "--listen", ":8080"]
    volumes:
      - /opt/openwebui-sw:/srv:ro
    networks:
      - traefik-proxy
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.labels.server_type == productivity
      labels:
        - "traefik.enable=true"
        - "traefik.docker.network=traefik-proxy"

        # /sw.js (HTTP)
        - "traefik.http.routers.openwebui-swjs.rule=Host(`openai.ayushpalak.com`) && Path(`/sw.js`)"
        - "traefik.http.routers.openwebui-swjs.entrypoints=web"
        - "traefik.http.routers.openwebui-swjs.priority=1000"
        - "traefik.http.routers.openwebui-swjs.service=openwebui-sw"

        # /sw.js (HTTPS)
        - "traefik.http.routers.openwebui-swjs-https.rule=Host(`openai.ayushpalak.com`) && Path(`/sw.js`)"
        - "traefik.http.routers.openwebui-swjs-https.entrypoints=websecure"
        - "traefik.http.routers.openwebui-swjs-https.tls.certresolver=letsencrypt"
        - "traefik.http.routers.openwebui-swjs-https.priority=1000"
        - "traefik.http.routers.openwebui-swjs-https.service=openwebui-sw"

        # /offline.html (HTTP)
        - "traefik.http.routers.openwebui-offline.rule=Host(`openai.ayushpalak.com`) && Path(`/offline.html`)"
        - "traefik.http.routers.openwebui-offline.entrypoints=web"
        - "traefik.http.routers.openwebui-offline.priority=1000"
        - "traefik.http.routers.openwebui-offline.service=openwebui-sw"

        # /offline.html (HTTPS)
        - "traefik.http.routers.openwebui-offline-https.rule=Host(`openai.ayushpalak.com`) && Path(`/offline.html`)"
        - "traefik.http.routers.openwebui-offline-https.entrypoints=websecure"
        - "traefik.http.routers.openwebui-offline-https.tls.certresolver=letsencrypt"
        - "traefik.http.routers.openwebui-offline-https.priority=1000"
        - "traefik.http.routers.openwebui-offline-https.service=openwebui-sw"

        # Target service for the sidecar
        - "traefik.http.services.openwebui-sw.loadbalancer.server.port=8080"

        # Required SW headers + diagnostic header
        - "traefik.http.routers.openwebui-swjs.middlewares=openwebui-sw-headers"
        - "traefik.http.routers.openwebui-swjs-https.middlewares=openwebui-sw-headers"
        - "traefik.http.middlewares.openwebui-sw-headers.headers.customresponseheaders.Service-Worker-Allowed=/"
        - "traefik.http.middlewares.openwebui-sw-headers.headers.customresponseheaders.Cache-Control=no-cache"
        - "traefik.http.middlewares.openwebui-sw-headers.headers.customresponseheaders.X-SW-Served-By=sidecar"
```

- All other routes continue to your existing `openwebui` service.
- Dedicated routers for both HTTP and HTTPS ensure only `/sw.js` and `/offline.html` are served by the sidecar.
- `traefik.docker.network=traefik-proxy` is set so Traefik selects the correct network.

3) Redeploy your stack. Validate with:

```
curl -I https://openai.ayushpalak.com/sw.js
# Expect: Service-Worker-Allowed: /, Cache-Control: no-cache, and X-SW-Served-By: sidecar
```

---

## Portainer steps (bind mount)

Option A — If you can create the host folder via SSH:
- SSH to the host node running the stack
- `sudo mkdir -p /opt/openwebui-sw`
- `sudo chown 1000:1000 /opt/openwebui-sw` (adjust if needed)
- Upload `sw.js` and `offline.html` into `/opt/openwebui-sw/`
- In Portainer → Stacks → (edit your stack) → add the `sw_static` service from the snippet above
- Update the stack

Option B — Using Portainer only:
- Portainer → Stacks → Edit your Open WebUI stack
- Add the `sw_static` service and the bind mount volume line: `- /opt/openwebui-sw:/srv:ro`
- Update the stack (Portainer will create the directory if missing)
- After the stack is up, go to the `sw_static` container → Console → upload or paste the two files into `/srv` (you can also use an exec shell and `vi`/`nano`)
- Restart `sw_static`

---

## Cloudflare Cache Rules / Page Rules for /sw.js

To ensure fast SW updates, bypass edge caching for `/sw.js`:

- Cache Rules (recommended):
  - Cloudflare → Websites → (your domain) → Rules → Cache Rules → Create rule
  - If: URI Path equals `/sw.js`
  - Then: Cache = Bypass cache (Edge TTL not required)
  - Save and deploy

- Page Rules (legacy alternative):
  - Cloudflare → Rules → Page Rules → Create
  - URL pattern: `https://openai.ayushpalak.com/sw.js`
  - Setting: Cache Level = Bypass (and ensure this rule is ordered before broader caching rules)
  - Save and deploy

Optional: Add a second rule to cache static assets more aggressively, e.g., regex for asset extensions, with Edge TTL and respect origin headers.

---

## Validation checklist

- `curl -I https://openai.ayushpalak.com/sw.js` shows the headers (including `X-SW-Served-By: sidecar`)
- Visit the site in a browser → DevTools → Application → Service Workers → shows registered
- Offline navigation shows `offline.html`
- Conversation GET `/api/v1/chats/:id` returns cached data when offline

---

## Notes

- The SW uses an approximate entry cap for API cache. Your Expo native app already enforces a strict 100 MB cache limit for offline text.
- If you need to cache additional endpoints in the SW, extend `isChatApiGet()` accordingly.
