# Offline Sync Button Integration Plan (offline-sync-button -> chore/release-1.0.1-rc8)

## Goal

Bring the **user-facing manual sync controls** and any required plumbing from `offline-sync-button` into `chore/release-1.0.1-rc8` with minimal risk to the release branch.

## Executive Summary

`offline-sync-button` contains a mix of:

- **Primary feature**: manual sync buttons (incremental + full) surfaced in the Offline screen, with status feedback.
- **Supporting changes**: sync plumbing (`manualSync`, `forceSyncReset`, token acquisition expectations), optional WebView-based “crawler” sync fallback, and network/ATS config changes (iOS ATS / Android cleartext).
- **Non-goals for release**: unrelated formatting refactors, CI workflow edits, doc/test deletions, and broad dependency/tooling changes.

This plan integrates the feature in **three sprints**, with each sprint shippable/testable.

## Scope

### In-scope

- **Offline screen manual controls**
  - Add **Sync** (incremental) and **Full Sync** actions on the Offline screen header.
  - Display progress + results (conversations/messages counts).
  - Provide user-friendly error messages with clear CTAs.

- **Sync engine support**
  - Ensure `manualSync(baseUrl, forceFullSync)` exists and is used by UI.
  - Ensure `forceSyncReset(baseUrl)` resets the “full sync done” flag + last sync time.
  - Ensure incremental/full sync behavior matches expected caching semantics.

- **Auth/token capture dependency handling**
  - If manual sync requires a captured token, guide the user to the action that captures it (e.g., open the server client / login).

- **Network config decisions (explicit)**
  - Decide whether to include **iOS ATS relaxations** and/or **Android cleartext** enablement for this release.

### Out-of-scope (do not bring from branch unless separately approved)

- CI workflow changes (`.github/workflows/*`).
- Formatting-only refactors (quote style changes, collapsing try/catch, etc.).
- Removal of docs/tests/tooling files seen in the branch diff.
- Broad dependency upgrades.

## Current State (release branch)

- Offline view exists: `app/offline.tsx`, `app/offline/view.tsx`.
- Background sync exists via `ClientScreen`: `app/client.tsx` (uses `maybeFullSync` + outbox drain).
- Sync engine exists: `lib/sync.ts` (`fullSync`, `incrementalSync`, `maybeFullSync`, `manualSync`).
- Central logging exists: `lib/log.ts` with `setLogConfig` in `app/_layout.tsx`.

## Proposed Integration Strategy

- Prefer **selective cherry-picks** of feature commits OR manual porting of small, clear hunks.
- Avoid merging the entire branch wholesale because it contains unrelated deletions/formatting changes.

## Sprint Plan

## Sprint 1: Manual Sync Buttons + Minimal Plumbing

### Sprint Goal

Users can trigger **Incremental Sync** and **Full Sync** from the Offline screen and receive clear success/failure feedback.

### User Stories

- **US1.1 (User)**: From Offline screen, I can press `Sync` to fetch recent updates.
- **US1.2 (User)**: From Offline screen, I can press `Full Sync` to rebuild offline cache.
- **US1.3 (User)**: If sync cannot run (offline/no token), I see a clear message telling me what to do next.

### Parallel Workstreams

#### Frontend/UI (Parallel)

- **Task F1**: Add button UI to `app/offline.tsx` header.
- **Task F2**: Add in-screen banner/toast for:
  - Success: “Synced X conversations / Y messages”
  - Failure: user-friendly message + CTA
- **Task F3**: Disable buttons while a sync is running (`syncingType` state).

#### Sync Engine (Parallel)

- **Task S1**: Ensure `manualSync(baseUrl, forceFullSync)` implements:
  - If `forceFullSync`: call `forceSyncReset()` then `fullSync()`.
  - Else: if `isFullSyncDone()` -> `incrementalSync()` else `fullSync()`.
- **Task S2**: Ensure `forceSyncReset(baseUrl)` is safe and host extraction is robust (must not throw; prefer existing safe URL helpers).

#### Error/UX (Parallel)

- **Task UX1**: Map errors into user-facing messages:
  - No token -> “Open the server and sign in, then retry Sync.”
  - Offline -> “You’re offline. Connect to the internet and retry.”
  - Invalid server URL -> “Re-add your server in Servers.”

### Validation (User-testable)

- **Test 1**: With valid login/token captured, press `Sync` and confirm:
  - UI disables buttons while running
  - Success message shows counts
  - Offline list updates order/metadata
- **Test 2**: Press `Full Sync` and confirm `isFullSyncDone` becomes true after completion.
- **Test 3**: Without token captured, pressing sync produces a CTA message.

### Done Criteria

