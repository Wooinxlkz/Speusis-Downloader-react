/* Speusis Extension — Network Interceptor v0.27 — MAIN world
 * (loaded via inject.js's <script src> injection, not declared directly
 * as a content script — see inject.js for why)
 *
 * v0.27: locked (cipher-signed) formats now get resolved into real,
 * downloadable URLs via an external deciphering service - kikkia/yt-cipher
 * (MIT, https://github.com/kikkia/yt-cipher), specifically its public
 * `/resolve_url` endpoint. This file only extracts and hands off the raw
 * cipher pieces (streamUrl, encryptedSignature, signatureKey, playerUrl);
 * the actual network call to the resolver happens in service-worker.js,
 * not here (MAIN-world scripts run inside the page and would carry the
 * page's own CSP/origin restrictions - the extension's background
 * service worker doesn't). This intentionally does NOT reimplement
 * YouTube's cipher-breaking logic locally - that's still the same hard,
 * constantly-shifting problem yt-dlp dedicates a large component to, and
 * yt-cipher is itself just a hosted wrapper around yt-dlp's own approach
 * (see its README: "An http api wrapper for yt-dlp/ejs"). If that
 * external service is down, rate-limited, or the request fails for any
 * reason, this fails silently and the format simply stays locked - same
 * as v0.26's behavior, no regression either way.
 *
 * v0.23: YouTube quality coverage widened from 2 legacy "combined" formats
 * (18/22 — the only itags YouTube still serves as single video+audio files)
 * to the full adaptive ladder: video-only and audio-only streams up to 4K,
 * which content.js now pairs up and hands to the desktop app for muxing.
 * Plus direct subtitle-track capture (those URLs aren't signature-locked,
 * so they just work). */
