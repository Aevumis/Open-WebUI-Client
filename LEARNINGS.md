# Learnings

This document tracks issues encountered and how they were fixed, to avoid regressions and speed up future work.

---

## 2025-09-02 – Safe area overlap (status bar and home indicator)

- Symptom:
  - Top header/buttons overlapped by the status bar/notch.
  - Bottom UI could sit under the iOS home indicator.
- Cause:
  - App root not wrapped with `SafeAreaProvider`.
  - Screens used RN `SafeAreaView` (or lacked bottom edges) instead of `react-native-safe-area-context` with explicit edges.
- Fix:
  - Wrap root in `SafeAreaProvider`.
  - Use `SafeAreaView` from `react-native-safe-area-context` with `edges={["top", "bottom"]}` on applicable screens.
- Changes:
  - `app/_layout.tsx` → wrap `<Stack />` with `<SafeAreaProvider>`.
  - `app/client.tsx` → `SafeAreaView` from safe-area-context, `edges={["top", "bottom"]}` (loading and main views).
  - `app/servers.tsx` → `SafeAreaView` from safe-area-context, `edges={["top", "bottom"]}`.
  - `app/offline.tsx` → `SafeAreaView` from safe-area-context, `edges={["top", "bottom"]}`.
- Validation:
  - Confirmed by user: buttons and content no longer hidden at top or bottom.

---

## 2025-09-02 – expo-router navigation error

- Symptom:
  - Error in Metro: `Attempted to navigate before mounting the Root Layout component.`
  - Stack trace pointed to `app/index.tsx` calling `router.replace("/servers")` inside `useEffect`.
- Cause:
  - Imperative navigation fired before the root layout finished mounting.
- Fix:
  - Use declarative redirect with `Redirect` from `expo-router`.
- Changes:
  - File: `app/index.tsx`
  - Before:
    ```tsx
    import { useEffect } from "react";
    import { router } from "expo-router";
    
    export default function Index() {
      useEffect(() => {
        router.replace("/servers");
      }, []);
      return null;
    }
    ```
  - After:
    ```tsx
    import { Redirect } from "expo-router";
    export default function Index() {
      return <Redirect href="/servers" />;
    }
    ```

---

## 2025-09-02 – Service Worker 404 behind Traefik

- Symptom:
  - `curl -I https://openai.ayushpalak.com/sw.js` returned 404 with `server: uvicorn` (routed to Open WebUI container).
  - `offline.html` also 404 initially.
- Cause:
  - Traefik router rules were not matching the sidecar static server. Combined Path rule and/or priorities caused the generic host router to win.
  - In some environments, labels under `deploy:` are ignored (Docker Standalone). Also missing explicit `traefik.docker.network` can break routing.
- Fix:
  - Add a dedicated static sidecar (`caddy:2-alpine`) to serve only `/sw.js` and `/offline.html`.
  - Create separate routers for each path (HTTP and HTTPS), set higher priority, and attach the proper Traefik network.
  - Add required headers via a middleware: `Service-Worker-Allowed: /` and `Cache-Control: no-cache`.
  - Bypass Cloudflare cache for `/sw.js` to ensure fast updates.
- Validation:
  - `curl -I` now shows `server: Caddy`, `service-worker-allowed: /`, `cache-control: no-cache`, and a diagnostic header `x-sw-served-by: sidecar`.
- Notes:
  - The app registers the SW from within the React Native WebView injection, not on the desktop site. Desktop DevTools won’t show a SW unless you manually call `navigator.serviceWorker.register('/sw.js')` in the console.

---

## 2025-09-03 – Offline message queue & WebView-assisted drain

- Symptom:
  - Sending messages while offline didn’t enqueue, and nothing drained on reconnect without a native token.
- Cause:
  - The site blocked fetch attempts when offline (navigator.onLine=false), so interception never reached error path.
  - No robust DOM fallback to capture message text right at user interaction.
  - The page lacked RN connectivity context to reliably detect offline state.
- Fix:
  - Patch `navigator.onLine` early and in fetch wrapper to encourage attempts and trigger offline paths.
  - Capture UI text immediately on Enter/button and queue from DOM if no completion occurs shortly (1.2s) and offline.
  - Inject RN connectivity into page via `window.__owui_rnOnline` so fallback runs even if browser events are missing.
  - Implement WebView-assisted drain that simulates UI send for queued `{ uiText }` using page cookies, and waits for completion.
- Changes:
  - File: `components/OpenWebUIView.tsx`
    - `buildInjection()`:
      - Track `__owui_wasOffline`, `__owui_lastCompletionTick`, `__owui_lastTextCandidate`.
      - Add `composeEnter`/`buttonClick` logs with `len`, and `queueFromDom` + `queueMessage` on fallback.
      - Detect successful completion fetches (`/api/chat/completions`) and post `completionOk`.
    - RN bridge:
      - `useEffect([online])` injects `window.__owui_rnOnline` and logs `{ scope:'rn', event:'online' }`.
    - Drain:
      - If no native token, perform WebView-assisted drain by inserting text and clicking send; wait up to 8s for completion tick.
    - Logging:
      - Add a debug log-level switch `DEBUG_WEBVIEW_DEBUG_LOGS` to gate verbose WebView debug logs.
