import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import { setLogConfig } from "../lib/log";

export default function RootLayout() {
  // Global logger config: adjust here to control verbosity and scopes
  setLogConfig({
    level: typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info',
    scopes: (typeof __DEV__ !== 'undefined' && __DEV__)
      ? ['webview', 'injection', 'sync', 'outbox']
      : ['sync', 'outbox'],
  });
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
      {/* Global toast host (library) */}
      <Toast />
    </SafeAreaProvider>
  );
}
