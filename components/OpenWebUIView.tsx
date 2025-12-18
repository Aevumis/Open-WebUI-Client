import React, { useCallback, useMemo, useRef } from "react";
import { Alert, Platform, useColorScheme } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Camera } from "expo-camera";
import * as Haptics from "expo-haptics";
import Toast from "react-native-toast-message";

import { cacheApiResponse, type CachedEntry } from "../lib/cache";
import {
  enqueue,
  setToken,
  count,
  getToken,
  listOutbox,
  removeOutboxItems,
  getSettings,
} from "../lib/outbox";
import { debug as logDebug, info as logInfo } from "../lib/log";
import {
  WEBVIEW_LOAD_TIMEOUT,
  AUTH_POLLING_INTERVAL,
  AUTH_CAPTURE_TIMEOUT,
  SW_READY_WAIT,
  SW_DETECTION_DELAY,
  WEBVIEW_DRAIN_TIMEOUT,
  WEBVIEW_DRAIN_CHECK_INTERVAL,
} from "../lib/constants";
import { safeGetHost, safeParseUrl } from "../lib/url-utils";
import { STORAGE_KEYS } from "../lib/storage-keys";
import { getErrorMessage } from "../lib/error-utils";
import { getStorageJSON, setStorageJSON, removeStorageItem } from "../lib/storage-utils";
import { WebViewMessage, ChatCompletionBody, ConversationData } from "../lib/types";
import {
  buildInjection,
  buildThemeBootstrap,
  buildDrainBatchJS,
  buildSyncJS,
  buildConnectivityJS,
  buildThemeProbeJS,
  buildApplyColorSchemeJS,
  buildCleanupJS,
} from "../lib/webview-scripts";
import { useWebViewHandlers } from "../hooks/useWebViewHandlers";

type WebViewPermissionRequest = {
  resources: string[];
  grant: (resources: string[]) => void;
  deny: () => void;
};

