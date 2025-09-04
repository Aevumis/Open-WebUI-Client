import React, { useCallback, useMemo, useRef } from "react";
import { Alert, Platform } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { cacheApiResponse, type CachedEntry } from "../lib/cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { enqueue, setToken, count, getToken, listOutbox, removeOutboxItems, getSettings } from "../lib/outbox";
import { debug as logDebug, info as logInfo } from "../lib/log";
import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

// WebView debug logs are now gated via centralized logger scopes/levels

function buildInjection(baseUrl: string) {
  // Intercept fetch/XHR to capture conversation JSON and downloads; avoid changing behavior of page.
  // Post messages to React Native with type keys for native handling.
  const allowedHost = JSON.stringify(new URL(baseUrl).host);
  return `(() => {
    try {
      if (window.__owui_injected) {
        try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'debug', scope: 'injection', event: 'alreadyInjected' })); } catch (_) {}
        return;
      }
      window.__owui_injected = true;
    } catch (_) {}
    const host = ${allowedHost};
    let sentAuth = false;
    // offline + completion tracking
    window.__owui_wasOffline = false;
    window.__owui_lastCompletionTick = 0;

    try { (window.ReactNativeWebView||{}).postMessage && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'debug', scope: 'injection', event: 'hostInfo', hostExpected: host, hostActual: window.location.host })); } catch {}

    function post(msg) {
      try {
        var RN = (window && window.ReactNativeWebView) ? window.ReactNativeWebView : null;
        if (RN && RN.postMessage) RN.postMessage(JSON.stringify(msg));
      } catch (_) {}
    }

    // Early boot marker and error hooks
    try { post({ type: 'debug', scope: 'injection', event: 'boot' }); } catch {}
    try {
      window.addEventListener('error', function(e) {
        try { post({ type: 'debug', scope: 'injection', event: 'error', message: String((e && e.message) || (e && e.error) || 'unknown') }); } catch {}
      });
      window.addEventListener('unhandledrejection', function(e) {
        try { post({ type: 'debug', scope: 'injection', event: 'unhandledrejection', reason: String(e && (e.reason && e.reason.message) || e && e.reason || 'unknown') }); } catch {}
      });
      // Patch navigator.onLine early so apps that gate on it still attempt fetch when device is offline
      try {
        var nproto = Object.getPrototypeOf(navigator);
        var desc = Object.getOwnPropertyDescriptor(nproto, 'onLine');
        if (desc && desc.configurable && !nproto.__owui_onLine_patched) {
          Object.defineProperty(nproto, 'onLine', { configurable: true, get: function(){ return true; } });
          nproto.__owui_onLine_patched = true;
          post({ type: 'debug', scope: 'injection', event: 'forceOnlinePatchedEarly', ok: true });
        }
      } catch (epe) { try { post({ type: 'debug', scope: 'injection', event: 'forceOnlinePatchedEarly', ok: false, message: String(epe && epe.message || epe) }); } catch(_){} }
      // Browser network state visibility
      window.addEventListener('online', function(){ try { window.__owui_wasOffline = false; post({ type: 'debug', scope: 'injection', event: 'browserNetwork', online: true }); } catch {} });
      window.addEventListener('offline', function(){ try { window.__owui_wasOffline = true; post({ type: 'debug', scope: 'injection', event: 'browserNetwork', online: false }); } catch {} });
      // User interaction hints while offline test
      document.addEventListener('keydown', function(e){
        try {
          if (e && (e.key === 'Enter' || e.keyCode === 13)) {
            var tag = (e.target && e.target.tagName || '').toLowerCase();
            if (tag === 'textarea' || tag === 'input') {
              var parts = (window.location.pathname || '').split('/').filter(Boolean);
              var idx = parts.indexOf('c');
              var cid = (idx >= 0 && parts[idx+1]) ? parts[idx+1] : null;
              // If offline, intercept and queue immediately to avoid UI placeholder/duplicate
              var rnVal0 = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
              var offline0 = (window.__owui_wasOffline === true) || (rnVal0 === false);
              if (offline0 && !e.shiftKey) {
                var textNow0 = '';
                var node0 = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
                if (node0) {
                  if ('value' in node0) { textNow0 = (node0.value||'').trim(); }
                  else { textNow0 = (node0.innerText || node0.textContent || '').trim(); }
                }
                try { window.__owui_lastTextCandidate = textNow0; } catch {}
                if (textNow0 && cid) {
                  post({ type: 'debug', scope: 'injection', event: 'offlineIntercepted', how: 'enter', chatId: cid, len: textNow0.length });
                  post({ type: 'queueMessage', chatId: cid, body: { uiText: textNow0 } });
                  // Clear input to reflect queued state
                  try {
                    if (node0) {
                      if ('value' in node0) { node0.value = ''; try { node0.dispatchEvent(new Event('input', { bubbles: true })); } catch(_){} }
                      else { node0.innerText = ''; try { node0.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch(_){} }
                    }
                  } catch {}
                }
                try { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); } catch {}
                return;
              }
              var startTick = Date.now();
              // capture candidate text immediately
              var textNow = '';
              var node = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
              if (node) {
                if ('value' in node) { textNow = (node.value||'').trim(); }
                else { textNow = (node.innerText || node.textContent || '').trim(); }
              }
              try { window.__owui_lastTextCandidate = textNow; } catch {}
              post({ type: 'debug', scope: 'injection', event: 'composeEnter', chatId: cid, online: !!navigator.onLine, len: (textNow||'').length });
              // Fallback: if offline and no completion fetch follows shortly, queue from DOM
              setTimeout(function(){
                try {
                  var rnVal = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
                  var offline = (window.__owui_wasOffline === true) || (rnVal === false);
                  if (!offline) return;
                  if ((window.__owui_lastCompletionTick||0) > startTick) return;
                  var text = String(window.__owui_lastTextCandidate||'').trim();
                  if (text && cid) {
                    post({ type: 'debug', scope: 'injection', event: 'queueFromDom', chatId: cid, len: text.length });
                    post({ type: 'queueMessage', chatId: cid, body: { uiText: text } });
                  }
                } catch {}
              }, 1200);
            }
          }
        } catch {}
      }, true);
      // Backup: intercept form submit within the compose container (contains #chat-input)
      document.addEventListener('submit', function(e){
        try {
          var tgt = e && e.target;
          var form = (tgt && (tgt.tagName === 'FORM' ? tgt : (tgt.closest ? tgt.closest('form') : null))) || null;
          if (!form) { return; }
          var hasChatInput = !!(form && form.querySelector && form.querySelector('#chat-input'));
          if (!hasChatInput) { return; }
          var parts = (window.location.pathname || '').split('/').filter(Boolean);
          var idx = parts.indexOf('c');
          var cid = (idx >= 0 && parts[idx+1]) ? parts[idx+1] : null;
          var rnValS = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
          var offlineS = (window.__owui_wasOffline === true) || (rnValS === false);
          if (!offlineS) { return; }
          var textNowS = '';
          var nodeS = form.querySelector('textarea, [contenteditable="true"], [role="textbox"]') || document.querySelector('#chat-input') || document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
          if (nodeS) {
            if ('value' in nodeS) { textNowS = (nodeS.value||'').trim(); }
            else { textNowS = (nodeS.innerText || nodeS.textContent || '').trim(); }
          }
          try { window.__owui_lastTextCandidate = textNowS; } catch {}
          if (textNowS && cid) {
            post({ type: 'debug', scope: 'injection', event: 'offlineIntercepted', how: 'submit', chatId: cid, len: textNowS.length });
            post({ type: 'queueMessage', chatId: cid, body: { uiText: textNowS } });
            try {
              if (nodeS) {
                if ('value' in nodeS) { nodeS.value = ''; try { nodeS.dispatchEvent(new Event('input', { bubbles: true })); } catch(_){} }
                else { nodeS.innerText = ''; try { nodeS.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch(_){} }
              }
            } catch {}
          }
          try { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); } catch {}
          return;
        } catch {}
      }, true);
      document.addEventListener('click', function(e){
        try {
          // Only handle clicks on the explicit Send button to avoid blocking other buttons when offline
          var sendBtn = e && e.target && (e.target.closest ? e.target.closest('#send-message-button') : null);
          if (!sendBtn) { return; }
          var parts = (window.location.pathname || '').split('/').filter(Boolean);
          var idx = parts.indexOf('c');
          var cid = (idx >= 0 && parts[idx+1]) ? parts[idx+1] : null;
          // If offline, intercept and queue immediately to avoid UI placeholder/duplicate
          var rnVal1 = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
          var offline1 = (window.__owui_wasOffline === true) || (rnVal1 === false);
          if (offline1) {
            var textNow1 = '';
            var node1 = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
            if (node1) {
              if ('value' in node1) { textNow1 = (node1.value||'').trim(); }
              else { textNow1 = (node1.innerText || node1.textContent || '').trim(); }
            }
            try { window.__owui_lastTextCandidate = textNow1; } catch {}
            if (textNow1 && cid) {
              post({ type: 'debug', scope: 'injection', event: 'offlineIntercepted', how: 'clickSend', chatId: cid, len: textNow1.length });
              post({ type: 'queueMessage', chatId: cid, body: { uiText: textNow1 } });
              // Clear input to reflect queued state
              try {
                if (node1) {
                  if ('value' in node1) { node1.value = ''; try { node1.dispatchEvent(new Event('input', { bubbles: true })); } catch(_){} }
                  else { node1.innerText = ''; try { node1.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch(_){} }
                }
              } catch {}
            }
            try { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); } catch {}
            return;
          }
          var startTick = Date.now();
          // capture candidate text immediately
          var textNow = '';
          var node = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
          if (node) {
            if ('value' in node) { textNow = (node.value||'').trim(); }
            else { textNow = (node.innerText || node.textContent || '').trim(); }
          }
          try { window.__owui_lastTextCandidate = textNow; } catch {}
          post({ type: 'debug', scope: 'injection', event: 'buttonClickSend', chatId: cid, online: !!navigator.onLine, len: (textNow||'').length });
          // Fallback: if offline and no completion fetch follows shortly, queue from DOM
          setTimeout(function(){
            try {
              var rnVal = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
              var offline = (window.__owui_wasOffline === true) || (rnVal === false);
              if (!offline) return;
              if ((window.__owui_lastCompletionTick||0) > startTick) return;
              var text = String(window.__owui_lastTextCandidate||'').trim();
              if (text && cid) {
                post({ type: 'debug', scope: 'injection', event: 'queueFromDom', chatId: cid, len: text.length });
                post({ type: 'queueMessage', chatId: cid, body: { uiText: text } });
              }
            } catch {}
          }, 1200);
        } catch {}
      }, true);
    } catch {}

    function getCookie(name) {
      try {
        const m = (document.cookie || '').match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
      } catch (_) { return null; }
    }

    function checkAuthOnce() {
      if (sentAuth) return;
      // Try common cookie names used by Auth.js/NextAuth and a generic session-token fallback
      const names = [
        'authjs.session-token',
        '__Secure-authjs.session-token',
        'next-auth.session-token',
        '__Secure-next-auth.session-token',
        'token',
      ];
      let t = null;
      for (var i = 0; i < names.length && !t; i++) { t = getCookie(names[i]); }
      if (!t) {
        try {
          var parts = (document.cookie || '').split(';');
          for (var j = 0; j < parts.length && !t; j++) {
            var kv = parts[j].trim();
            var eq = kv.indexOf('=');
            if (eq > 0) {
              var k = kv.slice(0, eq);
              var v = decodeURIComponent(kv.slice(eq + 1));
              if (/session-token$/i.test(k)) { t = v; break; }
            }
          }
        } catch (_) {}
      }
      if (t) { sentAuth = true; post({ type: 'authToken', token: t }); post({ type: 'debug', scope: 'injection', event: 'authCookieCaptured' }); }
    }

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

    checkAuthOnce();
    const authPoll = setInterval(checkAuthOnce, 3000);
    try { post({ type: 'debug', scope: 'injection', event: 'injected' }); } catch {}

    // Capture Authorization from XMLHttpRequest as well (e.g., axios)
    try {
      const XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype && !XHR.prototype.__owui_patched) {
        const origSetHeader = XHR.prototype.setRequestHeader;
        XHR.prototype.setRequestHeader = function(name, value) {
          try {
            if (!sentAuth && /authorization/i.test(String(name))) {
              const m = String(value).match(/Bearer\s+(.+)/i);
              if (m && m[1]) { sentAuth = true; post({ type: 'authToken', token: m[1] }); post({ type: 'debug', scope: 'injection', event: 'authXHRHeaderCaptured' }); }
            }
          } catch {}
          return origSetHeader.apply(this, arguments);
        };
        // mark patched
        XHR.prototype.__owui_patched = true;
      }
    } catch {}

    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
      try {
        // Force sites that gate on navigator.onLine to attempt fetch even when offline.
        // This enables our network-failure path below to queue the message body.
        try {
          var proto = Object.getPrototypeOf(navigator);
          var d = Object.getOwnPropertyDescriptor(proto, 'onLine');
          if (d && d.configurable && !proto.__owui_onLine_patched) {
            Object.defineProperty(proto, 'onLine', { configurable: true, get: function(){ return true; } });
            proto.__owui_onLine_patched = true;
            post({ type: 'debug', scope: 'injection', event: 'forceOnlinePatched', ok: true });
          }
        } catch (pe) { try { post({ type: 'debug', scope: 'injection', event: 'forceOnlinePatched', ok: false, message: String(pe && pe.message || pe) }); } catch(_){} }

        // Attempt to capture Authorization header or cookie token before request
        const hh = new Headers((init && init.headers) || {});
        const ah = hh.get('authorization') || hh.get('Authorization');
        if (ah && !sentAuth) {
          const m = ah.match(/Bearer\s+(.+)/i);
          if (m && m[1]) { sentAuth = true; post({ type: 'authToken', token: m[1] }); post({ type: 'debug', scope: 'injection', event: 'authHeaderCaptured' }); }
        } else if (!sentAuth) {
          checkAuthOnce();
        }
      } catch (_) {}

      // If this is a chat completion POST, optionally queue when offline
      let targetUrl = typeof input === 'string' ? input : (input && input.url);
      const isCompletion = (() => {
        try {
          const u = new URL(targetUrl, window.location.href);
          const p = u.pathname;
          return (p === '/api/chat/completions' || p === '/api/v1/chat/completions') && u.host === host;
        } catch { return false; }
      })();

      if (isCompletion) {
        try {
          try {
            const u = new URL(targetUrl, window.location.href);
            post({ type: 'debug', scope: 'injection', event: 'completionDetected', pathname: u.pathname, online: !!navigator.onLine });
          } catch {}
          const bodyRaw = init && init.body;
          let bodyParsed = null;
          if (typeof bodyRaw === 'string') {
            try { bodyParsed = JSON.parse(bodyRaw); } catch {}
          }
          // Derive chatId from URL path /c/:id if present
          let chatId = null;
          try {
            const parts = (window.location.pathname || '').split('/').filter(Boolean);
            const i = parts.indexOf('c');
            if (i >= 0 && parts[i+1]) chatId = parts[i+1];
          } catch {}
          if (!navigator.onLine && bodyParsed && chatId) {
            try { post({ type: 'debug', scope: 'injection', event: 'queueCandidate', chatId, bodyKeys: Object.keys(bodyParsed || {}), online: !!navigator.onLine }); } catch {}
            post({ type: 'queueMessage', chatId, body: bodyParsed });
          }
        } catch (_) {}
      }

      let res;
      try {
        res = await origFetch(input, init);
      } catch (err) {
        // Network failure: try queueing
        if (isCompletion) {
          try {
            const bodyRaw = init && init.body;
            let bodyParsed = null;
            if (typeof bodyRaw === 'string') { try { bodyParsed = JSON.parse(bodyRaw); } catch {} }
            let chatId = null;
            try {
              const parts = (window.location.pathname || '').split('/').filter(Boolean);
              const i = parts.indexOf('c');
              if (i >= 0 && parts[i+1]) chatId = parts[i+1];
            } catch {}
            if (bodyParsed && chatId) {
              try { post({ type: 'debug', scope: 'injection', event: 'queueOnError', chatId, bodyKeys: Object.keys(bodyParsed || {}), error: String(err && err.message || err) }); } catch {}
              post({ type: 'queueMessage', chatId, body: bodyParsed });
            }
          } catch {}
        }
        throw err;
      }
      // Mark success tick for completion sends
      try {
        if (isCompletion && res && res.ok) {
          window.__owui_lastCompletionTick = Date.now();
          post({ type: 'debug', scope: 'injection', event: 'completionOk' });
        }
      } catch (_) {}
      try {
        const url = typeof input === 'string' ? input : input.url;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') && shouldCache(url)) {
          const clone = res.clone();
          const data = await clone.json();
          post({ type: 'cacheResponse', url, data });
        } else if ((ct.includes('application/octet-stream') || ct.includes('application/pdf') || ct.includes('image/') || ct.includes('zip') || ct.includes('ms-') || ct.includes('officedocument')) && url) {
          // Likely a download; attempt to capture
          const disp = res.headers.get('content-disposition') || '';
          if (/attachment/i.test(disp)) {
            const clone = res.clone();
            const blob = await clone.blob();
            const b64 = await readBlobAsBase64(blob);
            const nameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disp);
            const filename = decodeURIComponent(nameMatch?.[1] || nameMatch?.[2] || 'download');
            post({ type: 'downloadBlob', filename, mime: ct, base64: b64 });
          }
        }
      } catch (e) {}
      return res;
    }

    const origOpen = window.open;
    window.open = function(url, target, features) {
      try { post({ type: 'externalLink', url }); } catch {}
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
          post({ type: 'externalLink', url: u.toString() });
        }
      } catch {}
    }, true);

  })();`;
}

