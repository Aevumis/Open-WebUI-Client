import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Share,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { readCachedEntry } from "../../lib/cache";
import { debug, warn } from "../../lib/log";
import Markdown from "react-native-markdown-display";

// Render markdown with a library instead of custom parsing

interface Theme {
  bg: string;
  text: string;
  muted: string;
  border: string;
  separator: string;
  cardBg: string;
  primary: string;
}

function MessageBubble({
  role,
  content,
  C,
  isDark,
}: {
  role: "user" | "assistant" | string;
  content: string;
  C: Theme;
  isDark: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n").length;
  const isLong = lines > 10 || content.length > 1200;
  const bubbleBg =
    role === "user" ? (isDark ? "#0f2a3d" : "#e9f2ff") : isDark ? C.cardBg : "#f6f6f6";
  const codeInlineBg = isDark ? "#1f2937" : "#f0f0f0";
  const codeBlockBg = isDark ? "#0f1318" : "#f6f8fa";

  return (
    <View style={{ marginVertical: 8, alignItems: role === "user" ? "flex-end" : "flex-start" }}>
      <View
        style={{
          maxWidth: "90%",
          backgroundColor: bubbleBg,
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Markdown
          style={{
            body: { color: C.text, fontSize: 14 },
            code_inline: {
              fontFamily: "SpaceMono-Regular",
              backgroundColor: codeInlineBg,
              paddingHorizontal: 4,
              color: C.text,
            },
            code_block: {
              fontFamily: "SpaceMono-Regular",
              backgroundColor: codeBlockBg,
              borderRadius: 6,
              padding: 10,
              color: C.text,
            },
            heading1: { fontSize: 22, fontWeight: "700", color: C.text },
            heading2: { fontSize: 20, fontWeight: "700", color: C.text },
            heading3: { fontSize: 18, fontWeight: "700", color: C.text },
            link: { color: C.primary },
          }}
        >
          {expanded || !isLong ? content : content.split("\n").slice(0, 10).join("\n") + "\n…"}
        </Markdown>
        {isLong && (
          <TouchableOpacity
            onPress={() => setExpanded((v) => !v)}
            style={{ marginTop: 8, alignSelf: "flex-start" }}
          >
            <Text style={{ color: C.primary, fontWeight: "600" }}>
              {expanded ? "Show less" : "Show more"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function OfflineConversationView() {
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
        primary: "#0a7ea4",
      }
    : {
        bg: "#ffffff",
        text: "#111111",
        muted: "#666666",
        border: "#e5e5e5",
        separator: "#eeeeee",
        cardBg: "#fafafa",
        primary: "#0a7ea4",
      };
  const params = useLocalSearchParams<{ host?: string; id?: string }>();
  const host = params.host || "";
  const id = params.id || "";

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState<string>("");
  const [messages, setMessages] = useState<
    { id: string; role: "user" | "assistant" | "system"; content: string }[]
  >([]);

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
        while (curId && !visited.has(curId)) {
          const node: import("../../lib/types").MessageNode | undefined = map[curId];
          if (!node) break;
          visited.add(curId);
          path.push(curId);
          curId = node.parentId;
        }
        path.reverse();

        const ordered = path
          .map((mid) => {
            const node = map[mid];
            if (!node) return null;
            return {
              id: mid,
              role: node.role,
              content: String(node.content || ""),
            };
          })
          .filter(
            (m): m is { id: string; role: "user" | "assistant" | "system"; content: string } =>
              m !== null
          );
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
      const text = messages.map((m) => `${m.role.toUpperCase()}\n${m.content}`).join("\n\n");
      await Share.share({ message: `${title}\n\n${text}` });
    } catch (e) {
      warn("offline", "share failed", String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: C.separator,
        }}
      >
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 6 }}>
          <Text style={{ color: C.primary, fontWeight: "700" }}>Back</Text>
        </TouchableOpacity>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: C.text }} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 12 }}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble role={item.role} content={item.content} C={C} isDark={isDark} />
          )}
          ListEmptyComponent={
            <Text style={{ padding: 16, color: C.muted }}>No messages in this conversation.</Text>
          }
        />
      )}

      <View
        style={{
          padding: 10,
          borderTopWidth: 1,
          borderTopColor: C.separator,
          backgroundColor: C.cardBg,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text style={{ color: C.muted, fontSize: 12, flex: 1 }}>Viewing cached copy (offline)</Text>
        <TouchableOpacity
          onPress={shareTranscript}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={{ fontWeight: "600", color: C.text }}>Share</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
