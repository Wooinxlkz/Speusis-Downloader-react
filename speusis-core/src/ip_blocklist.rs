//! Ported 1:1 from src/core/ipBlocklist.ts
use std::collections::HashSet;
use std::time::Duration;
use tokio::fs;

pub struct IpBlocklist {
    blocked: HashSet<String>,
    loaded: bool,
}

impl IpBlocklist {
    pub fn new() -> Self {
        Self { blocked: HashSet::new(), loaded: false }
    }

    /// Mirrors `load(source)`: source may be an http(s) URL or a local file path.
    /// Any failure (bad URL, non-200, missing file) leaves `loaded = false`,
    /// same as the original's swallow-all catch block.
    pub async fn load(&mut self, source: &str) {
        if source.is_empty() {
            return;
        }
        let text = if source.starts_with("http://") || source.starts_with("https://") {
            self.fetch_remote(source).await
        } else {
            fs::read_to_string(source).await.ok()
        };

        match text {
            Some(text) => {
                self.parse_lines(&text);
                self.loaded = true;
            }
            None => self.loaded = false,
        }
    }

    async fn fetch_remote(&self, url: &str) -> Option<String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .no_proxy()
            .build()
            .ok()?;
        let res = client.get(url).send().await.ok()?;
        if !res.status().is_success() {
            return None;
        }
        res.text().await.ok()
    }

    fn parse_lines(&mut self, text: &str) {
        self.blocked.clear();
        for line in text.split(['\n', '\r']) {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }
            if let Some(ip) = trimmed.split([' ', '\t', ',', '|']).next() {
                if !ip.is_empty() {
                    self.blocked.insert(ip.to_string());
                }
            }
        }
    }

    pub fn is_blocked(&self, ip: &str) -> bool {
        if !self.loaded || self.blocked.is_empty() {
            return false;
        }
        self.blocked.contains(ip)
    }

    pub fn size(&self) -> usize {
        self.blocked.len()
    }
}

impl Default for IpBlocklist {
    fn default() -> Self {
        Self::new()
    }
}
