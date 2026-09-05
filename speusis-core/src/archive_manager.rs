//! Archive extraction and creation for Speusis's built-in Archive Manager.
//!
//! v0.5.50 scope: ZIP (read + write) and TAR / TAR.GZ (read only). RAR isn't
//! supported — there's no free/open extraction library for it — and 7z is
//! planned for a later release (tracked alongside the other "maybe later"
//! formats from the feature request this shipped with).

use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    Tar,
    TarGz,
}

/// Detects the archive kind from a file's extension. Returns `None` for
/// anything Speusis doesn't yet know how to extract (e.g. `.rar`, `.7z`) so
/// callers can gray out the menu item instead of failing at extract time.
pub fn detect_archive_kind(path: &str) -> Option<ArchiveKind> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".zip") {
        Some(ArchiveKind::Zip)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Some(ArchiveKind::TarGz)
    } else if lower.ends_with(".tar") {
        Some(ArchiveKind::Tar)
    } else {
        None
    }
}

pub fn is_supported_archive(path: &str) -> bool {
    detect_archive_kind(path).is_some()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExtractResult {
    #[serde(rename = "destDir")]
    pub dest_dir: String,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
}

/// Joins `entry_name` onto `dest_dir`, rejecting absolute paths and any
/// `..` component so a malicious archive can't write outside the chosen
/// destination folder ("zip-slip" / "tar-slip"). Used for TAR/TAR.GZ
/// entries; ZIP entries go through the zip crate's own `enclosed_name()`
/// guard instead (see `extract_zip` below).
fn safe_join(dest_dir: &Path, entry_name: &str) -> Result<PathBuf, String> {
    let entry_path = Path::new(entry_name);
    let mut joined = dest_dir.to_path_buf();
    let mut wrote_any = false;
    for component in entry_path.components() {
        match component {
            Component::Normal(part) => {
                joined.push(part);
                wrote_any = true;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!(
                    "Refusing to extract \"{entry_name}\" — it points outside the destination folder."
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Refusing to extract \"{entry_name}\" — absolute paths aren't allowed."
                ));
            }
        }
    }
    if !wrote_any {
        return Err(format!("Archive entry \"{entry_name}\" has an empty path."));
    }
    Ok(joined)
}

/// Extracts every entry in `archive_path` into `dest_dir` (created if it
/// doesn't already exist). Returns the number of files written.
pub fn extract_archive(archive_path: &str, dest_dir: &str) -> Result<ExtractResult, String> {
    let kind = detect_archive_kind(archive_path).ok_or_else(|| {
        "Unsupported archive format — Speusis currently extracts .zip, .tar, and .tar.gz/.tgz files."
            .to_string()
    })?;
    let dest = PathBuf::from(dest_dir);
    fs::create_dir_all(&dest).map_err(|e| format!("Couldn't create destination folder: {e}"))?;

    match kind {
        ArchiveKind::Zip => extract_zip(archive_path, &dest),
        ArchiveKind::Tar => {
            let file = fs::File::open(archive_path).map_err(|e| format!("Couldn't open archive: {e}"))?;
            extract_tar_reader(file, &dest)
        }
        ArchiveKind::TarGz => {
            let file = fs::File::open(archive_path).map_err(|e| format!("Couldn't open archive: {e}"))?;
            let gz = flate2::read::GzDecoder::new(file);
            extract_tar_reader(gz, &dest)
        }
    }
}

fn extract_zip(archive_path: &str, dest: &Path) -> Result<ExtractResult, String> {
    let file = fs::File::open(archive_path).map_err(|e| format!("Couldn't open archive: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid ZIP file: {e}"))?;
    let mut count = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // `enclosed_name()` is the zip crate's own zip-slip guard: it
        // returns `None` for absolute paths or any entry containing `..`.
        let Some(name) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            return Err(format!(
                "Refusing to extract \"{}\" — unsafe path in archive.",
                entry.name()
            ));
        };
        let out_path = dest.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(ExtractResult {
        dest_dir: dest.to_string_lossy().to_string(),
        file_count: count,
    })
}

fn extract_tar_reader<R: Read>(reader: R, dest: &Path) -> Result<ExtractResult, String> {
    let mut archive = tar::Archive::new(reader);
    let mut count = 0usize;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path_in_archive = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let out_path = safe_join(dest, &path_in_archive)?;
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        entry.unpack(&out_path).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(ExtractResult {
        dest_dir: dest.to_string_lossy().to_string(),
        file_count: count,
    })
}

