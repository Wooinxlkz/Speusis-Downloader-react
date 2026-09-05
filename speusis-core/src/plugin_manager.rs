//! Ported from src/core/pluginManager.ts + src/shared/plugin.ts.
//!
//! NOT a full port: the original uses Node's `vm` module to sandbox-execute
//! arbitrary plugin JavaScript at runtime. Rust has no built-in JS VM, so a
//! faithful port means embedding a JS engine (e.g. `boa` or `deno_core`) -
//! a substantial project on its own. Since the shipped source has zero real
//! plugin.json files (this system has never been exercised), I've ported the
//! parts that don't require running untrusted JS - manifest loading,
//! permission checks, the handler registry, the PluginAPI surface - and left
//! `load()` returning a clear "not implemented" error instead of silently
//! pretending to run plugin code. If/when you actually write a plugin,
//! that's the point to decide: embed a JS engine, or require plugins to be
//! compiled Rust/WASM instead (much simpler and faster, but breaks JS plugin
//! compatibility with anything written for the Electron version).
use crate::event_bus::EventBus;
use crate::settings_manager::SettingsManager;
use crate::types::AppSettings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    EventsRead,
    EventsWrite,
    DownloadsRegister,
    SettingsRead,
    UiBadge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    pub permissions: Vec<Permission>,
    pub entry: String,
}

/// Mirrors `PluginAPI.log`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

pub struct PluginManager {
    plugins_dir: std::path::PathBuf,
    event_bus: EventBus,
    settings: Arc<Mutex<SettingsManager>>,
    loaded: Mutex<Vec<PluginManifest>>,
    handlers: Mutex<HashMap<String, String>>, // scheme -> plugin name that registered it
}

impl PluginManager {
    pub fn new(plugins_dir: impl AsRef<std::path::Path>, event_bus: EventBus, settings: Arc<Mutex<SettingsManager>>) -> Self {
        Self {
            plugins_dir: plugins_dir.as_ref().to_path_buf(),
            event_bus,
            settings,
            loaded: Mutex::new(Vec::new()),
            handlers: Mutex::new(HashMap::new()),
        }
    }

    /// Mirrors `getHandler(scheme)` - returns which plugin owns the scheme,
    /// since there's no executable handler to hand back yet.
    pub async fn get_handler(&self, scheme: &str) -> Option<String> {
        self.handlers.lock().await.get(scheme).cloned()
    }

    /// Mirrors `loadAll()`: walks pluginsDir, validates each manifest.
    /// Returns the manifests it found so callers can surface
    /// "N plugins found but plugin execution isn't implemented yet"
    /// instead of the silent Electron-vm behavior.
    pub async fn load_all(&self) -> Vec<(PluginManifest, anyhow::Result<()>)> {
        let mut results = Vec::new();
        let mut entries = match tokio::fs::read_dir(&self.plugins_dir).await {
            Ok(e) => e,
            Err(_) => return results, // matches the TS catch-and-return-early on readdir failure
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let dir = entry.path();
            match self.load_manifest(&dir).await {
                Ok(manifest) => {
                    self.validate_manifest(&manifest);
                    self.loaded.lock().await.push(manifest.clone());
                    let run_result = Err(anyhow::anyhow!(
                        "Plugin '{}' has a valid manifest but plugin JS execution is not implemented in the Rust backend yet",
                        manifest.name
                    ));
                    results.push((manifest, run_result));
                }
                Err(_) => continue,
            }
        }
        results
    }

    async fn load_manifest(&self, plugin_dir: &std::path::Path) -> anyhow::Result<PluginManifest> {
        let raw = tokio::fs::read_to_string(plugin_dir.join("plugin.json")).await?;
        let manifest: PluginManifest = serde_json::from_str(&raw)?;
        Ok(manifest)
    }

    /// Mirrors `unloadAll()`. There's no live plugin instance to call
    /// `onUnload()` on yet (see module doc), so this just clears state.
    pub async fn unload_all(&self) {
        self.loaded.lock().await.clear();
        self.handlers.lock().await.clear();
    }

    fn validate_manifest(&self, manifest: &PluginManifest) -> bool {
        !manifest.name.is_empty() && !manifest.version.is_empty() && !manifest.entry.is_empty()
    }

    fn require_permission(&self, manifest: &PluginManifest, permission: Permission) -> anyhow::Result<()> {
        if !manifest.permissions.contains(&permission) {
            anyhow::bail!("Plugin {} missing permission {:?}", manifest.name, permission);
        }
        Ok(())
    }

    /// Mirrors `createApi().getSettings()` - the one PluginAPI method that's
    /// safe to expose without a running plugin, since callers might want to
    /// permission-check + fetch settings without full plugin execution.
    pub async fn get_settings_for(&self, manifest: &PluginManifest) -> anyhow::Result<AppSettings> {
        self.require_permission(manifest, Permission::SettingsRead)?;
        Ok(self.settings.lock().await.get().clone())
    }

    pub fn log(&self, manifest: &PluginManifest, level: LogLevel, message: &str) {
        let entry = serde_json::json!({
            "level": level,
            "plugin": manifest.name,
            "message": message,
            "at": chrono::Utc::now().to_rfc3339(),
        });
        eprintln!("{entry}");
    }
}
