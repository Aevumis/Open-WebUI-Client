import * as FileSystem from "expo-file-system";
import { CACHE_MAX_SIZE_BYTES, CACHE_EVICTION_TARGET } from "./constants";
import { safeParseUrl } from "./url-utils";

export type CachedEntry = {
  url: string;
  capturedAt: number;
  data: any; // JSON from API
  title?: string;
};

export type CacheIndexItem = {
  key: string; // host/id
  id: string;
  host: string;
  lastAccess: number;
  size: number;
  title?: string;
};

const ROOT = FileSystem.documentDirectory + "openwebui-cache/";
const INDEX_PATH = ROOT + "index.json";

let evictionInProgress = false;

async function ensureDir(path: string) {
  await FileSystem.makeDirectoryAsync(path, { intermediates: true }).catch(() => {});
}

async function readJSON<T>(path: string): Promise<T | null> {
  try {
    const s = await FileSystem.readAsStringAsync(path);
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

async function writeJSON(path: string, value: any) {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
}

function entryPath(host: string, id: string) {
  return `${ROOT}${host}/conversations/${id}.json`;
}

function parseIdFromUrl(url: string) {
  const u = safeParseUrl(url);
  if (u) {
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => /(conversation|conversations|chat|thread|messages)/i.test(p));
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  return String(Math.random()).slice(2);
}

export async function cacheApiResponse(host: string, entry: CachedEntry) {
  const id = parseIdFromUrl(entry.url);
  const path = entryPath(host, id);
  const dir = path.slice(0, path.lastIndexOf('/'));
  await ensureDir(dir);
  await writeJSON(path, entry);
  await touchIndex(host, id, entry.title);
  await enforceLimit();
}

export async function readCachedEntry(host: string, id: string): Promise<CachedEntry | null> {
  const path = entryPath(host, id);
  const data = await readJSON<CachedEntry>(path);
  return data;
}

export async function getCacheIndex(): Promise<CacheIndexItem[]> {
  const idx = (await readJSON<Record<string, CacheIndexItem>>(INDEX_PATH)) || {};
  return Object.values(idx).sort((a, b) => b.lastAccess - a.lastAccess);
}

/**
 * Recalculates the total cache size by checking the actual file system.
 * Removes index entries for files that no longer exist.
 * @returns Promise resolving to the actual total size in bytes
 */
export async function recalculateSize(): Promise<number> {
  const idx = (await readJSON<Record<string, CacheIndexItem>>(INDEX_PATH)) || {};
  let actualSize = 0;
  let changed = false;

  for (const [key, meta] of Object.entries(idx)) {
    try {
      const info = await FileSystem.getInfoAsync(entryPath(meta.host, meta.id));
      if (info.exists) {
        if (info.size !== meta.size) {
          meta.size = info.size || 0;
          changed = true;
        }
        actualSize += meta.size;
      } else {
        // File missing, remove from index
        delete idx[key];
        changed = true;
      }
    } catch {
      // Skip error checking for individual files
    }
  }

  if (changed) {
    await writeJSON(INDEX_PATH, idx);
  }
  return actualSize;
}

async function touchIndex(host: string, id: string, title?: string) {
  const key = `${host}/${id}`;
  const idx = (await readJSON<Record<string, CacheIndexItem>>(INDEX_PATH)) || {};
  const stat = await FileSystem.getInfoAsync(entryPath(host, id));
  const size = stat.exists ? stat.size ?? 0 : 0;
  idx[key] = {
    key,
    id,
    host,
    lastAccess: Date.now(),
    size,
    title: title || idx[key]?.title,
  };
  await ensureDir(ROOT);
  await writeJSON(INDEX_PATH, idx);
}

async function totalSize(idx: Record<string, CacheIndexItem>) {
  return Object.values(idx).reduce((sum, it) => sum + (it.size || 0), 0);
}

async function enforceLimit() {
  if (evictionInProgress) return;
  evictionInProgress = true;
  try {
    const idx = (await readJSON<Record<string, CacheIndexItem>>(INDEX_PATH)) || {};
    let size = await totalSize(idx);
    if (size <= CACHE_MAX_SIZE_BYTES) return;

    // LRU eviction
    const items = Object.values(idx).sort((a, b) => a.lastAccess - b.lastAccess);
    const targetSize = CACHE_MAX_SIZE_BYTES * CACHE_EVICTION_TARGET;

    for (const it of items) {
      if (size <= targetSize) break;
      try {
        await FileSystem.deleteAsync(entryPath(it.host, it.id), { idempotent: true });
        size -= it.size || 0;
        delete idx[it.key];
      } catch {
        // Continue with next file if deletion fails
      }
    }
    await writeJSON(INDEX_PATH, idx);
  } finally {
    evictionInProgress = false;
  }
}
