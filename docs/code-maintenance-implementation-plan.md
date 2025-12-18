# Code Maintenance Issues - Implementation Plan

**Date:** 2025-12-18
**Project:** Open WebUI Client
**Status:** Planning Phase

---

## Overview

This document outlines the implementation plan for all 9 code quality and maintainability issues identified in the code analysis report (Issues #19-27). These issues don't affect functionality but impact long-term maintainability, developer productivity, and code reliability.

---

## Issue #19: Extensive Code Duplication

### Problem Analysis
Repetitive code patterns exist throughout the codebase, making it harder to maintain and increasing the risk of inconsistencies when changes are needed.

**Examples:**
- Host extraction: `new URL(baseUrl).host` repeated 20+ times (✅ Now fixed with `safeGetHost()`)
- Error handling patterns duplicated across files
- Logging calls with similar structure
- Storage key generation patterns

### Current Status
- ✅ Host extraction already consolidated via `safeGetHost()` utility
- ⚠️ Error handling patterns still duplicated
- ⚠️ Logging patterns still duplicated
- ⚠️ Storage key patterns still duplicated

### Implementation Strategy

#### Step 1: Identify Remaining Duplication Patterns
Use Grep to find:
- Similar try-catch blocks
- Repeated logging patterns
- Duplicate validation logic
- Similar data transformation code

#### Step 2: Create Utility Functions
Add to existing `lib/url-utils.ts` or create new utility files:

**lib/error-utils.ts**
```typescript
/**
 * Standard error logger that extracts message from various error types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Safely execute async operation with error handling
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  fallback: T,
  onError?: (error: unknown) => void
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (onError) onError(error);
    return fallback;
  }
}
```

**lib/storage-utils.ts**
```typescript
/**
 * Safe JSON parse from AsyncStorage
 */
export async function getStorageJSON<T>(
  key: string,
  defaultValue: T
): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Safe JSON write to AsyncStorage
 */
export async function setStorageJSON<T>(
  key: string,
  value: T
): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
```

#### Step 3: Replace Duplicated Code
Search for patterns and replace with utilities:
- All manual JSON.parse/stringify combinations
- All try-catch blocks doing similar things
- All error message extraction logic

### Success Criteria
- [ ] No more than 2 instances of similar try-catch patterns
- [ ] All AsyncStorage operations use utility functions
- [ ] Error message extraction uses single utility

---

## Issue #20: Magic String Storage Keys

### Problem Analysis
Storage keys are hardcoded strings scattered across multiple files, risking typos and inconsistencies.

**Current Examples:**
```typescript
const STORAGE_KEY = "servers:list";              // app/servers.tsx
const ACTIVE_KEY = "servers:active";             // app/servers.tsx
const TOKEN_KEY = (host: string) => `authToken:${host}`;  // lib/outbox.ts
const OUTBOX_KEY = (host: string) => `outbox:${host}`;    // lib/outbox.ts
const SETTINGS_KEY = (host: string) => `server:settings:${host}`;  // lib/outbox.ts
const SYNC_DONE = (host: string) => `sync:done:${host}`;  // lib/sync.ts
```

### Implementation Strategy

#### Step 1: Create Storage Keys Module
Create `lib/storage-keys.ts`:
```typescript
/**
 * Centralized storage keys for AsyncStorage
 * All keys should be defined here to prevent typos and ensure consistency
 */

// Server Configuration
export const STORAGE_KEYS = {
  SERVERS_LIST: "servers:list",
  SERVERS_ACTIVE: "servers:active",

  // Per-host keys (use functions)
  authToken: (host: string) => `authToken:${host}`,
  outbox: (host: string) => `outbox:${host}`,
  serverSettings: (host: string) => `server:settings:${host}`,

  // Sync state
  syncDone: (host: string) => `sync:done:${host}`,
  syncLastTime: (host: string) => `sync:lastTime:${host}`,
  syncVersion: (host: string) => `sync:version:${host}`,
} as const;

// Type-safe key validation
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
```

#### Step 2: Update All Files
Replace hardcoded strings with imports from STORAGE_KEYS:

**Files to update:**
- app/servers.tsx
- app/client.tsx
- lib/outbox.ts
- lib/sync.ts
- Any other files using AsyncStorage directly

**Before:**
```typescript
const TOKEN_KEY = (host: string) => `authToken:${host}`;
await AsyncStorage.getItem(TOKEN_KEY(host));
```

**After:**
```typescript
import { STORAGE_KEYS } from "./storage-keys";
await AsyncStorage.getItem(STORAGE_KEYS.authToken(host));
```

#### Step 3: Add Migration Safety
If any keys are renamed during consolidation, add migration logic:
```typescript
// lib/storage-migration.ts
export async function migrateStorageKeys() {
  // Example: if we rename a key
  const oldValue = await AsyncStorage.getItem("old:key");
  if (oldValue) {
    await AsyncStorage.setItem(STORAGE_KEYS.NEW_KEY, oldValue);
    await AsyncStorage.removeItem("old:key");
  }
}
```

### Success Criteria
- [ ] All storage keys defined in single location
- [ ] No hardcoded storage key strings in any file
- [ ] Type safety for storage keys
- [ ] Migration path documented if keys change

---

## Issue #21: Inconsistent Error Handling

### Problem Analysis
Functions handle errors inconsistently - some throw, some return null, some silently catch, making it unclear what to expect when calling them.

**Examples:**
```typescript
// Pattern 1: Throws errors
export async function fullSync(baseUrl: string) {
  if (!token) throw new Error("No auth token captured yet");
}

// Pattern 2: Returns null
async function readJSON<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// Pattern 3: Silent catch with empty block
try {
  const c = await count(host);
  setQueuedCount(c);
} catch {}
```

### Implementation Strategy

#### Step 1: Define Error Handling Guidelines
Create `docs/error-handling-guide.md`:
```markdown
# Error Handling Guidelines

## When to THROW errors
- Invalid arguments that indicate programmer error
- Missing required configuration (auth tokens, server URLs)
- Unrecoverable errors in critical paths

## When to RETURN null/undefined
- Optional data that may not exist
- Failed reads where absence is normal (cache misses, etc.)
- Safe utility functions

## When to CATCH silently
- UI event handlers (must not crash the app)
- Background operations that can safely fail
- Always log the error even if caught

## Pattern Examples
See code examples...
```

#### Step 2: Categorize Functions
Review each function and categorize:
- **Critical functions** → Should throw on errors
- **Data accessors** → Return null on errors
- **UI handlers** → Catch and log errors

#### Step 3: Add Result Type for Complex Cases
For functions that need to return both success/failure and data:
```typescript
// lib/result.ts
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function err<E = Error>(error: E): Result<never, E> {
  return { success: false, error };
}
```

Use for operations where you want to handle both cases:
```typescript
export async function safeDrain(url: string): Promise<Result<DrainResult>> {
  try {
    const result = await drain(url);
    return ok(result);
  } catch (error) {
    return err(error);
  }
}
```

#### Step 4: Refactor Inconsistent Functions
Go through each file and standardize based on the guidelines.

### Success Criteria
- [ ] Error handling guidelines documented
- [ ] All functions follow consistent patterns
- [ ] No empty catch blocks without logging
- [ ] Clear documentation on what each function does on error

---

## Issue #22: Liberal Use of `any` Type

### Problem Analysis
The codebase uses `any` type extensively, losing TypeScript's type safety benefits and making bugs harder to catch at compile time.

**Locations:**
- `lib/outbox.ts:315`: `catch (e: any)`
- `app/offline.tsx:11`: `useNavigation<any>()`
- `components/OpenWebUIView.tsx`: Multiple instances
- Event handlers and message types

### Implementation Strategy

#### Step 1: Define Core Type Interfaces
Create `lib/types.ts`:
```typescript
/**
 * Core type definitions for the application
 */

// WebView Message Types
export type WebViewMessage =
  | { type: 'authToken'; token: string }
  | { type: 'cacheEntry'; host: string; entry: CachedEntry }
  | { type: 'queueMessage'; chatId: string; body: ChatCompletionRequest }
  | { type: 'drainComplete'; sent: number; failed: number }
  | { type: 'debug'; scope: string; event: string; [key: string]: any }
  | { type: 'swStatus'; hasSW: boolean; swFunctional?: boolean };

// API Types
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream?: boolean;
  // Add other fields as discovered
}

export interface ConversationData {
  id: string;
  title?: string;
  chat?: {
    messages: Message[];
    created_at?: number;
    updated_at?: number;
  };
  archived?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

// Navigation Types
export interface ServerParams {
  id: string;
}

export interface Server {
  id: string;
  url: string;
  label?: string;
}

// Error Types (instead of any)
export interface AppError {
  message: string;
  code?: string;
  stack?: string;
}
```

#### Step 2: Replace `any` Systematically

**Pattern 1: Error Handling**
```typescript
// Before
catch (e: any) {
  console.log(e.message);
}

// After
catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(message);
}
```

**Pattern 2: Navigation**
```typescript
// Before
const nav = useNavigation<any>();

// After
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
type RootStackParamList = {
  servers: undefined;
  client: { id: string };
  offline: undefined;
};
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
const nav = useNavigation<NavigationProp>();
```

**Pattern 3: Message Handlers**
```typescript
// Before
function onMessage(event: any) {
  const msg = JSON.parse(event.nativeEvent.data);
}

// After
function onMessage(event: WebViewMessageEvent) {
  const msg: WebViewMessage = JSON.parse(event.nativeEvent.data);
}
```

#### Step 3: Use Type Guards
```typescript
// lib/type-guards.ts
export function isAuthTokenMessage(msg: WebViewMessage): msg is { type: 'authToken'; token: string } {
  return msg.type === 'authToken' && typeof msg.token === 'string';
}

export function isCacheEntryMessage(msg: WebViewMessage): msg is { type: 'cacheEntry'; host: string; entry: CachedEntry } {
  return msg.type === 'cacheEntry' && typeof msg.host === 'string';
}

// Usage
if (isAuthTokenMessage(msg)) {
  // TypeScript knows msg.token is a string here
  await setToken(msg.token);
}
```

#### Step 4: Incremental Replacement
- Find all `any` usage: `grep -r ": any" --include="*.ts" --include="*.tsx"`
- Replace one file at a time, starting with core libraries
- Fix TypeScript errors as they arise
- Test after each file

### Success Criteria
- [ ] Core types defined in lib/types.ts
- [ ] No `any` in lib/ directory
- [ ] Type guards for runtime type checking
- [ ] Navigation types properly defined
- [ ] Error handling uses `unknown` instead of `any`

---

## Issue #23: No Unit Tests

### Problem Analysis
Complex logic in `sync.ts`, `outbox.ts`, and `cache.ts` is completely untested, making refactoring risky and bugs likely.

**Untested Critical Logic:**
- Sync pagination and retry logic
- Outbox queue management and locking
- Cache eviction algorithms
- URL parsing and validation
- Error handling paths

### Implementation Strategy

#### Step 1: Set Up Testing Infrastructure
```bash
# Install dependencies
npm install --save-dev jest @testing-library/react-native @testing-library/jest-native
npm install --save-dev @types/jest ts-jest
```

**jest.config.js:**
```javascript
module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|expo|@expo|@react-navigation)/)'
  ],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'components/**/*.tsx',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
};
```

**jest-setup.js:**
```javascript
import '@testing-library/jest-native/extend-expect';
import 'react-native-gesture-handler/jestSetup';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file://mock-directory/',
  makeDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
}));
```

#### Step 2: Write Tests for Core Utilities
Start with pure utility functions (no dependencies):

**lib/__tests__/url-utils.test.ts:**
```typescript
import { safeGetHost, safeParseUrl, isValidUrl } from '../url-utils';

describe('url-utils', () => {
  describe('safeGetHost', () => {
    it('should extract host from valid URL', () => {
      expect(safeGetHost('https://example.com/path')).toBe('example.com');
    });

    it('should return null for invalid URL', () => {
      expect(safeGetHost('not-a-url')).toBeNull();
    });

    it('should handle URLs with ports', () => {
      expect(safeGetHost('https://example.com:8080')).toBe('example.com:8080');
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
    });
  });
});
```

#### Step 3: Write Tests for Business Logic

**lib/__tests__/cache.test.ts:**
```typescript
import { cacheApiResponse, getCacheIndex, recalculateSize } from '../cache';
import * as FileSystem from 'expo-file-system';

jest.mock('expo-file-system');

describe('cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cacheApiResponse', () => {
    it('should save entry and update index', async () => {
      const entry = {
        url: 'https://example.com/api/v1/chats/123',
        capturedAt: Date.now(),
        data: { id: '123', title: 'Test Chat' },
        title: 'Test Chat',
      };

      await cacheApiResponse('example.com', entry);

      expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
    });
  });

  describe('recalculateSize', () => {
    it('should calculate total size from index', async () => {
      // Test implementation
    });
  });
});
```

**lib/__tests__/outbox.test.ts:**
```typescript
import { enqueue, drain, count } from '../outbox';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('outbox', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('enqueue', () => {
    it('should add item to outbox', async () => {
      await enqueue('example.com', {
        id: 'test-id',
        chatId: 'chat-123',
        body: { messages: [] },
      });

      const c = await count('example.com');
      expect(c).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired items', async () => {
      // Test TTL cleanup
    });

    it('should remove items with too many retries', async () => {
      // Test retry limit
    });
  });
});
```

#### Step 4: Add Integration Tests

**__tests__/integration/sync.test.ts:**
```typescript
describe('Sync Integration', () => {
  it('should perform full sync and cache results', async () => {
    // Mock API responses
    // Call fullSync
    // Verify cache contains expected data
  });
});
```

#### Step 5: Add to CI/CD
Update package.json:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

### Target Coverage Goals
- **lib/** utilities: 90%+ coverage
- **lib/** business logic: 80%+ coverage
- **components/**: 60%+ coverage (focus on logic, not UI)

### Success Criteria
- [ ] Jest configured and running
- [ ] All utility functions have tests
- [ ] Core business logic (sync, outbox, cache) has tests
- [ ] Coverage reports generated
- [ ] Tests run in CI (if applicable)

---

## Issue #24: Long, Complex Functions

### Problem Analysis
Several functions are extremely long and handle multiple responsibilities, making them hard to understand, test, and maintain.

**Examples:**
- `buildInjection()`: 507 lines - generates entire WebView injection script
- `onMessage()`: 185 lines - handles all WebView message types
- `injectWebDrainBatch()`: 73 lines - complex DOM manipulation logic

### Implementation Strategy

#### Step 1: Identify Functions to Refactor
Priority list:
1. `buildInjection()` - 507 lines
2. `onMessage()` - 185 lines
3. `injectWebDrainBatch()` - 73 lines
4. Any function over 50 lines with multiple responsibilities

#### Step 2: Refactor buildInjection()
Break into logical sections:

**Before:**
```typescript
function buildInjection(baseUrl: string) {
  return `(() => {
    // 507 lines of JavaScript string
  })()`;
}
```

**After:**
```typescript
// components/webview-injection/index.ts
export function buildInjection(baseUrl: string): string {
  const host = safeGetHost(baseUrl);
  return `
    ${buildUtilityFunctions()}
    ${buildAuthCapture(host)}
    ${buildServiceWorkerSetup()}
    ${buildFetchInterception(host)}
    ${buildOfflineHandling()}
    ${buildMessageHandlers()}
  `;
}

// components/webview-injection/auth.ts
function buildAuthCapture(host: string): string {
  return `
    function checkAuthOnce() {
      // Auth capture logic
    }
  `;
}

// components/webview-injection/fetch-interception.ts
function buildFetchInterception(host: string): string {
  return `
    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
      // Fetch interception logic
    };
  `;
}
```

Benefits:
- Each section can be tested independently
- Easier to understand what each part does
- Simpler to modify one aspect without affecting others

#### Step 3: Refactor onMessage()
Use strategy pattern for message handling:

**Before:**
```typescript
function onMessage(event: WebViewMessageEvent) {
  const msg = JSON.parse(event.nativeEvent.data);
  if (msg.type === 'authToken') {
    // 30 lines
  } else if (msg.type === 'cacheEntry') {
    // 40 lines
  } else if (msg.type === 'queueMessage') {
    // 50 lines
  }
  // ... 185 lines total
}
```

**After:**
```typescript
// components/webview-handlers/index.ts
type MessageHandler = (msg: any, context: MessageContext) => Promise<void>;

const messageHandlers: Record<string, MessageHandler> = {
  authToken: handleAuthToken,
  cacheEntry: handleCacheEntry,
  queueMessage: handleQueueMessage,
  drainComplete: handleDrainComplete,
  debug: handleDebug,
};

function onMessage(event: WebViewMessageEvent) {
  const msg = JSON.parse(event.nativeEvent.data);
  const handler = messageHandlers[msg.type];
  if (handler) {
    handler(msg, { baseUrl, online, onQueueCountChange });
  }
}

// components/webview-handlers/auth-token.ts
async function handleAuthToken(msg: any, context: MessageContext) {
  const { token } = msg;
  const host = safeGetHost(context.baseUrl);
  if (host) {
    await setToken(host, token);
    logInfo('webview', 'auth token captured', { host });
  }
}
```

#### Step 4: Apply Single Responsibility Principle
For each long function:
1. Identify distinct responsibilities
2. Extract each into its own function
3. Name functions clearly to show intent
4. Keep main function as coordinator

**Example - Breaking down complex logic:**
```typescript
// Before: One function doing everything
async function processSync(url: string) {
  // Validate URL
  // Get token
  // Fetch conversations
  // Filter archived
  // Cache each conversation
  // Update sync status
  // Handle errors
}

// After: Each step is its own function
async function processSync(url: string) {
  const context = await prepareSyncContext(url);
  const conversations = await fetchConversations(context);
  const filtered = filterArchivedConversations(conversations);
  await cacheConversations(context, filtered);
  await updateSyncStatus(context, filtered.length);
}
```

### Success Criteria
- [ ] No function over 100 lines
- [ ] Functions have single, clear responsibility
- [ ] buildInjection() broken into modules
- [ ] onMessage() uses handler pattern
- [ ] Each function is easily testable

---

## Issue #25: Missing Documentation

### Problem Analysis
Complex functions lack JSDoc comments explaining their purpose, parameters, return values, and potential errors.

### Implementation Strategy

#### Step 1: Define Documentation Standards
Create `docs/documentation-guide.md`:
```markdown
# Documentation Standards

## Required Documentation
All exported functions must have JSDoc comments with:
- Description of what the function does
- @param for each parameter
- @returns for return value
- @throws for errors that may be thrown
- @example for complex functions

## Template
\`\`\`typescript
/**
 * Brief one-line description
 *
 * Longer description if needed, explaining:
 * - When to use this function
 * - Important behavior to know
 * - Performance considerations
 *
 * @param paramName - Description of parameter
 * @returns Description of return value
 * @throws {ErrorType} When this error occurs
 *
 * @example
 * const result = await myFunction('example');
 */
\`\`\`
```

#### Step 2: Document Core Functions
Start with most important/complex functions:

**lib/sync.ts:**
```typescript
/**
 * Performs a full synchronization of conversations from the server to local cache
 *
 * This function fetches up to `limitConversations` conversations from the server,
 * retrieves their full details, and caches them locally. It respects the configured
 * RPS (requests per second) limit to avoid overwhelming the server.
 *
 * The sync will skip archived conversations and marks sync as complete when done.
 *
 * @param baseUrl - The base URL of the Open WebUI server (e.g., "https://example.com")
 * @returns Promise resolving to counts of synced conversations and messages
 * @throws {Error} If baseUrl is invalid
 * @throws {Error} If no auth token is available for the host
 *
 * @example
 * const result = await fullSync('https://chat.example.com');
 * console.log(`Synced ${result.conversations} conversations`);
 */
export async function fullSync(baseUrl: string): Promise<{ conversations: number; messages: number }> {
  // Implementation
}
```

**lib/outbox.ts:**
```typescript
/**
 * Drains the outbox by sending queued messages to the server
 *
 * Attempts to send all queued messages for the given server, respecting the
 * configured RPS limit. Messages are sent in FIFO order. Failed messages are
 * marked with retry counts and kept in the queue for future attempts.
 *
 * The function uses an exclusive lock to prevent concurrent drain operations
 * on the same host, avoiding race conditions and duplicate sends.
 *
 * @param baseUrl - The base URL of the server to drain messages for
 * @returns Promise resolving to counts of sent and remaining messages
 *
 * @example
 * const result = await drain('https://chat.example.com');
 * if (result.sent > 0) {
 *   console.log(`Sent ${result.sent} queued messages`);
 * }
 */
export async function drain(baseUrl: string): Promise<{ sent: number; remaining: number }> {
  // Implementation
}
```

**lib/cache.ts:**
```typescript
/**
 * Recalculates the total cache size by checking actual file system
 *
 * This function verifies each cached file still exists and updates the index
 * with accurate size information. Files that no longer exist are removed from
 * the index. This helps recover from inconsistent states where the index doesn't
 * match reality.
 *
 * Note: This is an expensive operation that should be called sparingly, typically
 * only during initialization or when cache corruption is suspected.
 *
 * @returns Promise resolving to the actual total size in bytes
 *
 * @example
 * const actualSize = await recalculateSize();
 * console.log(`Cache is using ${actualSize / 1024 / 1024}MB`);
 */
export async function recalculateSize(): Promise<number> {
  // Implementation
}
```

#### Step 3: Document Types and Interfaces
```typescript
/**
 * Represents a queued message waiting to be sent to the server
 *
 * Items are stored in AsyncStorage and persisted across app restarts.
 * They have a TTL of 7 days and a max retry limit of 10 attempts.
 */
export type OutboxItem = {
  /** Unique identifier for this queued item (local UUID) */
  id: string;

  /** The chat/conversation ID this message belongs to */
  chatId: string;

  /** The request body to send to /api/chat/completions */
  body: any;

  /** Timestamp when this item was first queued */
  createdAt: number;

  /** Number of send attempts made so far */
  tries: number;

  /** Error message from the last failed attempt, if any */
  lastError?: string;
};
```

#### Step 4: Add README for Complex Modules
Create README files for complex directories:

**lib/README.md:**
```markdown
# Core Libraries

## Overview
This directory contains the core business logic for the Open WebUI Client.

## Modules

### sync.ts
Handles synchronization of conversations between server and local cache.
- Full sync: Initial download of all conversations
- Incremental sync: Updates since last sync
- Respects RPS limits and caches locally

### outbox.ts
Manages queued messages when offline or when send fails.
- Queue management with FIFO ordering
- Automatic retry with exponential backoff
- TTL and size limits to prevent unbounded growth

### cache.ts
Local file-based cache for conversation data.
- 100MB size limit with LRU eviction
- Atomic operations to prevent corruption
- Automatic cleanup of stale entries

## Architecture Decisions
See docs/architecture.md for detailed explanations of key design choices.
```

### Success Criteria
- [ ] All exported functions have JSDoc comments
- [ ] Complex types are documented
- [ ] Each lib/ module has usage examples
- [ ] README files for complex directories
- [ ] Architecture decisions documented

---

## Issue #26: Inconsistent Code Style

### Problem Analysis
Mix of formatting styles makes code harder to read and can cause merge conflicts.

**Issues Found:**
- Mix of single/double quotes (mostly consistent, some inconsistencies in injected JS)
- Inconsistent spacing in conditionals
- Some arrow functions, some regular functions
- Inconsistent indentation in some areas

### Implementation Strategy

#### Step 1: Install and Configure Prettier
```bash
npm install --save-dev prettier eslint-config-prettier eslint-plugin-prettier
```

**.prettierrc.json:**
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": false,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf",
  "bracketSpacing": true,
  "jsxBracketSameLine": false
}
```

**.prettierignore:**
```
node_modules/
build/
dist/
.expo/
*.md
package-lock.json
```

#### Step 2: Install and Configure ESLint
```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**.eslintrc.json:**
```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  "plugins": ["@typescript-eslint", "react", "react-hooks", "prettier"],
  "rules": {
    "prettier/prettier": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off"
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
}
```

