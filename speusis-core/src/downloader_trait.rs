//! Not present in the original TS (scheduler.ts imported the concrete
//! HttpDirectDownloader class directly). Rust has no structural typing, so
//! the scheduler needs an explicit trait; HttpDirectDownloader and
//! FtpDownloader both implement it. Behavior at call sites is identical.
use crate::scheduler::TaskHandle;
use async_trait::async_trait;

#[async_trait]
pub trait Downloader: Send + Sync {
    async fn start(&self, task: TaskHandle);
    fn cancel(&self, id: &str);
}
