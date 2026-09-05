//! Ported 1:1 from src/core/networkManager.ts
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Response, StatusCode, Url};
use std::collections::HashMap;
use std::str::FromStr;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct AuthCredential {
    pub username: String,
    pub password: String,
}

pub struct NetworkManager {
    direct_client: reqwest::Client,
    proxy_client: reqwest::Client,
}

impl NetworkManager {
    pub fn new() -> Self {
        // Try a direct connection first so a stale system proxy cannot block
        // ordinary downloads. Keep a second client with reqwest's normal
        // proxy behavior for machines that genuinely require a proxy/VPN.
        let direct_client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let proxy_client = reqwest::Client::builder()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { direct_client, proxy_client }
    }

    fn should_retry_with_proxy(status: StatusCode) -> bool {
        matches!(status.as_u16(), 407 | 502 | 503 | 504)
    }

    fn browser_headers() -> HashMap<&'static str, &'static str> {
        HashMap::from([
            // HeaderName::from_static requires lowercase ASCII names.
            // Passing browser-style mixed-case names here can panic inside
            // reqwest/http before any request is sent.
            ("user-agent", USER_AGENT),
            ("accept", "*/*"),
            ("accept-language", "en-US,en;q=0.9"),
            ("accept-encoding", "identity"),
            ("connection", "keep-alive"),
        ])
    }

    fn build_headers(
        extra: &HashMap<String, String>,
        auth: Option<&AuthCredential>,
    ) -> anyhow::Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        for (k, v) in Self::browser_headers() {
            headers.insert(HeaderName::from_static(k), HeaderValue::from_static(v));
        }
        for (k, v) in extra {
            headers.insert(HeaderName::from_str(k)?, HeaderValue::from_str(v)?);
        }
        if let Some(auth) = auth {
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", auth.username, auth.password));
            headers.insert(
                HeaderName::from_static("authorization"),
                HeaderValue::from_str(&format!("Basic {encoded}"))?,
            );
        }
        Ok(headers)
    }

    /// Mirrors `validateUrl(url)`: only allow the same four schemes.
    pub fn validate_url(url: &str) -> anyhow::Result<()> {
        let parsed = Url::parse(url)?;
        let scheme = parsed.scheme();
        if !["http", "https", "ftp", "magnet"].contains(&scheme) {
            anyhow::bail!("Unsupported URL scheme: {scheme}:");
        }
        Ok(())
    }

    /// Mirrors `head(url, auth)`. Now also takes extra headers (mainly for
    /// Referer - see http_direct_downloader.rs's resolve_metadata) since
    /// this used to be the one request type in the whole client that could
    /// never carry any, which mattered because it's always the *first*
    /// request made for a download.
    pub async fn head(
        &self,
        url: &str,
        extra_headers: &HashMap<String, String>,
        auth: Option<&AuthCredential>,
    ) -> anyhow::Result<Response> {
        Self::validate_url(url)?;
        let headers = Self::build_headers(extra_headers, auth)?;
        match self.direct_client.head(url).headers(headers.clone()).send().await {
            Ok(response) if !Self::should_retry_with_proxy(response.status()) => Ok(response),
            Ok(_) | Err(_) => Ok(self.proxy_client.head(url).headers(headers).send().await?),
        }
    }

    /// Mirrors `get(url, extraHeaders, signal, auth)`. `signal`'s abort
    /// behavior maps to a timeout/cancellation token at the call site
    /// (e.g. `tokio::select!` against a cancellation future) rather than
    /// a parameter here, since Rust doesn't have Fetch's AbortSignal type.
    pub async fn get(
        &self,
        url: &str,
        extra_headers: HashMap<String, String>,
        auth: Option<&AuthCredential>,
    ) -> anyhow::Result<Response> {
        Self::validate_url(url)?;
        let headers = Self::build_headers(&extra_headers, auth)?;
        match self.direct_client.get(url).headers(headers.clone()).send().await {
            Ok(response) if !Self::should_retry_with_proxy(response.status()) => Ok(response),
            Ok(_) | Err(_) => Ok(self.proxy_client.get(url).headers(headers).send().await?),
        }
    }
}

impl Default for NetworkManager {
    fn default() -> Self {
        Self::new()
    }
}
