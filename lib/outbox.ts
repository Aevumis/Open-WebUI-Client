import AsyncStorage from "@react-native-async-storage/async-storage";
import { debug as logDebug, info as logInfo, warn as logWarn } from "./log";
import { 
  OUTBOX_LOCK_TIMEOUT, 
  MAX_OUTBOX_ITEMS, 
  OUTBOX_ITEM_TTL, 
  OUTBOX_MAX_RETRIES, 
  DEFAULT_LIMIT_CONVERSATIONS, 
  DEFAULT_RPS 
} from "./constants";
import { safeGetHost } from "./url-utils";

// Mutex implementation to prevent race conditions in outbox operations
// Each host gets its own lock to allow concurrent operations across different hosts
const outboxLocks = new Map<string, Promise<void>>();

/**
 * Acquires an exclusive lock for outbox operations on a specific host.
 * @param host - The host to lock for outbox operations
 * @returns Promise that resolves to a release function when the lock is acquired
 * @throws Error if the lock cannot be acquired within 30 seconds
 */
async function acquireLock(host: string): Promise<() => void> {
  const timeout = OUTBOX_LOCK_TIMEOUT; // 30 seconds to prevent deadlocks

  // Wait for any existing lock on this host
  if (outboxLocks.has(host)) {
    await outboxLocks.get(host);
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = () => {
      outboxLocks.delete(host);
      resolve();
    };
  });

  outboxLocks.set(host, lockPromise);

  // Create timeout promise to prevent deadlocks
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      outboxLocks.delete(host);
      reject(new Error(`Outbox lock timeout for host: ${host}`));
    }, timeout);
  });

  // Return the release function, but ensure we don't timeout while getting it
  return Promise.race([
    Promise.resolve(releaseLock!),
    timeoutPromise
  ]);
}

/**
 * Wraps a function with outbox locking to ensure atomic operations.
 * This prevents race conditions when multiple concurrent operations attempt
 * to read-modify-write the outbox data.
 * @param host - The host to lock for outbox operations
 * @param fn - The async function to execute while holding the lock
 * @returns Promise that resolves with the function's result
 */
async function withOutboxLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const releaseLock = await acquireLock(host);
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

export type OutboxItem = {
  id: string; // local UUID
  chatId: string;
  body: any; // JSON payload for /api/chat/completions
  createdAt: number;
  tries: number;
  lastError?: string;
  // Note: Items have a TTL (7 days) and max retry limit (10 attempts)
};

const TOKEN_KEY = (host: string) => `authToken:${host}`;
const OUTBOX_KEY = (host: string) => `outbox:${host}`;
const SETTINGS_KEY = (host: string) => `server:settings:${host}`;

export type ServerSettings = {
  limitConversations: number; // default 30
  rps: number; // default 5
  fullSyncOnLoad: boolean; // default true
};

export async function getSettings(host: string): Promise<ServerSettings> {
  const defaults: ServerSettings = { limitConversations: DEFAULT_LIMIT_CONVERSATIONS, rps: DEFAULT_RPS, fullSyncOnLoad: true };
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY(host));
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to remain compatible with older stored values
      return { ...defaults, ...parsed } as ServerSettings;
    }
  } catch {}
  return defaults;
}

export async function setSettings(host: string, settings: Partial<ServerSettings>) {
  const current = await getSettings(host);
  const next = { ...current, ...settings };
  await AsyncStorage.setItem(SETTINGS_KEY(host), JSON.stringify(next));
}

export async function setToken(host: string, token: string) {
  await AsyncStorage.setItem(TOKEN_KEY(host), token);
}

export async function getToken(host: string): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY(host));
}

async function getOutbox(host: string): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY(host));
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function setOutbox(host: string, items: OutboxItem[]) {
  await AsyncStorage.setItem(OUTBOX_KEY(host), JSON.stringify(items));
}

/**
 * Cleans up the outbox by removing expired items and items with too many retries.
 * Also enforces maximum item limit by removing oldest items if necessary.
 * @param host - The host to clean up the outbox for
 * @returns Promise that resolves to the count of items removed
 */
