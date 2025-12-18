# Error Handling Guidelines

This document outlines the standard practices for error handling in the Open WebUI Client application. Adhering to these guidelines ensures a consistent user experience and makes debugging easier.

## Principles

1.  **Fail Gracefully**: The application should never crash due to a predictable error. Always catch exceptions at the boundaries (UI handlers, background tasks).
2.  **User-Centric Messages**: Errors shown to the user should be informative but non-technical. Use `Toast` for transient errors and `Alert` for critical ones.
3.  **Log for Developers**: Always log the full error details (including stack traces if possible) to the console using the `log` module.

## Standard Utilities

Use `lib/error-utils.ts` for consistent error message extraction.

```typescript
import { getErrorMessage } from "../lib/error-utils";

try {
  // Dangerous operation
} catch (error) {
  const msg = getErrorMessage(error);
  logInfo("module", "action failed", { error: msg });
}
```

## UI Error Handling

### Boundary Errors

Wrap top-level components or critical sections in the `ErrorBoundary` component located in `components/ErrorBoundary.tsx`.

### Async Operations

For async event handlers (e.g., button clicks), wrap logic in a `try/catch` block.

```typescript
const handlePress = async () => {
  try {
    await performAction();
  } catch (e) {
    // Log the error
    logDebug("ui", "action failed", { error: getErrorMessage(e) });
    // Inform the user
    Toast.show({ type: "error", text1: "Action Failed", text2: "Please try again." });
  }
};
```

## Background Tasks

Background tasks (like `sync` or `drain`) must never throw unhandled exceptions that could crash the app process.

-   **Sync/Drain**: These functions return status objects or void, and handle their own errors internally by logging them and retrying if appropriate.
-   **WebView Messages**: Message handlers in `OpenWebUIView` are wrapped in `try/catch` blocks to prevent a malformed message from crashing the WebView bridge.

## API Errors

When making `fetch` calls:

1.  Check `res.ok`.
2.  If not OK, throw an error with the status code or server message.
3.  Catch the error in the calling function.

```typescript
if (!res.ok) {
  throw new Error(`HTTP ${res.status}`);
}
```
