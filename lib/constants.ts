/**
 * Timing constants for the application
 * All values in milliseconds unless otherwise specified
 */

// WebView & Injection Timings
export const WEBVIEW_LOAD_TIMEOUT = 1200; // Wait for WebView initial load
export const WEBVIEW_NAVIGATION_DELAY = 500; // Delay before injecting on navigation
export const WEBVIEW_DRAIN_TIMEOUT = 8000; // Max wait for web-assisted drain
export const WEBVIEW_DRAIN_CHECK_INTERVAL = 500; // How often to check drain progress
export const SW_READY_WAIT = 1000; // Wait for Service Worker to be ready
export const SW_DETECTION_DELAY = 3000; // Delay for Service Worker detection warning

// Authentication
export const AUTH_POLLING_INTERVAL = 3000; // How often to check for auth token in WebView
export const AUTH_CAPTURE_TIMEOUT = 30000; // Max wait for auth token capture
export const TOKEN_AVAILABILITY_WAIT = 250; // Wait for token to be available in storage

// Sync & Network
export const SYNC_INTERVAL = 5000; // Background sync interval when online
export const FULL_SYNC_DEBOUNCE = 1000; // Debounce time for full sync triggers
export const NETWORK_RETRY_DELAY = 2000; // Wait before retrying failed network requests
export const NETWORK_TIMEOUT = 30000; // Default network request timeout
export const OUTBOX_LOCK_TIMEOUT = 30000; // Timeout for acquiring outbox lock
export const SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default lookback for incremental sync

// Cache & Storage
export const CACHE_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
export const CACHE_EVICTION_TARGET = 0.9; // Target 90% of max size after eviction
export const CACHE_INDEX_SAVE_DEBOUNCE = 500; // Debounce cache index writes

// UI & UX
export const SEARCH_DEBOUNCE = 300; // Debounce search input
export const TOAST_DURATION = 3000; // Default toast message duration
export const BUTTON_PRESS_FEEDBACK = 100; // Haptic/visual feedback delay

// Outbox & Message Queue
export const OUTBOX_DRAIN_INTERVAL = 2000; // Check outbox drain
export const OUTBOX_MAX_RETRIES = 10; // Max retry attempts for failed messages
export const OUTBOX_ITEM_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_OUTBOX_ITEMS = 1000; // Maximum items per host

// Defaults
export const DEFAULT_LIMIT_CONVERSATIONS = 30;
export const DEFAULT_RPS = 5;

export type SyncMode = "main" | "crawler" | "main+fallback";

export function getSyncMode(): SyncMode {
  const raw = String(process.env.EXPO_PUBLIC_SYNC_MODE || "main+fallback").trim();
  if (raw === "main" || raw === "crawler" || raw === "main+fallback") return raw;
  return "main+fallback";
}
