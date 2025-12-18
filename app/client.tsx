import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, TouchableOpacity, View, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import OpenWebUIView from "../components/OpenWebUIView";
import { maybeFullSync, isFullSyncDone } from "../lib/sync";
import { getCacheIndex } from "../lib/cache";
import { drain, getSettings, count } from "../lib/outbox";
import { debug as logDebug, info as logInfo } from "../lib/log";
import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";
import { SYNC_INTERVAL } from "../lib/constants";
import { safeGetHost } from "../lib/url-utils";
import { STORAGE_KEYS } from "../lib/storage-keys";

export default function ClientScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const [url, setUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [isOnline, setIsOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<'checking' | 'syncing' | 'done' | 'disabled'>('checking');
  const scheme = useColorScheme();
  const C = scheme === 'dark'
    ? {
        bg: '#0b0b0b',
        cardBg: '#111111',
        text: '#e5e7eb',
        textStrong: '#ffffff',
        separator: '#27272a',
        primary: '#4fb3d9',
        textOnPrimary: '#ffffff',
      }
    : {
        bg: '#ffffff',
        cardBg: '#ffffff',
        text: '#111827',
        textStrong: '#000000',
        separator: '#eeeeee',
        primary: '#0a7ea4',
        textOnPrimary: '#ffffff',
      };

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
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.SERVERS_LIST);
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
        const host = safeGetHost(url);
        if (host) {
          const c = await count(host);
          setQueuedCount(c);
        }
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
        const host = safeGetHost(url);
        if (host) {
          const settings = await getSettings(host);
          if (settings.fullSyncOnLoad) {
            const done = await isFullSyncDone(url);
            if (done) {
              setSyncStatus('done');
            } else {
              setSyncStatus('syncing');
              logInfo('sync', 'maybeFullSync start');
              const res = await maybeFullSync(url);
              if (res) {
                logInfo('sync', 'fullSync result', res);
                setSyncStatus('done');
                try {
                  const idx = await getCacheIndex();
                  const count = idx.filter(it => it.host === host).length;
                  logInfo('cache', 'index count for host', { host, count });
                } catch {}
              }
              logInfo('sync', 'maybeFullSync done');
            }
          } else {
            setSyncStatus('disabled');
            logInfo('sync', 'fullSyncOnLoad disabled, skip maybeFullSync');
          }
        }
      } catch {}
      try {
        logInfo('outbox', 'drain start');
        const dres = await drain(url);
        logInfo('outbox', 'drain result', dres);
        try { setQueuedCount(dres.remaining); } catch {}
        try {
          if (dres.sent > 0) {
            try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch {}
            Toast.show({ type: 'success', text1: `Sent ${dres.sent} queued` });
          }
        } catch {}
      } catch {}
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
          logInfo('sync', 'fullSyncOnLoad disabled, stop retries');
          clearInterval(timer);
          return;
        }
        const done = await isFullSyncDone(url);
        if (done) {
          setSyncStatus('done');
          logInfo('sync', 'fullSync already done, stopping retries');
          clearInterval(timer);
          return;
        }
      } catch {}
      await attempt();
    }, SYNC_INTERVAL);

    return () => { cancelled = true; clearInterval(timer); };
  }, [url, isOnline]);

  if (!url) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }} edges={["top", "bottom"]}>
        <ActivityIndicator color={C.primary} />
        <Text style={{ marginTop: 8, color: C.text }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <View style={{ height: 48, backgroundColor: C.cardBg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.separator }}>
        <TouchableOpacity onPress={() => router.replace("/servers")}>
          <Text style={{ color: C.primary, fontWeight: "700" }}>Servers</Text>
        </TouchableOpacity>
        <Text style={{ color: C.textStrong, fontWeight: "700" }}>{label || url}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {syncStatus === 'syncing' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
              <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 4 }} />
              <Text style={{ color: C.primary, fontWeight: '600', fontSize: 12 }}>Syncing...</Text>
            </View>
          )}
          {queuedCount > 0 && (
            <View style={{ backgroundColor: C.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginRight: 10 }}>
              <Text style={{ color: C.textOnPrimary, fontWeight: '700', fontSize: 12 }}>Queued: {queuedCount}</Text>
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
