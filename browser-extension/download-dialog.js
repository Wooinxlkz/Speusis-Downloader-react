/* Speusis Extension — Download Dialog v0.23 */
"use strict";

const SPEUSIS_ENDPOINT = "http://127.0.0.1:9999/downloads";
const SPEUSIS_STREAM_ENDPOINT = "http://127.0.0.1:9999/downloads/stream";

/* ── DOM refs ──────────────────────────────────────────────────── */
const urlField      = document.getElementById("urlField");
const filenameField = document.getElementById("filenameField");
const saveDirField  = document.getElementById("saveDirField");
const categoryField = document.getElementById("categoryField");
const catLabel      = document.getElementById("catLabel");
const fileIconSvg   = document.getElementById("fileIconSvg");
const fileSize      = document.getElementById("fileSize");
const ytNotice      = document.getElementById("ytNotice");
const torNotice     = document.getElementById("torNotice");
const spinner       = document.getElementById("spinner");
const statusLine    = document.getElementById("statusLine");
const statusText    = document.getElementById("statusText");
const rememberCb    = document.getElementById("rememberPath");
const rememberBox   = document.getElementById("rememberBox");
const videoSection  = document.getElementById("videoSection");
const qualityList   = document.getElementById("qualityList");
const modalOverlay  = document.getElementById("modalOverlay");
const newCatInput   = document.getElementById("newCatInput");
const qualityProfile = document.getElementById("qualityProfile");
function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      // Reading lastError prevents Chrome from reporting an unchecked
      // "message port closed" error when the worker is restarting.
      const error = chrome.runtime.lastError;
      resolve(error ? null : response);
    });
  });
}
if (qualityProfile) {
  chrome.storage.local.get("__speusis_quality_profile", r => {
    if (r.__speusis_quality_profile) qualityProfile.value = r.__speusis_quality_profile;
    applyQualityProfile();
  });
  qualityProfile.addEventListener("change", () => {
    chrome.storage.local.set({__speusis_quality_profile:qualityProfile.value});
    applyQualityProfile();
  });
}

/* ── Quality labels ────────────────────────────────────────────── */
const QUALITY_LABELS = ["1080p HD","720p HD","480p","360p","240p","144p"];
const BADGE_COLORS   = { HD:"#1d4ed8",SD:"#065f46",LOW:"#6b21a8",HLS:"#dc2626",DASH:"#7c3aed",CMAF:"#7c3aed",Stream:"#6b7280",Subtitle:"#0891b2",MP4:"#ec4899" };

/* ── File type colours ─────────────────────────────────────────── */
const FILE_TYPES = {
  zip:{color:"#f59e0b",bg:"#7c3b00",ext:"ZIP"},rar:{color:"#f59e0b",bg:"#7c3b00",ext:"RAR"},
  "7z":{color:"#f59e0b",bg:"#7c3b00",ext:"7Z"},tar:{color:"#f59e0b",bg:"#7c3b00",ext:"TAR"},
  gz:{color:"#f59e0b",bg:"#7c3b00",ext:"GZ"},bz2:{color:"#f59e0b",bg:"#7c3b00",ext:"BZ2"},
  pdf:{color:"#ef4444",bg:"#7f1d1d",ext:"PDF"},doc:{color:"#3b82f6",bg:"#1e3a8a",ext:"DOC"},
  docx:{color:"#3b82f6",bg:"#1e3a8a",ext:"DOCX"},txt:{color:"#94a3b8",bg:"#374151",ext:"TXT"},
  xls:{color:"#22c55e",bg:"#14532d",ext:"XLS"},xlsx:{color:"#22c55e",bg:"#14532d",ext:"XLSX"},
  csv:{color:"#22c55e",bg:"#14532d",ext:"CSV"},
  mp3:{color:"#a78bfa",bg:"#4c1d95",ext:"MP3"},flac:{color:"#a78bfa",bg:"#4c1d95",ext:"FLAC"},
  wav:{color:"#a78bfa",bg:"#4c1d95",ext:"WAV"},aac:{color:"#a78bfa",bg:"#4c1d95",ext:"AAC"},
  ogg:{color:"#a78bfa",bg:"#4c1d95",ext:"OGG"},m4a:{color:"#a78bfa",bg:"#4c1d95",ext:"M4A"},
  mp4:{color:"#ec4899",bg:"#831843",ext:"MP4"},mkv:{color:"#ec4899",bg:"#831843",ext:"MKV"},
  avi:{color:"#ec4899",bg:"#831843",ext:"AVI"},mov:{color:"#ec4899",bg:"#831843",ext:"MOV"},
  wmv:{color:"#ec4899",bg:"#831843",ext:"WMV"},flv:{color:"#ec4899",bg:"#831843",ext:"FLV"},
  webm:{color:"#ec4899",bg:"#831843",ext:"WEBM"},m3u8:{color:"#ec4899",bg:"#831843",ext:"HLS"},
  mpd:{color:"#a78bfa",bg:"#4c1d95",ext:"DASH"},
  exe:{color:"#f97316",bg:"#7c2d12",ext:"EXE"},msi:{color:"#f97316",bg:"#7c2d12",ext:"MSI"},
  apk:{color:"#22c55e",bg:"#14532d",ext:"APK"},deb:{color:"#f97316",bg:"#7c2d12",ext:"DEB"},
  iso:{color:"#64748b",bg:"#1e293b",ext:"ISO"},img:{color:"#64748b",bg:"#1e293b",ext:"IMG"},
  jpg:{color:"#06b6d4",bg:"#164e63",ext:"JPG"},jpeg:{color:"#06b6d4",bg:"#164e63",ext:"JPEG"},
  png:{color:"#06b6d4",bg:"#164e63",ext:"PNG"},gif:{color:"#06b6d4",bg:"#164e63",ext:"GIF"},
};

