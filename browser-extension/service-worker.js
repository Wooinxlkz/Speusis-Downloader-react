/* Speusis Extension — Service Worker v0.27 — Cross-Browser */
"use strict";

const SPEUSIS_ENDPOINT = "http://127.0.0.1:9999/downloads";
// kikkia/yt-cipher (MIT) public instance - see interceptor.js's v0.27
// comment for the full explanation of what this does and doesn't do.
const YT_CIPHER_ENDPOINT = "https://cipher.kikkia.dev/resolve_url";
const DIALOG_WIDTH   = 640;
// The form only needs a compact viewport; its content area still scrolls
// when an informational notice is shown.
const DIALOG_HEIGHT  = 390;
const PENDING_KEY    = "__speusis_pending_download";
const DIALOG_ID_KEY  = "__speusis_dialog_id";

/*
 * In-memory flag blocks concurrent openDownloadDialog() calls within one SW
 * activation (handles the "multiple onCreated at once" race on session restore).
 * DIALOG_ID_KEY in storage handles the cross-SW-restart case.
 */
let _opening = false;

/* ── Startup: wipe stale state from the previous browser session ── */
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove([PENDING_KEY, DIALOG_ID_KEY]);
});

/* ── Install / Context Menus ─────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id:"speusis-download-link",  title:"Download with Speusis",              contexts:["link"] });
  chrome.contextMenus.create({ id:"speusis-download-video", title:"Download Video with Speusis",         contexts:["video","audio"] });
  chrome.contextMenus.create({ id:"speusis-download-page",  title:"Download Page Target with Speusis",   contexts:["page"] });
  chrome.contextMenus.create({ id:"speusis-collect-page-links", title:"Collect downloadable links", contexts:["page"] });
  chrome.contextMenus.create({ id:"speusis-download-page-media", title:"Download all media on page", contexts:["page"] });
});

/* ── Context Menu Clicks ─────────────────────────────────────────── */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if ((info.menuItemId === "speusis-collect-page-links" || info.menuItemId === "speusis-download-page-media") && tab?.id != null) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type:"speusis-scan-links" });
      const links = await filterBlockedLinks(result?.links || []);
      if (info.menuItemId === "speusis-download-page-media") {
        await queueBatch(links, tab.url, true);
        notify("Speusis", `${links.length} downloadable link(s) added to the queue.`);
      } else {
        await chrome.storage.local.set({ __speusis_last_collected_links: links, __speusis_last_collected_at: Date.now() });
        notify("Speusis", `${links.length} downloadable link(s) collected.`);
      }
    } catch {
      notify("Speusis", "This page does not allow link collection.");
    }
    return;
  }
  let url = null;
  if (info.menuItemId === "speusis-download-link"  && info.linkUrl) url = info.linkUrl;
  if (info.menuItemId === "speusis-download-video" && info.srcUrl)  url = info.srcUrl;
  if (info.menuItemId === "speusis-download-page"  && tab?.url)     url = tab.url;
  if (url && !isUnsupportedScheme(url))
    await openDownloadDialog({ url, pageUrl: tab?.url, pageTitle: tab?.title });
});

async function queueBatch(items, pageUrl, start) {
  const settings = await chrome.storage.local.get(["__speusis_quality_profile", "__speusis_rules"]);
  for (const item of items.slice(0, 500)) {
    const rule = findRule(item.url, settings.__speusis_rules || []);
    const body = {
      url: item.url, filename: item.name || guessFilename(item.url),
      start: !!start, pageUrl,
      qualityProfile: settings.__speusis_quality_profile || "best",
    };
    if (rule?.category) body.category = rule.category;
    try {
      const response = await fetch(SPEUSIS_ENDPOINT, {
        method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Speusis rejected the item");
    } catch {}
  }
}
function notify(title, message) {
  chrome.notifications.create({ type:"basic", iconUrl:"icon128.png", title, message });
}
function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
async function filterBlockedLinks(links) {
  const { __speusis_blocked_domains: blocked = [] } =
    await chrome.storage.local.get("__speusis_blocked_domains");
  return links.filter(item => {
    const host = domainOf(item.url);
    return !blocked.some(d => host === d || host.endsWith("." + d));
  });
}
function findRule(url, rules) {
  const host = domainOf(url);
  return rules.find(r => r?.domain && (host === r.domain || host.endsWith("." + r.domain)));
}

/* ── Intercept Browser Downloads ─────────────────────────────────── */
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.url || item.finalUrl || "";
  if (isUnsupportedScheme(url)) return;
  if (!isDownloadable(url)) return;
  try { await chrome.downloads.cancel(item.id); chrome.downloads.erase({ id: item.id }); } catch {}
  await openDownloadDialog({
    url,
    suggestedFilename: item.filename || guessFilename(url),
    fileSize: item.totalBytes > 0 ? item.totalBytes : null,
  });
});

