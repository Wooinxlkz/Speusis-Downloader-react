//! Ported from src/core/eventBus.ts.
//!
//! Node's EventEmitter (arbitrary named listeners) doesn't map 1:1 onto Rust;
//! the idiomatic Tauri equivalent is a broadcast channel of the AppEvent enum,
//! which every subscriber (including the Tauri command that forwards to the
//! renderer via `app_handle.emit("event-bus", ..)`, matching the old
//! `ipcRenderer.on("event-bus", listener)` contract in preload.ts) can filter
//! by variant instead of by string event name.
use crate::types::AppEvent;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        // Same purpose as EventEmitter's default unbounded-ish behavior;
        // 1024 pending events is generous headroom for a UI-facing bus.
        let (sender, _) = broadcast::channel(1024);
        Self { sender }
    }

    /// Mirrors `emit(event, payload)`.
    pub fn emit(&self, event: AppEvent) {
        // A send error just means there are currently no subscribers -
        // identical in effect to EventEmitter.emit with no listeners.
        let _ = self.sender.send(event);
    }

    /// Mirrors `on(event, handler)` / `onAny(handler)`: callers get a receiver
    /// and match on the AppEvent variant themselves to filter to one event
    /// type or handle all of them, replacing the string-keyed listener map.
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