async function cleanupOutbox(host: string): Promise<number> {
  return withOutboxLock(host, async () => {
    const list = await getOutbox(host);
    const now = Date.now();

    // Filter out items that are too old or have too many retries
    let filtered = list.filter(item => {
      const isExpired = (now - item.createdAt) > OUTBOX_ITEM_TTL;
      const hasTooManyRetries = item.tries >= OUTBOX_MAX_RETRIES;

      if (isExpired || hasTooManyRetries) {
        if (isExpired) {
          logDebug('outbox', 'removing expired item', {
            id: item.id,
            chatId: item.chatId,
            ageMs: now - item.createdAt,
            maxAgeMs: OUTBOX_ITEM_TTL
          });
        }
        if (hasTooManyRetries) {
          logDebug('outbox', 'removing item with too many retries', {
            id: item.id,
            chatId: item.chatId,
            retries: item.tries,
            maxRetries: OUTBOX_MAX_RETRIES
          });
        }
        return false;
      }
      return true;
    });

    // If we still have too many items, remove the oldest ones
    let removedCount = list.length - filtered.length;
    if (filtered.length > MAX_OUTBOX_ITEMS) {
      const itemsToRemove = filtered.length - MAX_OUTBOX_ITEMS;
      // Sort by creation time (oldest first) and remove excess items
      const sortedByAge = [...filtered].sort((a, b) => a.createdAt - b.createdAt);
      const oldestIds = sortedByAge.slice(0, itemsToRemove).map(item => item.id);

      filtered = filtered.filter(item => !oldestIds.includes(item.id));
      removedCount += itemsToRemove;

      logInfo('outbox', 'removing oldest items due to size limit', {
        host,
        itemsRemoved: itemsToRemove,
        totalItems: MAX_OUTBOX_ITEMS,
        oldestItemAge: now - sortedByAge[0].createdAt
      });
    }

    // Write back the cleaned outbox if anything was removed
    if (removedCount > 0) {
      await setOutbox(host, filtered);
      logInfo('outbox', 'cleanup completed', {
        host,
        itemsRemoved: removedCount,
        originalCount: list.length,
        finalCount: filtered.length
      });
    }

    return removedCount;
  });
}

// Expose read-only snapshot for external drains (e.g., WebView-assisted)
export async function listOutbox(host: string): Promise<OutboxItem[]> {
  return getOutbox(host);
}

// Remove specific items by id after successful send
export async function removeOutboxItems(host: string, ids: string[]) {
  return withOutboxLock(host, async () => {
    const list = await getOutbox(host);
    const next = list.filter((it) => !ids.includes(it.id));
    await setOutbox(host, next);
  });
}

export async function enqueue(host: string, item: Omit<OutboxItem, "tries" | "createdAt">) {
  return withOutboxLock(host, async () => {
    const list = await getOutbox(host);
    const next: OutboxItem = { ...item, tries: 0, createdAt: Date.now() };
    list.push(next);
    await setOutbox(host, list);

    // Clean up old/failed items after adding the new one
    const removedCount = await cleanupOutbox(host);
    if (removedCount > 0) {
      logDebug('outbox', 'cleanup after enqueue', {
        host,
        itemsRemoved: removedCount,
        newId: next.id
      });
    }
  });
}

export async function count(host: string) {
  return withOutboxLock(host, async () => {
    const list = await getOutbox(host);
    return list.length;
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function drain(baseUrl: string): Promise<{ sent: number; remaining: number }> {
  const host = safeGetHost(baseUrl);
  if (!host) {
    logInfo('outbox', 'drain invalid url', { baseUrl });
    return { sent: 0, remaining: 0 };
  }

  return withOutboxLock(host, async () => {
    // Clean up old/failed items before processing
    const removedCount = await cleanupOutbox(host);
    if (removedCount > 0) {
      logInfo('outbox', 'cleanup before drain', {
        host,
        itemsRemoved: removedCount
      });
    }

    const token = await getToken(host);
    if (!token) {
      logInfo('outbox', 'drain no token, abort', { host });
      return { sent: 0, remaining: (await getOutbox(host)).length };
    }

    let list = await getOutbox(host);
    if (!list.length) return { sent: 0, remaining: 0 };

    const { rps } = await getSettings(host);
    const minInterval = Math.max(0, Math.floor(1000 / Math.max(1, rps)));

    let sent = 0;
    const serviceUrl = `${baseUrl.replace(/\/$/, "")}/api/chat/completions`;
    logInfo('outbox', 'drain start', { host, serviceUrl, tokenPresent: !!token, initial: list.length, rps });

    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      try {
        const res = await fetch(serviceUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Use Bearer token authentication only - this is the secure method
            // Bearer tokens are sent in the Authorization header, not exposed in cookies
            authorization: `Bearer ${token}`,
            referer: `${baseUrl.replace(/\/$/, "")}/c/${it.chatId}`,
          },
          body: JSON.stringify(it.body),
        });

        if (res.ok) {
          sent++;
          // remove from list
          list.splice(i, 1);
          i--;
          await setOutbox(host, list);
          logDebug('outbox', 'sent', { id: it.id, chatId: it.chatId, status: res.status });
        } else if (res.status === 401) {
          // auth invalid; stop draining
          logWarn('outbox', 'unauthorized (401), stopping');
          throw new Error(`Unauthorized (401)`);
        } else {
          // keep for retry
          it.tries += 1;
          it.lastError = `HTTP ${res.status}`;
          await setOutbox(host, list);
          logDebug('outbox', 'keep for retry', { id: it.id, chatId: it.chatId, status: res.status });
        }
      } catch (e: any) {
        // network or auth error; keep and stop early
        it.tries += 1;
        it.lastError = e?.message || String(e);
        await setOutbox(host, list);
        logWarn('outbox', 'error', { id: it.id, chatId: it.chatId, error: it.lastError });
        break;
      }
      if (minInterval) await sleep(minInterval);
    }

    const remaining = (await getOutbox(host)).length;
    logInfo('outbox', 'drain done', { sent, remaining });
    return { sent, remaining };
  });
}
