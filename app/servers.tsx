import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link, router } from "expo-router";
import { STORAGE_KEYS } from "../lib/storage-keys";
import { getSettings, setSettings } from "../lib/outbox";
import { ServerSettings, ServerItem } from "../lib/types";
import { safeGetHost, safeParseUrl } from "../lib/url-utils";
import { getStorageJSON, setStorageJSON } from "../lib/storage-utils";

async function getServers(): Promise<ServerItem[]> {
  return getStorageJSON<ServerItem[]>(STORAGE_KEYS.SERVERS_LIST, []);
}

async function setServers(list: ServerItem[]) {
  await setStorageJSON(STORAGE_KEYS.SERVERS_LIST, list);
}

async function getActive(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.SERVERS_ACTIVE);
}

async function setActive(id: string) {
  await AsyncStorage.setItem(STORAGE_KEYS.SERVERS_ACTIVE, id);
}

function isPrivateIP(hostname: string): boolean {
  // Check for localhost variations
  if (
    hostname === "localhost" ||
    hostname === "localhost.localdomain" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.")
  ) {
    return true;
  }

  // IPv4 pattern matching for private ranges
  const ipv4Pattern = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
  const match = hostname.match(ipv4Pattern);
  if (match && match[1] && match[2]) {
    const [, octet1, octet2] = match;
    const first = parseInt(octet1, 10);
    const second = parseInt(octet2, 10);

    // 10.0.0.0 - 10.255.255.255 (10/8 prefix)
    if (first === 10) return true;

    // 172.16.0.0 - 172.31.255.255 (172.16/12 prefix)
    if (first === 172 && second >= 16 && second <= 31) return true;

    // 192.168.0.0 - 192.168.255.255 (192.168/16 prefix)
    if (first === 192 && second === 168) return true;

    // 169.254.0.0 - 169.254.255.255 (Link-local)
    if (first === 169 && second === 254) return true;
  }

  // Check for private/internal TLDs
  const privateTlds = [".internal", ".corp", ".home", ".lan"];
  if (privateTlds.some((tld) => hostname.endsWith(tld))) {
    return true;
  }

  return false;
}

function normalizeUrl(input: string): { url: string; warning?: string } | null {
  const u = safeParseUrl(input.trim());
  if (!u) return null;
  if (!/^https?:$/.test(u.protocol)) return null;

  // Check if hostname is a private/internal address
  const isPrivate = isPrivateIP(u.hostname);
  let warning: string | undefined;

  if (isPrivate) {
    warning = "You're connecting to an internal/local address. Please ensure this is intentional.";
  }

  // Ensure no trailing slash for base
  u.pathname = u.pathname.replace(/\/$/, "");
  return { url: u.toString(), warning };
}

