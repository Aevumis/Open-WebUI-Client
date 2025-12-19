import {
  AUTH_CAPTURE_TIMEOUT,
  AUTH_POLLING_INTERVAL,
  SW_READY_WAIT,
  WEBVIEW_LOAD_TIMEOUT,
} from "./constants";
import { safeGetHost } from "./url-utils";

/**
 * Generates the boilerplate injection script for the WebView.
 * Handles duplicate injection prevention, host verification, and basic postMessage wrapper.
 */
export function buildInjectionBoilerplate(allowedHost: string) {
  return `
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

    // Sanitization functions to prevent XSS vulnerabilities
    function sanitizeText(text) {
      try {
        if (typeof text !== 'string') {
          text = String(text || '');
        }
        // Limit to 50,000 characters
        if (text.length > 50000) {
          text = text.substring(0, 50000);
        }
        // Remove null bytes and control characters (except common whitespace)
        text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        return text;
      } catch (_) {
        return '';
      }
    }

    function validateChatId(chatId) {
      try {
        if (typeof chatId !== 'string') return false;
        // UUID pattern: alphanumeric and hyphens only
        return /^[0-9a-fA-F-]+$/.test(chatId);
      } catch (_) {
        return false;
      }
    }
  `;
}

/**
 * Generates error reporting and network state patching hooks.
 */
export function buildInjectionErrorHooks() {
  return `
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
    } catch (_) {}
  `;
}

/**
 * Generates DOM interception logic for offline support.
 */
export function buildInjectionDomInterception() {
  return `
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
                textNow0 = sanitizeText(textNow0);
                try { window.__owui_lastTextCandidate = textNow0; } catch {}
                if (textNow0 && cid && validateChatId(cid)) {
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
              textNow = sanitizeText(textNow);
              try { window.__owui_lastTextCandidate = textNow; } catch {}
              post({ type: 'debug', scope: 'injection', event: 'composeEnter', chatId: cid, online: !!navigator.onLine, len: (textNow||'').length });
              // Fallback: if offline and no completion fetch follows shortly, queue from DOM
              setTimeout(function(){
                try {
                  var rnVal = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
                  var offline = (window.__owui_wasOffline === true) || (rnVal === false);
                  if (!offline) return;
                  if ((window.__owui_lastCompletionTick||0) > startTick) return;
                  var text = sanitizeText(String(window.__owui_lastTextCandidate||'').trim());
                  if (text && cid && validateChatId(cid)) {
                    post({ type: 'debug', scope: 'injection', event: 'queueFromDom', chatId: cid, len: text.length });
                    post({ type: 'queueMessage', chatId: cid, body: { uiText: text } });
                  }
                } catch {} 
              }, ${WEBVIEW_LOAD_TIMEOUT});
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
          textNowS = sanitizeText(textNowS);
          try { window.__owui_lastTextCandidate = textNowS; } catch {}
          if (textNowS && cid && validateChatId(cid)) {
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
            textNow1 = sanitizeText(textNow1);
            try { window.__owui_lastTextCandidate = textNow1; } catch {}
            if (textNow1 && cid && validateChatId(cid)) {
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
          textNow = sanitizeText(textNow);
          try { window.__owui_lastTextCandidate = textNow; } catch {}
          post({ type: 'debug', scope: 'injection', event: 'buttonClickSend', chatId: cid, online: !!navigator.onLine, len: (textNow||'').length });
          // Fallback: if offline and no completion fetch follows shortly, queue from DOM
          setTimeout(function(){
            try {
              var rnVal = (typeof window.__owui_rnOnline !== 'undefined') ? !!window.__owui_rnOnline : null;
              var offline = (window.__owui_wasOffline === true) || (rnVal === false);
              if (!offline) return;
              if ((window.__owui_lastCompletionTick||0) > startTick) return;
              var text = sanitizeText(String(window.__owui_lastTextCandidate||'').trim());
                                if (text && cid && validateChatId(cid)) {
                                  post({ type: 'debug', scope: 'injection', event: 'queueFromDom', chatId: cid, len: text.length });
                                  post({ type: 'queueMessage', chatId: cid, body: { uiText: text } });
                                }
                              } catch {} 
                            }, ${WEBVIEW_LOAD_TIMEOUT});
                      } catch {} 
                    }, true);
                `;
}

