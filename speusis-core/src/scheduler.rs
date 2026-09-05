//! Ported 1:1 from src/core/scheduler.ts.
//!
//! One deliberate structural change from the TS: the original passes `task`
//! as a shared JS object - `scheduler.pause()` mutates `task.status` and the
//! downloader's in-flight loop reads that same object, so the mutation is
//! visible immediately without any explicit channel. Rust has no shared
//! mutable references by default, so tasks are stored as `Arc<Mutex<DownloadTask>>`
//! here and the *same* Arc is handed to the downloader - reproducing the
//! "same object, mutation visible to both sides" behavior the original
//! relies on for pause/resume to work mid-download.
use async_recursion::async_recursion;
use crate::downloader_trait::Downloader;
use crate::event_bus::EventBus;
use crate::types::{
    AppEvent, DownloadFailed, DownloadKind, DownloadPaused, DownloadRequest, DownloadResumed,
    DownloadStatus, DownloadTask,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type TaskHandle = Arc<Mutex<DownloadTask>>;

struct State {
    tasks: HashMap<String, TaskHandle>,
    queue: Vec<String>,
}

pub struct Scheduler {
    state: Mutex<State>,
    event_bus: EventBus,
    downloader: Arc<dyn Downloader>,
    max_concurrent: Arc<dyn Fn() -> u32 + Send + Sync>,
    active: AtomicU32,
}

impl Scheduler {
    pub fn new(
        event_bus: EventBus,
        downloader: Arc<dyn Downloader>,
        max_concurrent: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State { tasks: HashMap::new(), queue: Vec::new() }),
            event_bus,
            downloader,
            max_concurrent,
            active: AtomicU32::new(0),
        })
    }

    /// Mirrors `add(request, start = true)`.
    pub async fn add(self: &Arc<Self>, request: DownloadRequest, start: bool) -> DownloadTask {
        let kind = request.kind.unwrap_or(DownloadKind::Http);
        let mut request = request;
        request.kind = Some(kind);
        let task = DownloadTask {
            request,
            id: Uuid::new_v4().to_string(),
            status: DownloadStatus::Queued,
            created_at: chrono::Utc::now().timestamp_millis(),
            started_at: None,
            completed_at: None,
            size: None,
            received_bytes: 0,
            output_path: None,
            part_path: None,
            retry_count: 0,
            partial_bytes: None,
            peers: None,
            torrent_files: None,
            is_seeding: None,
            uploaded_bytes: None,
            seed_ratio: None,
            security_scan: None,
            last_error: None,
        };
        let snapshot = task.clone();
        let handle: TaskHandle = Arc::new(Mutex::new(task));

        let mut state = self.state.lock().await;
        state.tasks.insert(snapshot.id.clone(), handle);
        crate::debug_log::log(&format!("scheduler.add: id={} start={} url={}", snapshot.id, start, snapshot.request.url));
        if start {
            state.queue.push(snapshot.id.clone());
            drop(state);
            let this = Arc::clone(self);
            crate::debug_log::log(&format!("scheduler.add: spawning drain() for id={}", snapshot.id));
            tokio::spawn(async move { this.drain().await });
        } else {
            crate::debug_log::log(&format!("scheduler.add: start=false, NOT spawning drain for id={}", snapshot.id));
        }
        snapshot
    }

    /// Mirrors `list()`: newest first.
    pub async fn list(&self) -> Vec<DownloadTask> {
        let state = self.state.lock().await;
        let mut tasks = Vec::with_capacity(state.tasks.len());
        for handle in state.tasks.values() {
            tasks.push(handle.lock().await.clone());
        }
        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        tasks
    }

    /// Returns the shared, mutable handle for a task by id (same Arc the
    /// downloader holds), so a caller outside the normal downloader trait
    /// (the streamed-upload listener route) can drive a task's lifecycle
    /// directly - update status/progress fields and have it be visible to
    /// the UI immediately, the same way pause()/resume() already do.
    pub async fn task_handle(&self, id: &str) -> Option<TaskHandle> {
        self.state.lock().await.tasks.get(id).cloned()
    }

    /// Gives external callers (the listener's streamed-upload route) a way
    /// to emit progress/completion/failure events for a task it's driving
    /// itself, without needing its own separate EventBus instance.
    pub fn event_bus(&self) -> EventBus {
        self.event_bus.clone()
    }

    /// Mirrors `pause(id)`: flips status to Paused BEFORE cancelling, so the
    /// downloader's in-flight loop (which shares this same Arc<Mutex<..>>)
    /// observes "paused" rather than treating the abort as a failure.
    pub async fn pause(&self, id: &str) -> Option<DownloadTask> {
        let handle = { self.state.lock().await.tasks.get(id).cloned()? };
        {
            let mut task = handle.lock().await;
            if task.status != DownloadStatus::Running {
                return Some(task.clone());
            }
            task.status = DownloadStatus::Paused;
        }
        self.downloader.cancel(id);
        self.event_bus.emit(AppEvent::DownloadPaused(DownloadPaused { id: id.to_string() }));
        let result = handle.lock().await.clone();
        Some(result)
    }

    /// Mirrors `resume(id)`: re-queues at the FRONT of the queue.
    pub async fn resume(self: &Arc<Self>, id: &str) -> Option<DownloadTask> {
        let handle = { self.state.lock().await.tasks.get(id).cloned()? };
        {
            let mut task = handle.lock().await;
            if task.status != DownloadStatus::Paused {
                return Some(task.clone());
            }
            task.status = DownloadStatus::Queued;
            task.last_error = None;
        }
        {
            let mut state = self.state.lock().await;
            state.queue.insert(0, id.to_string());
        }
        self.event_bus.emit(AppEvent::DownloadResumed(DownloadResumed { id: id.to_string() }));
        let this = Arc::clone(self);
        tokio::spawn(async move { this.drain().await });
        let result = handle.lock().await.clone();
        Some(result)
    }

    /// Mirrors `cancel(id)`.
    pub async fn cancel(&self, id: &str) {
        let handle = { self.state.lock().await.tasks.get(id).cloned() };
        if let Some(handle) = handle {
            handle.lock().await.status = DownloadStatus::Cancelled;
            self.downloader.cancel(id);
        }
    }

    /// Mirrors `remove(id, deleteFromDisk = false)`.
    pub async fn remove(&self, id: &str, delete_from_disk: bool) {
        self.cancel(id).await;
        let handle = {
            let mut state = self.state.lock().await;
            let handle = state.tasks.remove(id);
            if let Some(pos) = state.queue.iter().position(|q| q == id) {
                state.queue.remove(pos);
            }
            handle
        };
        if delete_from_disk {
            if let Some(handle) = handle {
                let task = handle.lock().await;
                let file_path = task.output_path.clone().or_else(|| task.part_path.clone());
                if let Some(path) = file_path {
                    let _ = fs::remove_file(path).await; // ignore if already gone
                }
            }
        }
    }

    /// Mirrors `drain()`.
    #[async_recursion]
    async fn drain(self: Arc<Self>) {
        crate::debug_log::log("scheduler.drain: entered");
        loop {
            let max = (self.max_concurrent)();
            let active_now = self.active.load(Ordering::SeqCst);
            let next_task = {
                let mut state = self.state.lock().await;
                let queue_len = state.queue.len();
                crate::debug_log::log(&format!("scheduler.drain: loop check - active={active_now} max={max} queue_len={queue_len}"));
                if active_now >= max || state.queue.is_empty() {
                    crate::debug_log::log("scheduler.drain: blocked (active>=max or empty queue) - breaking");
                    None
                } else {
                    let id = state.queue.remove(0);
                    match state.tasks.get(&id) {
                        Some(handle) => {
                            let mut task = handle.lock().await;
                            if task.status == DownloadStatus::Queued {
                                task.status = DownloadStatus::Running;
                                drop(task);
                                crate::debug_log::log(&format!("scheduler.drain: picked task id={id}, marking Running"));
                                Some(Arc::clone(handle))
                            } else {
                                crate::debug_log::log(&format!("scheduler.drain: task id={id} was not Queued (status changed), skipping"));
                                continue; // task no longer queued - same as the TS `continue`
                            }
                        }
                        None => {
                            crate::debug_log::log(&format!("scheduler.drain: task id={id} not found in tasks map, skipping"));
                            continue; // task removed - same as the TS `continue`
                        }
                    }
                }
            };

            let Some(handle) = next_task else { break };
            self.active.fetch_add(1, Ordering::SeqCst);
            let this = Arc::clone(&self);
            let downloader = Arc::clone(&self.downloader);
            let handle_for_download = Arc::clone(&handle);
            tokio::spawn(async move {
                let task_id_for_log = handle_for_download.lock().await.id.clone();
                crate::debug_log::log(&format!("scheduler.drain: about to call downloader.start() for id={task_id_for_log}"));
                // Spawned as its own task and joined (rather than just
                // `.await`ed inline) so a panic inside downloader.start()
                // - which can happen from a lower-level dependency bug, not
                // just our own code - is caught here as an Err instead of
                // unwinding straight through this whole closure. Without
                // this, a panic skipped the fetch_sub/re-drain below
                // entirely: the concurrency slot never got released and NO
                // future download could ever start again, and the task
                // itself stayed stuck at "Queued/Running" forever with no
                // visible error.
                let download_task = tokio::spawn(async move {
                    downloader.start(handle_for_download).await;
                });
                let join_result = download_task.await;
                crate::debug_log::log(&format!("scheduler.drain: downloader.start() task for id={task_id_for_log} finished, panicked={}", join_result.is_err()));
                if join_result.is_err() {
                    // Panicked (or was otherwise aborted) mid-download.
                    // downloader.start() normally handles its own Err
                    // results internally (sets Failed, emits
                    // DownloadFailed) - this branch only runs for the case
                    // it couldn't, i.e. it never got the chance to.
                    let mut task = handle.lock().await;
                    if task.status != DownloadStatus::Paused {
                        task.status = DownloadStatus::Failed;
                        task.last_error = Some("Download failed unexpectedly (internal error) - see crash.log".to_string());
                        let id = task.id.clone();
                        let retry_count = task.retry_count;
                        drop(task);
                        this.event_bus.emit(AppEvent::DownloadFailed(DownloadFailed {
                            id,
                            reason: "Download failed unexpectedly (internal error) - see crash.log".to_string(),
                            retry_count,
                        }));
                    }
                }
                this.active.fetch_sub(1, Ordering::SeqCst);
                let this2 = Arc::clone(&this);
                tokio::spawn(async move { this2.drain().await });
            });
        }
        crate::debug_log::log("scheduler.drain: loop exited");
    }
}