export default function OpenWebUIView({
  baseUrl,
  online,
  onQueueCountChange,
}: {
  baseUrl: string;
  online: boolean;
  onQueueCountChange?: (count: number) => void;
}) {
  const webref = useRef<WebView>(null);
  const drainingRef = React.useRef(false);
  const syncingRef = React.useRef(false);
  const baseUrlRef = React.useRef(baseUrl);
  React.useEffect(() => {
    baseUrlRef.current = baseUrl;
  }, [baseUrl]);
  const colorScheme = useColorScheme();
  const isAndroid = Platform.OS === "android";
  const dev = typeof __DEV__ !== "undefined" && __DEV__;

  // Mount-time visibility and permission setup
  React.useEffect(() => {
    try {
      logInfo("webview", "mount", { baseUrl });

      // Proactively request camera and microphone permissions on mount
      // This ensures permissions are available when the WebView needs them
      (async () => {
        try {
          const cameraPermission = await Camera.requestCameraPermissionsAsync();
          const microphonePermission = await Camera.requestMicrophonePermissionsAsync();

          logInfo("permissions", "proactive permission request", {
            camera: cameraPermission.status,
            microphone: microphonePermission.status,
          });

          if (cameraPermission.status !== "granted" || microphonePermission.status !== "granted") {
            Toast.show({
              type: "info",
              text1: "Camera/Microphone Access",
              text2: "Some features may require camera and microphone permissions.",
              visibilityTime: 4000,
            });
          }
        } catch (error) {
          logDebug("permissions", "proactive request error", { error: getErrorMessage(error) });
        }
      })();
    } catch (e) {
      logDebug("webview", "mount error", { error: getErrorMessage(e) });
    }
  }, [baseUrl]);

  // Inject one batch of webview-assisted drain using page cookies (fallback when no native token)
  const injectWebDrainBatch = useCallback(async () => {
    try {
      const host = safeGetHost(baseUrlRef.current);
      if (!host) return;
      const items = await listOutbox(host);
      if (!items.length) {
        drainingRef.current = false;
        return;
      }
      const batch = items
        .slice(0, 3)
        .map((it) => ({ id: it.id, chatId: it.chatId, body: it.body }));
      logInfo("webviewDrain", "sending batch", { size: batch.length });
      const js = buildDrainBatchJS(batch, WEBVIEW_DRAIN_TIMEOUT, WEBVIEW_DRAIN_CHECK_INTERVAL);
      webref.current?.injectJavaScript(js);
    } catch (e) {
      logDebug("webviewDrain", "inject error", { error: getErrorMessage(e) });
    }
  }, []);

  // WebView-assisted full sync for when cookies exist but native token is not available (httpOnly)
  const injectWebSync = useCallback(async () => {
    try {
      const js = buildSyncJS();
      syncingRef.current = true;
      webref.current?.injectJavaScript(js);
    } catch (e) {
      logDebug("sync", "inject error", { error: getErrorMessage(e) });
    }
  }, []);

  const handlers = useWebViewHandlers({
    host: safeGetHost(baseUrl) || "",
    drainingRef,
    syncingRef,
    onQueueCountChange,
    injectWebDrainBatch,
  });

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      try {
        const msg: WebViewMessage = JSON.parse(e.nativeEvent.data || "{}");
        const host = safeGetHost(baseUrl);
        if (!host) return;

        switch (msg.type) {
          case "debug":
            handlers.handleDebug(msg);
            if (msg.event === "boot") {
              const tok = await getToken(host);
              const settings = await getSettings(host);
              if (!tok && settings.fullSyncOnLoad) {
                await injectWebSync();
              } else if (!settings.fullSyncOnLoad) {
                logInfo("sync", "fullSyncOnLoad disabled, skip webview-assisted sync");
              }
            }
            break;
          case "swStatus":
            await handlers.handleSwStatus(msg);
            break;
          case "drainBatchResult":
            await handlers.handleDrainBatchResult(msg);
            break;
          case "drainBatchError":
            handlers.handleDrainBatchError(msg);
            break;
          case "authToken":
            await handlers.handleAuthToken(msg);
            break;
          case "themeProbe":
            handlers.handleThemeProbe(msg);
            break;
          case "syncDone":
            await handlers.handleSyncDone(msg);
            break;
          case "queueMessage":
            await handlers.handleQueueMessage(msg);
            break;
          case "externalLink":
            await handlers.handleExternalLink(msg);
            break;
          case "cacheResponse":
            await handlers.handleCacheResponse(msg);
            break;
          case "downloadBlob":
            await handlers.handleDownloadBlob(msg);
            break;
        }
      } catch (err) {
        try {
          logDebug("webview", "onMessageError", { error: getErrorMessage(err) });
          logDebug("webview", "raw", String(e?.nativeEvent?.data || ""));
        } catch {
          // Final fallback to prevent loop
        }
      }
    },
    [baseUrl, injectWebSync, handlers]
  );

  const injected = useMemo(() => buildInjection(baseUrl), [baseUrl]);
  const themeBootstrap = useMemo(
    () => buildThemeBootstrap(colorScheme as "dark" | "light" | null),
    [colorScheme]
  );
  const beforeScripts = useMemo(() => `${themeBootstrap};${injected}`, [themeBootstrap, injected]);

  // Keep page aware of RN connectivity so DOM fallback can enqueue when RN says offline
  React.useEffect(() => {
    try {
      const js = buildConnectivityJS(online);
      webref.current?.injectJavaScript(js);
    } catch (e) {
      logDebug("webview", "connectivity inject error", { error: getErrorMessage(e) });
    }
  }, [online]);

  // Debug: inject a theme probe to read the page's current theme-related state
  const injectThemeProbe = useCallback(() => {
    if (!dev) return;
    try {
      const js = buildThemeProbeJS();
      webref.current?.injectJavaScript(js);
    } catch (e) {
      logDebug("theme", "inject probe error", { error: getErrorMessage(e) });
    }
  }, [dev]);

  // Apply device color scheme inside the WebView (helps when matchMedia doesn't reflect OS in RN WebView)
  React.useEffect(() => {
    try {
      const dark = colorScheme === "dark";
      logInfo("theme", "apply RN scheme", { scheme: colorScheme });
      const js = buildApplyColorSchemeJS(dark);
      webref.current?.injectJavaScript(js);
      // Probe immediately after applying
      injectThemeProbe();
      if (isAndroid) {
        // Note: react-native-webview supports forceDarkOn on Android; use it to encourage dark rendering where applicable
        logInfo("theme", "android forceDarkOn set", { forceDarkOn: !!dark });
      }
    } catch (e) {
      logDebug("theme", "apply scheme error", { error: getErrorMessage(e) });
    }
  }, [colorScheme, injectThemeProbe, isAndroid]);

  // On becoming online: if no native token but outbox has items, start webview-assisted drain
  React.useEffect(() => {
    (async () => {
      if (!online) return;
      const host = safeGetHost(baseUrl);
      if (!host) return;
      const [c, token] = [await count(host), await getToken(host)];
      if (c > 0 && !token && !drainingRef.current) {
        drainingRef.current = true;
        logInfo("webviewDrain", "start (no native token)", { host, pending: c });
        await injectWebDrainBatch();
      }
    })();
  }, [online, baseUrl, injectWebDrainBatch]);

  // One-shot manual injection attempt as a fallback
  React.useEffect(() => {
    try {
      logDebug("webview", "manual inject attempt");
      webref.current?.injectJavaScript(`${injected};true;`);
      // Also perform a theme probe early
      injectThemeProbe();
    } catch (e) {
      logDebug("webview", "manual inject error", { error: getErrorMessage(e) });
    }
  }, [injected, injectThemeProbe]);

  // Cleanup WebView intervals on unmount

  React.useEffect(() => {
    const currentWebref = webref.current;

    return () => {
      try {
        logDebug("webview", "unmount cleanup");
        currentWebref?.injectJavaScript(buildCleanupJS());
      } catch (e) {
        logDebug("webview", "cleanup error", { error: getErrorMessage(e) });
      }
    };
  }, []);

  return (
    <WebView
      ref={webref}
      source={{ uri: baseUrl }}
      setSupportMultipleWindows={false}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      geolocationEnabled // Android
      javaScriptEnabled
      domStorageEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      {...(Platform.OS === "android" && {
        onPermissionRequest: async (request: WebViewPermissionRequest) => {
          const { resources } = request;
          logInfo("webview", "permission request", { resources });
          request.grant(resources);
        },
      })}
      // Encourage Android to respect dark theme at the rendering layer (in addition to page CSS)
      forceDarkOn={isAndroid && colorScheme === "dark"}
      onFileDownload={async (e) => {
        try {
          const url = e.nativeEvent.downloadUrl;
          const filename = url.split("/").pop() || "download";
          const dir = FileSystem.documentDirectory + "downloads/";
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
          const dest = dir + filename;
          const { uri } = await FileSystem.downloadAsync(url, dest);
          if (Platform.OS === "ios") {
            await Sharing.shareAsync(uri);
          } else {
            Alert.alert("Downloaded", filename);
          }
        } catch {
          Alert.alert("Download failed", "Unable to download file.");
        }
      }}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => {
        try {
          const base = safeParseUrl(baseUrl);
          const current = safeParseUrl(req.url);
          if (!base || !current) return true;
          if (current.host !== base.host) {
            WebBrowser.openBrowserAsync(req.url);
            return false;
          }
          logDebug("webview", "allow navigation", current.toString());
          return true;
        } catch {
          return true;
        }
      }}
      injectedJavaScriptBeforeContentLoaded={beforeScripts}
      injectedJavaScript={injected}
      onLoadEnd={() => {
        try {
          logDebug("webview", "onLoadEnd reinject");
          // Attempt plain reinject
          webref.current?.injectJavaScript(`${injected};true;`);
          // Probe the bridge explicitly
          webref.current?.injectJavaScript(
            `(function(){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('{"type":"debug","scope":"probe","event":"ping"}')}catch(e){}})();`
          );
          // Safe-eval wrapper to catch syntax/runtime errors of the injected bundle
          const WRAP = `(function(){try{var CODE=${JSON.stringify(injected)}; (new Function('code', 'return eval(code)'))(CODE);}catch(e){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'evalError',message:String(e&&e.message||e)}))}catch(_){} }})();`;
          webref.current?.injectJavaScript(WRAP);
          // Report whether our guard flag is set in page context
          webref.current?.injectJavaScript(
            `(function(){try{var v=!!window.__owui_injected;window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'hasInjected',val:v}))}catch(e){}})();`
          );
          // Re-assert theme via bootstrap notify if available
          const APPLY = buildApplyColorSchemeJS(colorScheme === "dark");
          webref.current?.injectJavaScript(APPLY);
          // Re-probe theme on each navigation to capture changes from the app
          injectThemeProbe();
        } catch (e) {
          logDebug("webview", "onLoadEnd error", { error: getErrorMessage(e) });
        }
      }}
      onNavigationStateChange={(navState) => {
        try {
          logDebug("webview", "nav change", navState.url);
          webref.current?.injectJavaScript(`${injected};true;`);
          const WRAP = `(function(){try{var CODE=${JSON.stringify(injected)}; (new Function('code', 'return eval(code)'))(CODE);}catch(e){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'evalError',message:String(e&&e.message||e)}))}catch(_){} }})();`;
          webref.current?.injectJavaScript(WRAP);
          webref.current?.injectJavaScript(
            `(function(){try{var v=!!window.__owui_injected;window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'hasInjected',val:v}))}catch(e){}})();`
          );
          // Re-assert theme on navigation changes
          const APPLY = buildApplyColorSchemeJS(colorScheme === "dark");
          webref.current?.injectJavaScript(APPLY);
          // Re-probe theme on each navigation to capture changes from the app
          injectThemeProbe();
        } catch (e) {
          logDebug("webview", "nav change error", { error: getErrorMessage(e) });
        }
      }}
      onError={(syntheticEvent) => {
        try {
          logInfo("webview", "error", syntheticEvent.nativeEvent);
        } catch (e) {
          logDebug("webview", "onError handler error", { error: getErrorMessage(e) });
        }
      }}
      allowsBackForwardNavigationGestures
      startInLoadingState
    />
  );
}
