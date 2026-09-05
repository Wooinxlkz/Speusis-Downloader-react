//! Ported 1:1 from src/core/fileManager.ts
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Mutex;

pub struct FileManager {
    // Mirrors the open-file-handle cache in fileManager.ts, keyed by path.
    handles: Mutex<HashMap<String, File>>,
}

impl FileManager {
    pub fn new() -> Self {
        Self { handles: Mutex::new(HashMap::new()) }
    }

    /// Mirrors `sanitizeFilename(name)`.
    pub fn sanitize_filename(name: &str) -> String {
        let base = Path::new(name)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let cleaned: String = base
            .chars()
            .filter(|c| *c != '\0')
            .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
            .collect();
        let cleaned = cleaned.replace("..", "_");
        let trimmed = cleaned.trim();
        if trimmed.is_empty() { "download.bin".to_string() } else { trimmed.to_string() }
    }

    pub async fn ensure_directory(dir: impl AsRef<Path>) -> anyhow::Result<()> {
        fs::create_dir_all(dir).await?;
        Ok(())
    }

    pub fn get_part_path(target_dir: &str, filename: &str) -> PathBuf {
        Path::new(target_dir).join(format!("{}.part", Self::sanitize_filename(filename)))
    }

    pub fn get_final_path(target_dir: &str, filename: &str) -> PathBuf {
        Path::new(target_dir).join(Self::sanitize_filename(filename))
    }

    /// Mirrors `openForWriting(path, size)`: create + pre-allocate to `size`
    /// bytes, then keep a persistent r+ handle open for chunked writes.
    pub async fn open_for_writing(&self, path: &str, size: u64) -> anyhow::Result<()> {
        {
            let mut handles = self.handles.lock().await;
            if let Some(existing) = handles.remove(path) {
                drop(existing); // closing = dropping the handle, same as the ignored close() in the original
            }
        }

        let create_handle = OpenOptions::new().write(true).create(true).truncate(true).open(path).await?;
        if size > 0 {
            create_handle.set_len(size).await?;
        }
        drop(create_handle);

        let rw_handle = OpenOptions::new().read(true).write(true).open(path).await?;
        self.handles.lock().await.insert(path.to_string(), rw_handle);
        Ok(())
    }

    /// Mirrors `writeChunk(path, offset, chunk)`: uses the persistent handle
    /// if present, otherwise a one-shot open/write/close (torrent-engine case).
    pub async fn write_chunk(&self, path: &str, offset: u64, chunk: &[u8]) -> anyhow::Result<()> {
        let mut handles = self.handles.lock().await;
        if let Some(handle) = handles.get_mut(path) {
            handle.seek(SeekFrom::Start(offset)).await?;
            handle.write_all(chunk).await?;
        } else {
            drop(handles);
            let mut h = OpenOptions::new().read(true).write(true).open(path).await?;
            h.seek(SeekFrom::Start(offset)).await?;
            h.write_all(chunk).await?;
        }
        Ok(())
    }

    /// Mirrors `closeFile(path)`: idempotent.
    pub async fn close_file(&self, path: &str) {
        let mut handles = self.handles.lock().await;
        if let Some(handle) = handles.remove(path) {
            drop(handle);
        }
    }

    /// Mirrors `finalize(partPath, finalPath)`. Handles the case where the
    /// part file lives in a different directory than the final destination
    /// (e.g. a configured temp dir) — `rename` fails across filesystems/
    /// drives, so fall back to copy+remove when that happens.
    pub async fn finalize(&self, part_path: &str, final_path: &str) -> anyhow::Result<()> {
        self.close_file(part_path).await;
        if fs::rename(part_path, final_path).await.is_err() {
            fs::copy(part_path, final_path).await?;
            fs::remove_file(part_path).await?;
        }
        Ok(())
    }

    pub async fn file_size(path: &str) -> u64 {
        fs::metadata(path).await.map(|m| m.len()).unwrap_or(0)
    }

    pub fn get_resume_path(part_path: &str) -> String {
        format!("{part_path}.speusis.json")
    }

    pub async fn read_json<T: serde::de::DeserializeOwned>(path: &str) -> Option<T> {
        let raw = fs::read_to_string(path).await.ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub async fn write_json<T: serde::Serialize>(path: &str, value: &T) -> anyhow::Result<()> {
        let json = serde_json::to_string_pretty(value)?;
        fs::write(path, json).await?;
        Ok(())
    }

    pub async fn remove(path: &str) -> anyhow::Result<()> {
        // Mirrors `rm(path, { force: true })` - missing file is not an error.
        match fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn sha1(data: &[u8]) -> String {
        let mut hasher = Sha1::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    pub fn sha256(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    /// Reads the live resume manifest for a `.part` file (if one exists yet)
    /// and returns a per-segment progress snapshot for the segment-map UI.
    /// Only cares about `size`/`segments` — other manifest fields are ignored.
    pub async fn read_segment_map(part_path: &str) -> Option<crate::types::SegmentMapResponse> {
        #[derive(serde::Deserialize)]
        struct SegDto { start: u64, end: u64, received: u64 }
        #[derive(serde::Deserialize)]
        struct ManifestDto { size: u64, segments: Vec<SegDto> }

        let resume_path = Self::get_resume_path(part_path);
        let manifest = Self::read_json::<ManifestDto>(&resume_path).await?;
        let downloaded_bytes: u64 = manifest.segments.iter().map(|s| s.received).sum();
        let segments = manifest
            .segments
            .into_iter()
            .enumerate()
            .map(|(i, s)| {
                let len = s.end.saturating_sub(s.start) + 1;
                crate::types::SegmentMapEntry {
                    index: i as u32,
                    start: s.start,
                    end: s.end,
                    received: s.received,
                    done: s.received >= len,
                }
            })
            .collect::<Vec<_>>();
        Some(crate::types::SegmentMapResponse {
            total_segments: segments.len() as u32,
            downloaded_bytes,
            total_bytes: manifest.size,
            segments,
        })
    }
}

impl Default for FileManager {
    fn default() -> Self {
        Self::new()
    }
}
