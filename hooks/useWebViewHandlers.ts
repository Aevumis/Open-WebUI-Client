import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback } from "react";
import { Alert, Platform } from "react-native";
import Toast from "react-native-toast-message";

import { cacheApiResponse, type CachedEntry } from "../lib/cache";
import { getErrorMessage } from "../lib/error-utils";
import { debug as logDebug, info as logInfo } from "../lib/log";
import { count, getToken, removeOutboxItems, setToken } from "../lib/outbox";
import { STORAGE_KEYS } from "../lib/storage-keys";
import { getStorageJSON, removeStorageItem, setStorageJSON } from "../lib/storage-utils";
import { ChatCompletionBody, ConversationData, WebViewMessage } from "../lib/types";

export interface WebViewHandlersContext {
  host: string;
  drainingRef: React.MutableRefObject<boolean>;
  syncingRef: React.MutableRefObject<boolean>;
  onQueueCountChange?: (count: number) => void;
  injectWebDrainBatch: () => Promise<void>;
}

export function useWebViewHandlers(context: WebViewHandlersContext) {
  const { host, drainingRef, syncingRef, onQueueCountChange, injectWebDrainBatch } = context;

  const handleDebug = useCallback((msg: Extract<WebViewMessage, { type: "debug" }>) => {
    logDebug("webview", "debug", msg);
  }, []);

  const handleAuthToken = useCallback(
    async (msg: Extract<WebViewMessage, { type: "authToken" }>) => {
      if (typeof msg.token === "string") {
        await setToken(host, msg.token);
        logInfo("outbox", "token saved for host", { host });
      }
    },
    [host]
  );

  const handleSyncDone = useCallback(
    async (msg: Extract<WebViewMessage, { type: "syncDone" }>) => {
      try {
        await setStorageJSON(STORAGE_KEYS.syncDone(host), Date.now());
        logInfo("sync", "done flag set (webview-assisted)", {
          host,
          conversations: msg.conversations,
          messages: msg.messages,
        });
      } catch (e) {
        logDebug("webview", "handleSyncDone error", { error: getErrorMessage(e) });
      }
      syncingRef.current = false;
    },
    [host, syncingRef]
  );

  const handleQueueMessage = useCallback(
    async (
      msg: Extract<WebViewMessage, { type: "queueMessage" }> & {
        chatId?: string;
        body?: ChatCompletionBody;
      }
    ) => {
      if (msg.chatId && msg.body) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await enqueueWrapper(host, { id, chatId: msg.chatId, body: msg.body });
        const c = await count(host);
        logInfo("outbox", "enqueued", {
          chatId: msg.chatId,
          bodyKeys: Object.keys(msg.body || {}),
          count: c,
        });

        try {
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          } catch (e) {
            logDebug("webview", "haptics error", { error: getErrorMessage(e) });
          }
          Toast.show({ type: "info", text1: "Message queued" });
        } catch (e) {
          logDebug("webview", "handleQueueMessage toast error", { error: getErrorMessage(e) });
        }

        try {
          onQueueCountChange && onQueueCountChange(c);
        } catch (e) {
          logDebug("webview", "onQueueCountChange error", { error: getErrorMessage(e) });
        }
      }
    },
    [host, onQueueCountChange]
  );

  const handleDownloadBlob = useCallback(
    async (msg: Extract<WebViewMessage, { type: "downloadBlob" }>) => {
      if (msg.base64) {
        const filename = msg.filename || "download";
        const uri = FileSystem.documentDirectory + `downloads/` + filename;
        await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + "downloads", {
          intermediates: true,
        }).catch(() => {});
        await FileSystem.writeAsStringAsync(uri, msg.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (Platform.OS === "ios") {
          await Sharing.shareAsync(uri, { mimeType: msg.mime, dialogTitle: filename });
        } else {
          Alert.alert("Downloaded", filename);
        }
      }
    },
    []
  );

  const handleSwStatus = useCallback(
    async (
      msg: Extract<WebViewMessage, { type: "swStatus" }> & {
        hasSW?: boolean;
        swFunctional?: boolean;
        method?: string;
      }
    ) => {
      logInfo("webview", "swStatus", msg);
      try {
        const key = STORAGE_KEYS.swHint(host);
        const pendingKey = STORAGE_KEYS.swHintPending(host);
        const shownCount = await getStorageJSON<number>(key, 0);

        if (msg.method === "unsupported") {
          const existingPending = await getStorageJSON<number | null>(pendingKey, null);
          if (!existingPending) {
            await setStorageJSON(pendingKey, Date.now());
            logInfo("webview", "swUnsupportedPending", { host, delayingWarning: true });
            setTimeout(async () => {
              try {
                const stillPending = await getStorageJSON<number | null>(pendingKey, null);
                if (stillPending) {
                  await removeStorageItem(pendingKey);
                  const currentCount = await getStorageJSON<number>(key, 0);
                  if (currentCount < 2) {
                    await setStorageJSON(key, currentCount + 1);
                    Toast.show({
                      type: "info",
                      text1: "Service Worker not supported",
                      text2: "Your browser may not support Service Workers. Tap to learn more.",
                      onPress: async () => {
                        try {
                          await WebBrowser.openBrowserAsync(
                            "https://github.com/Aevumis/Open-WebUI-Client/tree/main/webui-sw"
                          );
                        } catch {}
                      },
                    });
                  }
                }
              } catch (e) {
                logDebug("webview", "handleSwStatus timeout error", { error: getErrorMessage(e) });
              }
            }, 3000);
          }
          return;
        }

        await removeStorageItem(pendingKey);
        const shouldWarn =
          (!msg.hasSW || (msg.hasSW && msg.swFunctional === false)) && shownCount < 2;

        if (shouldWarn) {
          await setStorageJSON(key, shownCount + 1);
          const warningText = !msg.hasSW
            ? "Service Worker not found on server"
            : "Service Worker found but not working properly";
          Toast.show({
            type: "info",
            text1: "Offline mode not fully enabled",
            text2: `${warningText}. Tap to learn more.`,
            onPress: async () => {
              try {
                await WebBrowser.openBrowserAsync(
                  "https://github.com/Aevumis/Open-WebUI-Client/tree/main/webui-sw"
                );
              } catch {}
            },
          });
        } else if (msg.hasSW && msg.swFunctional !== false) {
          await removeStorageItem(key);
          logInfo("webview", "swWorking", { host, method: msg.method });
        }
      } catch (e) {
        logDebug("webview", "handleSwStatus error", { error: getErrorMessage(e) });
      }
    },
    [host]
  );

  const handleDrainBatchResult = useCallback(
    async (msg: Extract<WebViewMessage, { type: "drainBatchResult" }>) => {
      if (Array.isArray(msg.successIds)) {
        await removeOutboxItems(host, msg.successIds);
        const remaining = await count(host);
        const token = await getToken(host);
        logInfo("webviewDrain", "batch result", { removed: msg.successIds.length, remaining });
        try {
          if (msg.successIds.length > 0) {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            } catch (e) {
              logDebug("webview", "haptics error", { error: getErrorMessage(e) });
            }
            Toast.show({ type: "success", text1: `Sent ${msg.successIds.length} queued` });
          }
        } catch (e) {
          logDebug("webview", "handleDrainBatchResult toast error", { error: getErrorMessage(e) });
        }
        try {
          onQueueCountChange && onQueueCountChange(remaining);
        } catch (e) {
          logDebug("webview", "onQueueCountChange error", { error: getErrorMessage(e) });
        }
        if (!token && remaining > 0) {
          await injectWebDrainBatch();
        } else {
          drainingRef.current = false;
        }
      }
    },
    [host, drainingRef, onQueueCountChange, injectWebDrainBatch]
  );

  const handleDrainBatchError = useCallback(
    (msg: Extract<WebViewMessage, { type: "drainBatchError" }>) => {
      logInfo("webviewDrain", "batch error", { error: msg.error });
      drainingRef.current = false;
    },
    [drainingRef]
  );

  const handleThemeProbe = useCallback((msg: Extract<WebViewMessage, { type: "themeProbe" }>) => {
    if (msg.payload) {
      try {
        logInfo("theme", "probe", msg.payload);
      } catch (e) {
        logDebug("theme", "probe error", { error: getErrorMessage(e) });
      }
    }
  }, []);

  const handleExternalLink = useCallback(
    async (msg: Extract<WebViewMessage, { type: "externalLink" }>) => {
      if (typeof msg.url === "string") {
        await WebBrowser.openBrowserAsync(msg.url);
      }
    },
    []
  );

  const handleCacheResponse = useCallback(
    async (msg: Extract<WebViewMessage, { type: "cacheResponse" }>) => {
      const entry: CachedEntry = {
        url: msg.url,
        capturedAt: Date.now(),
        data: msg.data as ConversationData,
      };
      await cacheApiResponse(host, entry);
    },
    [host]
  );

  return {
    handleDebug,
    handleAuthToken,
    handleSyncDone,
    handleQueueMessage,
    handleDownloadBlob,
    handleSwStatus,
    handleDrainBatchResult,
    handleDrainBatchError,
    handleThemeProbe,
    handleExternalLink,
    handleCacheResponse,
  };
}

// Helper to avoid importing enqueue directly in the hook if not needed, but we do need it
import { enqueue } from "../lib/outbox";
async function enqueueWrapper(host: string, item: any) {
  await enqueue(host, item);
}
