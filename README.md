# Open WebUI Client

A React Native/Expo mobile client for [Open WebUI](https://github.com/open-webui/open-webui) that provides native offline capabilities and enhanced mobile experience.

## Features

### 🔌 **Native Offline Support**
- **Message Queueing**: Messages sent while offline are automatically queued and sent when connectivity returns
- **Conversation Caching**: Full conversation history cached locally for offline viewing (up to 100MB)
- **Smart Sync**: Automatic background synchronization of conversations when online
- **Outbox Management**: Visual indicators for queued messages with automatic retry logic

### 📱 **Mobile-First Experience**
- **WebView Integration**: Seamless embedding of Open WebUI with native enhancements
- **Theme Synchronization**: Automatic light/dark mode sync between device and web interface
- **Native Navigation**: Smooth transitions between servers and offline content
- **Haptic Feedback**: Tactile feedback for important actions

### 🌐 **Multi-Server Management**
- **Server Profiles**: Manage multiple Open WebUI instances with custom labels
- **Per-Server Settings**: Individual sync preferences and rate limiting per server
- **Authentication Handling**: Automatic token capture and management

### ⚡ **Performance Optimized**
- **Intelligent Caching**: LRU cache eviction with configurable limits
- **Rate Limiting**: Configurable requests per second to respect server limits
- **Background Tasks**: Non-blocking sync and queue processing

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the development server**
   ```bash
   npx expo start
   ```

3. **Run on device/simulator**
   - Scan QR code with Expo Go (development)
   - Press `a` for Android emulator
   - Press `i` for iOS simulator

4. **Add your Open WebUI server**
   - Launch the app and tap "Add Server"
   - Enter your Open WebUI URL (e.g., `https://your-openwebui.com`)
   - The app will automatically capture authentication tokens

## Building for Production

```bash
# Build for Android
npx expo build:android

# Build for iOS  
npx expo build:ios

# Or use EAS Build (recommended)
npx eas build --platform all
```

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

## Install

Download official builds from GitHub Releases:

- Releases: https://github.com/Aevumis/Open-WebUI-Client/releases

Assets you will typically find per release:

- `Open-WebUI-Client-<version>-android.apk` — Android APK for sideloading
- `Open-WebUI-Client-<version>-ios.ipa` — iOS IPA for internal/sideload testing (advanced users)
- `SHA256SUMS.txt` — checksums for the above assets

Platform-specific install notes:

### Android
- Download the `.apk` from the release
- On your device, enable "Install from unknown sources"
- Tap the APK to install, or use ADB: `adb install Open-WebUI-Client-<version>-android.apk`

### iOS
- Preferred: TestFlight public link (when available) will be listed in the release notes
- Advanced users: The `.ipa` asset can be sideloaded via tools like AltStore or re-signed for development use. Note that raw `.ipa` files are not installable by the general public without appropriate provisioning or sideloading tools.

## Releases & Changelog

- All releases are tagged (e.g., `v1.0.0`) and published on GitHub Releases with downloadable assets.
- See `CHANGELOG.md` for a summary of changes per version. The changelog is updated automatically as part of the release process.

## Branding & Trademark Notice

This project is an independent, community-built client for Open WebUI.

- We are not affiliated with, endorsed by, or sponsored by the Open WebUI project or its maintainers.
- "Open WebUI" and any associated logos or marks are the property of their respective owners. We do not claim ownership of these trademarks or branding.
- The name is used solely to help users understand interoperability with the Open WebUI project.
- We are happy to rename/rebrand this client if requested by the Open WebUI project to avoid any potential confusion. No trademark or branding rights are intended to be infringed.
