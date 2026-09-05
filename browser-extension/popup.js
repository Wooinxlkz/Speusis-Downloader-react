/* Speusis popup controller — external file required by extension CSP. */
"use strict";

const ENDPOINT = "http://127.0.0.1:9999";
const $ = id => document.getElementById(id);

$("popupVersion").textContent =
  "v" + chrome.runtime.getManifest().version + " · Download Manager";

function showFeedback(message, error = false) {
  const el = $("feedbackMsg");
  el.textContent = message;
  el.className = error ? "error" : "";
  clearTimeout(showFeedback.timer);
  showFeedback.timer = setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, 3500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

function renderSavedSettings(blocked = [], rules = []) {
  $("blockedList").innerHTML = blocked.map((domain, index) =>
    `<div class="saved-item"><span class="saved-label">${escapeHtml(domain)}</span><button class="remove-btn" data-remove-blocked="${index}" aria-label="Remove ${escapeHtml(domain)}">×</button></div>`
  ).join("");
  $("rulesList").innerHTML = rules.map((rule, index) =>
    `<div class="saved-item"><span class="saved-label">${escapeHtml(rule.domain)}</span><span class="saved-kind">${escapeHtml(rule.category || "General")}</span><button class="remove-btn" data-remove-rule="${index}" aria-label="Remove rule">×</button></div>`
  ).join("");
  $("blockedHeading").style.display = blocked.length ? "block" : "none";
  $("rulesHeading").style.display = rules.length ? "block" : "none";
}

async function loadSavedSettings() {
  const result = await chrome.storage.local.get(["__speusis_blocked_domains", "__speusis_rules"]);
  renderSavedSettings(result.__speusis_blocked_domains || [], result.__speusis_rules || []);
}

async function checkStatus() {
  try {
    const res = await fetch(ENDPOINT + "/health");
    if (!res.ok) throw new Error();
    $("desktopStatus").textContent = "Running";
    $("statusDot").classList.remove("offline");
    $("statusText").textContent = "Speusis is running";
  } catch {
    $("desktopStatus").textContent = "Offline";
    $("statusDot").classList.add("offline");
    $("statusText").textContent = "Speusis desktop is not running";
  }
}

async function sendDownload(url, later) {
  try {
    const res = await fetch(ENDPOINT + "/downloads", {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({url, start:!later}),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    $("urlInput").value = "";
    showFeedback(later ? "Added to queue." : "Download started.");
  } catch (err) {
    showFeedback("Speusis is not running: " + err.message, true);
  }
}

function activeTab() {
  return chrome.tabs.query({active:true, currentWindow:true}).then(tabs => tabs[0]);
}

function selectTab(name) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.panel === name);
  });
  chrome.storage.local.set({__speusis_popup_tab:name});
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
});

async function scanPage() {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("No active tab");
  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {type:"speusis-scan-links"});
  } catch {
    throw new Error("This page cannot be scanned.");
  }
  const links = result?.links || [];
  const box = $("linkResults");
  box.innerHTML = links.map(item => {
    const url = encodeURIComponent(item.url);
    const name = encodeURIComponent(item.name || item.url);
    const safeName = String(item.name || item.url).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    return `<label class="link-item"><input type="checkbox" checked data-url="${url}" data-name="${name}"><span class="link-name" title="${safeName}">${safeName}</span></label>`;
  }).join("") || '<div class="hint">No downloadable links found on this page.</div>';
  box.style.display = "block";
  $("linkActions").style.display = links.length ? "flex" : "none";
  showFeedback(`${links.length} link(s) found.`);
}

