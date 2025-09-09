# Code Structure Guide

This document provides a comprehensive overview of the Open WebUI Client codebase architecture, designed to help new developers and AI models understand the project structure and contribute effectively.

## Project Overview

Open WebUI Client is a React Native/Expo application that provides a native mobile interface for Open WebUI instances with advanced offline capabilities. The app uses a WebView to embed the web interface while adding native features like message queueing, conversation caching, and multi-server management.

## Architecture Patterns

### Core Design Principles
- **WebView-First**: The app embeds Open WebUI in a WebView and enhances it with native capabilities
- **Offline-First**: All features are designed to work offline with automatic sync when online
- **Multi-Server**: Support for multiple Open WebUI instances with per-server settings
- **Performance-Conscious**: Intelligent caching, rate limiting, and background processing

### Key Technologies
- **React Native + Expo**: Cross-platform mobile development
- **Expo Router**: File-based routing system
- **AsyncStorage**: Local data persistence
- **WebView**: Embedding web content with JavaScript injection
- **FileSystem**: Local file management for caching

## Directory Structure

```
├── app/                    # Main application screens (Expo Router)
│   ├── _layout.tsx        # Root layout with global providers
│   ├── index.tsx          # Entry point (redirects to servers)
│   ├── servers.tsx        # Server management screen
│   ├── client.tsx         # Main WebView client screen
│   ├── offline.tsx        # Offline conversation browser
│   └── offline/
│       └── view.tsx       # Individual conversation viewer
├── components/            # Reusable UI components
│   └── OpenWebUIView.tsx  # Main WebView component with injections
├── lib/                   # Core business logic
│   ├── cache.ts          # Conversation caching system
│   ├── outbox.ts         # Message queueing and sending
│   ├── sync.ts           # Background synchronization
│   ├── storage.ts        # AsyncStorage utilities
│   └── log.ts            # Scoped logging system
├── types/                 # TypeScript type definitions
├── assets/               # Static assets (images, icons)
├── webui-sw/             # Service Worker for in-WebView offline support
└── [config files]        # Expo, TypeScript, ESLint configuration
```

## Core Components Deep Dive

### 1. App Screens (`app/`)

#### `_layout.tsx` - Root Layout
- Sets up global providers (SafeAreaProvider, Toast)
- Configures logging levels and scopes
- Provides app-wide theme and navigation context

#### `servers.tsx` - Server Management
- **Purpose**: Manage multiple Open WebUI server instances
- **Key Features**:
  - Add/edit/delete server configurations
  - Per-server settings (sync limits, rate limiting)
  - Server validation and URL normalization
- **Storage**: Uses `servers:list` and `servers:active` AsyncStorage keys

#### `client.tsx` - Main Client Screen
- **Purpose**: Primary interface showing the WebView with native enhancements
- **Key Features**:
  - Network status monitoring
  - Automatic sync and outbox draining
  - Queue count display
  - Navigation to offline mode
- **Integration**: Orchestrates sync, outbox, and WebView components

#### `offline.tsx` - Offline Browser
- **Purpose**: Browse cached conversations when offline
- **Key Features**:
  - Filter by server/host
  - Search conversations by title
  - Display conversation metadata
  - Navigate to individual conversation views

#### `offline/view.tsx` - Conversation Viewer
- **Purpose**: Display individual cached conversations
- **Key Features**:
  - Markdown rendering with syntax highlighting
  - Message threading (follows conversation branches)
  - Share conversation transcripts
  - Expandable long messages

### 2. Core Component (`components/`)

#### `OpenWebUIView.tsx` - WebView Integration
This is the heart of the application, handling the complex WebView integration:

**JavaScript Injection System**:
- **Theme Bootstrap**: Syncs device dark/light mode with web interface
- **Main Injection**: Comprehensive script that:
  - Intercepts fetch requests for message queueing
  - Captures authentication tokens from cookies/headers
  - Handles offline message composition
  - Manages Service Worker registration
  - Provides download handling

**Message Handling**:
- Processes messages from injected JavaScript
- Handles authentication token capture
- Manages offline message queueing
- Coordinates with native caching system

**Key Methods**:
- `buildInjection()`: Creates the main JavaScript injection
- `buildThemeBootstrap()`: Handles theme synchronization
- `onMessage()`: Processes WebView messages
- `injectWebDrainBatch()`: WebView-assisted message sending

### 3. Business Logic (`lib/`)

#### `cache.ts` - Conversation Caching
- **Purpose**: Local storage of conversation data for offline access
- **Features**:
  - LRU (Least Recently Used) eviction policy
  - 100MB storage limit with automatic cleanup
  - Conversation indexing and metadata
  - File-based storage using Expo FileSystem

