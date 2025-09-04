import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Share, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { readCachedEntry } from "../../lib/cache";
import { debug, warn } from "../../lib/log";
import Markdown from "react-native-markdown-display";

// Render markdown with a library instead of custom parsing

function MessageBubble({ role, content }: { role: "user" | "assistant" | string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n").length;
  const isLong = lines > 10 || content.length > 1200;

  return (
    <View style={{ marginVertical: 8, alignItems: role === "user" ? "flex-end" : "flex-start" }}>
      <View
        style={{
          maxWidth: "90%",
          backgroundColor: role === "user" ? "#e9f2ff" : "#f6f6f6",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Markdown
          style={{
            body: { color: "#111", fontSize: 14 },
            code_inline: { fontFamily: "SpaceMono-Regular", backgroundColor: "#f0f0f0", paddingHorizontal: 4 },
            code_block: { fontFamily: "SpaceMono-Regular", backgroundColor: "#f6f8fa", borderRadius: 6, padding: 10 },
            heading1: { fontSize: 22, fontWeight: "700" },
            heading2: { fontSize: 20, fontWeight: "700" },
            heading3: { fontSize: 18, fontWeight: "700" },
          }}
        >
          {expanded || !isLong ? content : content.split("\n").slice(0, 10).join("\n") + "\n…"}
        </Markdown>
        {isLong && (
          <TouchableOpacity onPress={() => setExpanded(v => !v)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
            <Text style={{ color: "#0a7ea4", fontWeight: "600" }}>{expanded ? "Show less" : "Show more"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function OfflineConversationView() {
  const params = useLocalSearchParams<{ host?: string; id?: string }>();
  const host = params.host || "";
  const id = params.id || "";

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState<string>("");
  const [messages, setMessages] = useState<Array<{ id: string; role: string; content: string }>>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const entry = await readCachedEntry(host, id);
        if (!entry) {
          warn("offline", "missing cache entry", { host, id });
          setLoading(false);
          return;
        }
        const data = entry.data;
        setTitle(data?.title || data?.chat?.title || id);
        const history = data?.chat?.history;
        const map = history?.messages || {};
        let curId: string | null | undefined = history?.currentId;

        // Build path from root to currentId (ignoring branches)
        const path: string[] = [];
        const visited = new Set<string>();
        while (curId && !visited.has(curId) && map[curId]) {
          visited.add(curId);
          path.push(curId);
          curId = map[curId].parentId;
        }
        path.reverse();

        const ordered = path.map((mid) => ({ id: mid, role: map[mid].role, content: String(map[mid].content || "") }));
        setMessages(ordered);
        debug("offline", "loaded offline conversation", { host, id, count: ordered.length });
      } catch (e) {
        warn("offline", "failed to load offline conversation", String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [host, id]);

  const shareTranscript = async () => {
    try {
      const text = messages
        .map((m) => `${m.role.toUpperCase()}\n${m.content}`)
        .join("\n\n");
      await Share.share({ message: `${title}\n\n${text}` });
    } catch (e) {
      warn("offline", "share failed", String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 6 }}>
          <Text style={{ color: "#0a7ea4", fontWeight: "700" }}>Back</Text>
        </TouchableOpacity>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>{title}</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 12 }}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble role={item.role} content={item.content} />
          )}
          ListEmptyComponent={<Text style={{ padding: 16, color: "#666" }}>No messages in this conversation.</Text>}
        />
      )}

      <View style={{ padding: 10, borderTopWidth: 1, borderTopColor: "#eee", backgroundColor: "#fafafa", flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: "#666", fontSize: 12, flex: 1 }}>Viewing cached copy (offline)</Text>
        <TouchableOpacity onPress={shareTranscript} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "#ddd" }}>
          <Text style={{ fontWeight: "600" }}>Share</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
