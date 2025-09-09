# Backlog

- offline Attachments: Priority 5 - uploading and sending files through `/api/chat/completions` and any related upload endpoints.
- Background tasks: Priority 5 - add `expo-task-manager` + `expo-background-fetch` to periodically run incremental sync and outbox drain on built app.
- WebView-assisted drain: Priority 2 - navigate to `/c/:chatId` before each send and batch by `chatId` to minimize page switches; ensure messages land in the correct conversation.
- Sync polish: already done? Priority 2 - incremental sync based on `updated_at` or ETag when available.
- Offline reader: Priority 3 - support selecting among branches (multiple assistant children) in conversation detail; allow switching between alternate replies; remember last viewed branch.