- Sync buttons are present, accessible, and do not crash.
- Manual sync uses centralized logger (no direct `console.*` usage outside logger).
- Errors are user-friendly with clear CTAs.

---

## Sprint 2: Reliability Enhancements (Optional WebView Crawler + De-dup + Guardrails)

### Sprint Goal

Improve reliability when native token-based fetch is blocked or when server behavior differs, without destabilizing release.

### User Stories

- **US2.1 (User)**: If native sync fails but the web session is valid, app can still populate offline cache.
- **US2.2 (User)**: Sync results do not duplicate conversations in cache.

### Parallel Workstreams

#### WebView/Crawler (Parallel, optional)

- **Task W1**: Decide whether to include the `offline-sync-button` WebView crawler approach (hidden WebView fetch `/api/v1/chats` and post messages back).
- **Task W2**: If included:
  - Make host scoping strict (never sync from a mismatched host).
  - Add timeouts and explicit completion/error messages.
  - Ensure crawler is only used as fallback when token-based sync fails or token missing.

#### Cache Integrity (Parallel)

- **Task C1**: Confirm cache index keys remain stable (`host/id`).
- **Task C2**: Verify “offline de-duplication” behavior from branch is either already present or port minimal fix.

#### Observability (Parallel)

- **Task O1**: Add scoped logs for:
  - `sync` (start/end, mode)
  - `offline` (button taps, banner)
  - `webview`/`crawler` (only if crawler enabled)

### Validation (User-testable)

- **Test 4**: Simulate token not present, but web session exists (open client first), then trigger sync and confirm fallback works (if enabled).
- **Test 5**: Run sync twice; confirm cache items don’t balloon due to duplication.

### Done Criteria

- Fallback behavior is gated and cannot accidentally sync from the wrong host.
- No regressions to existing background sync (`ClientScreen`).

---

## Sprint 3: Platform Networking Config + Unit Tests + Release Hardening

### Sprint Goal

Finalize platform behavior and reduce long-term risk by adding focused unit tests and clarifying configuration choices.

### Decisions to Make (explicit)

- **Decision D3.1 (iOS ATS)**: Include `NSAppTransportSecurity.NSAllowsArbitraryLoads=true` or keep stricter ATS.
  - **Risk**: Broad ATS relax increases security exposure.
  - **Alternative**: add per-domain exceptions or require HTTPS.

- **Decision D3.2 (Android cleartext HTTP)**: Include `plugins/withCleartextTraffic.js` to enable `android:usesCleartextTraffic=true`.
  - **Risk**: Allows HTTP traffic (mitigation: only needed for local dev / self-hosted non-HTTPS).
  - **Alternative**: document requirement for HTTPS / reverse proxy.

### Parallel Workstreams

#### Platform Config (Parallel)

- **Task P1**: If enabling ATS/cleartext:
  - Add config changes in `app.json` and plugin file.
  - Add release notes entry explaining why.
- **Task P2**: Confirm versioning strategy (do not regress `version`, `buildNumber`, `versionCode`).

#### Unit Testing (Parallel; focus first)

- **Task T1**: Add unit tests for sync decision logic:
  - `manualSync(forceFullSync=false)` chooses incremental iff `isFullSyncDone=true`.
  - `manualSync(forceFullSync=true)` resets then runs full.
- **Task T2**: Add unit tests for host parsing safety (invalid URL yields user-friendly error path).

#### QA + Release Hardening (Parallel)

- **Task QA1**: Define a small smoke checklist (no E2E required yet):
  - Offline screen renders
  - Sync buttons work
  - Background sync still runs when online

### Validation (User-testable)

- **Test 6**: iOS build installs and can connect to target servers (HTTP/HTTPS as chosen).
- **Test 7**: Android build installs and can connect to local/self-hosted servers (HTTP/HTTPS as chosen).

### Done Criteria

- Platform behavior is intentional and documented.
- Unit tests cover the most failure-prone sync decision paths.

## Risk Register

- **Risk R1: Bringing unrelated deletions/refactors**
  - Mitigation: selective cherry-pick/manual port only; avoid wholesale merge.

- **Risk R2: URL parsing throws at runtime**
  - Mitigation: use safe URL helpers and convert errors into user-facing CTAs.

- **Risk R3: Token availability / auth capture mismatch**
  - Mitigation: clear UI guidance; optional crawler fallback gated.

- **Risk R4: Security regression from ATS/cleartext**
  - Mitigation: explicit decision + least-privilege configuration where possible.

## Rollback Plan

- If manual sync introduces regressions, revert only:
  - `app/offline.tsx` UI additions
  - `lib/sync.ts` manual sync changes
  - Any platform config toggles

## Deliverable

- This plan file: `docs/offline-sync-button-integration-plan.md`
