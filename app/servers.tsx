import React, { useEffect, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link, router } from "expo-router";
import { getSettings, setSettings, type ServerSettings } from "../lib/outbox";

const STORAGE_KEY = "servers:list";
const ACTIVE_KEY = "servers:active";

type ServerItem = {
  id: string;
  url: string;
  label?: string;
};

async function getServers(): Promise<ServerItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function setServers(list: ServerItem[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

async function getActive(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_KEY);
}

async function setActive(id: string) {
  await AsyncStorage.setItem(ACTIVE_KEY, id);
}

function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    // Ensure no trailing slash for base
    u.pathname = u.pathname.replace(/\/$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

export default function ServersScreen() {
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
    const norm = normalizeUrl(url);
    if (!norm) {
      Alert.alert("Invalid URL", "Please enter a valid http(s) URL.");
      return;
    }
    const id = `${Date.now()}`;
    const next = [...servers, { id, url: norm, label: label || undefined }];
    setLocalServers(next);
    await setServers(next);
    setUrl("");
    setLabel("");
  };

  const remove = async (id: string) => {
    const next = servers.filter(s => s.id !== id);
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
      const host = new URL(item.url).host;
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
      const host = new URL(item.url).host;
      const limit = Math.max(1, Math.min(500, Number.parseInt(formLimit || "30", 10) || 30));
      const rps = Math.max(1, Math.min(50, Number.parseInt(formRps || "5", 10) || 5));
      await setSettings(host, { limitConversations: limit, rps, fullSyncOnLoad: formFullSync });
      Alert.alert("Saved", "Server settings updated.");
      setOpenSettingsFor(null);
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || e || "Failed to save settings"));
    }
  };

  const proceed = () => {
    const selected = servers.find(s => s.id === active);
    if (!selected) {
      Alert.alert("Select a server", "Please select a server to continue.");
      return;
    }
    router.replace({ pathname: "/client", params: { id: selected.id } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: "600", marginBottom: 4 }}>Open WebUI Client</Text>
          <Text style={{ color: "#666", marginBottom: 16 }}>Add one or more server URLs, select one, then Continue.</Text>

          <View style={{ gap: 8, marginBottom: 12 }}>
            <TextInput
              placeholder="https://your-openwebui.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={url}
              onChangeText={setUrl}
              style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12 }}
            />
            <TextInput
              placeholder="Optional label (e.g., Production)"
              value={label}
              onChangeText={setLabel}
              style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12 }}
            />
            <TouchableOpacity onPress={add} style={{ backgroundColor: "#111", padding: 12, borderRadius: 8, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Add URL</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={servers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={{ paddingVertical: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity onPress={() => activate(item.id)} style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#111", alignItems: "center", justifyContent: "center" }}>
                    {active === item.id ? <View style={{ width: 12, height: 12, backgroundColor: "#111", borderRadius: 6 }} /> : null}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600" }}>{item.label || item.url}</Text>
                    {item.label ? <Text style={{ color: "#666", fontSize: 12 }}>{item.url}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => openSettings(item)}>
                    <Text style={{ color: "#0a7ea4", fontWeight: "600" }}>Settings</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(item.id)}>
                    <Text style={{ color: "#c00", fontWeight: "600" }}>Remove</Text>
                  </TouchableOpacity>
                </View>
                {openSettingsFor === item.id ? (
                  <View style={{ marginTop: 10, padding: 12, borderWidth: 1, borderColor: "#eee", borderRadius: 8, gap: 8 }}>
                    <Text style={{ fontWeight: "600", marginBottom: 4 }}>Server Settings</Text>
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: "#666" }}>Conversation limit</Text>
                      <TextInput
                        placeholder="30"
                        keyboardType="number-pad"
                        value={formLimit}
                        onChangeText={setFormLimit}
                        style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10 }}
                      />
                    </View>
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: "#666" }}>Rate limit (requests/second)</Text>
                      <TextInput
                        placeholder="5"
                        keyboardType="number-pad"
                        value={formRps}
                        onChangeText={setFormRps}
                        style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10 }}
                      />
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                      <Text style={{ color: "#666" }}>Full sync on app load</Text>
                      <TouchableOpacity onPress={() => setFormFullSync(v => !v)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: formFullSync ? "#0a7ea4" : "#ddd", borderRadius: 14 }}>
                        <Text style={{ color: formFullSync ? "#0a7ea4" : "#333", fontWeight: "600" }}>{formFullSync ? 'On' : 'Off'}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <TouchableOpacity onPress={() => saveSettings(item)} style={{ backgroundColor: "#111", padding: 12, borderRadius: 8, alignItems: "center" }}>
                        <Text style={{ color: "#fff", fontWeight: "600" }}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setOpenSettingsFor(null)} style={{ padding: 12, borderRadius: 8, alignItems: "center", borderWidth: 1, borderColor: "#ddd" }}>
                        <Text style={{ color: "#111", fontWeight: "600" }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            )}
            ListEmptyComponent={<Text style={{ color: "#666" }}>No servers added yet.</Text>}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#eee" }} />}
          />

          <View style={{ height: 12 }} />
          <TouchableOpacity onPress={proceed} style={{ backgroundColor: "#0a7ea4", padding: 14, borderRadius: 10, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Continue</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center", marginTop: 12 }}>
            <Link href="/offline" asChild>
              <TouchableOpacity>
                <Text style={{ color: "#0a7ea4" }}>Offline content</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
