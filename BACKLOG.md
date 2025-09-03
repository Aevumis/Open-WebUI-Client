# Backlog

- Attachments: uploading and sending files through `/api/chat/completions` and any related upload endpoints. (Deferred)
- Settings UI: per-server config for `limitConversations` (default 30) and `rps` (default 5).
- Background tasks: add `expo-task-manager` + `expo-background-fetch` to periodically run incremental sync and outbox drain on built app.
- Sync polish: incremental sync based on `updated_at` or ETag when available.
- UI indicators: show queued/sent states in the WebView via lightweight DOM event or banner.
