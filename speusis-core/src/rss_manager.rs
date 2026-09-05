//! Ported 1:1 from src/core/rssManager.ts
use crate::event_bus::EventBus;
use crate::types::{AppEvent, DownloadTask, RssFeed, RssFeedFetched, RssItemDownloaded};
use regex::RegexBuilder;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

struct RssItem {
    title: String,
    url: String,
    guid: String,
    filename: Option<String>,
}

/// Mirrors the `addDownload` callback param in the TS constructor.
pub struct AddDownloadInput {
    pub url: String,
    pub filename: Option<String>,
    pub target_dir: Option<String>,
    pub start: bool,
}

pub type AddDownloadFn =
    Arc<dyn Fn(AddDownloadInput) -> Pin<Box<dyn Future<Output = DownloadTask> + Send>> + Send + Sync>;

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct PersistedState {
    feeds: Vec<RssFeed>,
    #[serde(rename = "seenGuids")]
    seen_guids: Vec<String>,
}

pub struct RssManager {
    data_dir: PathBuf,
    event_bus: EventBus,
    add_download: AddDownloadFn,
    feeds: Mutex<HashMap<String, RssFeed>>,
    seen_guids: Mutex<HashSet<String>>,
    timers: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl RssManager {
    pub fn new(data_dir: impl AsRef<Path>, event_bus: EventBus, add_download: AddDownloadFn) -> Arc<Self> {
        Arc::new(Self {
            data_dir: data_dir.as_ref().to_path_buf(),
            event_bus,
            add_download,
            feeds: Mutex::new(HashMap::new()),
            seen_guids: Mutex::new(HashSet::new()),
            timers: Mutex::new(HashMap::new()),
        })
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("rss-feeds.json")
    }

    /// Mirrors `load()`.
    pub async fn load(self: &Arc<Self>) -> anyhow::Result<()> {
        fs::create_dir_all(&self.data_dir).await?;
        if let Ok(raw) = fs::read_to_string(self.state_path()).await {
            if let Ok(data) = serde_json::from_str::<PersistedState>(&raw) {
                let mut feeds = self.feeds.lock().await;
                for f in data.feeds {
                    feeds.insert(f.id.clone(), f);
                }
                let mut seen = self.seen_guids.lock().await;
                for g in data.seen_guids {
                    seen.insert(g);
                }
            }
        }
        self.restart_timers().await;
        Ok(())
    }

    async fn save(&self) -> anyhow::Result<()> {
        fs::create_dir_all(&self.data_dir).await?;
        let feeds: Vec<RssFeed> = self.feeds.lock().await.values().cloned().collect();
        let seen_guids: Vec<String> = self.seen_guids.lock().await.iter().cloned().collect();
        let json = serde_json::to_string_pretty(&PersistedState { feeds, seen_guids })?;
        fs::write(self.state_path(), json).await?;
        Ok(())
    }

    /// Mirrors `addFeed(config)`.
    pub async fn add_feed(self: &Arc<Self>, mut feed: RssFeed) -> RssFeed {
        feed.id = Uuid::new_v4().to_string();
        self.feeds.lock().await.insert(feed.id.clone(), feed.clone());
        let _ = self.save().await;
        if feed.enabled {
            self.start_timer(feed.clone()).await;
        }
        feed
    }

    /// Mirrors `updateFeed(id, patch)`. `patch` merges onto the existing feed
    /// the same way the JSON-value merge does in settingsManager.
    pub async fn update_feed(self: &Arc<Self>, id: &str, patch: serde_json::Value) -> Option<RssFeed> {
        let current = self.feeds.lock().await.get(id).cloned()?;
        let mut merged = serde_json::to_value(&current).ok()?;
        if let (Some(base), Some(patch)) = (merged.as_object_mut(), patch.as_object()) {
            for (k, v) in patch {
                base.insert(k.clone(), v.clone());
            }
        }
        let updated: RssFeed = serde_json::from_value(merged).ok()?;
        self.feeds.lock().await.insert(id.to_string(), updated.clone());
        let _ = self.save().await;
        self.stop_timer(id).await;
        if updated.enabled {
            self.start_timer(updated.clone()).await;
        }
        Some(updated)
    }

    /// Mirrors `removeFeed(id)`.
    pub async fn remove_feed(&self, id: &str) {
        self.stop_timer(id).await;
        self.feeds.lock().await.remove(id);
        let _ = self.save().await;
    }

    /// Mirrors `listFeeds()`.
    pub async fn list_feeds(&self) -> Vec<RssFeed> {
        self.feeds.lock().await.values().cloned().collect()
    }

    /// Mirrors `fetchNow(id)`.
    pub async fn fetch_now(self: &Arc<Self>, id: &str) -> u32 {
        let feed = { self.feeds.lock().await.get(id).cloned() };
        match feed {
            Some(feed) => self.poll_feed(feed).await,
            None => 0,
        }
    }

    /// Mirrors `stopAll()`.
    pub async fn stop_all(&self) {
        let ids: Vec<String> = self.timers.lock().await.keys().cloned().collect();
        for id in ids {
            self.stop_timer(&id).await;
        }
    }

    async fn restart_timers(self: &Arc<Self>) {
        let feeds: Vec<RssFeed> = self.feeds.lock().await.values().cloned().collect();
        for feed in feeds {
            if feed.enabled {
                self.start_timer(feed).await;
            }
        }
    }

    /// Mirrors `startTimer(feed)`: immediate poll + repeating interval,
    /// `max(5, fetchInterval)` minutes, same as `Math.max(5, feed.fetchInterval) * 60 * 1000`.
    async fn start_timer(self: &Arc<Self>, feed: RssFeed) {
        self.stop_timer(&feed.id).await;
        let interval_secs = feed.fetch_interval.max(5) * 60;
        let this = Arc::clone(self);
        let feed_id = feed.id.clone();

        let handle = tokio::spawn(async move {
            this.poll_feed(feed.clone()).await;
            let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
            ticker.tick().await; // first tick fires immediately; skip it since we already polled above
            loop {
                ticker.tick().await;
                this.poll_feed(feed.clone()).await;
            }
        });
        self.timers.lock().await.insert(feed_id, handle);
    }

    /// Mirrors `stopTimer(id)`.
    async fn stop_timer(&self, id: &str) {
        if let Some(handle) = self.timers.lock().await.remove(id) {
            handle.abort();
        }
    }

    /// Mirrors `pollFeed(feed)`.
    async fn poll_feed(self: &Arc<Self>, feed: RssFeed) -> u32 {
        let xml = match Self::fetch_url(&feed.url, 5).await {
            Ok(xml) => xml,
            Err(e) => {
                eprintln!("[RssManager] Poll failed for {}: {e}", feed.url);
                return 0;
            }
        };

        let items = Self::parse_rss(&xml);
        let mut added = 0u32;

        for item in items {
            if item.url.is_empty() {
                continue;
            }
            {
                let mut seen = self.seen_guids.lock().await;
                if seen.contains(&item.guid) {
                    continue;
                }
                seen.insert(item.guid.clone());
            }

            if let Some(filter) = &feed.filter {
                let matches = RegexBuilder::new(filter)
                    .case_insensitive(true)
                    .build()
                    .map(|re| re.is_match(&item.title) || re.is_match(&item.url))
                    .unwrap_or_else(|_| {
                        let f = filter.to_lowercase();
                        item.title.to_lowercase().contains(&f) || item.url.to_lowercase().contains(&f)
                    });
                if !matches {
                    continue;
                }
            }

            if feed.auto_download && feed.enabled {
                let task = (self.add_download)(AddDownloadInput {
                    url: item.url.clone(),
                    filename: item.filename.clone(),
                    target_dir: feed.target_dir.clone(),
                    start: true,
                })
                .await;
                self.event_bus.emit(AppEvent::RssItemDownloaded(RssItemDownloaded {
                    feed_id: feed.id.clone(),
                    item_title: item.title.clone(),
                    task_id: task.id,
                }));
                added += 1;
            }
        }

        {
            let mut feeds = self.feeds.lock().await;
            if let Some(f) = feeds.get_mut(&feed.id) {
                f.last_fetched = Some(chrono::Utc::now().timestamp_millis());
            }
        }
        let _ = self.save().await;

        if added > 0 {
            self.event_bus.emit(AppEvent::RssFeedFetched(RssFeedFetched {
                feed_id: feed.id.clone(),
                new_items: added,
            }));
        }

        added
    }

    /// Mirrors `fetchUrl(url, redirects)`: manual redirect-follow loop with a
    /// custom User-Agent (RSS servers sometimes block the browser UA), same
    /// as the original's raw http/https module use with 20s timeout.
    fn fetch_url(url: &str, redirects: u8) -> Pin<Box<dyn Future<Output = anyhow::Result<String>> + Send + '_>> {
        Box::pin(async move {
            if redirects == 0 {
                anyhow::bail!("Too many redirects");
            }
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(20))
                .no_proxy()
                .build()?;
            let res = client
                .get(url)
                .header("User-Agent", "Speusis Downloader/0.6 RSS Reader")
                .header(
                    "Accept",
                    "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                )
                .send()
                .await?;

            let status = res.status();
            if status.is_redirection() {
                if let Some(loc) = res.headers().get("location").and_then(|v| v.to_str().ok()) {
                    let loc = loc.to_string();
                    return Self::fetch_url(&loc, redirects - 1).await;
                }
            }
            Ok(res.text().await?)
        })
    }