/**
 * Generates auth token capture logic.
 */
export function buildInjectionAuthCapture() {
  return `
    function getCookie(name) {
      try {
        const parts = (document.cookie || '').split(';');
        for (var i = 0; i < parts.length; i++) {
          var kv = (parts[i] || '').trim();
          if (!kv) continue;
          if (kv.indexOf(name + '=') === 0) {
            return decodeURIComponent(kv.slice(name.length + 1));
          }
        }
        return null;
      } catch (_) { return null; }
    }

    function checkAuthOnce() {
      if (sentAuth) {
        if (window.__owui_authPoll) { clearInterval(window.__owui_authPoll); window.__owui_authPoll = null; }
        return;
      }
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
      if (t) {
        sentAuth = true;
        post({ type: 'authToken', token: t });
        post({ type: 'debug', scope: 'injection', event: 'authCookieCaptured' });
        if (window.__owui_authPoll) { clearInterval(window.__owui_authPoll); window.__owui_authPoll = null; }
      }
    }

        checkAuthOnce();

        if (!sentAuth) {

          window.__owui_authPoll = setInterval(checkAuthOnce, ${AUTH_POLLING_INTERVAL});

          // Prevent infinite polling

          setTimeout(() => {

            if (window.__owui_authPoll) {

              clearInterval(window.__owui_authPoll);

              window.__owui_authPoll = null;

              post({ type: 'debug', scope: 'injection', event: 'authPollingTimeout' });

            }

          }, ${AUTH_CAPTURE_TIMEOUT});

        }

    
  `;
}

/**
 * Generates service worker registration and status reporting logic.
 */
export function buildInjectionServiceWorker() {
  return `
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
              await new Promise(r => setTimeout(r, ${SW_READY_WAIT}));
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
  `;
}

/**
 * Generates fetch and XHR interception logic to capture conversations and downloads.
 */
export function buildInjectionFetchInterception() {
  return `
    function shouldCache(url) {
      try {
        const u = new URL(url, window.location.href);
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

    function parseContentDispositionFilename(disp) {
      try {
        var s = String(disp || '');
        if (!s) return 'download';

        var idxStar = s.toLowerCase().indexOf('filename*=');
        if (idxStar >= 0) {
          var after = s.slice(idxStar + 'filename*='.length);
          var semi = after.indexOf(';');
          if (semi >= 0) after = after.slice(0, semi);
          after = after.trim();
          if ((after[0] === '"' && after[after.length - 1] === '"') || (after[0] === "'" && after[after.length - 1] === "'")) {
            after = after.slice(1, -1);
          }
          var parts = after.split("''");
          var val = parts.length >= 2 ? parts.slice(1).join("''") : after;
          try { return decodeURIComponent(val); } catch (_) { return val || 'download'; }
        }

        var idx = s.toLowerCase().indexOf('filename=');
        if (idx >= 0) {
          var after2 = s.slice(idx + 'filename='.length);
          var semi2 = after2.indexOf(';');
          if (semi2 >= 0) after2 = after2.slice(0, semi2);
          after2 = after2.trim();
          if ((after2[0] === '"' && after2[after2.length - 1] === '"') || (after2[0] === "'" && after2[after2.length - 1] === "'")) {
            after2 = after2.slice(1, -1);
          }
          return after2 || 'download';
        }
        return 'download';
      } catch (_) {
        return 'download';
      }
    }

    // Capture Authorization from XMLHttpRequest as well (e.g., axios)
    try {
      const XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype && !XHR.prototype.__owui_patched) {
        const origSetHeader = XHR.prototype.setRequestHeader;
        XHR.prototype.setRequestHeader = function(name, value) {
          try {
            if (!sentAuth && /authorization/i.test(String(name))) {
              const m = String(value).match(/Bearer\\s+(.+)/i);
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
          const m = ah.match(/Bearer\\s+(.+)/i);
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
          if (!navigator.onLine && bodyParsed && chatId && validateChatId(chatId)) {
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
            if (bodyParsed && chatId && validateChatId(chatId)) {
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
        var absUrl = url;
        try { absUrl = new URL(url, window.location.href).toString(); } catch(_) { absUrl = url; }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') && shouldCache(absUrl)) {
          const clone = res.clone();
          const data = await clone.json();
          post({ type: 'cacheResponse', url: absUrl, data });
        } else if ((ct.includes('application/octet-stream') || ct.includes('application/pdf') || ct.includes('image/') || ct.includes('zip') || ct.includes('ms-') || ct.includes('officedocument')) && url) {
          // Likely a download; attempt to capture
          const disp = res.headers.get('content-disposition') || '';
          if (/attachment/i.test(disp)) {
            const clone = res.clone();
            const blob = await clone.blob();
            const b64 = await readBlobAsBase64(blob);
            const filename = parseContentDispositionFilename(disp);
            post({ type: 'downloadBlob', filename, mime: ct, base64: b64 });
          }
        }
      } catch (e) {}
      return res;
    };
  `;
}

