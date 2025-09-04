import React, { useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getCacheIndex, readCachedEntry, type CacheIndexItem } from "../lib/cache";
import { router } from "expo-router";

export default function OfflineScreen() {
  const [items, setItems] = useState<CacheIndexItem[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [updatedMap, setUpdatedMap] = useState<Record<string, number>>({});
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const idx = await getCacheIndex();
      setItems(idx);
    })();
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
          const raw = entry?.data?.updated_at
            ?? entry?.data?.updatedAt
            ?? entry?.data?.chat?.timestamp
            ?? entry?.data?.created_at
            ?? entry?.data?.timestamp
            ?? entry?.capturedAt;
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
    router.push(href as any);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
      <FlatList
        data={visibleItems}
        keyExtractor={(it) => it.key}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee", backgroundColor: "#fff" }}>
            <Text style={{ fontSize: 18, fontWeight: "700" }}>Offline content</Text>
            <Text style={{ color: "#666" }}>Cached conversations</Text>
            <View style={{ marginTop: 12 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {["all", ...hosts].map((h) => (
                  <TouchableOpacity
                    key={h}
                    onPress={() => setHostFilter(h)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      marginRight: 8,
                      backgroundColor: hostFilter === h ? "#0a7ea4" : "#f2f2f2",
                      borderWidth: hostFilter === h ? 0 : 1,
                      borderColor: "#e5e5e5",
                    }}
                  >
                    <Text style={{ color: hostFilter === h ? "#fff" : "#333", fontWeight: "600" }}>{h === "all" ? "All" : h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                <TextInput
                  placeholder="Search by title or ID"
                  value={query}
                  onChangeText={setQuery}
                  placeholderTextColor="#999"
                  style={{ padding: 0 }}
                />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => open(item)} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" }}>
            <Text style={{ fontWeight: "700" }} numberOfLines={1}>
              {titles[item.key] || item.title || item.id}
            </Text>
            <Text style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
              {(() => {
                const ts = updatedMap[item.key] ?? item.lastAccess;
                return `Last updated: ${new Date(ts).toLocaleString()}`;
              })()}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ padding: 16, color: "#666" }}>No cached items yet.</Text>}
      />
    </SafeAreaView>
  );
}