    /// Mirrors `parseRss(xml)`.
    fn parse_rss(xml: &str) -> Vec<RssItem> {
        let mut items = Vec::new();
        let item_re = RegexBuilder::new(r"<item[^>]*>([\s\S]*?)</item>").case_insensitive(true).build().unwrap();
        for cap in item_re.captures_iter(xml) {
            let content = &cap[1];
            let title = Self::extract_tag(content, "title").unwrap_or_default();
            let enclosure_url = Self::extract_attr(content, "enclosure", "url");
            let link = enclosure_url.clone().or_else(|| Self::extract_tag(content, "link")).unwrap_or_default();
            let guid = Self::extract_tag(content, "guid").unwrap_or_else(|| link.clone());
            let filename = enclosure_url
                .as_ref()
                .and_then(|u| u.split('/').next_back())
                .map(|s| s.split('?').next().unwrap_or(s).to_string());
            if !link.is_empty() {
                items.push(RssItem { title, url: link, guid, filename });
            }
        }

        if items.is_empty() {
            let entry_re = RegexBuilder::new(r"<entry[^>]*>([\s\S]*?)</entry>").case_insensitive(true).build().unwrap();
            for cap in entry_re.captures_iter(xml) {
                let content = &cap[1];
                let title = Self::extract_tag(content, "title").unwrap_or_default();
                let link = Self::extract_attr(content, "link", "href")
                    .or_else(|| Self::extract_tag(content, "link"))
                    .unwrap_or_default();
                let guid = Self::extract_tag(content, "id").unwrap_or_else(|| link.clone());
                if !link.is_empty() {
                    items.push(RssItem { title, url: link, guid, filename: None });
                }
            }
        }

        items
    }

    fn extract_tag(xml: &str, tag: &str) -> Option<String> {
        let pattern = format!(
            r"<{tag}[^>]*><!\[CDATA\[([\s\S]*?)\]\]></{tag}>|<{tag}[^>]*>([^<]*)</{tag}>",
            tag = regex::escape(tag)
        );
        let re = RegexBuilder::new(&pattern).case_insensitive(true).build().ok()?;
        let caps = re.captures(xml)?;
        caps.get(1).or_else(|| caps.get(2)).map(|m| m.as_str().trim().to_string())
    }

    fn extract_attr(xml: &str, tag: &str, attr: &str) -> Option<String> {
        let pattern = format!(r#"<{tag}[^>]*\s{attr}="([^"]*)"#, tag = regex::escape(tag), attr = regex::escape(attr));
        let re = RegexBuilder::new(&pattern).case_insensitive(true).build().ok()?;
        re.captures(xml).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
    }
}
