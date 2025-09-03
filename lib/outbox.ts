import AsyncStorage from "@react-native-async-storage/async-storage";

export type OutboxItem = {
  id: string; // local UUID
  chatId: string;
  body: any; // JSON payload for /api/chat/completions
  createdAt: number;
  tries: number;
  lastError?: string;
};

const TOKEN_KEY = (host: string) => `authToken:${host}`;
const OUTBOX_KEY = (host: string) => `outbox:${host}`;
const SETTINGS_KEY = (host: string) => `server:settings:${host}`;

export type ServerSettings = {
  limitConversations: number; // default 30
  rps: number; // default 5
};

export async function getSettings(host: string): Promise<ServerSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY(host));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { limitConversations: 30, rps: 5 };
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

// Expose read-only snapshot for external drains (e.g., WebView-assisted)
export async function listOutbox(host: string): Promise<OutboxItem[]> {
  return getOutbox(host);
}

// Remove specific items by id after successful send
export async function removeOutboxItems(host: string, ids: string[]) {
  const list = await getOutbox(host);
  const next = list.filter((it) => !ids.includes(it.id));
  await setOutbox(host, next);
}

export async function enqueue(host: string, item: Omit<OutboxItem, "tries" | "createdAt">) {
  const list = await getOutbox(host);
  const next: OutboxItem = { ...item, tries: 0, createdAt: Date.now() };
  list.push(next);
  await setOutbox(host, list);
}

export async function count(host: string) {
  const list = await getOutbox(host);
  return list.length;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function drain(baseUrl: string): Promise<{ sent: number; remaining: number }> {
  const host = new URL(baseUrl).host;
  const token = await getToken(host);
  if (!token) {
    try { console.log('[outbox][drain] no token, abort', { host }); } catch {}
    return { sent: 0, remaining: (await getOutbox(host)).length };
  }

  let list = await getOutbox(host);
  if (!list.length) return { sent: 0, remaining: 0 };

  const { rps } = await getSettings(host);
  const minInterval = Math.max(0, Math.floor(1000 / Math.max(1, rps)));

  let sent = 0;
  const serviceUrl = `${baseUrl.replace(/\/$/, "")}/api/chat/completions`;
  try { console.log('[outbox][drain] start', { host, serviceUrl, tokenPresent: !!token, initial: list.length, rps }); } catch {}

  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    try {
      const res = await fetch(serviceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          // Also send cookie for servers that rely on cookie-based auth (e.g., authjs.session-token)
          cookie: `authjs.session-token=${token}; token=${token}`,
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
        try { console.log('[outbox][drain] sent', { id: it.id, chatId: it.chatId, status: res.status }); } catch {}
      } else if (res.status === 401) {
        // auth invalid; stop draining
        try { console.log('[outbox][drain] unauthorized (401), stopping'); } catch {}
        throw new Error(`Unauthorized (401)`);
      } else {
        // keep for retry
        it.tries += 1;
        it.lastError = `HTTP ${res.status}`;
        await setOutbox(host, list);
        try { console.log('[outbox][drain] keep for retry', { id: it.id, chatId: it.chatId, status: res.status }); } catch {}
      }
    } catch (e: any) {
      // network or auth error; keep and stop early
      it.tries += 1;
      it.lastError = e?.message || String(e);
      await setOutbox(host, list);
      try { console.log('[outbox][drain] error', { id: it.id, chatId: it.chatId, error: it.lastError }); } catch {}
      break;
    }
    if (minInterval) await sleep(minInterval);
  }

  const remaining = (await getOutbox(host)).length;
  try { console.log('[outbox][drain] done', { sent, remaining }); } catch {}
  return { sent, remaining };
}
