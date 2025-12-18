import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getCacheIndex, readCachedEntry, type CacheIndexItem } from "../lib/cache";
import { safeGetHost } from "../lib/url-utils";
import { router } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { isFullSyncDone } from "../lib/sync";
import { getSettings } from "../lib/outbox";
import { ServerItem } from "../lib/types";

export default function OfflineScreen() {
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const C = isDark
    ? {
        bg: "#0d0f12",
        text: "#e6e6e6",
        muted: "#9aa4b2",
        border: "#2a2f36",
        separator: "#1b1f24",
        cardBg: "#14181d",
        inputBg: "#0f1318",
        primary: "#0a7ea4",
        pillBg: "#1f2937",
        pillActiveBg: "#0a7ea4",
        pillText: "#e6e6e6",
        pillActiveText: "#ffffff",
      }
    : {
        bg: "#ffffff",
        text: "#111111",
        muted: "#666666",
        border: "#e5e5e5",
        separator: "#eeeeee",
        cardBg: "#ffffff",
        inputBg: "#ffffff",
        primary: "#0a7ea4",
        pillBg: "#f2f2f2",
        pillActiveBg: "#0a7ea4",
        pillText: "#333333",
        pillActiveText: "#ffffff",
      };
  const [items, setItems] = useState<CacheIndexItem[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [updatedMap, setUpdatedMap] = useState<Record<string, number>>({});
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [syncInfo, setSyncInfo] = useState<{
    host: string;
    syncDone: boolean;
    syncEnabled: boolean;
  } | null>(null);

  const goBackOrServers = () => {
    try {
      if ((navigation as any)?.canGoBack?.()) {
        (navigation as any).goBack();
      } else {
        router.replace("/servers");
      }
    } catch {
      router.replace("/servers");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const idx = await getCacheIndex();
      const titleUpdates: Record<string, string> = {};
      const tsUpdates: Record<string, number> = {};
      await Promise.all(
        idx.map(async (it) => {
          const entry = await readCachedEntry(it.host, it.id);
          if (entry) {
            const t = entry.title || entry.data?.title || entry.data?.chat?.title;
            if (t) titleUpdates[it.key] = String(t);
            const raw =
              entry.data?.updated_at ??
              entry.data?.updatedAt ??
              entry.data?.chat?.timestamp ??
              entry.data?.created_at ??
              entry.data?.timestamp ??
              entry.capturedAt;
            if (raw != null) {
              let v = Number(raw);
              if (Number.isFinite(v)) {
                if (v < 1e12) v = v * 1000; // sec -> ms
                tsUpdates[it.key] = v;
              }
            }
          }
        })
      );
      if (cancelled) return;
      if (Object.keys(titleUpdates).length) setTitles((p) => ({ ...p, ...titleUpdates }));
      if (Object.keys(tsUpdates).length) setUpdatedMap((p) => ({ ...p, ...tsUpdates }));
      setItems(idx);

      // Check sync status for empty state messaging
      if (idx.length === 0) {
        try {
          // Get the most recent server from storage to check sync status
          const serversRaw = await import("@react-native-async-storage/async-storage").then((m) =>
            m.default.getItem("servers:list")
          );
          const activeRaw = await import("@react-native-async-storage/async-storage").then((m) =>
            m.default.getItem("servers:active")
          );
          if (serversRaw && activeRaw) {
            const servers: ServerItem[] = JSON.parse(serversRaw);
            const activeServer = servers.find((s) => s.id === activeRaw);
            if (activeServer) {
              const host = safeGetHost(activeServer.url) || "";
              const syncDone = await isFullSyncDone(activeServer.url);
              const settings = await getSettings(host);
              setSyncInfo({ host, syncDone, syncEnabled: settings.fullSyncOnLoad });
            }
          }
        } catch {
          // Ignore errors in sync status check
        }
      }

      setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Backfill titles for legacy items lacking title in index
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        items
          .filter((it) => !it.title)
          .map(async (it) => {
            const entry = await readCachedEntry(it.host, it.id);
            const t = entry?.title || entry?.data?.title || entry?.data?.chat?.title;
            if (t) updates[`${it.host}/${it.id}`] = String(t);
          })
      );
      if (!cancelled && Object.keys(updates).length) {
        setTitles((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  // Backfill updated_at (or best-effort) from cached JSON for display
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates: Record<string, number> = {};
      await Promise.all(
        items.map(async (it) => {
          if (updatedMap[it.key] != null) return;
          const entry = await readCachedEntry(it.host, it.id);
          // Prefer updated_at from API JSON, then updatedAt, then chat.timestamp, then created_at, then top-level timestamp, then capturedAt
          const raw =
            entry?.data?.updated_at ??
            entry?.data?.updatedAt ??
            entry?.data?.chat?.timestamp ??
            entry?.data?.created_at ??
            entry?.data?.timestamp ??
            entry?.capturedAt;
          if (raw != null) {
            let v = Number(raw);
            if (Number.isFinite(v)) {
              // Normalize seconds to ms
              if (v < 1e12) v = v * 1000;
              updates[it.key] = v;
            }
          }
        })
      );
      if (!cancelled && Object.keys(updates).length) {
        setUpdatedMap((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, updatedMap]);

  const hosts = useMemo(() => Array.from(new Set(items.map((i) => i.host))), [items]);
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((i) => {
      if (hostFilter !== "all" && i.host !== hostFilter) return false;
      if (!q) return true;
      const t = (titles[i.key] || i.title || i.id).toLowerCase();
      return t.includes(q) || i.id.toLowerCase().includes(q);
    });
    // Sort by updated_at (desc), fallback to lastAccess until loaded
    return filtered.slice().sort((a, b) => {
      const au = updatedMap[a.key] ?? a.lastAccess;
      const bu = updatedMap[b.key] ?? b.lastAccess;
      return bu - au;
    });
  }, [items, hostFilter, query, titles, updatedMap]);

  const open = async (item: CacheIndexItem) => {
    // Ensure it exists before navigating
    const data = await readCachedEntry(item.host, item.id);
    if (!data) return;
    const href = `/offline/view?host=${encodeURIComponent(item.host)}&id=${encodeURIComponent(item.id)}`;
    // Cast to any to satisfy current route typings until typegen picks up new file
    router.push(href);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      {initializing ? (
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <TouchableOpacity onPress={goBackOrServers}>
              <Text style={{ color: C.primary, fontWeight: "700" }}>{"\u2039"} Back</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 18, fontWeight: "700", color: C.text }}>Offline content</Text>
          <Text style={{ color: C.muted }}>Cached conversations</Text>
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={{ marginTop: 8, color: C.muted }}>Loading cached conversations…</Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(it) => it.key}
          keyboardShouldPersistTaps="handled"
          stickyHeaderIndices={[0]}
          ListHeaderComponent={
            <View
              style={{
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: C.separator,
                backgroundColor: C.bg,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <TouchableOpacity onPress={goBackOrServers}>
                  <Text style={{ color: C.primary, fontWeight: "700" }}>{"\u2039"} Back</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 18, fontWeight: "700", color: C.text }}>
                Offline content
              </Text>
              <Text style={{ color: C.muted }}>Cached conversations</Text>
              <View style={{ marginTop: 12 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 10 }}
                >
                  {["all", ...hosts].map((h) => (
                    <TouchableOpacity
                      key={h}
                      onPress={() => setHostFilter(h)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 16,
                        marginRight: 8,
                        backgroundColor: hostFilter === h ? C.pillActiveBg : C.pillBg,
                        borderWidth: hostFilter === h ? 0 : 1,
                        borderColor: C.border,
                      }}
                    >
                      <Text
                        style={{
                          color: hostFilter === h ? C.pillActiveText : C.pillText,
                          fontWeight: "600",
                        }}
                      >
                        {h === "all" ? "All" : h}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.inputBg,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  <TextInput
                    placeholder="Search by title or ID"
                    value={query}
                    onChangeText={setQuery}
                    placeholderTextColor={C.muted}
                    style={{ padding: 0, color: C.text }}
                  />
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => open(item)}
              style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.separator }}
            >
              <Text style={{ fontWeight: "700", color: C.text }} numberOfLines={1}>
                {titles[item.key] || item.title || item.id}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {(() => {
                  const ts = updatedMap[item.key] ?? item.lastAccess;
                  return `Last updated: ${new Date(ts).toLocaleString()}`;
                })()}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ padding: 16, alignItems: "center" }}>
              <Text style={{ color: C.muted, textAlign: "center", marginBottom: 12 }}>
                No cached conversations yet.
              </Text>
              {syncInfo && (
                <View style={{ alignItems: "center" }}>
                  {!syncInfo.syncEnabled ? (
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ color: C.muted, textAlign: "center", fontSize: 14 }}>
                        Sync is disabled for this server.
                      </Text>
                      <Text
                        style={{ color: C.muted, textAlign: "center", fontSize: 14, marginTop: 4 }}
                      >
                        Enable &quot;Full sync on app load&quot; in server settings to cache
                        conversations.
                      </Text>
                    </View>
                  ) : !syncInfo.syncDone ? (
                    <View style={{ alignItems: "center" }}>
                      <ActivityIndicator
                        size="small"
                        color={C.primary}
                        style={{ marginBottom: 8 }}
                      />
                      <Text
                        style={{
                          color: C.primary,
                          textAlign: "center",
                          fontSize: 14,
                          fontWeight: "600",
                        }}
                      >
                        Initial sync in progress...
                      </Text>
                      <Text
                        style={{ color: C.muted, textAlign: "center", fontSize: 12, marginTop: 4 }}
                      >
                        Downloading conversations from {syncInfo.host}
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ color: C.muted, textAlign: "center", fontSize: 14 }}>
                      Sync completed but no conversations found on {syncInfo.host}
                    </Text>
                  )}
                </View>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