- Validation:
  - Offline send produced:
    - `[WebView][debug] { scope:'rn', event:'online', online:false }`
    - `[WebView][debug] { scope:'injection', event:'buttonClick', len:4 }`
    - `[WebView][debug] { scope:'injection', event:'queueFromDom', len:4 }`
    - `[outbox] enqueued ... count: 1`
  - Reconnect produced:
    - `[webviewDrain] start (no native token) ... pending: 1`
    - Repeated UI-simulated `buttonClick` followed by:
    - `completionDetected pathname:'/api/chat/completions'` and `completionOk`
    - `[webviewDrain] batch result { removed: 1, remaining: 0 }`
  - Offline intercept duplicate UI suppression:
    - Offline queue:
      - `[WebView][debug] { type: 'debug', scope: 'rn', event: 'online', online: false }`
      - `[WebView][debug] { scope: 'injection', event: 'offlineIntercepted', how: 'click', chatId: '…', len: 6 }`
      - `[outbox] enqueued … count: 1`
    - Reconnect + drain:
      - `[WebView][debug] { scope: 'injection', event: 'browserNetwork', online: true }`
      - `[net] change … effectiveOnline: true`
      - `[webviewDrain] start (no native token) { pending: 1 }`
      - `[webviewDrain] sending batch { size: 1 }`
      - `[outbox][drain] no token, abort` (expected; proceed with WebView-assisted drain)
      - `[WebView][debug] { scope: 'injection', event: 'buttonClick', online: true, len: 6 }`
      - `[webviewDrain] batch result { removed: 0, remaining: 1 }` (timeout at ~8s)
      - Retry: `sending batch` → `buttonClick`
      - `completionDetected pathname:'/api/chat/completions'` → `completionOk`
      - `[webviewDrain] batch result { removed: 1, remaining: 0 }`

---

## 2025-09-03 – Offline send duplicate UI suppression (intercept at source)

- Symptom (before):
  - When offline, the site created an optimistic placeholder (user + blank assistant). On reconnect, our drain sent again, causing duplicate UI and potential cross-device duplicates.
- Fix:
  - Intercept Enter/button when offline in `components/OpenWebUIView.tsx` `buildInjection()`.
  - Prevent default, capture text, `post({ type: 'queueMessage' })`, clear input, and log `offlineIntercepted`.
  - Do not allow the site to create placeholders while offline.
- Validation (logs):
  - Offline queue:
    - `[WebView][debug] { type: 'debug', scope: 'rn', event: 'online', online: false }`
    - `[WebView][debug] { scope: 'injection', event: 'offlineIntercepted', how: 'click', chatId: '…', len: 6 }`
    - `[outbox] enqueued … count: 1`
  - Reconnect + drain:
    - `[WebView][debug] { scope: 'injection', event: 'browserNetwork', online: true }`
    - `[net] change … effectiveOnline: true`
    - `[webviewDrain] start (no native token) { pending: 1 }`
    - `[webviewDrain] sending batch { size: 1 }`
    - `[outbox][drain] no token, abort` (expected; proceed with WebView-assisted drain)
    - `[WebView][debug] { scope: 'injection', event: 'buttonClick', online: true, len: 6 }`
    - `[webviewDrain] batch result { removed: 0, remaining: 1 }` (timeout at ~8s)
    - Retry: `sending batch` → `buttonClick`
    - `completionDetected pathname:'/api/chat/completions'` → `completionOk`
    - `[webviewDrain] batch result { removed: 1, remaining: 0 }`
- Notes:
  - The first simulated click timed out (~8s) just before completion arrived; a second attempt succeeded ~200ms later. To reduce retries, consider increasing the wait window to 9–10s.
  - No placeholder message appeared offline; only one message was delivered after reconnect.

---

## 2025-09-03 – Full sync startup issue (token httpOnly; WebView-assisted sync)

- Symptom:
  - On app launch, `[sync] maybeFullSync: no token yet, skipping for now` and outbox `[drain no token, abort]` repeated.
  - WebView injection logs showed `injected`/`hasInjected`, but no `authToken` messages and no initial full sync.
- Root Cause:
  - Server auth was stored in httpOnly cookies (e.g., `authjs.session-token`). The RN WebView JavaScript environment cannot read httpOnly cookies via `document.cookie`, so our injection could not capture/post a token to native storage.
  - `maybeFullSync()` waited ~5s for a token and then exited, with no fallback to sync using cookie auth alone.
- Fix:
  - `components/OpenWebUIView.tsx`:
    - Added WebView-assisted full sync that runs on injection events when no native token is saved. It fetches `/api/v1/chats/?page=N` and `/api/v1/chats/:id` with `credentials: 'include'`, then posts `{ type: 'cacheResponse', url, data }` for caching and finally `{ type: 'syncDone' }` to mark completion.
    - Kept broadened cookie-name detection to capture a token if it is ever non-httpOnly (`authjs.session-token`, `__Secure-*`, `next-auth.session-token`, `token`, generic `*session-token`).
  - `app/client.tsx`:
    - Added a retry loop to re-run `maybeFullSync()` every 5s until `isFullSyncDone()` is set, so native full sync will proceed if/when a token becomes available.
  - `lib/sync.ts`:
    - Ensured fetch includes cookie-based auth headers as a fallback.
  - Logging:
    - Enabled `'webview'` scope to surface injection and sync debug events.
- Validation (logs):
  - `[webview] debug { "event": "syncStart", "scope": "injection" }` appears after injection.
  - `[sync] done flag set (webview-assisted) { conversations: 30, messages: 168, host: "openai.ayushpalak.com" }` is logged, followed by `[sync] fullSync already done, stopping retries`.
- Notes:
  - Duplicate `syncStart`/`done` can occur if the WebView re-injects around navigations; current behavior is benign. We can further gate with a page-level flag (e.g., `window.__owui_syncing`) if needed to eliminate duplicates.
  - If a non-httpOnly token becomes available in the future, native-token-based full sync will take over automatically.