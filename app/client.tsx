import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import OpenWebUIView from "../components/OpenWebUIView";
import { maybeFullSync, isFullSyncDone } from "../lib/sync";
import { getCacheIndex } from "../lib/cache";
import { drain, getSettings, count } from "../lib/outbox";
import { debug as logDebug, info as logInfo } from "../lib/log";
import { useToast } from "../components/Toast";

const STORAGE_KEY = "servers:list";

export default function ClientScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const [url, setUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [isOnline, setIsOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const toast = useToast();

  useEffect(() => {
    const sub = NetInfo.addEventListener((state: NetInfoState) => {
      const next = state.isInternetReachable ?? !!state.isConnected;
      logDebug('net', 'change', { isConnected: state.isConnected, isInternetReachable: state.isInternetReachable, effectiveOnline: next });
      setIsOnline(next);
    });
    return () => sub();
  }, []);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const list: { id: string; url: string; label?: string }[] = raw ? JSON.parse(raw) : [];
      const s = list.find(x => x.id === params.id);
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
        const c = await count(new URL(url).host);
        setQueuedCount(c);
      } catch {}
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
        const host = new URL(url).host;
        const settings = await getSettings(host);
        if (settings.fullSyncOnLoad) {
          logInfo('sync', 'maybeFullSync start');
          const res = await maybeFullSync(url);
          if (res) {
            logInfo('sync', 'fullSync result', res);
            try {
              const idx = await getCacheIndex();
              const count = idx.filter(it => it.host === host).length;
              logInfo('cache', 'index count for host', { host, count });
            } catch {}
          }
          logInfo('sync', 'maybeFullSync done');
        } else {
          logInfo('sync', 'fullSyncOnLoad disabled, skip maybeFullSync');
        }
      } catch {}
      try {
        logInfo('outbox', 'drain start');
        const dres = await drain(url);
        logInfo('outbox', 'drain result', dres);
        try { setQueuedCount(dres.remaining); } catch {}
        try { if (dres.sent > 0) toast.show(`Sent ${dres.sent} queued`, { type: 'success' }); } catch {}
      } catch {}
      running = false;
    };

    // Immediate attempt
    attempt();
    // Retry every 5s until full sync done
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const host = new URL(url).host;
        const settings = await getSettings(host);
        if (!settings.fullSyncOnLoad) {
          logInfo('sync', 'fullSyncOnLoad disabled, stop retries');
          clearInterval(timer);
          return;
        }
        const done = await isFullSyncDone(url);
        if (done) {
          logInfo('sync', 'fullSync already done, stopping retries');
          clearInterval(timer);
          return;
        }
      } catch {}
      await attempt();
    }, 5000);

    return () => { cancelled = true; clearInterval(timer); };
  }, [url, isOnline]);

  if (!url) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }} edges={["top", "bottom"]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
        <TouchableOpacity onPress={() => router.replace("/servers")}>
          <Text style={{ color: "#0a7ea4", fontWeight: "700" }}>Servers</Text>
        </TouchableOpacity>
        <Text style={{ fontWeight: "700" }}>{label || url}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {queuedCount > 0 && (
            <View style={{ backgroundColor: '#0a7ea4', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginRight: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Queued: {queuedCount}</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => router.push("/offline")}>
            <Text style={{ color: "#0a7ea4", fontWeight: "700" }}>Offline</Text>
          </TouchableOpacity>
        </View>
      </View>
      <OpenWebUIView baseUrl={url} online={isOnline} onQueueCountChange={setQueuedCount} />
    </SafeAreaView>
  );
}