async function queueSelected() {
  const tab = await activeTab();
  const selected = [...document.querySelectorAll("#linkResults input:checked")].map(input => ({
    url: decodeURIComponent(input.dataset.url),
    name: decodeURIComponent(input.dataset.name || ""),
  }));
  if (!selected.length) {
    showFeedback("Select at least one link.", true);
    return;
  }
  const profile = $("qualityProfile").value;
  for (const item of selected) {
    const res = await fetch(ENDPOINT + "/downloads", {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({url:item.url, filename:item.name, start:false, pageUrl:tab?.url, qualityProfile:profile}),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
  }
  showFeedback(`${selected.length} item(s) queued.`);
}

async function queuePage() {
  await scanPage();
  await queueSelected();
}

$("btnScan").addEventListener("click", () =>
  scanPage().catch(err => showFeedback(err.message, true)));
$("btnQueuePage").addEventListener("click", () =>
  queuePage().catch(err => showFeedback("Could not queue page media: " + err.message, true)));
$("btnQueueSelected").addEventListener("click", () =>
  queueSelected().catch(err => showFeedback("Could not queue selected links: " + err.message, true)));
$("btnSelectAll").addEventListener("click", () =>
  document.querySelectorAll("#linkResults input").forEach(input => { input.checked = true; }));
$("btnCopyPageUrl").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await navigator.clipboard.writeText(tab.url);
    showFeedback("Page URL copied.");
  } catch {
    showFeedback("Could not copy this page URL.", true);
  }
});
$("btnOpenTools").addEventListener("click", () =>
  showFeedback("Media tools are handled by the Speusis desktop app."));

$("qualityProfile").addEventListener("change", () =>
  chrome.storage.local.set({__speusis_quality_profile:$("qualityProfile").value}));
chrome.storage.local.get(["__speusis_quality_profile","__speusis_popup_tab"], result => {
  if (result.__speusis_quality_profile) $("qualityProfile").value = result.__speusis_quality_profile;
  if (result.__speusis_popup_tab) selectTab(result.__speusis_popup_tab);
});
loadSavedSettings();

$("btnBlock").addEventListener("click", async () => {
  const input = $("blockedDomain");
  const domain = input.value.trim().toLowerCase().replace(/^www\./, "");
  if (!domain) return;
  const result = await chrome.storage.local.get("__speusis_blocked_domains");
  const list = result.__speusis_blocked_domains || [];
  if (!list.includes(domain)) list.push(domain);
  await chrome.storage.local.set({__speusis_blocked_domains:list});
  input.value = "";
  await loadSavedSettings();
  showFeedback(`Blocked ${domain}.`);
});

$("btnRule").addEventListener("click", async () => {
  const input = $("ruleDomain");
  const domain = input.value.trim().toLowerCase().replace(/^www\./, "");
  if (!domain) return;
  const result = await chrome.storage.local.get("__speusis_rules");
  const rules = result.__speusis_rules || [];
  if (!rules.some(rule => rule.domain === domain && rule.category === $("ruleCategory").value)) {
    rules.push({domain, category:$("ruleCategory").value});
  }
  await chrome.storage.local.set({__speusis_rules:rules});
  input.value = "";
  await loadSavedSettings();
  showFeedback(`Rule saved for ${domain}.`);
});

document.addEventListener("click", async event => {
  const blockedButton = event.target.closest("[data-remove-blocked]");
  const ruleButton = event.target.closest("[data-remove-rule]");
  if (!blockedButton && !ruleButton) return;
  if (blockedButton) {
    const result = await chrome.storage.local.get("__speusis_blocked_domains");
    const list = result.__speusis_blocked_domains || [];
    list.splice(Number(blockedButton.dataset.removeBlocked), 1);
    await chrome.storage.local.set({__speusis_blocked_domains:list});
    await loadSavedSettings();
    showFeedback("Blocked site removed.");
  } else {
    const result = await chrome.storage.local.get("__speusis_rules");
    const rules = result.__speusis_rules || [];
    rules.splice(Number(ruleButton.dataset.removeRule), 1);
    await chrome.storage.local.set({__speusis_rules:rules});
    await loadSavedSettings();
    showFeedback("Rule removed.");
  }
});

$("urlForm").addEventListener("submit", event => {
  event.preventDefault();
  const url = $("urlInput").value.trim();
  if (url) sendDownload(url, false);
});
$("btnLater").addEventListener("click", () => {
  const url = $("urlInput").value.trim();
  if (url) sendDownload(url, true);
});

checkStatus();
setInterval(checkStatus, 15000);