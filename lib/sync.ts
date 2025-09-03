import AsyncStorage from "@react-native-async-storage/async-storage";
import { cacheApiResponse } from "./cache";
import { getSettings, getToken } from "./outbox";
import { debug as logDebug, info as logInfo } from "./log";

const SYNC_DONE = (host: string) => `sync:done:${host}`;

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
    await AsyncStorage.setItem(SYNC_DONE(host), String(Date.now()));
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

export async function maybeFullSync(baseUrl: string) {
  const done = await isFullSyncDone(baseUrl);
  if (done) return null;
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
