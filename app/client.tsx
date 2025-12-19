import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import OpenWebUIView from "../components/OpenWebUIView";
import { getCacheIndex } from "../lib/cache";
import { getSyncMode, SYNC_INTERVAL } from "../lib/constants";
import { getErrorMessage } from "../lib/error-utils";
import { debug as logDebug, info as logInfo } from "../lib/log";
import { count, drain, getSettings } from "../lib/outbox";
import { STORAGE_KEYS } from "../lib/storage-keys";
import { getStorageJSON } from "../lib/storage-utils";
import { isFullSyncDone, maybeFullSync } from "../lib/sync";
import { ServerItem } from "../lib/types";
import { safeGetHost } from "../lib/url-utils";

export default function ClientScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const syncMode = getSyncMode();
  const [url, setUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [isOnline, setIsOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<"checking" | "syncing" | "done" | "disabled">(
    "checking"
  );
  const scheme = useColorScheme();
  const C =
    scheme === "dark"
      ? {
          bg: "#0b0b0b",
          cardBg: "#111111",
          text: "#e5e7eb",
          textStrong: "#ffffff",
          separator: "#27272a",
          primary: "#4fb3d9",
          textOnPrimary: "#ffffff",
        }
      : {
          bg: "#ffffff",
          cardBg: "#ffffff",
          text: "#111827",
          textStrong: "#000000",
          separator: "#eeeeee",
          primary: "#0a7ea4",
          textOnPrimary: "#ffffff",
        };

  useEffect(() => {
    try {
      logInfo("sync", "mode", { mode: syncMode });
    } catch {}
    const sub = NetInfo.addEventListener((state: NetInfoState) => {
      const next = state.isInternetReachable ?? !!state.isConnected;
      logDebug("net", "change", {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        effectiveOnline: next,
      });
      setIsOnline(next);
    });
    return () => sub();
  }, []);

  useEffect(() => {
    (async () => {
      const list = await getStorageJSON<ServerItem[]>(STORAGE_KEYS.SERVERS_LIST, []);
      const s = list.find((x) => x.id === params.id);
      if (!s) {
        Alert.alert("Server not found", "Please select a server again.");
        router.replace("/servers");
        return;
      }
      setUrl(s.url);
      setLabel(s.label);
    })();
  }, [params.id]);

  // Initialize queued count when URL changes
  useEffect(() => {
    (async () => {
      try {
        if (!url) return;
        const host = safeGetHost(url);
        if (host) {
          const c = await count(host);
          setQueuedCount(c);
        }
      } catch (e) {
        logDebug("client", "count error", { error: getErrorMessage(e) });
      }
    })();
  }, [url]);

  // Kick off sync and keep retrying periodically until done; also drain outbox each attempt
  useEffect(() => {
    if (!url || !isOnline) return;
    let cancelled = false;
    let running = false;

    const attempt = async () => {
      if (running) return;
      running = true;
      try {
        const host = safeGetHost(url);
        if (host) {
          const settings = await getSettings(host);
          if (settings.fullSyncOnLoad) {
            const done = await isFullSyncDone(url);
            if (done) {
              setSyncStatus("done");
            } else {
              setSyncStatus("syncing");
              if (syncMode === "crawler") {
                logInfo("sync", "crawler-only mode: skip native maybeFullSync");
              } else {
                logInfo("sync", "maybeFullSync start");
                const res = await maybeFullSync(url);
                if (res) {
                  logInfo("sync", "fullSync result", res);
                  setSyncStatus("done");
                  try {
                    const idx = await getCacheIndex();
                    const count = idx.filter((it) => it.host === host).length;
                    logInfo("cache", "index count for host", { host, count });
                  } catch (e) {
                    logDebug("client", "cache index error", { error: getErrorMessage(e) });
                  }
                }
                logInfo("sync", "maybeFullSync done");
              }
            }
          } else {
            setSyncStatus("disabled");
            logInfo("sync", "fullSyncOnLoad disabled, skip maybeFullSync");
          }
        }
      } catch (e) {
        logDebug("client", "sync attempt error", { error: getErrorMessage(e) });
      }
      try {
        logInfo("outbox", "drain start");
        const dres = await drain(url);
        logInfo("outbox", "drain result", dres);
        try {
          setQueuedCount(dres.remaining);
        } catch (e) {
          logDebug("client", "queuedCount update error", { error: String(e) });
        }
        try {
          if (dres.sent > 0) {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            } catch (e) {
              logDebug("client", "haptics error", { error: String(e) });
            }
            Toast.show({ type: "success", text1: `Sent ${dres.sent} queued` });
          }
        } catch (e) {
          logDebug("client", "toast error", { error: String(e) });
        }
      } catch (e) {
        logDebug("client", "drain attempt error", { error: getErrorMessage(e) });
      }
      running = false;
    };

    // Immediate attempt
    attempt();
    // Retry every 5s until full sync done
    const timer = setInterval(async () => {
      if (cancelled) {
        clearInterval(timer);
        return;
      }
      try {
        const host = safeGetHost(url);
        if (!host) {
          clearInterval(timer);
          return;
        }
        const settings = await getSettings(host);
        if (!settings.fullSyncOnLoad) {
          logInfo("sync", "fullSyncOnLoad disabled, stop retries");
          clearInterval(timer);
          return;
        }
        const done = await isFullSyncDone(url);
        if (done) {
          setSyncStatus("done");
          logInfo("sync", "fullSync already done, stopping retries");
          clearInterval(timer);
          return;
        }
      } catch (e) {
        logDebug("client", "interval check error", { error: getErrorMessage(e) });
      }
      await attempt();
    }, SYNC_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, isOnline]);

  if (!url) {
    return (
      <SafeAreaView
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}
        edges={["top", "bottom"]}
      >
        <ActivityIndicator color={C.primary} />
        <Text style={{ marginTop: 8, color: C.text }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <View
        style={{
          height: 48,
          backgroundColor: C.cardBg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: C.separator,
        }}
      >
        <TouchableOpacity onPress={() => router.replace("/servers")}>
          <Text style={{ color: C.primary, fontWeight: "700" }}>Servers</Text>
        </TouchableOpacity>
        <Text style={{ color: C.textStrong, fontWeight: "700" }}>{label || url}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {syncStatus === "syncing" && (
            <View style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}>
              <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 4 }} />
              <Text style={{ color: C.primary, fontWeight: "600", fontSize: 12 }}>Syncing...</Text>
            </View>
          )}
          {queuedCount > 0 && (
            <View
              style={{
                backgroundColor: C.primary,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 12,
                marginRight: 10,
              }}
            >
              <Text style={{ color: C.textOnPrimary, fontWeight: "700", fontSize: 12 }}>
                Queued: {queuedCount}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={() => router.push("/offline")}>
            <Text style={{ color: C.primary, fontWeight: "700" }}>Offline</Text>
          </TouchableOpacity>
        </View>
      </View>
      <OpenWebUIView baseUrl={url} online={isOnline} onQueueCountChange={setQueuedCount} />
    </SafeAreaView>
  );
}
