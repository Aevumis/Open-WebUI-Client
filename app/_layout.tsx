import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setLogConfig } from "../lib/log";
import { ToastProvider } from "../components/Toast";

export default function RootLayout() {
  // Global logger config: adjust here to control verbosity and scopes
  setLogConfig({
    level: typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info',
    scopes: (typeof __DEV__ !== 'undefined' && __DEV__)
      ? ['sync', 'outbox', 'cache', 'net', 'webviewDrain', 'webview']
      : ['sync', 'outbox', 'cache', 'net'],
  });
  return (
    <ToastProvider>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </ToastProvider>
  );
}