/* ── Messages from content scripts ──────────────────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "speusis-subframe-stream") {
    // A cross-origin iframe detected a stream and can't render its own
    // badge usefully (too small/clipped) - relay it to the tab's top
    // frame so the one visible badge picks it up.
    if (sender.tab?.id != null) {
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: "speusis-subframe-stream-relay", url: message.url, streamType: message.streamType, encrypted: message.encrypted },
        { frameId: 0 }
      ).catch(() => {});
    }
    return;
  }
  if (message?.type === "speusis-resolve-yt-cipher") {
    resolveYtCipherFormats(message.playerUrl, message.formats || [], sender.tab?.id);
    return;
  }
  if (message?.type === "speusis-download") {
    openDownloadDialog({
      url:               message.url,
      suggestedFilename: message.filename,
      fileSize:          message.fileSize,
      pageUrl:           sender.tab?.url,
      pageTitle:         sender.tab?.title,
      isYouTube:         message.isYouTube,
      isStream:          message.isStream,
      streams:           message.streams,
      needsMux:          message.needsMux,
      videoUrl:          message.videoUrl,
      audioUrl:          message.audioUrl,
    }).then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message?.type === "speusis-start-download") {
    sendToSpeusis(message.url, message.filename, message.later, sender.tab?.url)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message?.type === "speusis-get-dialog-data") {
    chrome.storage.local.get([PENDING_KEY], (res) => {
      const data = res[PENDING_KEY] || null;
      sendResponse(data);
      if (data) chrome.storage.local.remove(PENDING_KEY);
    });
    return true;
  }
  if (message?.type === "speusis-get-file-size" && message.url) {
    inspectRemoteMedia(message.url)
      .then(info => sendResponse(info))
      .catch(() => sendResponse({ size: null, estimated: false }));
    return true;
  }
});

async function inspectRemoteMedia(url) {
  // Extension host permissions allow this worker to inspect media hosts even
  // when the dialog page itself is blocked by the site's CORS policy.
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    const length = Number(head.headers.get("content-length"));
    if (length > 0) return { size:length, estimated:false };
  } catch {}

  // Some CDNs omit Content-Length on HEAD but expose the total in
  // Content-Range for a one-byte request.
  try {
    const range = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
    });
    const contentRange = range.headers.get("content-range") || "";
    const match = contentRange.match(/\/(\d+)$/);
    const total = match ? Number(match[1]) : 0;
    if (total > 0) return { size:total, estimated:false };
  } catch {}

  // For a playlist, sum the sizes of its segments when the CDN exposes them.
  // If only some segments report a length, mark the result as estimated.
  if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(url)) {
    try {
      const playlist = await fetch(url, { redirect:"follow" });
      const text = await playlist.text();
      const base = playlist.url || url;
      const segmentUrls = [];
      if (/\.m3u8/i.test(url)) {
        if (!/#EXTINF:/i.test(text)) return { size:null, estimated:false };
        for (const line of text.split(/\r?\n/)) {
          const value = line.trim();
          if (!value || value.startsWith("#") || !/^https?:/i.test(new URL(value, base).href)) continue;
          segmentUrls.push(new URL(value, base).href);
        }
      } else {
        for (const match of text.matchAll(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi)) {
          segmentUrls.push(new URL(match[1].trim(), base).href);
        }
      }
      const unique = [...new Set(segmentUrls)].slice(0, 80);
      const lengths = await Promise.all(unique.map(async segment => {
        try {
          const r = await fetch(segment, { method:"HEAD", redirect:"follow" });
          const n = Number(r.headers.get("content-length"));
          return n > 0 ? n : 0;
        } catch { return 0; }
      }));
      const known = lengths.filter(Boolean);
      if (known.length) {
        const average = known.reduce((a,b)=>a+b,0) / known.length;
        const total = known.length === lengths.length
          ? known.reduce((a,b)=>a+b,0)
          : Math.round(average * lengths.length);
        return { size:total, estimated:known.length !== lengths.length };
      }
    } catch {}
  }
  return { size:null, estimated:false };
}

/* ── Open Dialog Window ──────────────────────────────────────────── */
async function openDownloadDialog(data) {
  if (data?.url && (await filterBlockedLinks([{url:data.url}])).length === 0) {
    notify("Speusis", "This domain is blocked in Privacy & Safety.");
    return;
  }
  /*
   * 1. Check storage for a dialog window ID that survived a SW restart.
   *    Chrome MV3 kills the SW after ~30 s idle; on next wake _opening resets
   *    to false but the window may still be open — storage catches that case.
   */
  const stored = await chrome.storage.local.get([DIALOG_ID_KEY]);
  const existingId = stored[DIALOG_ID_KEY] ?? null;
  if (existingId !== null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return; // dialog still alive — just focus it
    } catch {
      // window was closed without triggering onRemoved (e.g. browser crash)
      await chrome.storage.local.remove(DIALOG_ID_KEY);
    }
  }

  /*
   * 2. In-memory lock stops the race when several onCreated events fire at
   *    once (session restore on Windows startup replays queued downloads).
   */
  if (_opening) return;
  _opening = true;

  try {
    await chrome.storage.local.set({ [PENDING_KEY]: data });

    let left = 200, top = 120;
    try {
      const win = await chrome.windows.getCurrent({ populate: false });
      left = Math.round((win.left || 0) + ((win.width  || 1200) - DIALOG_WIDTH)  / 2);
      top  = Math.round((win.top  || 0) + ((win.height || 800)  - DIALOG_HEIGHT) / 2);
    } catch {}

    const created = await chrome.windows.create({
      url: chrome.runtime.getURL("download-dialog.html"),
      type: "popup", width: DIALOG_WIDTH, height: DIALOG_HEIGHT,
      left: Math.max(0, left), top: Math.max(0, top), focused: true,
    });

    const dialogId = created.id ?? null;
    await chrome.storage.local.set({ [DIALOG_ID_KEY]: dialogId });

    const onRemoved = (windowId) => {
      if (windowId === dialogId) {
        chrome.storage.local.remove([DIALOG_ID_KEY, PENDING_KEY]);
        chrome.windows.onRemoved.removeListener(onRemoved);
      }
    };
    chrome.windows.onRemoved.addListener(onRemoved);
  } finally {
    _opening = false;
  }
}

