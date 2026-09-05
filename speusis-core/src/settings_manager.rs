//! Ported 1:1 from src/core/settingsManager.ts
use crate::types::AppSettings;
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct SettingsManager {
    app_data_dir: PathBuf,
    settings: AppSettings,
}

impl SettingsManager {
    pub fn new(app_data_dir: impl AsRef<Path>, default_download_dir: impl AsRef<Path>) -> Self {
        let app_data_dir = app_data_dir.as_ref().to_path_buf();
        let settings = AppSettings::defaults(
            &app_data_dir.to_string_lossy(),
            &default_download_dir.as_ref().to_string_lossy(),
        );
        Self { app_data_dir, settings }
    }

    fn path(&self) -> PathBuf {
        self.app_data_dir.join("settings.json")
    }

    /// Mirrors `load()`: ensure the app data dir exists, try to read+merge
    /// settings.json, and if that fails (missing/corrupt) write fresh defaults.
    pub async fn load(&mut self) -> anyhow::Result<&AppSettings> {
        fs::create_dir_all(&self.app_data_dir).await?;
        match fs::read_to_string(self.path()).await {
            Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(patch) => {
                    // merge patch on top of current (default) settings, same as `{ ...this.settings, ...JSON.parse(raw) }`
                    let mut merged = serde_json::to_value(&self.settings)?;
                    if let (Some(base), Some(patch)) = (merged.as_object_mut(), patch.as_object()) {
                        for (k, v) in patch {
                            base.insert(k.clone(), v.clone());
                        }
                    }
                    self.settings = serde_json::from_value(merged)?;
                }
                Err(_) => self.save().await?,
            },
            Err(_) => self.save().await?,
        }
        Ok(&self.settings)
    }

    pub fn get(&self) -> &AppSettings {
        &self.settings
    }

    /// Mirrors `update(patch)`: shallow-merge patch fields, persist, return the result.
    pub async fn update(&mut self, patch: serde_json::Value) -> anyhow::Result<&AppSettings> {
        let mut merged = serde_json::to_value(&self.settings)?;
        if let (Some(base), Some(patch)) = (merged.as_object_mut(), patch.as_object()) {
            for (k, v) in patch {
                base.insert(k.clone(), v.clone());
            }
        }
        self.settings = serde_json::from_value(merged)?;
        self.save().await?;
        Ok(&self.settings)
    }

    async fn save(&self) -> anyhow::Result<()> {
        let json = serde_json::to_string_pretty(&self.settings)?;
        fs::write(self.path(), json).await?;
        Ok(())
    }
}
