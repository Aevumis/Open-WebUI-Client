import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import OpenWebUIView from "../components/OpenWebUIView";

const STORAGE_KEY = "servers:list";

export default function ClientScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const [url, setUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(state.isInternetReachable ?? !!state.isConnected);
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

  if (!url) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
        <TouchableOpacity onPress={() => router.replace("/servers")}>
          <Text style={{ color: "#0a7ea4", fontWeight: "700" }}>Servers</Text>
        </TouchableOpacity>
        <Text style={{ fontWeight: "700" }}>{label || url}</Text>
        <TouchableOpacity onPress={() => router.push("/offline")}>
          <Text style={{ color: "#0a7ea4", fontWeight: "700" }}>Offline</Text>
        </TouchableOpacity>
      </View>
      <OpenWebUIView baseUrl={url} online={isOnline} />
    </SafeAreaView>
  );
}