**Key Functions**:
- `cacheApiResponse()`: Store conversation data
- `readCachedEntry()`: Retrieve cached conversation
- `getCacheIndex()`: Get list of all cached conversations
- `enforceLimit()`: Automatic cache cleanup

#### `outbox.ts` - Message Queue Management
- **Purpose**: Queue and retry message sending when offline
- **Features**:
  - Persistent message queue per server
  - Automatic retry with exponential backoff
  - Rate limiting to respect server constraints
  - Token-based authentication

**Key Functions**:
- `enqueue()`: Add message to queue
- `drain()`: Send all queued messages
- `count()`: Get queue size
- `getSettings()`/`setSettings()`: Per-server configuration

#### `sync.ts` - Background Synchronization
- **Purpose**: Download and cache conversations from servers
- **Features**:
  - Paginated conversation fetching
  - Configurable conversation limits
  - Rate-limited requests
  - Incremental sync support

**Key Functions**:
- `fullSync()`: Complete conversation download
- `maybeFullSync()`: Conditional sync based on settings
- `isFullSyncDone()`: Check sync status

#### `log.ts` - Logging System
- **Purpose**: Scoped, configurable logging for debugging
- **Features**:
  - Log level filtering (error, warn, info, debug)
  - Scope-based filtering (sync, outbox, webview, etc.)
  - Development vs production configurations

### 4. Service Worker (`webui-sw/`)

Optional enhancement for in-WebView offline support:
- **`sw.js`**: Service Worker for caching web assets and API responses
- **`offline.html`**: Fallback page for offline navigation
- **`README.md`**: Deployment instructions for various hosting setups

## Data Flow Architecture

### 1. Authentication Flow
```
WebView → JavaScript Injection → Token Capture → AsyncStorage
                ↓
        Native API Calls (with token)
```

### 2. Message Sending Flow
```
Online:  WebView → Direct API Call → Success
Offline: WebView → JavaScript Injection → Native Queue → Retry when online
```

### 3. Conversation Caching Flow
```
API Response → JavaScript Injection → Native Cache → FileSystem Storage
                                           ↓
                                    Index Update → LRU Management
```

### 4. Sync Process Flow
```
App Launch → Check Sync Status → Fetch Conversations → Cache Locally
     ↓              ↓                    ↓                ↓
Network Check → Token Wait → Rate Limited Requests → Update Index
```

## Key Integration Points

### WebView ↔ Native Communication
- **Message Types**: Authentication, queueing, caching, debugging, downloads
- **Injection Points**: Document start, load end, navigation changes
- **Error Handling**: Graceful fallbacks for injection failures

### Storage Strategy
- **AsyncStorage**: Configuration, tokens, queues, sync status
- **FileSystem**: Large conversation data, downloads
- **Memory**: Temporary state, UI data

### Network Handling
- **Online Detection**: NetInfo integration with WebView awareness
- **Retry Logic**: Exponential backoff for failed requests
- **Rate Limiting**: Configurable per-server request throttling

## Development Guidelines

### Adding New Features

1. **Screen Addition**: Create new file in `app/` directory (Expo Router auto-routing)
2. **Business Logic**: Add to appropriate `lib/` module or create new one
3. **WebView Integration**: Extend injection scripts in `OpenWebUIView.tsx`
4. **Storage**: Use existing patterns in `storage.ts` or extend as needed

### Testing Strategy

- **Unit Tests**: Focus on `lib/` modules (pure functions)
- **Integration Tests**: WebView message handling and storage operations
- **E2E Tests**: Critical user flows (add server, send message, offline access)

### Performance Considerations

- **Memory Management**: Large conversations are file-cached, not kept in memory
- **Background Processing**: Sync and queue operations are non-blocking
- **WebView Optimization**: Minimal injection payload, efficient message passing

### Debugging Tools

- **Logging System**: Use scoped loggers with configurable verbosity
- **WebView Debugging**: Enable remote debugging for injected JavaScript
- **Storage Inspection**: AsyncStorage and FileSystem debugging utilities

## Common Patterns

### Error Handling
```typescript
try {
  // Operation
} catch (error) {
  logWarn('scope', 'operation failed', { error: String(error) });
  // Graceful fallback
}
```

### Async Storage Operations
```typescript
const data = await getJSON<Type>('key');
await setJSON('key', newData);
```

### WebView Message Handling
```typescript
const onMessage = useCallback(async (e: WebViewMessageEvent) => {
  const msg = JSON.parse(e.nativeEvent.data || '{}');
  switch (msg.type) {
    case 'messageType':
      // Handle message
      break;
  }
}, [dependencies]);
```

This architecture enables a robust, offline-capable mobile client that seamlessly integrates with Open WebUI while providing native mobile enhancements and reliable offline functionality.