(function () {
  "use strict";

  /* Standard HLS / DASH / CMAF segment detection */
  var STREAM_RE = /\.(m3u8|mpd|m4s)(\?|#|$)/i;

  /* Legacy combined (video+audio in one file) itags — the only ones
     directly downloadable with zero muxing. YouTube serves almost
     nothing above 720p this way anymore. */
  var YT_COMBINED = {
    "22": "720p HD",
    "18": "360p",
    "36": "240p",
    "17": "144p",
  };

  /* Adaptive video-only itags (need pairing with an audio track + muxing
     downstream). Covers the common MP4/WEBM ladder up to 4K/60fps. */
  var YT_ADAPTIVE_VIDEO = {
    "266": "2160p 4K", "313": "2160p 4K", "315": "2160p60 4K", "337": "2160p60 4K",
    "264": "1440p",    "271": "1440p",    "308": "1440p60",    "304": "1440p60",
    "137": "1080p",    "248": "1080p",    "299": "1080p60",    "303": "1080p60",
    "136": "720p",     "247": "720p",     "298": "720p60",     "302": "720p60",
    "135": "480p",     "244": "480p",
    "134": "360p",     "243": "360p",
    "133": "240p",     "242": "240p",
    "160": "144p",     "278": "144p",
  };

  /* Adaptive audio-only itags */
  var YT_ADAPTIVE_AUDIO = {
    "141": "256kbps AAC",
    "140": "128kbps AAC",
    "139": "48kbps AAC",
    "251": "160kbps Opus",
    "250": "70kbps Opus",
    "249": "50kbps Opus",
  };

  function notify(url, extra) {
    window.postMessage(Object.assign({ __speusis: true, url: String(url) }, extra || {}), "*");
  }

  function tryYouTubeStream(urlStr) {
    try {
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return;

      var u = new URL(urlStr);
      if (!u.hostname.endsWith("googlevideo.com")) return;
      if (u.pathname !== "/videoplayback") return;
      var itag = u.searchParams.get("itag");
      if (!itag) return;

      /* Build a clean download URL: remove byte-range and playback-position params
         so the server streams the whole file. Keep everything else (sig, key, expire, etc.) */
      u.searchParams.delete("range");
      u.searchParams.delete("rn");
      u.searchParams.delete("rbuf");
      var cleanUrl = u.toString();

      /* googlevideo URLs carry the exact byte size in `clen` - grab it so
         the dialog can show a real size instead of "Stream"/"—". */
      var clen = Number(u.searchParams.get("clen"));
      var fileSize = clen > 0 ? clen : null;

      if (YT_COMBINED[itag]) {
        notify(cleanUrl, { isYouTube: true, ytItag: itag, ytKind: "combined", ytQuality: YT_COMBINED[itag], fileSize: fileSize });
      } else if (YT_ADAPTIVE_VIDEO[itag]) {
        notify(cleanUrl, { isYouTube: true, ytItag: itag, ytKind: "video", ytQuality: YT_ADAPTIVE_VIDEO[itag], fileSize: fileSize });
      } else if (YT_ADAPTIVE_AUDIO[itag]) {
        notify(cleanUrl, { isYouTube: true, ytItag: itag, ytKind: "audio", ytQuality: YT_ADAPTIVE_AUDIO[itag], fileSize: fileSize });
      }
      /* Unknown itag: silently ignored, same as before. */
    } catch (_) {}
  }

  function isYouTubePlayerRequest(urlStr) {
    try {
      var u = new URL(urlStr, location.href);
      return /(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname) &&
        /\/youtubei\/v1\/player(?:$|[/?])/.test(u.pathname);
    } catch (_) {
      return false;
    }
  }

  function isYouTubeVideoPage() {
    return /^(\/watch|\/shorts\/|\/live\/)/.test(location.pathname);
  }

  function cleanYouTubeMediaUrl(urlStr) {
    try {
      var u = new URL(urlStr, location.href);
      u.searchParams.delete("range");
      u.searchParams.delete("rn");
      u.searchParams.delete("rbuf");
      return u.toString();
    } catch (_) {
      return urlStr;
    }
  }

  function formatHasAudio(f) {
    var codecs = String(f.codec || f.codecs || f.mimeType || "");
    return !!f.audioQuality || /(?:mp4a|aac|opus|vorbis|ac-3|ec-3)/i.test(codecs);
  }

  function formatHasVideo(f) {
    var mime = String(f.mimeType || "");
    return !!f.qualityLabel || /^video\//i.test(mime);
  }

  /* Modern YouTube no longer guarantees a window.ytInitialPlayerResponse
   * global.  Its player API response is the reliable source of the complete
   * quality ladder, so parse that response as it goes through fetch/XHR. */
  var _lastPlayerResponseKey = "";
  function publishPlayerResponse(pr) {
    try {
      /* Home/feed hover previews also use the player endpoint.  They are
       * not a user-opened video page and must never feed the download panel. */
      if (!isYouTubeVideoPage()) return;
      if (!pr || !pr.streamingData) return;
      var details = pr.videoDetails || {};
      var videoId = details.videoId || "";
      var all = [].concat(pr.streamingData.formats || [], pr.streamingData.adaptiveFormats || []);
      if (!all.length) return;

      var responseKey = videoId + ":" + all.map(function (f) {
        return String(f.itag || "") + ":" + String(f.url || f.signatureCipher || f.cipher || "");
      }).join("|");
      if (responseKey === _lastPlayerResponseKey) return;
      _lastPlayerResponseKey = responseKey;

      var formats = all.map(function (f) {
        return {
          itag: f.itag,
          quality: f.qualityLabel || f.audioQuality || String(f.itag),
          hasVideo: formatHasVideo(f),
          hasAudio: formatHasAudio(f),
          url: f.url ? cleanYouTubeMediaUrl(f.url) : null,
          locked: !f.url,
        };
      });
      window.postMessage({ __speusisYtFormats: true, videoId: videoId, formats: formats }, "*");

      var playerUrl = getPlayerUrl();
      if (playerUrl) {
        var lockedCipherData = all
          .filter(function (f) { return !f.url && (f.signatureCipher || f.cipher); })
          .map(function (f) {
            var cipherStr = f.signatureCipher || f.cipher;
            var params = new URLSearchParams(cipherStr);
            return {
              itag: f.itag,
              quality: f.qualityLabel || f.audioQuality || String(f.itag),
              hasVideo: formatHasVideo(f),
              hasAudio: formatHasAudio(f),
              streamUrl: params.get("url"),
              encryptedSignature: params.get("s"),
              signatureKey: params.get("sp") || "sig",
            };
          })
          .filter(function (c) { return c.streamUrl && c.encryptedSignature; });
        if (lockedCipherData.length) {
          window.postMessage({
            __speusisYtLockedCipherData: true,
            videoId: videoId,
            playerUrl: playerUrl,
            formats: lockedCipherData,
          }, "*");
        }
      }

      var tracks = pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
                   pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (tracks && tracks.length) {
        window.postMessage({
          __speusisYtCaptions: true,
          videoId: videoId,
          captions: tracks.map(function (t) {
            return {
              url: t.baseUrl,
              lang: t.languageCode,
              label: (t.name && (t.name.simpleText ||
                (t.name.runs && t.name.runs[0] && t.name.runs[0].text))) || t.languageCode,
              autoGenerated: t.kind === "asr",
            };
          }),
        }, "*");
      }
    } catch (_) {}
  }

  function parsePlayerResponseText(text) {
    try {
      var parsed = JSON.parse(text);
      if (parsed && (parsed.streamingData || parsed.videoDetails)) publishPlayerResponse(parsed);
    } catch (_) {}
  }

  function parsePlayerResponseValue(value) {
    if (!value) return;
    if (typeof value === "string") {
      parsePlayerResponseText(value);
      return;
    }
    if (typeof value === "object") {
      try {
        if (value.streamingData || value.videoDetails) publishPlayerResponse(value);
      } catch (_) {}
    }
  }

  /* ── Patch XMLHttpRequest ─────────────────────────────────────── */
  var origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    try {
      var urlStr = String(url);
      var pathname = new URL(urlStr, location.href).pathname;
      if (STREAM_RE.test(pathname)) {
        notify(urlStr);
      } else {
        tryYouTubeStream(new URL(urlStr, location.href).toString());
      }
      this.__speusisPlayerRequest = isYouTubePlayerRequest(urlStr);
    } catch (_) {}
    this.addEventListener("load", function () {
      if (!this.__speusisPlayerRequest) return;
      try {
        parsePlayerResponseValue(this.responseType === "json" ? this.response : this.responseText);
      } catch (_) {}
    });
    return origXhrOpen.apply(this, arguments);
  };

  /* ── Patch fetch ─────────────────────────────────────────────── */
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var urlStr =
        typeof input === "string"
          ? input
          : input && input.url
          ? input.url
          : String(input);
      var resolved = new URL(urlStr, location.href);
      if (STREAM_RE.test(resolved.pathname)) {
        notify(resolved.toString());
      } else {
        tryYouTubeStream(resolved.toString());
      }
      if (isYouTubePlayerRequest(resolved.toString())) {
        return origFetch.apply(this, arguments).then(function (response) {
          try {
            response.clone().text().then(parsePlayerResponseText).catch(function () {});
          } catch (_) {}
          return response;
        });
      }
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  /* ── YouTube player-response scan ────────────────────────────────
   * Reads window.ytInitialPlayerResponse (a real page global — readable
   * because this script now actually runs in the page's MAIN world) to
   * report the FULL list of available qualities and subtitle tracks up
   * front, before each one is necessarily captured live above. Formats
   * with a plain `url` field are immediately downloadable; the rest are
   * reported as "locked" until their real network request is observed
   * by the patches above (which happens automatically for the active
   * quality, and again on every manual quality change). */
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    var _lastVideoId = "";
    function getPlayerUrl() {
      try {
        var fromCfg = window.ytcfg && window.ytcfg.get && window.ytcfg.get("PLAYER_JS_URL");
        if (fromCfg) return fromCfg.startsWith("http") ? fromCfg : "https://www.youtube.com" + fromCfg;
      } catch (_) {}
      // Fallback: scan script tags for the current player bundle. YouTube
      // now commonly nests base.js under player_ias.vflset/<locale>/.
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src || "";
        if (/\/s\/player\/[^/]+\/.*\/(?:player_ias|base)\.js(?:[?#]|$)/.test(src)) return src;
      }
      return null;
    }

    function scanPlayerResponse() {
      try {
        var pr = window.ytInitialPlayerResponse;
        var videoId = pr && pr.videoDetails && pr.videoDetails.videoId;
        if (!videoId || videoId === _lastVideoId) return;
        _lastVideoId = videoId;
        publishPlayerResponse(pr);
      } catch (_) {}
    }
    scanPlayerResponse();
    setInterval(scanPlayerResponse, 1500);
    document.addEventListener("yt-navigate-finish", function () {
      _lastVideoId = "";
      _lastPlayerResponseKey = "";
      setTimeout(scanPlayerResponse, 250);
    });
  }
})();