/* ── Helpers ───────────────────────────────────────────────────── */
function guessFilename(url) {
  try { const p=new URL(url).pathname; return decodeURIComponent(p.split("/").filter(Boolean).pop()||"download"); }
  catch { return "download"; }
}
function isYouTubeUrl(url) {
  try { const h=new URL(url).hostname; return h.includes("youtube.com")||h.includes("youtu.be"); }
  catch { return false; }
}
function isVideoOrStreamUrl(url, filename) {
  const VIDEO_EXTS=/\.(mp4|mkv|avi|mov|wmv|flv|webm|m3u8|mpd|ts)(\?|#|$)/i;
  try { if (VIDEO_EXTS.test(new URL(url).pathname)) return true; } catch {}
  if (VIDEO_EXTS.test(filename||"")) return true;
  return isYouTubeUrl(url);
}
function sizeFromUrl(url) {
  try {
    const p = new URL(url).searchParams;
    for (const key of ["clen", "contentLength", "content-length", "size"]) {
      const value = Number(p.get(key));
      if (value > 0) return value;
    }
  } catch {}
  return null;
}
function isManifestUrl(url) {
  return /\.(m3u8|mpd)(?:[?#]|$)/i.test(String(url || ""));
}
function isTorrentUrl(url) { return url.startsWith("magnet:")||/\.torrent(\?|#|$)/i.test(url); }
function guessCategory(filename) {
  const ext=(filename||"").split(".").pop()?.toLowerCase();
  const map={
    zip:"Compressed",rar:"Compressed","7z":"Compressed",tar:"Compressed",gz:"Compressed",
    pdf:"Documents",doc:"Documents",docx:"Documents",txt:"Documents",xls:"Documents",xlsx:"Documents",
    mp3:"Music",flac:"Music",wav:"Music",aac:"Music",ogg:"Music",m4a:"Music",
    mp4:"Video",mkv:"Video",avi:"Video",mov:"Video",wmv:"Video",flv:"Video",webm:"Video",m3u8:"Video",
    exe:"Programs",msi:"Programs",apk:"Programs",deb:"Programs",
  };
  return map[ext]||"General";
}
function formatBytes(b) {
  if (!b||b<=0) return "Unknown size";
  const units=["B","KB","MB","GB"];
  const i=Math.min(units.length-1,Math.floor(Math.log(b)/Math.log(1024)));
  return `${(b/1024**i).toFixed(2)} ${units[i]}`;
}
function qualitySlug(label) {
  const m=String(label||"").match(/(\d{3,4})p/i);
  return m?m[1]+"p":String(label||"video").replace(/\s+/g,"-").toLowerCase();
}
function makeVideoFilename(title, quality) {
  return `${sanitize(title)}${quality?`_${qualitySlug(quality)}`:""}.mp4`;
}
const YT_ITAG_RANK={"22":1,"18":3,"36":5,"17":7};
function rankStream(s) {
  if (s.type==="Subtitle") return 900; // always sort after video/audio options
  if (s.ytItag && !s.needsMux) return YT_ITAG_RANK[s.ytItag]??99;
  // Muxed/adaptive entries carry a real resolution in .quality ("1080p60 (muxed)") —
  // sort by that number so 4K/1440p actually outrank 1080p/720p, instead of
  // falling through to the URL-text guess below (googlevideo URLs don't contain
  // human-readable resolution text, so that guess never matched adaptive URLs).
  const qm=String(s.quality||"").match(/(\d{3,4})p/i);
  if (qm) return 1000-parseInt(qm[1],10);
  const u=(s.url||"").toLowerCase();
  if (/2160|4k|uhd/.test(u)) return 0; if (/1440|2k/.test(u)) return 1;
  if (/1080/.test(u)) return 2; if (/720/.test(u)) return 3;
  if (/480/.test(u)) return 4; if (/360/.test(u)) return 5;
  if (/240/.test(u)) return 6; if (/144/.test(u)) return 7; return 99;
}
function labelStream(s, i) {
  if (s.quality) return s.quality;
  const u=(s.url||"").toLowerCase();
  if (/2160|4k|uhd/.test(u)) return "2160p 4K"; if (/1440|2k/.test(u)) return "1440p QHD";
  if (/1080/.test(u)) return "1080p HD"; if (/720/.test(u)) return "720p HD";
  if (/480/.test(u)) return "480p"; if (/360/.test(u)) return "360p";
  if (/240/.test(u)) return "240p"; if (/144/.test(u)) return "144p";
  return QUALITY_LABELS[i]||`Stream ${i+1}`;
}
function applyQualityProfile() {
  const rows = [...qualityList.querySelectorAll(".vq-row")];
  if (!rows.length) return;
  rows.forEach(row => row.classList.remove("recommended"));
  const profile = qualityProfile?.value || "best";
  let target = rows[0];
  if (profile === "small") target = rows[rows.length - 1];
  if (profile === "audio") target = rows.find(r => /audio|mp3|aac|opus/i.test(r.dataset.type + " " + r.dataset.quality)) || rows[0];
  if (profile === "1080" || profile === "720") {
    const limit = Number(profile);
    target = rows.find(r => {
      const match = r.dataset.quality.match(/(\d{3,4})p/i);
      return match && Number(match[1]) <= limit;
    }) || rows[rows.length - 1];
  }
  target.classList.add("recommended");
}
function getSaveDirs() { try { return JSON.parse(localStorage.getItem("__speusis_saveDirs")||"{}"); } catch { return {}; } }
function setSaveDirs(d) { try { localStorage.setItem("__speusis_saveDirs",JSON.stringify(d)); } catch {} }

/* ── Render file icon ──────────────────────────────────────────── */
function renderFileIcon(filename, isYT) {
  const ext=(filename||"").split(".").pop()?.toLowerCase()||"";
  if (isYT) {
    fileIconSvg.innerHTML=`<rect x="1" y="1" width="50" height="58" rx="5" fill="#7f1d1d" stroke="#dc2626" stroke-width="1.5"/>
      <rect x="10" y="20" width="32" height="22" rx="4" fill="#dc2626"/>
      <path d="M22 26l14 5-14 5V26z" fill="white"/>
      <text x="26" y="56" font-family="monospace" font-size="7" font-weight="700" fill="#fca5a5" text-anchor="middle">YouTube</text>`;
    return;
  }
  if (isTorrentUrl(filename||"")) {
    fileIconSvg.innerHTML=`<rect x="1" y="1" width="50" height="58" rx="5" fill="#451a03" stroke="#d97706" stroke-width="1.5"/>
      <path d="M26 14c-7 0-12 5-12 12s5 12 12 12 12-5 12-12" stroke="#d97706" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <polyline points="19,21 26,14 33,21" stroke="#d97706" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="5" y="38" width="42" height="18" rx="3" fill="#d97706"/>
      <text x="26" y="51" font-family="monospace,sans-serif" font-size="8" font-weight="800" fill="white" text-anchor="middle">TORRENT</text>`;
    return;
  }
  const ft=FILE_TYPES[ext];
  if (!ft) {
    fileIconSvg.innerHTML=`<rect x="1" y="1" width="50" height="58" rx="5" fill="#27272a" stroke="#3f3f46" stroke-width="1.5"/>
      <path d="M26 18v16M19.5 28l6.5 8 6.5-8" stroke="#fafafa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="16" y1="45" x2="36" y2="45" stroke="#fafafa" stroke-width="2" stroke-linecap="round"/>`;
    return;
  }
  const fs=ft.ext.length<=3?"10":ft.ext.length===4?"8.5":"7.5";
  fileIconSvg.innerHTML=`<rect x="1" y="1" width="50" height="58" rx="5" fill="${ft.bg}" stroke="${ft.color}" stroke-width="1.5"/>
    <path d="M33 1v12h12" stroke="${ft.color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>
    <rect x="3" y="38" width="46" height="18" rx="3" fill="${ft.color}"/>
    <text x="26" y="51" font-family="monospace,sans-serif" font-size="${fs}" font-weight="800" fill="white" text-anchor="middle" letter-spacing=".5">${ft.ext}</text>
    <line x1="9" y1="20" x2="31" y2="20" stroke="${ft.color}" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>
    <line x1="9" y1="26" x2="27" y2="26" stroke="${ft.color}" stroke-width="1.5" stroke-linecap="round" opacity=".4"/>
    <line x1="9" y1="32" x2="23" y2="32" stroke="${ft.color}" stroke-width="1.5" stroke-linecap="round" opacity=".3"/>`;
}

/* ── Quality rows ──────────────────────────────────────────────── */
let _pendingYtQuality="";
let _isStreamable=false; // set in init(): true for a direct, single-file video/stream URL that should be fetched by the browser and streamed to the app instead of handed over as a URL for the app to fetch itself
let _pendingMux=null; // {videoUrl, audioUrl} when the chosen row needs backend muxing
let _pendingPageUrl=null; // the tab this download was captured from - sent as Referer so hotlink-protected CDNs (most video/stream URLs) don't 403
function chooseQuality(row, fallbackUrl, pageTitle) {
  const dlUrl   = row.dataset.url||fallbackUrl;
  const quality = row.dataset.quality||row.dataset.type||"";
  const fname   = row.dataset.filename||makeVideoFilename(pageTitle,quality);
  _pendingYtQuality=quality;
  _pendingMux = row.dataset.needsMux==="1"
    ? { videoUrl: row.dataset.videoUrl, audioUrl: row.dataset.audioUrl }
    : null;
  urlField.value=dlUrl; filenameField.value=fname;
  categoryField.value="Video"; catLabel.textContent="Video";
  renderFileIcon(fname,false);
  // Keep the detected byte size when the selected quality carries one.
  // "Stream" is only a fallback for sources whose size is genuinely unknown.
  if (row.dataset.fileSize && Number(row.dataset.fileSize) > 0) {
    fileSize.textContent = formatBytes(Number(row.dataset.fileSize));
  } else if (row.dataset.type) {
    fileSize.textContent = isManifestUrl(dlUrl) ? "Stream" : "Size unavailable";
  }
  videoSection.style.display="none";
  document.body.classList.remove("quality-mode");
  _isStreamable=!_pendingMux&&!isManifestUrl(dlUrl);
  setStatus(`Selected ${quality||"video stream"}${_pendingMux?" — desktop app will mux video+audio":""}. Press Start Download or Download Later.`,"");
  filenameField.focus(); filenameField.select();
}
function buildQualityRows(data) {
  const url=data.url||"", isYT=isYouTubeUrl(url);
  const pageTitle=data.pageTitle||guessFilename(url)||"video";
  const streams=(data.streams||[]).filter(s=>s&&s.url);
  if (streams.length===0 && data.needsMux && data.videoUrl && data.audioUrl) {
    // Single muxed item sent directly from the badge (no full streams list attached).
    streams.push({ url:data.videoUrl, videoUrl:data.videoUrl, audioUrl:data.audioUrl, needsMux:true, type:"MP4", quality:"Selected quality (muxed)" });
  }
  if (streams.length>0) {
    const sorted=[...streams].sort((a,b)=>rankStream(a)-rankStream(b));
    qualityList.innerHTML=sorted.map((s,i)=>{
      const ql=labelStream(s,i),bt=s.type||"HLS",bc=BADGE_COLORS[bt]||"#1d4ed8";
      const fname=s.type==="Subtitle"?`${sanitize(pageTitle)}.${(s.quality||"en").slice(0,5).replace(/[^a-z0-9]/gi,"")}.vtt`:makeVideoFilename(pageTitle,ql);
      const sizeLabel=Number(s.fileSize)>0?formatBytes(Number(s.fileSize)):"Size unavailable";
      const meta=s.metadata||{};
      const dimensions=meta.width&&meta.height?` · ${meta.width}×${meta.height}`:"";
      const duration=meta.duration>0?` · ${Math.floor(meta.duration/60)}:${String(Math.floor(meta.duration%60)).padStart(2,"0")}`:"";
      const info=`${pageTitle.slice(0,44)} — ${bt} — ${ql}${dimensions}${duration}`;
      return `<div class="vq-row" data-url="${escAttr(s.url)}" data-type="${escAttr(bt)}" data-quality="${escAttr(ql)}" data-filename="${escAttr(fname)}" data-file-size="${Number(s.fileSize) > 0 ? Number(s.fileSize) : ""}" data-idx="${i}" data-needs-mux="${s.needsMux?"1":"0"}" data-video-url="${escAttr(s.videoUrl||"")}" data-audio-url="${escAttr(s.audioUrl||"")}">
        <span class="vq-num">${i+1}.</span>
        <span class="vq-info" title="${escAttr(info)}">${escHtml(info)} · <span class="vq-size">${escHtml(sizeLabel)}</span></span>
        <span class="vq-badge" style="background:${bc}">${bt}</span>
        <button class="vq-dl-btn" data-idx="${i}">↓</button></div>`;
    }).join("");
    wireQualityRows(url,pageTitle);
    applyQualityProfile();
    hydrateStreamSizes(sorted);
    document.getElementById("btnVideoDownload")?.addEventListener("click",()=>{
      const r=qualityList.querySelector(".vq-row"); if(r) chooseQuality(r,url,pageTitle);
    });
    // Only one real stream was detected (the common case: clicking a
    // single quality badge, or a page with just one video source) -
    // skip the picker screen and go straight to the final Save-As
    // screen instead of making the user click through a 1-item list.
    if (sorted.length === 1) {
      const onlyRow = qualityList.querySelector(".vq-row");
      if (onlyRow) chooseQuality(onlyRow, url, pageTitle);
    }
  } else if (isYT) {
    qualityList.innerHTML=`<div style="padding:18px 12px;text-align:center;color:#a1a1aa;font-size:12px;line-height:1.6">
      <div style="font-size:22px;margin-bottom:8px">▶</div>
      <div style="color:#fafafa;font-weight:600;margin-bottom:6px">No streams detected yet</div>
      <div>Play the YouTube video in the browser tab first,<br>then click the <strong>Speusis</strong> button that appears on the page.</div>
      <div style="margin-top:10px;padding:8px;background:#18181b;border-radius:4px;font-size:11px;color:#71717a">
        The extension captures the stream URL automatically while the video loads.</div></div>`;
    document.getElementById("btnVideoDownload")?.addEventListener("click",()=>{
      setStatus("Play the video in your browser tab first, then use the Speusis button on the page.","error");
    });
    const btnStart=document.getElementById("btnStart"),btnLater=document.getElementById("btnLater");
    if(btnStart) btnStart.disabled=true; if(btnLater) btnLater.disabled=true;
    setStatus("Play the video first to detect the stream URL.","");
  } else {
    const qualities=[{label:"Best Quality",fmt:"MP4",badge:"HD"},{label:"Medium Quality",fmt:"MP4",badge:"SD"}];
    qualityList.innerHTML=qualities.map((q,i)=>{
      const bc=BADGE_COLORS[q.badge]||"#1d4ed8",fname=makeVideoFilename(pageTitle,q.label);
      const info=`${pageTitle.slice(0,44)} — ${q.fmt} — ${q.label}`;
      return `<div class="vq-row" data-url="${escAttr(url)}" data-quality="${escAttr(q.label)}" data-filename="${escAttr(fname)}" data-idx="${i}">
        <span class="vq-num">${i+1}.</span>
        <span class="vq-info" title="${escAttr(info)}">${escHtml(info)}</span>
        <span class="vq-badge" style="background:${bc}">${q.badge}</span>
        <button class="vq-dl-btn" data-idx="${i}">↓</button></div>`;
    }).join("");
    wireQualityRows(url,pageTitle);
    document.getElementById("btnVideoDownload")?.addEventListener("click",()=>{
      const r=qualityList.querySelector(".vq-row"); if(r) chooseQuality(r,url,pageTitle);
    });
  }
  document.getElementById("btnDlAll")?.addEventListener("click",()=>{
    document.getElementById("btnDlAll").classList.toggle("collapsed");
    qualityList.classList.toggle("collapsed");
  });
  document.getElementById("btnVideoClose")?.addEventListener("click",()=>window.close());
}
async function hydrateStreamSizes(streams) {
  const rows=[...qualityList.querySelectorAll(".vq-row")];
  await Promise.all(streams.slice(0,20).map(async (stream,index) => {
    if (Number(stream.fileSize)>0 || !rows[index]) return;
    const info=await requestFileInfo(stream.url);
    if (!info?.size) return;
    const size=info.size;
    rows[index].dataset.fileSize=String(size);
    const sizeEl=rows[index].querySelector(".vq-size");
    if (sizeEl) sizeEl.textContent=formatBytes(size)+(info.estimated?" (est.)":"");
  }));
}
function wireQualityRows(url, pageTitle) {
  qualityList.querySelectorAll(".vq-dl-btn").forEach(btn=>btn.addEventListener("click",e=>{
    e.stopPropagation(); chooseQuality(btn.closest(".vq-row"),url,pageTitle);
  }));
  qualityList.querySelectorAll(".vq-row").forEach(row=>row.addEventListener("click",e=>{
    if(e.target.classList.contains("vq-dl-btn")) return; chooseQuality(row,url,pageTitle);
  }));
}

/* ── Init ──────────────────────────────────────────────────────── */
async function init() {
  const verEl = document.getElementById("titlebarVersion");
  if (verEl) verEl.textContent = "v" + chrome.runtime.getManifest().version;

  const data=await sendRuntimeMessage({type:"speusis-get-dialog-data"});
  if (!data) { setStatus("No download data received. Close this window.","error"); return; }

  _pendingPageUrl = data.pageUrl || null;

  const url=data.url||"", filename=data.suggestedFilename||guessFilename(url);
  const isYT=data.isYouTube||isYouTubeUrl(url), isTor=isTorrentUrl(url);
  const isVideo=isVideoOrStreamUrl(url,filename);

  urlField.value=url; filenameField.value=filename;

  const cat=guessCategory(filename);
  for (const opt of categoryField.options) {
    if (opt.value===cat||opt.text===cat){categoryField.value=opt.value;break;}
  }
  catLabel.textContent=categoryField.value||"General";

  // Load custom categories from localStorage
  const customCats=JSON.parse(localStorage.getItem("__speusis_categories")||"[]");
  customCats.forEach(c=>{ if(![...categoryField.options].some(o=>o.value===c)){
    const o=document.createElement("option"); o.value=o.textContent=c; categoryField.appendChild(o);
  }});

  const dirs=getSaveDirs();
  saveDirField.value=dirs[cat]||"Downloads\\";

  renderFileIcon(filename,isYT);
  let sizeKnown=false;
  const urlSize = sizeFromUrl(url);
  if (Number(data.fileSize) > 0) {
    fileSize.textContent=formatBytes(Number(data.fileSize));
    sizeKnown=true;
  } else if (urlSize) {
    fileSize.textContent=formatBytes(urlSize);
    sizeKnown=true;
  } else if (!isYT&&!isTor) {
    sizeKnown=await fetchFileSize(url);
  }

  if (isYT||data.isStream||isVideo) {
    if (!sizeKnown) fileSize.textContent=isManifestUrl(url) ? "Stream" : "Size unavailable";
    document.body.classList.add("quality-mode");
    videoSection.style.display="flex";
    buildQualityRows(data);
  }
  if (isYT) ytNotice.style.display="block";
  if (isTor){torNotice.style.display="block";fileSize.textContent="P2P";}

  // A manifest (.m3u8/.mpd) is a playlist, not a fetchable file - can't be
  // streamed as-is. A torrent goes through the torrent engine, not HTTP.
  // Everything else that's a single detected video/stream byte-URL (this is
  // exactly the case that was always getting 403'd when the app tried to
  // re-fetch it itself - googlevideo.com and CDNs like it) gets fetched by
  // the browser and streamed to the app instead.
  _isStreamable=(isYT||data.isStream||isVideo)&&!isTor&&!isManifestUrl(url);
}

async function fetchFileSize(url) {
  const info=await requestFileInfo(url);
  if (info?.size) {
    fileSize.textContent = formatBytes(info.size)+(info.estimated?" (est.)":"");
    return true;
  }
  return false;
}
async function requestFileInfo(url) {
  try {
    const result = await sendRuntimeMessage({type:"speusis-get-file-size",url});
    const size = Number(result?.size);
    if (size > 0) return {size, estimated:!!result.estimated};
  } catch {}
  return null;
}

/* ── Category / path sync ──────────────────────────────────────── */
categoryField.addEventListener("change",()=>{
  const cat=categoryField.value||"General";
  catLabel.textContent=cat;
  saveDirField.value=getSaveDirs()[cat]||"Downloads\\";
});
saveDirField.addEventListener("change",()=>{
  if(!rememberCb.checked) return;
  const dirs=getSaveDirs(); dirs[categoryField.value||"General"]=saveDirField.value; setSaveDirs(dirs);
});
rememberCb.addEventListener("change",()=>{
  rememberBox.style.display=rememberCb.checked?"":"none";
  if(rememberCb.checked){const dirs=getSaveDirs();dirs[categoryField.value||"General"]=saveDirField.value;setSaveDirs(dirs);}
});
filenameField.addEventListener("input",()=>{
  renderFileIcon(filenameField.value,false);
  const cat=guessCategory(filenameField.value);
  for(const opt of categoryField.options){if(opt.value===cat||opt.text===cat){categoryField.value=opt.value;break;}}
  catLabel.textContent=categoryField.value||"General";
});

/* ── Browse button — native folder picker ──────────────────────── */
document.getElementById("btnBrowse").addEventListener("click",async()=>{
  if (!window.showDirectoryPicker) {
    setStatus("Folder picker not supported in this browser. Type the path manually.","error"); return;
  }
  try {
    const handle=await window.showDirectoryPicker({mode:"readwrite"});
    saveDirField.value=handle.name;
    if(rememberCb.checked){
      const dirs=getSaveDirs(); dirs[categoryField.value||"General"]=handle.name; setSaveDirs(dirs);
    }
  } catch(e){
    if(e.name!=="AbortError") setStatus("Could not open folder picker: "+e.message,"error");
  }
});

/* ── Add Category modal ────────────────────────────────────────── */
document.getElementById("btnAddCat").addEventListener("click",()=>{
  newCatInput.value="";
  modalOverlay.classList.add("open");
  setTimeout(()=>newCatInput.focus(),60);
});
document.getElementById("modalCancel").addEventListener("click",()=>modalOverlay.classList.remove("open"));
document.getElementById("modalOk").addEventListener("click",()=>addCategory());
newCatInput.addEventListener("keydown",e=>{ if(e.key==="Enter") addCategory(); if(e.key==="Escape") modalOverlay.classList.remove("open"); });
function addCategory(){
  const name=newCatInput.value.trim();
  if(!name){newCatInput.focus();return;}
  if(![...categoryField.options].some(o=>o.value===name)){
    const opt=document.createElement("option"); opt.value=opt.textContent=name; categoryField.appendChild(opt);
    const cats=JSON.parse(localStorage.getItem("__speusis_categories")||"[]");
    if(!cats.includes(name)){cats.push(name);localStorage.setItem("__speusis_categories",JSON.stringify(cats));}
  }
  categoryField.value=name; catLabel.textContent=name;
  saveDirField.value=getSaveDirs()[name]||"Downloads\\";
  modalOverlay.classList.remove("open");
}

/* ── Main buttons ──────────────────────────────────────────────── */
document.getElementById("btnStart" ).addEventListener("click",()=>startDownload(false));
document.getElementById("btnLater" ).addEventListener("click",()=>startDownload(true));
document.getElementById("btnCancel").addEventListener("click",()=>window.close());

async function startDownload(later) {
  const url=urlField.value.trim();
  if(!url){setStatus("URL is empty.","error");return;}
  const isYtWatchPage=isYouTubeUrl(url)&&!url.includes("googlevideo.com")&&!url.includes(".m3u8")&&!url.includes(".mpd");
  if(isYtWatchPage){setStatus("Play the video in your browser tab first so the stream is detected, then click the Speusis button on the page.","error");return;}
  const filename=filenameField.value.trim();
  if(rememberCb.checked&&saveDirField.value.trim()){
    const dirs=getSaveDirs(); dirs[categoryField.value||"General"]=saveDirField.value.trim(); setSaveDirs(dirs);
  }
  doDownload(url,filename,later,_pendingYtQuality||undefined);
}

async function doDownload(url, filename, later, ytQuality, forceBackend) {
  const saveDir=saveDirField.value.trim();

  if (_isStreamable && !later && !forceBackend) {
    // Download Later has no meaning for a stream we fetch ourselves right
    // now - fall through to the normal JSON flow so it's just queued as a
    // URL for the app to pick up whenever it starts (matches existing
    // "Download Later" behavior for everything else).
    return streamDownload(url, filename||guessFilename(url), saveDir);
  }

  setSpinner(true);
  setStatus(later?"Adding to queue…":"Connecting to Speusis…","");
  try {
    const body={url, filename:filename||undefined, start:!later};
    if(ytQuality) body.ytQuality=ytQuality;
    if(_pendingPageUrl) body.pageUrl=_pendingPageUrl;
    if(_pendingMux){
      // Two-source download — video-only + audio-only streams that the
      // desktop app's Rust backend needs to fetch and mux into one file.
      // NOTE: this requires mux support added on that side — the extension
      // can only detect and hand off the pair, not merge them itself.
      body.needsMux=true; body.videoUrl=_pendingMux.videoUrl; body.audioUrl=_pendingMux.audioUrl;
    }
    if(saveDir) body.saveDir=saveDir;

    const res=await fetch(SPEUSIS_ENDPOINT,{
      method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body),
    });
    if(!res.ok){const b=await res.json().catch(()=>({}));throw new Error(b.error||`Speusis returned HTTP ${res.status}`);}
    setSpinner(false);
    setStatus(later?"✔ Added to queue!":"✔ Download started!","success");
    setTimeout(()=>window.close(),1200);
  } catch(err){
    setSpinner(false);
    const msg=String(err.message||err);
    if(msg.toLowerCase().includes("fetch")||msg.toLowerCase().includes("networkerror")||msg.toLowerCase().includes("failed to fetch"))
      setStatus("Speusis is not running. Please open the Speusis Downloader desktop app first.","error");
    else setStatus(msg,"error");
  }
}

// Fetches the video with the browser's own network stack (this is the
// whole point - a real browser fetch succeeds against CDNs like
// googlevideo.com that reject the app's own requests outright, almost
// certainly due to TLS/HTTP fingerprinting, not anything fixable by
// tweaking request headers on the app side) and streams the response body
// straight through to the app's /downloads/stream endpoint as it arrives,
// instead of handing the app a URL to fetch on its own.
async function streamDownload(url, filename, saveDir) {
  setSpinner(true);
  setStatus("Fetching from source…","");

  let resp;
  try {
    resp = await fetch(url, { credentials:"omit", referrerPolicy:"no-referrer" });
  } catch (e) {
    // Browser-side fetch failed outright (network/CORS). Fall back to letting
    // the desktop app fetch it — the app can send a proper Referer built from
    // pageUrl, which this chrome-extension:// page cannot. Same path "Add URL"
    // uses successfully against hotlink/Referer-protected CDNs.
    setStatus("Retrying via Speusis…","");
    return doDownload(url, filename, false, _pendingYtQuality||undefined, true);
  }
  if (!resp.ok || !resp.body) {
    // Non-OK (typically 403): a hotlink-protected CDN rejected this extension
    // page's request for lack of a matching Referer/cookies. We can't add a
    // cross-origin Referer from a chrome-extension:// origin, but the desktop
    // app can — hand off to the backend path (exactly what "Add URL" does).
    setStatus("Retrying via Speusis…","");
    return doDownload(url, filename, false, _pendingYtQuality||undefined, true);
  }

  const total = Number(resp.headers.get("content-length")||0);
  let received = 0;
  const progressStream = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      fileSize.textContent = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
      setStatus(total
        ? `Downloading… ${Math.round(received/total*100)}%`
        : `Downloading… ${formatBytes(received)}`, "");
      controller.enqueue(chunk);
    }
  });

  const headers = { "X-Speusis-Filename": encodeURIComponent(filename) };
  if (total > 0) headers["X-Speusis-Total-Size"] = String(total);
  if (saveDir) headers["X-Speusis-SaveDir"] = encodeURIComponent(saveDir);

  try {
    const uploadResp = await fetch(SPEUSIS_STREAM_ENDPOINT, {
      method: "POST",
      headers,
      body: resp.body.pipeThrough(progressStream),
      duplex: "half",
    });
    if (!uploadResp.ok) {
      const errBody = await uploadResp.json().catch(()=>({}));
      throw new Error(errBody.error || `Speusis returned HTTP ${uploadResp.status}`);
    }
    setSpinner(false);
    setStatus("✔ Download complete!","success");
    setTimeout(()=>window.close(),1200);
  } catch (err) {
    setSpinner(false);
    const msg = String(err.message||err);
    if (msg.toLowerCase().includes("fetch")||msg.toLowerCase().includes("networkerror")||msg.toLowerCase().includes("failed to fetch"))
      setStatus("Speusis is not running. Please open the Speusis Downloader desktop app first.","error");
    else setStatus("Stream to app failed: "+msg,"error");
  }
}

function setSpinner(show){spinner.style.display=show?"inline-block":"none";}
function setStatus(msg,type){statusText.textContent=msg;statusLine.className=type==="error"?"error":type==="success"?"success":"";}
function escHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function escAttr(s){return String(s).replace(/"/g,"&quot;");}
function sanitize(s){return(s||"video").replace(/[<>:"/\\|?*\x00-\x1f]/g,"").trim().slice(0,100)||"video";}

init();