/**
 * Generates logic to intercept external links and open them in the system browser.
 */
export function buildInjectionExternalLinks() {
  return `
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
  `;
}

/**
 * Combines all injection modules into a single script.
 */
export function buildInjection(baseUrl: string) {
  const h = safeGetHost(baseUrl);
  const allowedHost = JSON.stringify(h || "");
  return `(() => {
    ${buildInjectionBoilerplate(allowedHost)}
    ${buildInjectionErrorHooks()}
    ${buildInjectionDomInterception()}
    ${buildInjectionAuthCapture()}
    ${buildInjectionServiceWorker()}
    ${buildInjectionFetchInterception()}
    ${buildInjectionExternalLinks()}
  })();`;
}

/**
 * Generates the theme bootstrap script to apply the system color scheme to the WebView.
 */
export function buildThemeBootstrap(scheme: "dark" | "light" | null) {
  const isDark = scheme === "dark";
  return `(() => { try {
    var isDark = ${isDark ? "true" : "false"};
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
          if (typeof q === 'string' && /\\(prefers-color-scheme:\\s*dark\\)/i.test(q)) { return darkMql; }
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
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'debug', scope: 'injection', event:'themeBootstrap' })); } catch(_){ }
  } catch(_){ } })();`;
}

/**
 * Generates JS to perform a webview-assisted drain of the outbox.
 */
