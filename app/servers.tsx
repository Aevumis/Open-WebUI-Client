import React, { useEffect, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link, router } from "expo-router";

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

  const proceed = () => {
    const selected = servers.find(s => s.id === active);
    if (!selected) {
      Alert.alert("Select a server", "Please select a server to continue.");
      return;
    }
    router.replace({ pathname: "/client", params: { id: selected.id } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
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
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 }}>
                <TouchableOpacity onPress={() => activate(item.id)} style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#111", alignItems: "center", justifyContent: "center" }}>
                  {active === item.id ? <View style={{ width: 12, height: 12, backgroundColor: "#111", borderRadius: 6 }} /> : null}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600" }}>{item.label || item.url}</Text>
                  {item.label ? <Text style={{ color: "#666", fontSize: 12 }}>{item.url}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => remove(item.id)}>
                  <Text style={{ color: "#c00", fontWeight: "600" }}>Remove</Text>
                </TouchableOpacity>
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