/* ── YouTube cipher resolution (v0.27) ──────────────────────────────
 * Best-effort, purely additive: turns "locked" adaptive formats into
 * real playable URLs by asking kikkia/yt-cipher's public instance to
 * decipher each one, then reports successes back to the tab that asked.
 * Anything that fails (network error, rate limit, bad player URL) is
 * silently skipped - that format just stays locked, exactly like v0.26.
 * Requests are sent one at a time with a small stagger to stay well
 * under the public instance's stated 10 req/sec limit, and capped to
 * the first 20 formats per video (a full adaptive ladder rarely exceeds
 * that, and it keeps a single page load from hammering a free service). */
async function resolveYtCipherFormats(playerUrl, formats, tabId) {
  if (!playerUrl || !formats.length || tabId == null) return;
  const capped = formats.slice(0, 20);
  for (const f of capped) {
    try {
      const res = await fetch(YT_CIPHER_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stream_url: f.streamUrl,
          player_url: playerUrl,
          encrypted_signature: f.encryptedSignature,
          signature_key: f.signatureKey,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.resolved_url) {
          chrome.tabs.sendMessage(tabId, {
            type: "speusis-yt-cipher-resolved",
            url: data.resolved_url,
            itag: f.itag,
            quality: f.quality,
            kind: f.hasVideo ? "video" : "audio",
          }).catch(() => {});
        }
      }
    } catch {
      // Network error, offline, service down, etc. - skip this one format
      // silently and move on to the next; never blocks the rest.
    }
    await new Promise((r) => setTimeout(r, 150)); // ~6-7 req/sec, under the 10/sec limit
  }
}

/* ── Send to Speusis ───────────────────────────────────────────────── */
async function sendToSpeusis(url, filename, later = false, pageUrl = null) {
  const body = { url, filename, start: !later };
  // A lot of video/stream CDNs 403 a request with no Referer or a
  // mismatched one (hotlink protection) - sending the originating page
  // lets the app set a matching Referer on every request for this
  // download. Without it, stream captures used to fail instantly with
  // an unresolvable size ("Failed", size "—" in the main app).
  if (pageUrl) body.pageUrl = pageUrl;
  const response = await fetch(SPEUSIS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Speusis is not running or rejected the request");
  chrome.notifications.create({
    type: "basic", iconUrl: "icon128.png",
    title:   later ? "Added to Speusis Queue" : "Sent to Speusis",
    message: filename || url,
  });
}

/* ── Helpers ─────────────────────────────────────────────────────── */
const DOWNLOADABLE = /\.(7z|apk|avi|bin|bz2|csv|deb|dmg|doc|docx|exe|flac|flv|gz|img|iso|jar|mkv|mov|mp3|mp4|msi|ogg|pdf|pkg|rar|rpm|tar|ts|wav|webm|wmv|xls|xlsx|xz|zip)(\?|#|$)/i;

function isUnsupportedScheme(url) {
  return url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("javascript:");
}
function isDownloadable(url) {
  try { return DOWNLOADABLE.test(new URL(url).pathname); } catch { return DOWNLOADABLE.test(url); }
}
function guessFilename(url) {
  try {
    const p = new URL(url).pathname;
    return decodeURIComponent(p.split("/").filter(Boolean).pop() || "download");
  } catch { return "download"; }
}
