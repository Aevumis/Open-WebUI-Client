import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import { setLogConfig } from "../lib/log";
import { ErrorBoundary } from "../components/ErrorBoundary";

export default function RootLayout() {
  // Global logger config: adjust here to control verbosity and scopes
  setLogConfig({
    level: typeof __DEV__ !== "undefined" && __DEV__ ? "debug" : "info",
    scopes:
      typeof __DEV__ !== "undefined" && __DEV__
        ? ["webview", "injection", "sync", "outbox", "permissions"]
        : ["webview", "injection", "permissions"],
  });
  return (
    <SafeAreaProvider>
      <ErrorBoundary name="Root">
        <Stack screenOptions={{ headerShown: false }} />
      </ErrorBoundary>
      {/* Global toast host (library) */}
      <Toast />
    </SafeAreaProvider>
  );
}
