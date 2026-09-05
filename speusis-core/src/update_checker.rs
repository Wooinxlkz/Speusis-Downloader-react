//! Ported 1:1 from src/core/updateChecker.ts
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEFAULT_UPDATE_URL: &str = "https://api.github.com/repos/Wooinxlkz/Speusis-Downloader/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub download_url: String,
    pub download_size: Option<u64>,
    pub asar_url: Option<String>,
    pub release_notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub info: Option<UpdateInfo>,
    pub error: Option<String>,
}

fn parse_version(v: &str) -> (u64, u64, u64) {
    let v = v.strip_prefix('v').unwrap_or(v);
    let mut parts = v.split('.').map(|n| n.parse::<u64>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let (l_maj, l_min, l_patch) = parse_version(latest);
    let (c_maj, c_min, c_patch) = parse_version(current);
    if l_maj != c_maj {
        return l_maj > c_maj;
    }
    if l_min != c_min {
        return l_min > c_min;
    }
    l_patch > c_patch
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct GhRelease {
    tag_name: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
    html_url: Option<String>,
    body: Option<String>,
    version: Option<String>,
    download: Option<String>,
    url: Option<String>,
    notes: Option<String>,
    changelog: Option<String>,
}

/// Mirrors `checkForUpdate(updateUrl)`.
pub async fn check_for_update(update_url: Option<&str>, current_version: &str) -> UpdateCheckResult {
    let update_url = update_url.unwrap_or(DEFAULT_UPDATE_URL);
    match check_inner(update_url, current_version).await {
        Ok(result) => result,
        Err(e) => UpdateCheckResult { info: None, error: Some(e.to_string()) },
    }
}

async fn check_inner(update_url: &str, current_version: &str) -> anyhow::Result<UpdateCheckResult> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(12)).no_proxy().build()?;
    let res = client
        .get(update_url)
        .header("User-Agent", format!("Speusis Downloader/{current_version} (Windows)"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Update check timed out after 12s"))?;

    let status = res.status().as_u16();

    if status == 304 {
        return Ok(UpdateCheckResult { info: None, error: None });
    }
    if status == 401 || status == 403 {
        return Ok(UpdateCheckResult {
            info: None,
            error: Some(format!("Update server requires authentication (HTTP {status})")),
        });
    }
    if status == 404 {
        return Ok(UpdateCheckResult {
            info: None,
            error: Some(
                "Update server not found (HTTP 404) — the release repository may be private or the URL has changed"
                    .to_string(),
            ),
        });
    }
    if !(200..300).contains(&status) {
        return Ok(UpdateCheckResult { info: None, error: Some(format!("Update server returned HTTP {status}")) });
    }

    let body = res.text().await?;
    let data: GhRelease = match serde_json::from_str(&body) {
        Ok(d) => d,
        Err(_) => {
            return Ok(UpdateCheckResult {
                info: None,
                error: Some("Update server returned an invalid response".to_string()),
            })
        }
    };

    if let Some(tag) = &data.tag_name {
        let latest_version = tag.strip_prefix('v').unwrap_or(tag).to_string();
        // Tauri's default NSIS output is named like "Speusis Downloader_0.2.3_x64-setup.exe"
        // (lowercase "setup", version+arch baked in) - NOT the old Electron
        // "-Setup.exe" pattern this used to look for, which never matched a
        // real Tauri build and silently fell back to the release PAGE url
        // instead of the actual installer. Match any .exe asset instead,
        // preferring one that mentions "setup" if there's more than one.
        let exe_asset = data
            .assets
            .iter()
            .filter(|a| a.name.to_lowercase().ends_with(".exe"))
            .max_by_key(|a| a.name.to_lowercase().contains("setup") as u8);
        let asar_asset = data
            .assets
            .iter()
            .find(|a| a.name.ends_with("-patch.asar") || (a.name.ends_with(".asar") && !a.name.contains("electron")));
        let download_url = exe_asset
            .map(|a| a.browser_download_url.clone())
            .unwrap_or_else(|| data.html_url.clone().unwrap_or_else(|| update_url.to_string()));
        let download_size = exe_asset.and_then(|a| a.size);
        let asar_url = asar_asset.map(|a| a.browser_download_url.clone());
        let release_notes: String = data.body.clone().unwrap_or_default().chars().take(400).collect();

        if !is_newer_version(&latest_version, current_version) {
            return Ok(UpdateCheckResult { info: None, error: None });
        }
        return Ok(UpdateCheckResult {
            info: Some(UpdateInfo { version: latest_version, download_url, download_size, asar_url, release_notes }),
            error: None,
        });
    }

    let (latest_version, download_url, release_notes) = if let Some(version) = &data.version {
        let latest_version = version.strip_prefix('v').unwrap_or(version).to_string();
        let download_url =
            data.download.clone().or(data.url.clone()).unwrap_or_else(|| update_url.to_string());
        let release_notes = data.notes.clone().or(data.changelog.clone()).unwrap_or_default();
        (latest_version, download_url, release_notes)
    } else {
        return Ok(UpdateCheckResult {
            info: None,
            error: Some("Update server response missing version field".to_string()),
        });
    };

    if latest_version.is_empty() || !is_newer_version(&latest_version, current_version) {
        return Ok(UpdateCheckResult { info: None, error: None });
    }

    Ok(UpdateCheckResult {
        info: Some(UpdateInfo { version: latest_version, download_url, download_size: None, asar_url: None, release_notes }),
        error: None,
    })
}
