/**
 * Centralized storage keys for AsyncStorage
 * All keys should be defined here to prevent typos and ensure consistency
 */

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
