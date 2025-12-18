# Library Modules

This directory contains the core business logic, utility functions, and data management layers for the Open WebUI Client.

## Module Descriptions

- **`cache.ts`**: Manages the local caching of API responses (e.g., chat history) using the file system. Handles reading, writing, and evicting cache entries to stay within storage limits.
- **`constants.ts`**: Defines application-wide constants, configuration values, and default settings (e.g., timeouts, sync limits).
- **`error-utils.ts`**: Provides utilities for safe error message extraction and consistent error handling patterns.
- **`log.ts`**: A centralized logging utility that abstracts `console.log` and can be extended for remote logging or specific log levels.
- **`mutex.ts`**: Implements a mutual exclusion lock to manage concurrency for critical resources (like the outbox and cache).
- **`outbox.ts`**: Manages the offline message queue. Handles enqueuing messages, retrying failed sends, and draining the queue when the network is available.
- **`storage-keys.ts`**: Central registry for all AsyncStorage keys to ensure consistency and prevent key collisions.
- **`storage-utils.ts`**: Helper functions for type-safe reading and writing to AsyncStorage (e.g., JSON serialization/deserialization).
- **`storage.ts`**: (Legacy/Deprecated) Earlier storage implementation. Prefer `storage-utils.ts` and `cache.ts`.
- **`sync.ts`**: Handles synchronization logic between the local device and the server, including full syncs and incremental updates.
- **`types.ts`**: Contains TypeScript interfaces and type definitions used throughout the application (e.g., `WebViewMessage`, `ChatCompletionBody`, `ServerSettings`).
- **`url-utils.ts`**: Utilities for parsing, validating, and manipulating URLs and hostnames.

## Testing

Unit tests for these modules are located in the `__tests__` subdirectory. Run them using `npm test`.
