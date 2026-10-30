//! Audio and video files (Step 04c): subtitle files next to a video.

use std::fs;
use std::path::Path;
use tauri::WebviewWindow;

use crate::{ensure_main, validate_absolute_path};

/// Most subtitle files listed for one video.
pub const MAX_SIDECARS: usize = 20;
/// Most folder entries looked at (a folder can hold 100,000 files).
const MAX_ENTRIES_SCANNED: usize = 20_000;

/// Subtitle files for a video: names that start with the video's name
/// without its extension and a dot, and end with `.srt` or `.vtt`
/// (`movie.srt`, `movie.en.vtt`). Case-insensitive, sorted by name, at
/// most `MAX_SIDECARS`.
pub fn sidecar_names(video_name: &str, names: &[String]) -> Vec<String> {
    let stem = match video_name.rfind('.') {
        Some(dot) if dot > 0 => &video_name[..dot],
        _ => video_name,
    };
    let prefix = format!("{}.", stem.to_lowercase());
    let mut found: Vec<String> = names
        .iter()
        .filter(|name| {
            let lower = name.to_lowercase();
            lower.starts_with(&prefix) && (lower.ends_with(".srt") || lower.ends_with(".vtt"))
        })
        .cloned()
        .collect();
    found.sort_by_key(|name| name.to_lowercase());
    found.truncate(MAX_SIDECARS);
    found
}

/// Subtitle files next to a video file, as full paths.
pub fn sidecars(path: &Path) -> Result<Vec<String>, String> {
    let parent = path.parent().ok_or_else(|| "files.not_found".to_string())?;
    let video_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| "files.not_found".to_string())?;
    let entries = fs::read_dir(parent).map_err(|_| "files.not_found".to_string())?;
    let names: Vec<String> = entries
        .take(MAX_ENTRIES_SCANNED)
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    Ok(sidecar_names(&video_name, &names)
        .into_iter()
        .map(|name| parent.join(name).to_string_lossy().into_owned())
        .collect())
}

/// List the subtitle files next to a video (the player's Subtitles list).
#[tauri::command]
pub async fn media_sidecars(window: WebviewWindow, path: String) -> Result<Vec<String>, String> {
    ensure_main(window.label())?;
    validate_absolute_path(&path).map_err(|_| "files.not_found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || sidecars(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn finds_subtitles_named_after_the_video() {
        let all = names(&[
            "Movie.mp4",
            "movie.SRT",
            "Movie.en.vtt",
            "Movie.es.srt",
            "Movie2.srt",
            "Movie.txt",
            "Other.srt",
        ]);
        assert_eq!(
            sidecar_names("Movie.mp4", &all),
            names(&["Movie.en.vtt", "Movie.es.srt", "movie.SRT"])
        );
        assert!(sidecar_names("clip.webm", &all).is_empty());
    }

    #[test]
    fn lists_at_most_twenty() {
        let all: Vec<String> = (0..40).map(|n| format!("talk.{n:02}.srt")).collect();
        let found = sidecar_names("talk.mp4", &all);
        assert_eq!(found.len(), MAX_SIDECARS);
        assert_eq!(found[0], "talk.00.srt");
    }

    #[test]
    fn reads_the_video_folder() {
        let dir = std::env::temp_dir().join(format!(
            "adperastra-test-{}-media-sidecars",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        // A folder whose name looks like a subtitle file is not listed.
        fs::create_dir_all(dir.join("clip.old.srt")).unwrap();
        fs::write(dir.join("clip.mp4"), "video").unwrap();
        fs::write(dir.join("clip.srt"), "1").unwrap();
        let found = sidecars(&dir.join("clip.mp4")).unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with("clip.srt"));
        let _ = fs::remove_dir_all(&dir);
    }
}
