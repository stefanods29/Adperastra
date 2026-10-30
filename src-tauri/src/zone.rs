//! "Mark of the Web" (Step 04c). When a browser or mail app saves a file
//! from the internet, Windows records it in a small `Zone.Identifier`
//! stream next to the file's data. File tabs show such files in protected
//! view; Unblock removes the mark, like the Unblock box in the file's
//! Windows Properties.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

use crate::{ensure_main, validate_absolute_path};

/// Largest `Zone.Identifier` stream read (it is a few lines of text).
const ZONE_STREAM_MAX: u64 = 4096;

/// Zone 3 is Internet and zone 4 is Restricted sites: both mean "from the
/// internet". Zones 0 to 2 are this computer, the local network, trusted.
pub const INTERNET_ZONE: u32 = 3;

/// The `Zone.Identifier` stream of a file. None when the file name already
/// contains a colon, so no other stream is ever read or removed.
pub fn zone_stream_path(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy();
    if name.contains(':') {
        return None;
    }
    let mut text = path.as_os_str().to_os_string();
    text.push(":Zone.Identifier");
    Some(PathBuf::from(text))
}

/// The zone Windows recorded for a downloaded file, or None without a mark.
pub fn zone_id(path: &Path) -> Option<u32> {
    let stream = zone_stream_path(path)?;
    let file = fs::File::open(stream).ok()?;
    let mut bytes = Vec::new();
    file.take(ZONE_STREAM_MAX).read_to_end(&mut bytes).ok()?;
    String::from_utf8_lossy(&bytes).lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim().eq_ignore_ascii_case("ZoneId") {
            value.trim().parse::<u32>().ok()
        } else {
            None
        }
    })
}

/// True when the file carries the mark of a download from the internet.
pub fn is_from_internet(path: &Path) -> bool {
    zone_id(path).is_some_and(|zone| zone >= INTERNET_ZONE)
}

/// Remove the mark. Only the `Zone.Identifier` stream is removed; the
/// file's content is never touched. This is the one `remove_file` that
/// plan/rules.md R-SAFE allows outside the Recycle Bin path, because it
/// deletes no user data.
pub fn unblock(path: &Path) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|_| "files.not_found".to_string())?;
    if !meta.is_file() {
        return Err("files.not_a_file".to_string());
    }
    let stream = zone_stream_path(path).ok_or_else(|| "files.unblock_failed".to_string())?;
    match fs::remove_file(&stream) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            Err("files.unblock_denied".to_string())
        }
        Err(_) => Err("files.unblock_failed".to_string()),
    }
}

/// Unblock a file the user chose to trust (the UI asks first).
#[tauri::command]
pub async fn file_unblock(window: WebviewWindow, path: String) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "files.not_found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || unblock(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "adperastra-test-{}-zone-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn mark_of_the_web_is_read_and_removed() {
        let dir = temp_dir("mark");
        let file = dir.join("setup-notes.txt");
        fs::write(&file, "hello").unwrap();
        assert_eq!(zone_id(&file), None);
        assert!(!is_from_internet(&file));
        assert!(!crate::files::detect(&file).unwrap().from_internet);
        let stream = zone_stream_path(&file).unwrap();
        fs::write(
            &stream,
            "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/setup-notes.txt\r\n",
        )
        .unwrap();
        assert_eq!(zone_id(&file), Some(3));
        assert!(is_from_internet(&file));
        assert!(crate::files::detect(&file).unwrap().from_internet);
        unblock(&file).unwrap();
        assert_eq!(zone_id(&file), None);
        assert_eq!(fs::read_to_string(&file).unwrap(), "hello");
        // Unblocking a file without a mark is fine.
        unblock(&file).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_internet_zones_count() {
        let dir = temp_dir("zones");
        let file = dir.join("report.pdf");
        fs::write(&file, "data").unwrap();
        let stream = zone_stream_path(&file).unwrap();
        for (text, expected) in [
            ("[ZoneTransfer]\nZoneId=2\n", false),
            ("[ZoneTransfer]\nzoneid = 4\n", true),
            ("[ZoneTransfer]\nReferrerUrl=x\n", false),
        ] {
            fs::write(&stream, text).unwrap();
            assert_eq!(is_from_internet(&file), expected, "{text}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zone_stream_never_targets_another_stream() {
        assert!(zone_stream_path(&Path::new("data").join("a.txt:other")).is_none());
        let path = zone_stream_path(&Path::new("data").join("a.txt")).unwrap();
        assert!(path.to_string_lossy().ends_with("a.txt:Zone.Identifier"));
    }

    #[test]
    fn unblock_refuses_folders_and_missing_files() {
        let dir = temp_dir("refuse");
        assert_eq!(unblock(&dir), Err("files.not_a_file".to_string()));
        assert_eq!(
            unblock(&dir.join("missing.txt")),
            Err("files.not_found".to_string())
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
