# Backlog

- offline Attachments: uploading and sending files through `/api/chat/completions` and any related upload endpoints. (Priority 5)
- Background tasks: add `expo-task-manager` + `expo-background-fetch` to periodically run incremental sync and outbox drain on built app.
- WebView-assisted drain: navigate to `/c/:chatId` before each send and batch by `chatId` to minimize page switches; ensure messages land in the correct conversation.
- Sync polish: incremental sync based on `updated_at` or ETag when available.
- Offline reader: support selecting among branches (multiple assistant children) in conversation detail; allow switching between alternate replies; remember last viewed branch.
