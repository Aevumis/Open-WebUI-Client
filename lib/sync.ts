import AsyncStorage from "@react-native-async-storage/async-storage";
import { cacheApiResponse } from "./cache";
import { getSettings, getToken } from "./outbox";

const SYNC_DONE = (host: string) => `sync:done:${host}`;

async function fetchJSON(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fullSync(baseUrl: string): Promise<{ conversations: number; messages: number }> {
  const host = new URL(baseUrl).host;
  const token = await getToken(host);
  if (!token) throw new Error("No auth token captured yet");

  const { limitConversations, rps } = await getSettings(host);
  const minInterval = Math.max(0, Math.floor(1000 / Math.max(1, rps)));

  // 1) Fetch conversations, paginated by page=? until reaching limitConversations
  let page = 1;
  const chats: { id: string; title?: string; updated_at?: number; created_at?: number }[] = [];
  while (chats.length < limitConversations) {
    const listUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/chats/?page=${page}`;
    const data = await fetchJSON(listUrl, token);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const it of data) {
      chats.push({ id: it.id, title: it.title, updated_at: it.updated_at, created_at: it.created_at });
      if (chats.length >= limitConversations) break;
    }
    page += 1;
    if (minInterval) await new Promise((r) => setTimeout(r, minInterval));
  }

  // 2) Fetch each conversation payload and cache it
  let messagesCount = 0;
  for (const c of chats) {
    const convoUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/chats/${c.id}`;
    try {
      const data = await fetchJSON(convoUrl, token);
      if (data && data.archived === true) {
        // Ignore archived per requirement
        continue;
      }
      await cacheApiResponse(host, {
        url: convoUrl,
        capturedAt: Date.now(),
        data,
        title: c.title,
      });
      messagesCount += Array.isArray(data?.chat?.messages) ? data.chat.messages.length : (Array.isArray(data?.messages) ? data.messages.length : 0);
    } catch (e) {
      // continue on individual failures
    }
    if (minInterval) await new Promise((r) => setTimeout(r, minInterval));
  }

  await AsyncStorage.setItem(SYNC_DONE(host), String(Date.now()));
  return { conversations: chats.length, messages: messagesCount };
}

export async function isFullSyncDone(baseUrl: string) {
  const host = new URL(baseUrl).host;
  return !!(await AsyncStorage.getItem(SYNC_DONE(host)));
}

export async function maybeFullSync(baseUrl: string) {
  const done = await isFullSyncDone(baseUrl);
  if (done) return null;
  try {
    return await fullSync(baseUrl);
  } catch {
    return null;
  }
}