export default function OpenWebUIView({ baseUrl, online, onQueueCountChange }: { baseUrl: string; online: boolean; onQueueCountChange?: (count: number) => void }) {
  const webref = useRef<WebView>(null);
  const drainingRef = React.useRef(false);
  const syncingRef = React.useRef(false);
  const baseUrlRef = React.useRef(baseUrl);
  React.useEffect(() => { baseUrlRef.current = baseUrl; }, [baseUrl]);

  // Mount-time visibility
  React.useEffect(() => {
    try {
      logInfo('webview', 'mount', { baseUrl });
    } catch {}
  }, [baseUrl]);

  // Inject one batch of webview-assisted drain using page cookies (fallback when no native token)
  const injectWebDrainBatch = useCallback(async () => {
    try {
      const host = new URL(baseUrlRef.current).host;
      const items = await listOutbox(host);
      if (!items.length) { drainingRef.current = false; return; }
      const batch = items.slice(0, 3).map((it) => ({ id: it.id, chatId: it.chatId, body: it.body }));
      logInfo('webviewDrain', 'sending batch', { size: batch.length });
      const js = `(() => { (async function(){
        try {
          const items = ${JSON.stringify(batch)};
          const okIds = [];
          for (let it of items) {
            try {
              if (it && it.body && it.body.uiText) {
                // UI-driven send using page cookies and app JS
                const before = (window.__owui_lastCompletionTick||0);
                // Insert text into input
                let text = String(it.body.uiText||'');
                let ta = document.querySelector('textarea');
                if (ta) {
                  ta.value = text;
                  try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
                } else {
                  let ce = document.querySelector('[contenteditable="true"]');
                  if (ce) {
                    ce.innerText = text;
                    try { ce.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch {}
                  }
                }
                // Click send button heuristics
                let clicked = false;
                let btn = document.querySelector('button[type="submit"], button[data-testid*="send" i]');
                if (!btn) {
                  const buttons = Array.from(document.querySelectorAll('button'));
                  btn = buttons.find(b => /send/i.test(b.textContent||'')) || buttons[buttons.length-1];
                }
                if (btn) {
                  try { btn.click(); clicked = true; } catch {}
                }
                // Wait up to 8s for completion fetch success tick
                let ok = false;
                for (let i=0;i<32;i++) {
                  await new Promise(r=>setTimeout(r,250));
                  if ((window.__owui_lastCompletionTick||0) > before) { ok = true; break; }
                }
                if (clicked && ok) {
                  okIds.push(it.id);
                } else {
                  break;
                }
              } else {
                const res = await fetch('/api/chat/completions', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'referer': '/c/' + it.chatId },
                  body: JSON.stringify(it.body)
                });
                if (res && res.ok) {
                  okIds.push(it.id);
                } else {
                  break;
                }
              }
            } catch (e) {
              break;
            }
          }
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'drainBatchResult', successIds: okIds }));
        } catch (e) {
          try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'drainBatchError', error: String(e && e.message || e) })); } catch (_) {}
        }
      })(); })();`;
      webref.current?.injectJavaScript(js);
    } catch {}
  }, []);

  // WebView-assisted full sync for when cookies exist but native token is not available (httpOnly)
  const injectWebSync = useCallback(async () => {
    try {
      const host = new URL(baseUrlRef.current).host;
      const { limitConversations, rps } = await getSettings(host);
      const minInterval = Math.max(0, Math.floor(1000 / Math.max(1, rps)));
      const js = `(() => { (async () => {
        function post(m){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(_){} }
        try {
          if (window.__owui_syncing) { post({ type: 'debug', scope: 'injection', event: 'syncSkipAlreadyRunning' }); return; }
          window.__owui_syncing = true;
          post({ type: 'debug', scope: 'injection', event: 'syncStart' });
          const LIMIT = ${Number.isFinite(0) ? '' : ''}${limitConversations};
          const MIN = ${minInterval};
          let page = 1;
          const chats = [];
          for (;;) {
            const res = await fetch('/api/v1/chats/?page=' + page, { headers: { accept: 'application/json' }, credentials: 'include' });
            if (!res || !res.ok) break;
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;
            for (let i=0;i<data.length;i++) {
              const it = data[i];
              chats.push({ id: it.id, title: it.title });
              if (chats.length >= LIMIT) break;
            }
            if (chats.length >= LIMIT) break;
            if (MIN) { await new Promise(r=>setTimeout(r, MIN)); }
            page += 1;
          }
          let messages = 0;
          for (let i=0;i<chats.length;i++) {
            const c = chats[i];
            const url = '/api/v1/chats/' + c.id;
            try {
              const res = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'include' });
              if (res && res.ok) {
                const data = await res.json();
                if (data && data.archived === true) {
                  // skip archived
                } else {
                  try { post({ type: 'cacheResponse', url: (location.origin + url), data }); } catch(_){ }
                  try {
                    const mcount = Array.isArray(data && data.chat && data.chat.messages) ? data.chat.messages.length : (Array.isArray(data && data.messages) ? data.messages.length : 0);
                    messages += (mcount || 0);
                  } catch(_){}
                }
              }
            } catch(_){}
            if (MIN) { await new Promise(r=>setTimeout(r, MIN)); }
          }
          post({ type: 'syncDone', conversations: chats.length, messages });
        } catch (e) {
          try { post({ type: 'debug', scope: 'injection', event: 'syncError', message: String(e && e.message || e) }); } catch(_){}
        } finally {
          try { window.__owui_syncing = false; } catch(_){ }
        }
      })(); })();`;
      syncingRef.current = true;
      webref.current?.injectJavaScript(js);
    } catch {}
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data || '{}');
      const host = new URL(baseUrl).host;
      if (msg.type === 'debug') {
        logDebug('webview', 'debug', msg);
        try {
          if ((msg.event === 'injected' || msg.event === 'hasInjected') && !syncingRef.current) {
            const tok = await getToken(host);
            const settings = await getSettings(host);
            if (!tok && settings.fullSyncOnLoad) {
              await injectWebSync();
            } else if (!settings.fullSyncOnLoad) {
              logInfo('sync', 'fullSyncOnLoad disabled, skip webview-assisted sync');
            }
          }
        } catch {}
        return;
      }
      if (msg.type === 'drainBatchResult' && Array.isArray(msg.successIds)) {
        await removeOutboxItems(host, msg.successIds);
        const remaining = await count(host);
        const token = await getToken(host);
        logInfo('webviewDrain', 'batch result', { removed: msg.successIds.length, remaining });
        try {
          if (msg.successIds.length > 0) {
            try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch {}
            Toast.show({ type: 'success', text1: `Sent ${msg.successIds.length} queued` });
          }
        } catch {}
        try { onQueueCountChange && onQueueCountChange(remaining); } catch {}
        if (!token && remaining > 0) {
          await injectWebDrainBatch();
        } else {
          drainingRef.current = false;
        }
        return;
      }
      if (msg.type === 'drainBatchError') {
        logInfo('webviewDrain', 'batch error', { error: msg.error });
        drainingRef.current = false;
        return;
      }
      if (msg.type === 'authToken' && typeof msg.token === 'string') {
        await setToken(host, msg.token);
        logInfo('outbox', 'token saved for host', { host });
        return;
      }
      if (msg.type === 'syncDone') {
        try {
          await AsyncStorage.setItem(`sync:done:${host}`, String(Date.now()));
          logInfo('sync', 'done flag set (webview-assisted)', { host, conversations: msg.conversations, messages: msg.messages });
        } catch {}
        syncingRef.current = false;
        return;
      }
      if (msg.type === 'queueMessage' && msg.chatId && msg.body) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await enqueue(host, { id, chatId: msg.chatId, body: msg.body });
        const c = await count(host);
        logInfo('outbox', 'enqueued', { chatId: msg.chatId, bodyKeys: Object.keys(msg.body || {}), count: c });
        try {
          try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch {}
          Toast.show({ type: 'info', text1: 'Message queued' });
        } catch {}
        try { onQueueCountChange && onQueueCountChange(c); } catch {}
        return;
      }
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
        await cacheApiResponse(host, entry);
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
      try {
        logDebug('webview', 'raw', String(e?.nativeEvent?.data || ''));
      } catch {}
    }
  }, [baseUrl, injectWebDrainBatch]);

  const injected = useMemo(() => buildInjection(baseUrl), [baseUrl]);

  // Keep page aware of RN connectivity so DOM fallback can enqueue when RN says offline
  React.useEffect(() => {
    try {
      const val = online ? 'true' : 'false';
      const js = `(function(){try{ window.__owui_rnOnline = ${online ? 'true' : 'false'}; if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){ window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'rn',event:'online',online:${online ? 'true' : 'false'}})); } }catch(_){}})();`;
      webref.current?.injectJavaScript(js);
    } catch {}
  }, [online]);

  // On becoming online: if no native token but outbox has items, start webview-assisted drain
  React.useEffect(() => {
    (async () => {
      if (!online) return;
      const host = new URL(baseUrl).host;
      const [c, token] = [await count(host), await getToken(host)];
      if (c > 0 && !token && !drainingRef.current) {
        drainingRef.current = true;
        logInfo('webviewDrain', 'start (no native token)', { host, pending: c });
        await injectWebDrainBatch();
      }
    })();
  }, [online, baseUrl, injectWebDrainBatch]);

  // One-shot manual injection attempt as a fallback
  React.useEffect(() => {
    try {
      logDebug('webview', 'manual inject attempt');
      webref.current?.injectJavaScript(`${injected};true;`);
    } catch {}
  }, [injected]);

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
          logDebug('webview', 'allow navigation', current.toString());
          return true;
        } catch {
          return true;
        }
      }}
      injectedJavaScriptBeforeContentLoaded={injected}
      injectedJavaScript={injected}
      onLoadEnd={() => {
        try {
          logDebug('webview', 'onLoadEnd reinject');
          // Attempt plain reinject
          webref.current?.injectJavaScript(`${injected};true;`);
          // Probe the bridge explicitly
          webref.current?.injectJavaScript(`(function(){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('{"type":"debug","scope":"probe","event":"ping"}')}catch(e){}})();`);
          // Safe-eval wrapper to catch syntax/runtime errors of the injected bundle
          const WRAP = `(function(){try{var CODE=${JSON.stringify(injected)}; (new Function('code', 'return eval(code)'))(CODE);}catch(e){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'evalError',message:String(e&&e.message||e)}))}catch(_){} }})();`;
          webref.current?.injectJavaScript(WRAP);
          // Report whether our guard flag is set in page context
          webref.current?.injectJavaScript(`(function(){try{var v=!!window.__owui_injected;window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'hasInjected',val:v}))}catch(e){}})();`);
        } catch {}
      }}
      onNavigationStateChange={(navState) => {
        try {
          logDebug('webview', 'nav change', navState.url);
          webref.current?.injectJavaScript(`${injected};true;`);
          const WRAP = `(function(){try{var CODE=${JSON.stringify(injected)}; (new Function('code', 'return eval(code)'))(CODE);}catch(e){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'evalError',message:String(e&&e.message||e)}))}catch(_){} }})();`;
          webref.current?.injectJavaScript(WRAP);
          webref.current?.injectJavaScript(`(function(){try{var v=!!window.__owui_injected;window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'hasInjected',val:v}))}catch(e){}})();`);
        } catch {}
      }}
      onError={(syntheticEvent) => {
        try {
          logInfo('webview', 'error', syntheticEvent.nativeEvent);
        } catch {}
      }}
      allowsBackForwardNavigationGestures
      startInLoadingState
    />
  );
}
