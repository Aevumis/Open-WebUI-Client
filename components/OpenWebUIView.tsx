import React, { useCallback, useMemo, useRef } from "react";
import { Alert, Platform } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { cacheApiResponse, type CachedEntry } from "../lib/cache";

function buildInjection(baseUrl: string) {
  // Intercept fetch/XHR to capture conversation JSON and downloads; avoid changing behavior of page.
  // Post messages to React Native with type keys for native handling.
  const allowedHost = JSON.stringify(new URL(baseUrl).host);
  return `(() => {
    const RN = window.ReactNativeWebView;
    const host = ${allowedHost};

    // Register Service Worker for offline shell + API cache (served at origin /sw.js)
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) {}
    }

    function shouldCache(url) {
      try {
        const u = new URL(url);
        if (u.host !== host) return false;
        // Exact conversation endpoint pattern as provided: /api/v1/chats/:id
        return /^\\/api\\/v1\\/chats\\/[0-9a-fA-F-]+$/.test(u.pathname);
      } catch (_) {
        return false;
      }
    }

    async function readBlobAsBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
      const res = await origFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : input.url;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') && shouldCache(url)) {
          const clone = res.clone();
          const data = await clone.json();
          RN.postMessage(JSON.stringify({ type: 'cacheResponse', url, data }));
        } else if ((ct.includes('application/octet-stream') || ct.includes('application/pdf') || ct.includes('image/') || ct.includes('zip') || ct.includes('ms-') || ct.includes('officedocument')) && url) {
          // Likely a download; attempt to capture
          const disp = res.headers.get('content-disposition') || '';
          if (/attachment/i.test(disp)) {
            const clone = res.clone();
            const blob = await clone.blob();
            const b64 = await readBlobAsBase64(blob);
            const nameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disp);
            const filename = decodeURIComponent(nameMatch?.[1] || nameMatch?.[2] || 'download');
            RN.postMessage(JSON.stringify({ type: 'downloadBlob', filename, mime: ct, base64: b64 }));
          }
        }
      } catch (e) {}
      return res;
    }

    const origOpen = window.open;
    window.open = function(url, target, features) {
      RN.postMessage(JSON.stringify({ type: 'externalLink', url }));
      return null;
    };

    document.addEventListener('click', (e) => {
      const a = e.target && (e.target.closest ? e.target.closest('a') : null);
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      try {
        const u = new URL(href, window.location.href);
        if (u.origin !== window.location.origin) {
          e.preventDefault();
          RN.postMessage(JSON.stringify({ type: 'externalLink', url: u.toString() }));
        }
      } catch {}
    }, true);

  })();`;
}

export default function OpenWebUIView({ baseUrl, online }: { baseUrl: string; online: boolean }) {
  const webref = useRef<WebView>(null);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data || '{}');
      if (msg.type === 'externalLink' && typeof msg.url === 'string') {
        await WebBrowser.openBrowserAsync(msg.url);
        return;
      }
      if (msg.type === 'cacheResponse') {
        const entry: CachedEntry = {
          url: msg.url,
          capturedAt: Date.now(),
          data: msg.data,
        };
        await cacheApiResponse(new URL(baseUrl).host, entry);
        return;
      }
      if (msg.type === 'downloadBlob' && msg.base64) {
        const filename = msg.filename || 'download';
        const uri = FileSystem.documentDirectory + `downloads/` + filename;
        await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + 'downloads', { intermediates: true }).catch(() => {});
        await FileSystem.writeAsStringAsync(uri, msg.base64, { encoding: FileSystem.EncodingType.Base64 });
        if (Platform.OS === 'ios') {
          await Sharing.shareAsync(uri, { mimeType: msg.mime, dialogTitle: filename });
        } else {
          Alert.alert('Downloaded', filename);
        }
        return;
      }
    } catch (err) {
      // ignore
    }
  }, [baseUrl]);

  const injected = useMemo(() => buildInjection(baseUrl), [baseUrl]);

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
      onFileDownload={async (e) => {
        try {
          const url = e.nativeEvent.downloadUrl;
          const filename = url.split('/').pop() || 'download';
          const dir = FileSystem.documentDirectory + 'downloads/';
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
          const dest = dir + filename;
          const { uri } = await FileSystem.downloadAsync(url, dest);
          if (Platform.OS === 'ios') {
            await Sharing.shareAsync(uri);
          } else {
            Alert.alert('Downloaded', filename);
          }
        } catch (err) {
          Alert.alert('Download failed', 'Unable to download file.');
        }
      }}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => {
        try {
          const base = new URL(baseUrl);
          const current = new URL(req.url);
          if (current.host !== base.host) {
            WebBrowser.openBrowserAsync(req.url);
            return false;
          }
          return true;
        } catch {
          return true;
        }
      }}
      injectedJavaScriptBeforeContentLoaded={injected}
      allowsBackForwardNavigationGestures
      startInLoadingState
    />
  );
}
