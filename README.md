# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Open WebUI Client integration and offline support

This app embeds an Open WebUI instance in a WebView and adds native capabilities:

- Offline message queueing and automatic outbox drain when back online
- Native offline cache for conversation JSON (viewable in the app’s Offline screen)
- Optional in-WebView offline browsing via a Service Worker on your Open WebUI origin

### Enabling offline inside the WebView (Service Worker)

To enable in-WebView offline navigations and asset caching, deploy a Service Worker at your Open WebUI origin:

- Serve `sw.js` at `/sw.js` and `offline.html` at `/offline.html`
- Required headers on `/sw.js`:
  - `Service-Worker-Allowed: /`
  - `Cache-Control: no-cache`
- If you use Cloudflare, add a Cache Rule (or Page Rule) to bypass edge caching for `/sw.js`

We include a ready-to-use sidecar approach (e.g., small static Caddy server behind Traefik) and full instructions here:

- `webui-sw/README.md` (in this repo) → [webui-sw/README.md](./webui-sw/README.md)
- GitHub repository URL: https://github.com/Aevumis/Open-WebUI-Client

Validation quick checks:

```
curl -I https://<your-domain>/sw.js
# Expect: Service-Worker-Allowed: / and Cache-Control: no-cache

curl -I https://<your-domain>/offline.html
# Expect: 200 OK
```

### What if I don’t deploy the Service Worker?

- Online WebView usage: Works normally
- Offline queueing/outbox: Works (messages are queued and later sent)
- Native offline viewing: Works via the app’s Offline screen (conversations cached natively)
- In-WebView offline browsing: Not available (no offline shell or cached assets without the SW)

When the app detects that `/sw.js` is not present on a server you open, it will show a one-time hint with a link to the docs above.
