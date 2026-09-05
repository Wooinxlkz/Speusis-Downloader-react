//! Ported 1:1 from src/core/webGrabber.ts
use crate::types::GrabLink;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashSet;
use std::time::Duration;
use url::Url;

const DOWNLOADABLE_EXTS: &[&str] = &[
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "pdf", "doc", "docx", "xls", "xlsx", "ppt",
    "pptx", "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mp3", "flac", "wav", "aac",
    "ogg", "m4a", "wma", "exe", "msi", "dmg", "apk", "deb", "rpm", "iso", "img", "torrent", "jpg",
    "jpeg", "png", "gif", "webp", "m3u8", "mpd", "ts", "csv", "txt", "json", "xml", "epub", "mobi",
];

fn href_pattern() -> Regex {
    Regex::new(r#"(?i)(?:href|src|data-src|content)=["']([^"']+)["']"#).unwrap()
}

fn extract_ext(resolved: &Url) -> Option<String> {
    let path = resolved.path().to_lowercase();
    let stem = path.rsplit('.').next()?;
    // path.rsplit('.').next() on a path with no dot returns the whole path;
    // guard against matching e.g. "com/foo" as extension "foo".
    if !path.contains('.') {
        return None;
    }
    if DOWNLOADABLE_EXTS.contains(&stem) {
        Some(stem.to_string())
    } else {
        None
    }
}

fn extract_links(html: &str, base: &Url) -> Vec<GrabLink> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    let pattern = href_pattern();

    for cap in pattern.captures_iter(html) {
        let raw = cap[1].trim();
        if raw.is_empty() || raw.starts_with("javascript:") || raw.starts_with('#') {
            continue;
        }
        let resolved = match base.join(raw) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let resolved_str = resolved.to_string();
        if seen.contains(&resolved_str) {
            continue;
        }
        let Some(ext) = extract_ext(&resolved) else { continue };
        seen.insert(resolved_str.clone());

        let name = resolved
            .path_segments()
            .and_then(|segs| segs.filter(|s| !s.is_empty()).last())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("file.{ext}"));

        results.push(GrabLink { url: resolved_str, name, ext, size_hint: None });
    }
    results
}

/// Mirrors `grabLinksFromUrl(pageUrl)`: fetch the page then extract links.
pub async fn grab_links_from_url(page_url: &str) -> anyhow::Result<Vec<GrabLink>> {
    let base = Url::parse(page_url)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).no_proxy().build()?;

    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("user-agent"),
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ),
    );
    headers.insert(
        HeaderName::from_static("accept"),
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );

    let res = client
        .get(page_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Cannot fetch page: {e}"))?;
    if !res.status().is_success() {
        anyhow::bail!("Cannot fetch page: HTTP {}", res.status());
    }
    let html = res.text().await?;
    Ok(extract_links(&html, &base))
}

/// Mirrors `grabLinksFromHtml(html, baseUrl)`.
pub fn grab_links_from_html(html: &str, base_url: &str) -> anyhow::Result<Vec<GrabLink>> {
    let base = Url::parse(base_url)?;
    Ok(extract_links(html, &base))
}