export default function ServersScreen() {
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
        danger: "#ef4444",
        pillBg: "#1f2937",
        pillActiveBg: "#0a7ea4",
        pillText: "#e6e6e6",
        pillActiveText: "#ffffff",
      }
    : {
        bg: "#ffffff",
        text: "#111111",
        muted: "#666666",
        border: "#dddddd",
        separator: "#eeeeee",
        cardBg: "#ffffff",
        inputBg: "#ffffff",
        primary: "#0a7ea4",
        danger: "#cc0000",
        pillBg: "#f2f2f2",
        pillActiveBg: "#0a7ea4",
        pillText: "#333333",
        pillActiveText: "#ffffff",
      };
  const [servers, setLocalServers] = useState<ServerItem[]>([]);
  const [active, setLocalActive] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [openSettingsFor, setOpenSettingsFor] = useState<string | null>(null);
  const [formLimit, setFormLimit] = useState<string>("30");
  const [formRps, setFormRps] = useState<string>("5");
  const [formFullSync, setFormFullSync] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const [s, a] = await Promise.all([getServers(), getActive()]);
      setLocalServers(s);
      setLocalActive(a);
    })();
  }, []);

  const add = async () => {
    const result = normalizeUrl(url);
    if (!result) {
      Alert.alert("Invalid URL", "Please enter a valid http(s) URL.");
      return;
    }

    const { url: normalizedUrl, warning } = result;

    if (warning) {
      Alert.alert("Security Warning", `${warning}\n\nDo you want to continue adding this server?`, [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Add Anyway",
          onPress: async () => {
            const id = `${Date.now()}`;
            const next = [...servers, { id, url: normalizedUrl, label: label || undefined }];
            setLocalServers(next);
            await setServers(next);
            setUrl("");
            setLabel("");
          },
        },
      ]);
    } else {
      const id = `${Date.now()}`;
      const next = [...servers, { id, url: normalizedUrl, label: label || undefined }];
      setLocalServers(next);
      await setServers(next);
      setUrl("");
      setLabel("");
    }
  };

  const remove = async (id: string) => {
    const next = servers.filter((s) => s.id !== id);
    setLocalServers(next);
    await setServers(next);
    if (active === id) {
      await setActive("");
      setLocalActive(null);
    }
  };

  const activate = async (id: string) => {
    await setActive(id);
    setLocalActive(id);
  };

  const openSettings = async (item: ServerItem) => {
    try {
      const host = safeGetHost(item.url);
      if (!host) throw new Error("Invalid URL");
      const s: ServerSettings = await getSettings(host);
      setFormLimit(String(s.limitConversations));
      setFormRps(String(s.rps));
      setFormFullSync(!!s.fullSyncOnLoad);
      setOpenSettingsFor(item.id);
    } catch {
      setFormLimit("30");
      setFormRps("5");
      setFormFullSync(true);
      setOpenSettingsFor(item.id);
    }
  };

  const saveSettings = async (item: ServerItem) => {
    try {
      const host = safeGetHost(item.url);
      if (!host) throw new Error("Invalid URL");
      const limit = Math.max(1, Math.min(500, Number.parseInt(formLimit || "30", 10) || 30));
      const rps = Math.max(1, Math.min(50, Number.parseInt(formRps || "5", 10) || 5));
      await setSettings(host, { limitConversations: limit, rps, fullSyncOnLoad: formFullSync });
      Alert.alert("Saved", "Server settings updated.");
      setOpenSettingsFor(null);
    } catch (error: unknown) {
      Alert.alert(
        "Error",
        String(error instanceof Error ? error.message : error || "Failed to save settings")
      );
    }
  };

  const proceed = () => {
    const selected = servers.find((s) => s.id === active);
    if (!selected) {
      Alert.alert("Select a server", "Please select a server to continue.");
      return;
    }
    router.replace({ pathname: "/client", params: { id: selected.id } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: "600", marginBottom: 4, color: C.text }}>
            Open WebUI Client
          </Text>
          <Text style={{ color: C.muted, marginBottom: 16 }}>
            Add one or more server URLs, select one, then Continue.
          </Text>

          <View style={{ gap: 8, marginBottom: 12 }}>
            <TextInput
              placeholder="https://your-openwebui.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={url}
              onChangeText={setUrl}
              placeholderTextColor={C.muted}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: C.inputBg,
                color: C.text,
                borderRadius: 8,
                padding: 12,
              }}
            />
            <TextInput
              placeholder="Optional label (e.g., Production)"
              value={label}
              onChangeText={setLabel}
              placeholderTextColor={C.muted}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: C.inputBg,
                color: C.text,
                borderRadius: 8,
                padding: 12,
              }}
            />
            <TouchableOpacity
              onPress={add}
              style={{
                backgroundColor: "#111",
                padding: 12,
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Add URL</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={servers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={{ paddingVertical: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => activate(item.id)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: C.text,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {active === item.id ? (
                      <View
                        style={{ width: 12, height: 12, backgroundColor: C.text, borderRadius: 6 }}
                      />
                    ) : null}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600", color: C.text }}>
                      {item.label || item.url}
                    </Text>
                    {item.label ? (
                      <Text style={{ color: C.muted, fontSize: 12 }}>{item.url}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={() => openSettings(item)}>
                    <Text style={{ color: C.primary, fontWeight: "600" }}>Settings</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(item.id)}>
                    <Text style={{ color: C.danger, fontWeight: "600" }}>Remove</Text>
                  </TouchableOpacity>
                </View>
                {openSettingsFor === item.id ? (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.cardBg,
                      borderRadius: 8,
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "600", marginBottom: 4, color: C.text }}>
                      Server Settings
                    </Text>
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: C.muted }}>Conversation limit</Text>
                      <TextInput
                        placeholder="30"
                        keyboardType="number-pad"
                        value={formLimit}
                        onChangeText={setFormLimit}
                        placeholderTextColor={C.muted}
                        style={{
                          borderWidth: 1,
                          borderColor: C.border,
                          backgroundColor: C.inputBg,
                          color: C.text,
                          borderRadius: 8,
                          padding: 10,
                        }}
                      />
                    </View>
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: C.muted }}>Rate limit (requests/second)</Text>
                      <TextInput
                        placeholder="5"
                        keyboardType="number-pad"
                        value={formRps}
                        onChangeText={setFormRps}
                        placeholderTextColor={C.muted}
                        style={{
                          borderWidth: 1,
                          borderColor: C.border,
                          backgroundColor: C.inputBg,
                          color: C.text,
                          borderRadius: 8,
                          padding: 10,
                        }}
                      />
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 6,
                      }}
                    >
                      <Text style={{ color: C.muted }}>Full sync on app load</Text>
                      <TouchableOpacity
                        onPress={() => setFormFullSync((v) => !v)}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderWidth: 1,
                          borderColor: formFullSync ? C.primary : C.border,
                          borderRadius: 14,
                        }}
                      >
                        <Text
                          style={{ color: formFullSync ? C.primary : C.text, fontWeight: "600" }}
                        >
                          {formFullSync ? "On" : "Off"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => saveSettings(item)}
                        style={{
                          backgroundColor: "#111",
                          padding: 12,
                          borderRadius: 8,
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "600" }}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setOpenSettingsFor(null)}
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: C.border,
                        }}
                      >
                        <Text style={{ color: C.text, fontWeight: "600" }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            )}
            ListEmptyComponent={<Text style={{ color: C.muted }}>No servers added yet.</Text>}
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: C.separator }} />
            )}
          />

          <View style={{ height: 12 }} />
          <TouchableOpacity
            onPress={proceed}
            style={{
              backgroundColor: C.primary,
              padding: 14,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Continue</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center", marginTop: 12 }}>
            <Link href="/offline" asChild>
              <TouchableOpacity>
                <Text style={{ color: C.primary }}>Offline content</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