#### Step 3: Format Entire Codebase
```bash
# Check what would change
npx prettier --check "**/*.{ts,tsx,js,jsx,json}"

# Format all files
npx prettier --write "**/*.{ts,tsx,js,jsx,json}"

# Fix eslint issues
npx eslint --fix "**/*.{ts,tsx}"
```

#### Step 4: Add Scripts to package.json
```json
{
  "scripts": {
    "lint": "eslint . --ext .ts,.tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json}\""
  }
}
```

#### Step 5: Add Pre-commit Hook
```bash
npm install --save-dev husky lint-staged
npx husky install
```

**.husky/pre-commit:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx lint-staged
```

**package.json:**
```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{js,jsx,json}": [
      "prettier --write"
    ]
  }
}
```

### Success Criteria
- [ ] Prettier configured and running
- [ ] ESLint configured with TypeScript support
- [ ] Entire codebase formatted consistently
- [ ] Pre-commit hooks prevent inconsistent code
- [ ] CI checks formatting (if applicable)

---

## Issue #27: TypeScript Configuration Could Be Stricter

### Problem Analysis
Liberal use of `any` suggests TypeScript isn't configured strictly, missing opportunities to catch bugs at compile time.

### Implementation Strategy

#### Step 1: Review Current Configuration
```bash
cat tsconfig.json
```

#### Step 2: Incrementally Enable Strict Mode
Don't enable everything at once - it will be overwhelming.

**Phase 1: Enable Basic Checks**
```json
{
  "compilerOptions": {
    "strict": false,
    "noImplicitAny": true,
    "strictNullChecks": false,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

Fix all errors, then move to Phase 2.

**Phase 2: Enable Strict Null Checks**
```json
{
  "compilerOptions": {
    "strict": false,
    "strictNullChecks": true
  }
}
```

This will find many bugs where code assumes values exist but they might be null/undefined.

**Phase 3: Enable Full Strict Mode**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

#### Step 3: Recommended Full Configuration
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    // Strict Type Checking
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,

    // Additional Checks
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,

    // Module Resolution
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,

    // Output
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

#### Step 4: Fix Common Errors
After enabling strict mode, you'll see errors like:

**Error: Object is possibly 'null'**
```typescript
// Before
const value = map.get(key).value; // Error: map.get() might return undefined

// After
const item = map.get(key);
if (item) {
  const value = item.value;
}
```

**Error: Parameter 'x' implicitly has an 'any' type**
```typescript
// Before
function process(data) { } // Error

// After
function process(data: ProcessData) { }
```

### Success Criteria
- [ ] Strict mode enabled in tsconfig.json
- [ ] No TypeScript errors in codebase
- [ ] No suppressions (// @ts-ignore) except where absolutely necessary
- [ ] CI fails on TypeScript errors

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 days)
1. ✅ Issue #19 (partial): Already fixed host extraction duplication
2. Issue #20: Centralize storage keys (low risk, high impact)
3. Issue #26: Format codebase with Prettier (automated)

### Phase 2: Code Quality (3-5 days)
4. Issue #25: Add documentation to exported functions
5. Issue #22: Replace `any` with proper types
6. Issue #21: Standardize error handling

### Phase 3: Refactoring (5-7 days)
7. Issue #24: Break up long functions
8. Issue #27: Enable TypeScript strict mode incrementally

### Phase 4: Testing (Ongoing)
9. Issue #23: Add unit tests (can be done alongside other work)

---

## Success Metrics

After completing all issues:
- [ ] Code duplication reduced by 60%+
- [ ] All storage keys centralized
- [ ] Consistent error handling across codebase
- [ ] Zero uses of `any` type in lib/ directory
- [ ] 70%+ test coverage on core logic
- [ ] No function over 100 lines
- [ ] All exported functions documented
- [ ] Prettier/ESLint passing on all files
- [ ] TypeScript strict mode enabled

---

## Notes

- These changes don't affect functionality but significantly improve maintainability
- Can be done incrementally without breaking existing features
- Each issue can be tackled independently
- Testing (#23) should be built up as other issues are completed
- Consider creating separate branches for major refactoring work
