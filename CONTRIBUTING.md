# Contributing

Thanks for your interest in contributing!

## Development Setup

1. Clone the repo and install dependencies
   ```bash
   git clone https://github.com/Aevumis/Open-WebUI-Client.git
   cd Open-WebUI-Client
   npm install
   ```

2. Start the app
   ```bash
   npx expo start
   ```

3. Build (optional)
   ```bash
   # Local dev build (Android)
   npm run build:dev
   ```

## Branching & Commits

- Use feature branches: `feat/<short-name>` or `fix/<short-name>`
- Conventional Commits preferred (e.g., `feat:`, `fix:`, `docs:`, `chore:`)

## Pull Requests

- Include a clear description and testing steps
- Keep PRs focused and small when possible
- Link related issues

## Coding Standards

- TypeScript for app code
- ESLint is configured: `npm run lint`
- Centralized logging: use `lib/log.ts`; do not use `console.log` directly

## Testing

- Prefer unit/integration tests for critical logic (e.g., `lib/`) where feasible
- Manually test key flows: adding server, offline queue, sync, WebView navigation

## Release Process (maintainers)

- Tag `vX.Y.Z` to trigger the Release workflow
- CI will build APK/IPA, submit iOS to TestFlight (if configured), and publish assets
- Changelog PR will be opened automatically

## Code of Conduct

Participation is governed by our `CODE_OF_CONDUCT.md`.
