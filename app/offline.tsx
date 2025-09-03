import React, { useEffect, useState } from "react";
import { FlatList, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { getCacheIndex, readCachedEntry, type CacheIndexItem } from "../lib/cache";

export default function OfflineScreen() {
  const [items, setItems] = useState<CacheIndexItem[]>([]);

  useEffect(() => {
    (async () => {
      const idx = await getCacheIndex();
      setItems(idx);
    })();
  }, []);

  const open = async (item: CacheIndexItem) => {
    const data = await readCachedEntry(item.host, item.id);
    if (!data) return;
    // Basic plaintext render
    alert(JSON.stringify(data.data, null, 2).slice(0, 20000));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Offline content</Text>
        <Text style={{ color: "#666" }}>Cached conversation JSON (text only)</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it) => it.key}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => open(item)} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" }}>
            <Text style={{ fontWeight: "600" }}>{item.title || item.id}</Text>
            <Text style={{ color: "#666", fontSize: 12 }}>{item.host} • {new Date(item.lastAccess).toLocaleString()}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ padding: 16, color: "#666" }}>No cached items yet.</Text>}
      />
    </SafeAreaView>
  );
}