export function buildDrainBatchJS(batch: any[], timeout: number, interval: number) {
  return `(() => { (async function(){
    function findInput() {
      const selectors = ['textarea', '[contenteditable="true"]', '[role="textbox"]', '#chat-input'];
      for (var i=0; i<selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) return el;
      }
      return null;
    }
    function findBtn() {
      var btn = document.querySelector('#send-message-button') || 
                document.querySelector('button[type="submit"]') || 
                document.querySelector('button[data-testid*="send" i]');
      if (btn) return btn;
      var buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(function(b){ return /send/i.test(b.textContent||''); }) || buttons[buttons.length-1];
    }

    try {
      const items = ${JSON.stringify(batch)};
      const okIds = [];
      for (let it of items) {
        try {
          if (it && it.body && it.body.uiText) {
            // UI-driven send using page cookies and app JS
            const before = (window.__owui_lastCompletionTick||0);
            let text = String(it.body.uiText||'');
            let node = findInput();
            if (node) {
              if ('value' in node) {
                node.value = text;
                try { node.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
              } else {
                node.innerText = text;
                try { node.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch(_) {}
              }
            }
            
            let btn = findBtn();
            let clicked = false;
            if (btn) {
              try { btn.click(); clicked = true; } catch(_) {}
            }
            
            // Wait for completion fetch success tick
            let ok = false;
            for (let i=0; i<${Math.ceil(timeout / interval)}; i++) {
              await new Promise(r=>setTimeout(r, ${interval}));
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
}

/**
 * Generates JS to perform a webview-assisted full sync.
 */
export function buildSyncJS(opts: {
  expectedHost: string;
  maxConversations: number;
  timeoutMs: number;
}) {
  const allowedHost = JSON.stringify(opts.expectedHost || "");
  const maxConversations = Math.max(1, Math.floor(opts.maxConversations || 50));
  const timeoutMs = Math.max(1000, Math.floor(opts.timeoutMs || 15000));
  return `(() => { (async function(){
    function post(m){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(_){} }
    try {
      if (window.__owui_webSyncRunning) return;
      window.__owui_webSyncRunning = true;

      var expectedHost = ${allowedHost};
      try {
        if (expectedHost && window.location && window.location.host && window.location.host !== expectedHost) {
          post({ type: 'debug', scope: 'injection', event: 'syncError', message: 'Host mismatch', expectedHost: expectedHost, actualHost: window.location.host });
          return;
        }
      } catch(_){}

      function fetchWithTimeout(url, opts){
        try {
          var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          if (controller) {
            opts = opts || {};
            opts.signal = controller.signal;
          }
          var t = setTimeout(function(){ try { controller && controller.abort && controller.abort(); } catch(_){} }, ${timeoutMs});
          return fetch(url, opts).finally(function(){ try { clearTimeout(t); } catch(_){} });
        } catch (e) {
          return fetch(url, opts);
        }
      }

      post({ type: 'debug', scope: 'injection', event: 'syncStart', mode: 'crawler' });

      var conversations = [];
      var page = 1;
      while (conversations.length < ${maxConversations}) {
        var listUrl = '/api/v1/chats/?page=' + page;
        var res = await fetchWithTimeout(listUrl, { method: 'GET', credentials: 'include' });
        if (!res || !res.ok) throw new Error('Status ' + (res && res.status));
        var list = await res.json();
        var items = Array.isArray(list) ? list : (list && list.conversations) || [];
        if (!items || !items.length) break;
        for (var i = 0; i < items.length && conversations.length < ${maxConversations}; i++) {
          conversations.push(items[i]);
        }
        post({ type: 'debug', scope: 'injection', event: 'syncPage', page: page, totalSoFar: conversations.length });
        page += 1;
      }

      var msgCount = 0;
      for (var j = 0; j < conversations.length; j++) {
        var c = conversations[j];
        try {
          if (c && c.archived) continue;
          var id = c && c.id;
          if (!id) continue;
          post({ type: 'debug', scope: 'injection', event: 'syncItem', index: j + 1, total: conversations.length, id: id });
          var detailPath = '/api/v1/chats/' + id;
          var detailRes = await fetchWithTimeout(detailPath, { method: 'GET', credentials: 'include' });
          if (detailRes && detailRes.ok) {
            var data = await detailRes.json();
            var abs = detailPath;
            try { abs = new URL(detailPath, window.location.href).toString(); } catch(_) { abs = detailPath; }
            post({ type: 'cacheResponse', url: abs, data: data, title: (c && c.title) || undefined });
            var m = 0;
            try {
              m = (data && data.chat && data.chat.messages && data.chat.messages.length) || (data && data.messages && data.messages.length) || 0;
            } catch(_) { m = 0; }
            msgCount += m;
          }
        } catch(_){}
      }

      post({ type: 'syncDone', conversations: conversations.length, messages: msgCount });
      post({ type: 'debug', scope: 'injection', event: 'syncComplete', conversations: conversations.length, messages: msgCount });
    } catch (e) {
      try { post({ type: 'debug', scope: 'injection', event: 'syncError', message: String(e && e.message || e) }); } catch(_){ }
    } finally {
      try { window.__owui_webSyncRunning = false; } catch(_){}
    }
  })(); })();`;
}

/**
 * Generates JS to update the RN connectivity state in the WebView.
 */
export function buildConnectivityJS(online: boolean) {
  return `(function(){try{ window.__owui_rnOnline = ${online ? "true" : "false"}; if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){ window.ReactNativeWebView.postMessage(JSON.stringify({type:'debug',scope:'rn',event:'online',online:${online ? "true" : "false"}})); } }catch(_){}})();`;
}

/**
 * Generates JS to probe the current theme state of the page.
 */
export function buildThemeProbeJS() {
  return `(function(){try{
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
}

/**
 * Generates JS to apply the system color scheme to the page.
 */
export function buildApplyColorSchemeJS(isDark: boolean) {
  return `(() => { try {
    var isDark = ${isDark ? "true" : "false"};
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
}

/**
 * Generates JS to clean up intervals and other resources on unmount.
 */
export function buildCleanupJS() {
  return `
    (function(){
      if (window.__owui_authPoll) {
        clearInterval(window.__owui_authPoll);
        window.__owui_authPoll = null;
      }
    })();
  `;
}
