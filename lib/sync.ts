import AsyncStorage from "@react-native-async-storage/async-storage";
import { cacheApiResponse } from "./cache";
import { getSettings, getToken } from "./outbox";
import { debug as logDebug, info as logInfo } from "./log";

const SYNC_DONE = (host: string) => `sync:done:${host}`;
const LAST_SYNC_TIME = (host: string) => `sync:lastTime:${host}`;
const SYNC_VERSION = (host: string) => `sync:version:${host}`;

async function fetchJSON(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      // Fallback for cookie-based auth servers (e.g., authjs.session-token)
      cookie: `authjs.session-token=${token}; token=${token}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fullSync(baseUrl: string): Promise<{ conversations: number; messages: number }> {
  const host = new URL(baseUrl).host;
  const token = await getToken(host);
  logInfo('sync', 'fullSync start', { host, baseUrl, tokenPresent: !!token });
  if (!token) throw new Error("No auth token captured yet");

  const { limitConversations, rps } = await getSettings(host);
  logDebug('sync', 'settings', { limitConversations, rps });
  const minInterval = Math.max(0, Math.floor(1000 / Math.max(1, rps)));

  // 1) Fetch conversations, paginated by page=? until reaching limitConversations
  let page = 1;
  const chats: { id: string; title?: string; updated_at?: number; created_at?: number }[] = [];
  while (chats.length < limitConversations) {
    const listUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/chats/?page=${page}`;
    logDebug('sync', 'list fetch', { url: listUrl, page });
    const data = await fetchJSON(listUrl, token);
    logDebug('sync', 'list result', { page, length: Array.isArray(data) ? data.length : -1 });
    if (!Array.isArray(data) || data.length === 0) break;
    for (const it of data) {
      chats.push({ id: it.id, title: it.title, updated_at: it.updated_at, created_at: it.created_at });
      if (chats.length >= limitConversations) break;
    }
    logDebug('sync', 'list page summary', { page, totalSoFar: chats.length });
    page += 1;
    if (minInterval) await new Promise((r) => setTimeout(r, minInterval));
  }

  // 2) Fetch each conversation payload and cache it
  let messagesCount = 0;
  for (const c of chats) {
    const convoUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/chats/${c.id}`;
    try {
      logDebug('sync', 'chat fetch', { url: convoUrl, id: c.id });
      const data = await fetchJSON(convoUrl, token);
      if (data && data.archived === true) {
        // Ignore archived per requirement
        logDebug('sync', 'chat skip archived', { id: c.id });
        continue;
      }
      await cacheApiResponse(host, {
        url: convoUrl,
        capturedAt: Date.now(),
        data,
        title: c.title,
      });
      const mcount = Array.isArray(data?.chat?.messages) ? data.chat.messages.length : (Array.isArray(data?.messages) ? data.messages.length : 0);
      messagesCount += mcount;
      logDebug('sync', 'chat ok', { id: c.id, title: c.title, messages: mcount });
    } catch (e) {
      // continue on individual failures
      logDebug('sync', 'chat error', { url: convoUrl, id: c.id, error: (e as any)?.message || String(e) });
    }
    if (minInterval) await new Promise((r) => setTimeout(r, minInterval));
  }

  if (chats.length > 0) {
    const now = Date.now();
    await AsyncStorage.setItem(SYNC_DONE(host), String(now));
    await AsyncStorage.setItem(LAST_SYNC_TIME(host), String(now));
    await AsyncStorage.setItem(SYNC_VERSION(host), '1'); // Version for future migration
    logInfo('sync', 'done flag set', { host, conversations: chats.length, messages: messagesCount });
  } else {
    logDebug('sync', 'done flag NOT set (no conversations fetched)');
  }
  return { conversations: chats.length, messages: messagesCount };
}

export async function isFullSyncDone(baseUrl: string) {
  const host = new URL(baseUrl).host;
  return !!(await AsyncStorage.getItem(SYNC_DONE(host)));
}

export async function incrementalSync(baseUrl: string): Promise<{ conversations: number; messages: number } | null> {
  const host = new URL(baseUrl).host;
  const token = await getToken(host);
  logInfo('sync', 'incrementalSync start', { host, baseUrl, tokenPresent: !!token });
  if (!token) throw new Error("No auth token captured yet");

  const { limitConversations, rps } = await getSettings(host);
  logDebug('sync', 'incremental settings', { limitConversations, rps });
  const minInterval = Math.max(0, Math.floor(1000 / Math.max(1, rps)));

  const lastSyncTime = parseInt(await AsyncStorage.getItem(LAST_SYNC_TIME(host)) || '0');
  const cutoffTime = lastSyncTime || (Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago if no previous sync

  // Fetch conversations, looking for new/updated ones
  let page = 1;
  const newChats: { id: string; title?: string; updated_at?: number; created_at?: number }[] = [];
  let foundOldChat = false;

  while (newChats.length < limitConversations && !foundOldChat) {
    const listUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/chats/?page=${page}`;
    logDebug('sync', 'incremental list fetch', { url: listUrl, page });
    const data = await fetchJSON(listUrl, token);
    logDebug('sync', 'incremental list result', { page, length: Array.isArray(data) ? data.length : -1 });
    
    if (!Array.isArray(data) || data.length === 0) break;
    
    for (const it of data) {
      const chatTime = Math.max(it.updated_at || 0, it.created_at || 0);
      if (chatTime > cutoffTime) {
        newChats.push({ id: it.id, title: it.title, updated_at: it.updated_at, created_at: it.created_at });
      } else {
        foundOldChat = true;
        break;
      }
      if (newChats.length >= limitConversations) break;
    }
    
    logDebug('sync', 'incremental page summary', { page, newSoFar: newChats.length, foundOldChat });
    page += 1;
    if (minInterval) await new Promise((r) => setTimeout(r, minInterval));
  }

  // Fetch each new/updated conversation
  let messagesCount = 0;
  for (const c of newChats) {
    const convoUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/chats/${c.id}`;
    try {
      logDebug('sync', 'incremental chat fetch', { url: convoUrl, id: c.id });
      const data = await fetchJSON(convoUrl, token);
      if (data && data.archived === true) {
        logDebug('sync', 'incremental chat skip archived', { id: c.id });
        continue;
      }
      await cacheApiResponse(host, {
        url: convoUrl,
        capturedAt: Date.now(),
        data,
        title: c.title,
      });
      const mcount = Array.isArray(data?.chat?.messages) ? data.chat.messages.length : (Array.isArray(data?.messages) ? data.messages.length : 0);
      messagesCount += mcount;
      logDebug('sync', 'incremental chat ok', { id: c.id, title: c.title, messages: mcount });
    } catch (e) {
      logDebug('sync', 'incremental chat error', { url: convoUrl, id: c.id, error: (e as any)?.message || String(e) });
    }
    if (minInterval) await new Promise((r) => setTimeout(r, minInterval));
  }

  if (newChats.length > 0) {
    const now = Date.now();
    await AsyncStorage.setItem(LAST_SYNC_TIME(host), String(now));
    logInfo('sync', 'incremental sync complete', { host, newConversations: newChats.length, messages: messagesCount });
  } else {
    logInfo('sync', 'incremental sync: no new conversations', { host });
  }

  return { conversations: newChats.length, messages: messagesCount };
}

export async function forceSyncReset(baseUrl: string) {
  const host = new URL(baseUrl).host;
  await AsyncStorage.removeItem(SYNC_DONE(host));
  await AsyncStorage.removeItem(LAST_SYNC_TIME(host));
  logInfo('sync', 'force reset sync flags', { host });
}

export async function manualSync(baseUrl: string, forceFullSync = false): Promise<{ conversations: number; messages: number } | null> {
  const host = new URL(baseUrl).host;
  const token = await getToken(host);
  if (!token) {
    logInfo('sync', 'manualSync: no token available', { host });
    return null;
  }

  try {
    if (forceFullSync) {
      await forceSyncReset(baseUrl);
      return await fullSync(baseUrl);
    } else {
      const done = await isFullSyncDone(baseUrl);
      if (done) {
        return await incrementalSync(baseUrl);
      } else {
        return await fullSync(baseUrl);
      }
    }
  } catch (e) {
    logInfo('sync', 'manualSync error', { error: (e as any)?.message || String(e) });
    return null;
  }
}

export async function maybeFullSync(baseUrl: string) {
  const done = await isFullSyncDone(baseUrl);
  if (done) {
    // If full sync is done, try incremental sync instead
    const host = new URL(baseUrl).host;
    const token = await getToken(host);
    if (!token) {
      logDebug('sync', 'maybeFullSync: done, but no token for incremental', { host });
      return null;
    }
    try {
      return await incrementalSync(baseUrl);
    } catch (e) {
      logDebug('sync', 'incremental sync error, will retry later', { error: (e as any)?.message || String(e) });
      return null;
    }
  }
  
  const host = new URL(baseUrl).host;
  // Wait briefly for token to arrive from WebView if not present yet
  let token = await getToken(host);
  let tries = 0;
  while (!token && tries < 20) { // up to ~5s @250ms
    await new Promise((r) => setTimeout(r, 250));
    token = await getToken(host);
    tries++;
  }
  if (!token) {
    logDebug('sync', 'maybeFullSync: no token yet, skipping for now', { host });
    return null;
  }
  try {
    return await fullSync(baseUrl);
  } catch (e) {
    logDebug('sync', 'maybeFullSync error', { error: (e as any)?.message || String(e) });
    return null;
  }
}
