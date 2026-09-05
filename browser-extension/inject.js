/* Speusis Extension — Interceptor Bootstrap v0.23 */
/* Runs in the ISOLATED world at document_start. Its only job is to inject
 * interceptor.js as a real <script src> tag so THAT file executes in the
 * page's actual MAIN world and can patch the page's real window.fetch /
 * XMLHttpRequest.prototype.open.
 *
 * Why this exists: content scripts run in an ISOLATED world by default.
 * interceptor.js patching XHR/fetch there patches a copy the page never
 * calls — it silently detects nothing. Chrome MV3 offers a "world":"MAIN"
 * manifest key to fix this, but Firefox's MV2 build here has no equivalent,
 * so this classic injected-<script> technique is used instead — it works
 * the same way on both browsers and both manifest versions. */
(function () {
  "use strict";

  /* document_start can run before <head> or even <html> exists.  The old
   * one-shot prepend silently did nothing in that case, which left the
   * interceptor completely uninstalled on some YouTube navigations. */
  let injected = false;
  function inject() {
    if (injected || !document.documentElement) return;
    injected = true;
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("interceptor.js");
      s.onload = function () { this.remove(); };
      s.onerror = function () { injected = false; };
      document.documentElement.prepend(s);
    } catch (_) {
      injected = false;
    }
  }

  inject();
  if (!injected) {
    const retry = setInterval(() => {
      inject();
      if (injected) clearInterval(retry);
    }, 10);
    setTimeout(() => clearInterval(retry), 5000);
  }
})();