/// Creates a new ZIP archive at `output_path` from the given source paths.
/// Directories are added recursively (paths inside the zip stay relative to
/// the directory's own parent); plain files are added at the archive root
/// under their own file name.
pub fn create_zip(paths: &[String], output_path: &str) -> Result<usize, String> {
    if paths.is_empty() {
        return Err("No files selected to add to the archive.".to_string());
    }
    let file = fs::File::create(output_path).map_err(|e| format!("Couldn't create archive: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut count = 0usize;
    let mut seen_names = std::collections::HashSet::new();
    for path_str in paths {
        let path = Path::new(path_str);
        if path.is_dir() {
            count += add_dir_to_zip(&mut zip, path, path, options, &mut seen_names)?;
        } else if path.is_file() {
            let name = unique_name(
                path.file_name().and_then(|n| n.to_str()).ok_or("Invalid file name")?,
                &mut seen_names,
            );
            zip.start_file(&name, options).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
            io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
            count += 1;
        } else {
            return Err(format!("\"{path_str}\" doesn't exist or isn't accessible."));
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(count)
}

/// Adding several unrelated files that happen to share a basename would
/// otherwise silently overwrite one another inside the zip — dedupe by
/// suffixing " (2)", " (3)", etc., same convention as most file managers.
fn unique_name(base: &str, seen: &mut std::collections::HashSet<String>) -> String {
    if seen.insert(base.to_string()) {
        return base.to_string();
    }
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (base.to_string(), String::new()),
    };
    let mut n = 2;
    loop {
        let candidate = format!("{stem} ({n}){ext}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    root: &Path,
    dir: &Path,
    options: zip::write::FileOptions,
    seen_names: &mut std::collections::HashSet<String>,
) -> Result<usize, String> {
    let mut count = 0usize;
    let base = root.parent().unwrap_or(root);
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            count += add_dir_to_zip(zip, root, &path, options, seen_names)?;
        } else {
            let rel = path.strip_prefix(base).unwrap_or(&path);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let rel_str = unique_name(&rel_str, seen_names);
            zip.start_file(&rel_str, options).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
            io::copy(&mut f, zip).map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("speusis_archive_test_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_kinds_correctly() {
        assert_eq!(detect_archive_kind("movie.zip"), Some(ArchiveKind::Zip));
        assert_eq!(detect_archive_kind("archive.TAR.GZ"), Some(ArchiveKind::TarGz));
        assert_eq!(detect_archive_kind("archive.tgz"), Some(ArchiveKind::TarGz));
        assert_eq!(detect_archive_kind("backup.tar"), Some(ArchiveKind::Tar));
        assert_eq!(detect_archive_kind("data.rar"), None);
        assert_eq!(detect_archive_kind("data.7z"), None);
        assert!(is_supported_archive("x.zip"));
        assert!(!is_supported_archive("x.rar"));
    }

    #[test]
    fn zip_roundtrip_extracts_files_and_folders() {
        let work = tmp_dir("zip_roundtrip");
        let src_dir = work.join("src");
        fs::create_dir_all(src_dir.join("nested")).unwrap();
        fs::write(src_dir.join("a.txt"), b"hello a").unwrap();
        fs::write(src_dir.join("nested/b.txt"), b"hello b").unwrap();

        let zip_path = work.join("out.zip").to_string_lossy().to_string();
        let n = create_zip(&[src_dir.to_string_lossy().to_string()], &zip_path).unwrap();
        assert_eq!(n, 2, "should have zipped 2 files");
        assert!(Path::new(&zip_path).exists());

        let dest_dir = work.join("extracted").to_string_lossy().to_string();
        let result = extract_archive(&zip_path, &dest_dir).unwrap();
        assert_eq!(result.file_count, 2);

        let extracted_a = fs::read_to_string(work.join("extracted/src/a.txt")).unwrap();
        assert_eq!(extracted_a, "hello a");
        let extracted_b = fs::read_to_string(work.join("extracted/src/nested/b.txt")).unwrap();
        assert_eq!(extracted_b, "hello b");
    }

    #[test]
    fn create_zip_dedupes_colliding_names() {
        let work = tmp_dir("dedupe");
        let f1 = work.join("readme.txt");
        fs::write(&f1, b"one").unwrap();
        let sub = work.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let f2 = sub.join("readme.txt");
        fs::write(&f2, b"two").unwrap();

        let zip_path = work.join("dupes.zip").to_string_lossy().to_string();
        let n = create_zip(
            &[f1.to_string_lossy().to_string(), f2.to_string_lossy().to_string()],
            &zip_path,
        )
        .unwrap();
        assert_eq!(n, 2);

        let dest_dir = work.join("extracted").to_string_lossy().to_string();
        let result = extract_archive(&zip_path, &dest_dir).unwrap();
        assert_eq!(result.file_count, 2, "both same-named files should survive extraction");
    }

    #[test]
    fn tar_gz_roundtrip() {
        let work = tmp_dir("targz");
        let tar_gz_path = work.join("out.tar.gz");
        {
            let file = fs::File::create(&tar_gz_path).unwrap();
            let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
            let mut builder = tar::Builder::new(enc);
            let mut header = tar::Header::new_gnu();
            let data = b"tar gz contents";
            header.set_size(data.len() as u64);
            header.set_cksum();
            builder.append_data(&mut header, "inner/file.txt", &data[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let dest_dir = work.join("extracted").to_string_lossy().to_string();
        let result = extract_archive(&tar_gz_path.to_string_lossy(), &dest_dir).unwrap();
        assert_eq!(result.file_count, 1);
        let content = fs::read_to_string(work.join("extracted/inner/file.txt")).unwrap();
        assert_eq!(content, "tar gz contents");
    }

    #[test]
    fn safe_join_rejects_traversal_and_absolute_paths() {
        let dest = PathBuf::from("/tmp/speusis_dest");
        assert!(safe_join(&dest, "ok/nested/file.txt").is_ok());
        assert!(safe_join(&dest, "../../etc/passwd").is_err(), "must reject ..");
        assert!(safe_join(&dest, "ok/../../escape.txt").is_err(), "must reject embedded ..");
        assert!(safe_join(&dest, "/etc/passwd").is_err(), "must reject absolute paths");
    }

    #[test]
    fn create_zip_rejects_missing_path() {
        let work = tmp_dir("missing");
        let zip_path = work.join("out.zip").to_string_lossy().to_string();
        let err = create_zip(&["/nonexistent/path/does/not/exist".to_string()], &zip_path);
        assert!(err.is_err());
    }
}
