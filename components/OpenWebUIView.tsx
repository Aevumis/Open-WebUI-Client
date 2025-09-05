import React, { useCallback, useMemo, useRef } from "react";
import { Alert, Platform, useColorScheme } from "react-native";
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
      // Probe availability and report to native for UX hints - with better timing
      (async function(){
        try {
          // Wait for page to be more ready before testing SW
          const isPageReady = window.location.host && window.location.host.length > 0;
          if (!isPageReady) {
            post({ type: 'debug', scope: 'injection', event: 'swDetectionSkipped', reason: 'pageNotReady', host: window.location.host });
            return;
          }
          
          post({ type: 'debug', scope: 'injection', event: 'swDetectionStart', host: window.location.host });
          
          let hasSW = false;
          let method = 'regCheck';
          let status = null;
          let swFunctional = false;
          let error = null;
          
          try {
            // First check if SW file exists
            method = 'head';
            const res = await fetch('/sw.js', { method: 'HEAD', cache: 'no-store' });
            status = res && res.status;
            hasSW = !!(res && res.ok);
            post({ type: 'debug', scope: 'injection', event: 'swFileCheck', method: 'head', status, hasSW });
            
            if (!hasSW && (!res || status === 405 || status === 501)) {
              method = 'get';
              const res2 = await fetch('/sw.js', { method: 'GET', cache: 'no-store' });
              status = res2 && res2.status;
              hasSW = !!(res2 && res2.ok);
              post({ type: 'debug', scope: 'injection', event: 'swFileCheck', method: 'get', status, hasSW });
            }
          } catch (e) {
            error = String(e && e.message || e);
            post({ type: 'debug', scope: 'injection', event: 'swFileCheckError', error });
          }
          
          // Check registration status
          if (!hasSW) {
            try {
              const reg = await (navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration() : Promise.resolve(null));
              const regActive = !!(reg && reg.active);
              hasSW = regActive;
              if (hasSW) method = 'registration';
              post({ type: 'debug', scope: 'injection', event: 'swRegistrationCheck', hasRegistration: !!reg, hasActive: regActive, hasSW });
            } catch (e) {
              post({ type: 'debug', scope: 'injection', event: 'swRegistrationError', error: String(e && e.message || e) });
            }
          }
          
          // Test if SW is actually functional (only if we think it exists)
          if (hasSW) {
            try {
              // Wait a bit for SW to be ready, then test functionality
              await new Promise(r => setTimeout(r, 1000));
              const testRes = await fetch('/sw.js', { 
                method: 'GET', 
                cache: 'no-store',
                headers: { 'x-sw-test': 'functional-check' }
              });
              swFunctional = !!(testRes && testRes.ok);
              post({ type: 'debug', scope: 'injection', event: 'swFunctionalTest', swFunctional, status: testRes && testRes.status });
            } catch (e) {
              swFunctional = false;
              post({ type: 'debug', scope: 'injection', event: 'swFunctionalError', error: String(e && e.message || e) });
            }
          }
          
          post({ type: 'debug', scope: 'injection', event: 'swDetectionComplete', hasSW, swFunctional, method, status, error });
          try { post({ type: 'swStatus', hasSW, swFunctional, method, status, error }); } catch(_){}
        } catch (e) {
          post({ type: 'debug', scope: 'injection', event: 'swDetectionFailed', error: String(e && e.message || e) });
        }
      })();
    }
    else {
      try { 
        post({ type: 'debug', scope: 'injection', event: 'swUnsupported' });
        post({ type: 'swStatus', hasSW: false, method: 'unsupported' }); 
      } catch(_){}
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

// Document-start theme bootstrap: generic theming without app-specific internals.
// - Shims matchMedia('(prefers-color-scheme: dark)') to reflect RN scheme
// - Applies html class 'dark', data-theme attribute, and color-scheme style/meta
// - Respects explicit user choice in localStorage ('light'|'dark'); only overrides null/system/auto
// - Exposes window.__owui_notifyThemeChange(isDark) to re-assert later
function buildThemeBootstrap(scheme: 'dark' | 'light' | null) {
  const isDark = scheme === 'dark';
  return `(() => { try {
    var isDark = ${isDark ? 'true' : 'false'};
    try { window.__owui_rnColorScheme = isDark ? 'dark' : 'light'; } catch(_){ }
    try {
      var listeners = new Set();
      var darkMql = {
        matches: isDark,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: function(fn){ try{ listeners.add(fn); }catch(_){ } },
        removeListener: function(fn){ try{ listeners.delete(fn); }catch(_){ } },
        addEventListener: function(type, fn){ if(type==='change') this.addListener(fn); },
        removeEventListener: function(type, fn){ if(type==='change') this.removeListener(fn); }
      };
      function dispatchMql(){
        try {
          var ev = { matches: darkMql.matches, media: darkMql.media };
          if (typeof darkMql.onchange === 'function') { try { darkMql.onchange(ev); } catch(_){} }
          listeners.forEach(function(fn){ try { fn(ev); } catch(_){} });
        } catch(_){ }
      }
      var origMatchMedia = window.matchMedia;
      function owuiMatchMedia(q){
        try {
          if (typeof q === 'string' && /\(prefers-color-scheme:\s*dark\)/i.test(q)) { return darkMql; }
        } catch(_){ }
        return origMatchMedia ? origMatchMedia.call(window, q) : { matches: false, media: String(q||''), onchange: null, addListener: function(){}, removeListener: function(){}, addEventListener: function(){}, removeEventListener: function(){} };
      }
      try { Object.defineProperty(window, 'matchMedia', { configurable: true, get: function(){ return owuiMatchMedia; } }); } catch(_){ }
      window.__owui_notifyThemeChange = function(isDarkNow){
        try {
          darkMql.matches = !!isDarkNow;
          try { document && document.documentElement && document.documentElement.classList && document.documentElement.classList.toggle('dark', !!isDarkNow); } catch(_){ }
          try { document && document.documentElement && document.documentElement.setAttribute && document.documentElement.setAttribute('data-theme', (!!isDarkNow ? 'dark' : 'light')); } catch(_){ }
          try { document && document.documentElement && document.documentElement.style && (document.documentElement.style.colorScheme = (!!isDarkNow ? 'dark' : 'light')); } catch(_){ }
          try { var meta = document.querySelector('meta[name="color-scheme"]'); if(!meta){ meta = document.createElement('meta'); meta.setAttribute('name','color-scheme'); (document.head||document.documentElement).appendChild(meta); } meta.setAttribute('content', 'dark light'); } catch(_){ }
          try {
            var stored = null; try { stored = localStorage.getItem('theme'); } catch(_){ }
            if (stored === null || /^(system|auto)$/i.test(String(stored))) {
              try { localStorage.setItem('theme', (!!isDarkNow ? 'dark' : 'light')); localStorage.setItem('resolvedTheme', (!!isDarkNow ? 'dark' : 'light')); } catch(_){ }
            }
          } catch(_){ }
          try { window && window.dispatchEvent && window.dispatchEvent(new Event('storage')); } catch(_){ }
          dispatchMql();
        } catch(_){ }
      };
      // Initialize now
      window.__owui_notifyThemeChange(isDark);
    } catch(_){ }
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'debug', scope:'injection', event:'themeBootstrap' })); } catch(_){ }
  } catch(_){ } })();`;
}

export default function OpenWebUIView({ baseUrl, online, onQueueCountChange }: { baseUrl: string; online: boolean; onQueueCountChange?: (count: number) => void }) {
  const webref = useRef<WebView>(null);
  const drainingRef = React.useRef(false);
  const syncingRef = React.useRef(false);
  const baseUrlRef = React.useRef(baseUrl);
  React.useEffect(() => { baseUrlRef.current = baseUrl; }, [baseUrl]);
  const colorScheme = useColorScheme();
  const isAndroid = Platform.OS === 'android';
  const dev = (typeof __DEV__ !== 'undefined' && __DEV__);

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
      if (msg.type === 'swStatus') {
        logInfo('webview', 'swStatus', msg);
        try {
          const key = `swhint:${host}`;
          const pendingKey = `${key}:pending`;
          const shownCount = parseInt(await AsyncStorage.getItem(key) || '0');
          
          // If this is an "unsupported" detection (early timing issue), delay the warning
          if (msg.method === 'unsupported') {
            const existingPending = await AsyncStorage.getItem(pendingKey);
            if (!existingPending) {
              await AsyncStorage.setItem(pendingKey, String(Date.now()));
              logInfo('webview', 'swUnsupportedPending', { host, delayingWarning: true });
              
              // Wait 3 seconds, then check if we got a better detection
              setTimeout(async () => {
                try {
                  const stillPending = await AsyncStorage.getItem(pendingKey);
                  if (stillPending) {
                    // No better detection came in, show the warning
                    await AsyncStorage.removeItem(pendingKey);
                    const currentCount = parseInt(await AsyncStorage.getItem(key) || '0');
                    if (currentCount < 2) {
                      await AsyncStorage.setItem(key, String(currentCount + 1));
                      Toast.show({
                        type: 'info',
                        text1: 'Service Worker not supported',
                        text2: 'Your browser may not support Service Workers. Tap to learn more.',
                        onPress: async () => {
                          try { await WebBrowser.openBrowserAsync('https://github.com/Aevumis/Open-WebUI-Client/tree/main/webui-sw'); } catch {}
                        },
                      });
                      logInfo('webview', 'swDelayedWarningShown', { host, method: 'unsupported', shownCount: currentCount + 1 });
                    }
                  }
                } catch {}
              }, 3000);
            }
            return;
          }
          
          // Clear any pending unsupported warning since we got a real detection
          await AsyncStorage.removeItem(pendingKey);
          
          // Only show toast if:
          // 1. SW file doesn't exist OR SW exists but isn't functional
          // 2. Haven't shown this warning more than 2 times for this host
          // 3. Give preference to functional check over file existence
          const shouldWarn = (!msg.hasSW || (msg.hasSW && msg.swFunctional === false)) && shownCount < 2;
          
          if (shouldWarn) {
            await AsyncStorage.setItem(key, String(shownCount + 1));
            const warningText = !msg.hasSW 
              ? 'Service Worker not found on server'
              : 'Service Worker found but not working properly';
            
            Toast.show({
              type: 'info',
              text1: 'Offline mode not fully enabled',
              text2: `${warningText}. Tap to learn more.`,
              onPress: async () => {
                try { await WebBrowser.openBrowserAsync('https://github.com/Aevumis/Open-WebUI-Client/tree/main/webui-sw'); } catch {}
              },
            });
            
            logInfo('webview', 'swWarningShown', { 
              host, 
              hasSW: msg.hasSW, 
              swFunctional: msg.swFunctional, 
              method: msg.method, 
              shownCount: shownCount + 1 
            });
          } else if (msg.hasSW && msg.swFunctional !== false) {
            // SW appears to be working, clear any previous warning count
            await AsyncStorage.removeItem(key);
            logInfo('webview', 'swWorking', { host, method: msg.method });
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
      if (msg.type === 'themeProbe' && msg.payload) {
        try {
          logInfo('theme', 'probe', msg.payload);
        } catch {}
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
        logDebug('webview', 'onMessageError', { error: String(err) });
        logDebug('webview', 'raw', String(e?.nativeEvent?.data || ''));
      } catch {}
    }
  }, [baseUrl, injectWebDrainBatch, injectWebSync, onQueueCountChange]);

  const injected = useMemo(() => buildInjection(baseUrl), [baseUrl]);
  const themeBootstrap = useMemo(() => buildThemeBootstrap(colorScheme as 'dark' | 'light' | null), [colorScheme]);
  const beforeScripts = useMemo(() => `${themeBootstrap};${injected}`, [themeBootstrap, injected]);

  // Keep page aware of RN connectivity so DOM fallback can enqueue when RN says offline
  React.useEffect(() => {
    try {
      const js = `(function(){try{ window.__owui_rnOnline = ${online ? 'true' : 'false'}; if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){ window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'rn',event:'online',online:${online ? 'true' : 'false'}})); } }catch(_){}})();`;
      webref.current?.injectJavaScript(js);
    } catch {}
  }, [online]);

  // Debug: inject a theme probe to read the page's current theme-related state
  const injectThemeProbe = useCallback(() => {
    if (!dev) return;
    try {
      const js = `(function(){try{
        var html = document.documentElement||{};
        var body = document.body||{};
        var hasDarkClass = !!(html.classList && html.classList.contains('dark'));
        var dataTheme = (html.getAttribute && html.getAttribute('data-theme')) || null;
        var colorSchemeStyle = (html.style && html.style.colorScheme) || null;
        var localTheme = null, localResolved = null;
        try { localTheme = localStorage.getItem('theme'); } catch(_){}
        try { localResolved = localStorage.getItem('resolvedTheme'); } catch(_){}
        var mqlDark = null; try { var m = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)'); mqlDark = !!(m && m.matches); } catch(_){}
        var rnScheme = (typeof window.__owui_rnColorScheme==='string') ? window.__owui_rnColorScheme : null;
        var pageBg = null; try { pageBg = window.getComputedStyle(body).backgroundColor; } catch(_){}
        var htmlBg = null; try { htmlBg = window.getComputedStyle(html).backgroundColor; } catch(_){}
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'themeProbe', payload: { hasDarkClass, dataTheme, colorSchemeStyle, localTheme, localResolved, mqlDark, rnScheme, pageBg, htmlBg } }));
      }catch(e){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'debug', scope:'probe', event:'themeProbeError', message:String(e && e.message || e) })); }catch(_){} }})();`;
      webref.current?.injectJavaScript(js);
    } catch {}
  }, [dev]);

  // Apply device color scheme inside the WebView (helps when matchMedia doesn't reflect OS in RN WebView)
  React.useEffect(() => {
    try {
      const dark = colorScheme === 'dark';
      logInfo('theme', 'apply RN scheme', { scheme: colorScheme });
      const js = `(() => { try {
        var isDark = ${colorScheme === 'dark' ? 'true' : 'false'};
        try { window.__owui_rnColorScheme = isDark ? 'dark' : 'light'; } catch(_){ }
        try {
          if (typeof window.__owui_notifyThemeChange === 'function') {
            window.__owui_notifyThemeChange(isDark);
          } else {
            // Fallback generic application without overriding explicit user theme
            try { if (document && document.documentElement && document.documentElement.classList) { document.documentElement.classList.toggle('dark', isDark); } } catch(_){ }
            try { document && document.documentElement && document.documentElement.setAttribute && document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light'); } catch(_){ }
            try { document && document.documentElement && document.documentElement.style && (document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'); } catch(_){ }
            try { var stored = null; try{ stored = localStorage.getItem('theme'); }catch(_){ }
                 if (stored === null || /^(system|auto)$/i.test(String(stored))) {
                   try { localStorage.setItem('theme', (isDark ? 'dark' : 'light')); localStorage.setItem('resolvedTheme', (isDark ? 'dark' : 'light')); } catch(_){ }
                 }
            } catch(_){ }
            try { if (window && window.dispatchEvent) { window.dispatchEvent(new Event('storage')); } } catch(_){ }
          }
          try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'debug', scope:'rn', event:'colorSchemeApplied', scheme: (isDark ? 'dark':'light') })); } catch(_){ }
        } catch(_){ }
      } catch(_){ } })();`;
      webref.current?.injectJavaScript(js);
      // Probe immediately after applying
      injectThemeProbe();
      if (isAndroid) {
        // Note: react-native-webview supports forceDarkOn on Android; use it to encourage dark rendering where applicable
        logInfo('theme', 'android forceDarkOn set', { forceDarkOn: !!dark });
      }
    } catch {}
  }, [colorScheme, injectThemeProbe, isAndroid]);

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
      // Also perform a theme probe early
      injectThemeProbe();
    } catch {}
  }, [injected, injectThemeProbe]);

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
      onPermissionRequest={(request) => {
        // Grant microphone and camera permissions for WebRTC features
        if (request.nativeEvent.resources.includes('microphone') || 
            request.nativeEvent.resources.includes('camera')) {
          request.nativeEvent.grant();
        } else {
          request.nativeEvent.deny();
        }
      }}
      // Encourage Android to respect dark theme at the rendering layer (in addition to page CSS)
      forceDarkOn={isAndroid && colorScheme === 'dark'}
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
        } catch {
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
      injectedJavaScriptBeforeContentLoaded={beforeScripts}
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
          // Re-assert theme via bootstrap notify if available
          const APPLY = `(function(){try{var isDark=${colorScheme === 'dark' ? 'true' : 'false'}; if (typeof window.__owui_notifyThemeChange==='function'){ window.__owui_notifyThemeChange(isDark); } }catch(_){}})();`;
          webref.current?.injectJavaScript(APPLY);
          // Probe current theme state after load
          injectThemeProbe();
        } catch {}
      }}
      onNavigationStateChange={(navState) => {
        try {
          logDebug('webview', 'nav change', navState.url);
          webref.current?.injectJavaScript(`${injected};true;`);
          const WRAP = `(function(){try{var CODE=${JSON.stringify(injected)}; (new Function('code', 'return eval(code)'))(CODE);}catch(e){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'evalError',message:String(e&&e.message||e)}))}catch(_){} }})();`;
          webref.current?.injectJavaScript(WRAP);
          webref.current?.injectJavaScript(`(function(){try{var v=!!window.__owui_injected;window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'probe',event:'hasInjected',val:v}))}catch(e){}})();`);
          // Re-assert theme on navigation changes
          const APPLY = `(function(){try{var isDark=${colorScheme === 'dark' ? 'true' : 'false'}; if (typeof window.__owui_notifyThemeChange==='function'){ window.__owui_notifyThemeChange(isDark); } }catch(_){}})();`;
          webref.current?.injectJavaScript(APPLY);
          // Re-probe theme on each navigation to capture changes from the app
          injectThemeProbe();
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
