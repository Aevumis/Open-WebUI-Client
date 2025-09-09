# Privacy Policy

Last updated: 2025-09-08

This project, "Open WebUI Client", is an open-source mobile application. We care about user privacy and designed the app with an offline-first architecture.

## What we collect

- We do not collect analytics or telemetry by default.
- We do not transmit any data to our own servers.

## What the app does on your device

- Stores configuration, authentication tokens for servers you add, and cached conversation data locally on your device. This data remains on-device unless you explicitly remove it or uninstall the app.
- May request device permissions (e.g., microphone, camera, location) to enable features surfaced by the embedded web app. Permission prompts are system-managed and optional.

## What is sent over the network

- When you connect to an Open WebUI instance, data is exchanged directly between your device and that server (which you choose and control). This includes requests initiated by you within the app/WebView.
- Offline messages are queued on-device and sent to your chosen server once connectivity resumes.

## Third parties

- We do not embed third‑party analytics SDKs.
- Any data shared is between your device and the Open WebUI server(s) you configure.

## Security

- Sensitive tokens are stored using platform storage (e.g., AsyncStorage) appropriate for this application class. You can clear data by removing servers or uninstalling the app.
- Use HTTPS endpoints for your Open WebUI servers to protect data in transit.

## Your choices

- You can remove servers and their associated data from within the app.
- You can revoke device permissions at any time from system settings.
- You can uninstall the app to remove all local data.

## Contact

- To report a privacy concern, please open a GitHub issue or (preferably) a private security advisory as described in `SECURITY.md`.
