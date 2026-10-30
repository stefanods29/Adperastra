# Step 04c: Audio and video player, protected view, Open as text or hex, Default apps

| | |
|---|---|
| State | ready |
| Difficulty | ★★ |
| Branch | `step-04c-media-protected-defaults` |
| Tag | `v0.0.9-step04c` |
| Depends on | 04b |

## Goal

Music and videos play in a tab (MP4, WebM, MP3, M4A, AAC, WAV, OGG, Opus, FLAC), with subtitles from .srt or .vtt files next to the video. Files downloaded from the internet open in protected view: a yellow bar says so, their links stay off, and Unblock removes the mark (like the Unblock box in Windows Properties). Right-click > Open as > Open as text or Open as hex shows any file as text or as bytes. Settings gets an "Opening files" section: protected view on or off, and Default apps, where each file type can open in Adperastra or in its Windows app.

## Do not do in this step

- No editing (Step 06a adds "Enable editing" to the protected view bar). No search in the hex viewer and no Go to offset (Step 06f).
- No MKV, AVI, WMV or MOV playback: they open in their Windows app.
- No "downloaded" badge in the Details pane (Step 07b), no Microsoft Defender scan, no trusted folders for protected view (backlog).
- Do not change how folders, shortcuts (.lnk) or programs open.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-02, P-03, P-08, P-16, P-26, P-28, P-29), `plan/rules.md` R-SAFE and R-OPEN, `plan/recipes/add-settings-field.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-help-page.md`.
- Code: `src-tauri/src/main.rs` (settings: `FileSettings`, `Settings`, `validate`, `migrate`, the settings tests), `src-tauri/src/files.rs` (`FileTypeInfo`, `detect`), `src/services/settings.ts`, `src/views/FileTabView.tsx`, `src/handlers/openPipeline.ts`, `src/views/SettingsView.tsx`, `src/commands/explorerCommands.ts`, `src/commands/menus.ts`.

## Decisions (already made)

- D1. Player: the webview's own `<video>` or `<audio>` with its controls (`controlsList="nodownload noremoteplayback"`, no picture-in-picture), reading the file through the `adpfile` protocol (Range requests, Step 04a). Video: mp4, m4v, webm. Audio: mp3, m4a, aac, wav, ogg, oga, opus, flac, weba. A file the player cannot play shows "This file can't be played here" with Open in Windows app; a video without a picture (an unsupported video codec) shows a notice with the same button.
- D2. Player ribbon: Play / Pause (one shows at a time, key tip P), Loop (L), Speed (0.5× to 2×), Subtitles (videos only). No keyboard shortcuts of our own: the player gets the focus when it opens, so Space plays and pauses. Speed and Loop are saved in the tab. Playback continues while another tab is shown.
- D3. Subtitles: Rust `media_sidecars` lists up to 20 files in the video's folder whose names start with the video's name and a dot and end with .srt or .vtt. Choosing one reads it (at most 2 MB) through a file token, converts SRT to WebVTT, and shows it as a `<track>` (Blob URL); Off removes it.
- D4. Mark of the Web: `FileTypeInfo.from_internet` is true when the file's `Zone.Identifier` stream says `ZoneId=3` (Internet) or `4` (Restricted). At most 4 KB of the stream is read. Unblock (Rust `file_unblock`) removes only that stream; the file's content is never touched. This is the only `remove_file` outside the Recycle Bin path, allowed because it deletes no user data.
- D5. Protected view (setting on by default): a file tab for a file from the internet shows a yellow bar under the navigation row with Unblock (asks first) and a help button. Views get `protectedView`: the Markdown viewer ignores link clicks. Step 06a uses the same flag to start without editing.
- D6. Open as text / Open as hex: right-click > Open as (submenu) for files only, at most 15 at a time. They open a tab with the text viewer or the new hex viewer, whatever the type; tabs are per file and viewer, so the same file can be open in two viewers.
- D7. Hex viewer: never chosen by type (no extensions, no content types). Rows of 16 bytes: offset (8 hex digits, 12 over 4 GB), the bytes in hex with a wider gap after the 8th, and the same bytes as text ("." for anything not printable ASCII). Files over 1 MB show in parts of 1 MB (Alt+Page Up / Alt+Page Down), each read with one Range request. Zoom with Ctrl+= / Ctrl+- / Ctrl+0, saved in the tab.
- D8. Settings schema 5 (`plan/recipes/add-settings-field.md`): section `open` with `protected_view` (default true) and `open_with` (extension to `"builtin"` or `"windows"`; missing means built-in; at most 500 entries; keys are 1 to 16 characters from a-z, 0-9, `_`, `+`, `-`). Only `"windows"` choices are stored. The open pipeline reads it (`planOpen(path, registry, openWith)`).
- D9. Settings > Opening files lists the file types of each built-in viewer that is chosen by type (Image, Audio and video, Markdown, Text), each type once (".md" belongs to Markdown). Each group has one list for all its types and expands to show one list per type; a search box finds a type.
- D10. Ribbons leave out a group whose controls are all hidden (for example Parts for a small file), and Alt+letter skips hidden controls (Play and Pause share P).

## Tasks

### T1 - Settings: opening files (schema 5)

**Files:** modify `src-tauri/src/main.rs`, `src/services/settings.ts`, `src/__tests__/settings.test.ts`, `scripts/measure-ui.ps1`.

This is `plan/recipes/add-settings-field.md` with N = 5; every change is given here. The recipe's `migrate_keep_known` function is added now (first schema bump under plan v2).

In `src-tauri/src/main.rs`, find exactly:

```rust
use std::collections::HashMap;
```

Replace with:

```rust
use std::collections::{BTreeMap, HashMap};
```

In `src-tauri/src/main.rs`, find exactly:

```rust
pub const CURRENT_SCHEMA: u32 = 4;
```

Replace with:

```rust
pub const CURRENT_SCHEMA: u32 = 5;
```

In `src-tauri/src/main.rs`, find exactly:

```rust
impl Default for FileSettings {
    fn default() -> Self {
        Self {
            paste_image_format: default_paste_image_format(),
        }
    }
}
```

Replace with:

```rust
impl Default for FileSettings {
    fn default() -> Self {
        Self {
            paste_image_format: default_paste_image_format(),
        }
    }
}

/// Most entries in `open_with`.
pub const MAX_OPEN_WITH: usize = 500;

/// How files open (schema 5, Step 04c): Settings > Opening files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenSettings {
    /// Files from the internet open in protected view.
    #[serde(default = "default_true")]
    pub protected_view: bool,
    /// Extension (lower case, no dot) to "builtin" or "windows". An
    /// extension that is not listed opens in the built-in viewer when
    /// there is one.
    #[serde(default)]
    pub open_with: BTreeMap<String, String>,
}

impl Default for OpenSettings {
    fn default() -> Self {
        Self {
            protected_view: true,
            open_with: BTreeMap::new(),
        }
    }
}

/// An extension as `open_with` stores it: 1 to 16 characters from a-z,
/// 0-9, `_`, `+` and `-`.
fn is_valid_extension_key(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= 16
        && ext
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '+' | '-'))
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
    #[serde(default)]
    pub files: FileSettings,
}
```

Replace with:

```rust
    #[serde(default)]
    pub files: FileSettings,
    #[serde(default)]
    pub open: OpenSettings,
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            explorer: ExplorerViewSettings::default(),
            files: FileSettings::default(),
        }
    }
}
```

Replace with:

```rust
            explorer: ExplorerViewSettings::default(),
            files: FileSettings::default(),
            open: OpenSettings::default(),
        }
    }
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            "unsupported group_by {:?} (expected none, name, modified, type or size)",
            settings.explorer.group_by
        )));
    }
    Ok(())
}
```

Replace with:

```rust
            "unsupported group_by {:?} (expected none, name, modified, type or size)",
            settings.explorer.group_by
        )));
    }
    if settings.open.open_with.len() > MAX_OPEN_WITH {
        return Err(AppError::Validation(format!(
            "open_with has {} entries (at most {MAX_OPEN_WITH})",
            settings.open.open_with.len()
        )));
    }
    for (ext, choice) in &settings.open.open_with {
        if !is_valid_extension_key(ext) || !matches!(choice.as_str(), "builtin" | "windows") {
            return Err(AppError::Validation(format!(
                "unsupported open_with entry {ext:?}: {choice:?} (expected builtin or windows)"
            )));
        }
    }
    Ok(())
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
        explorer: ExplorerViewSettings::default(),
        files: FileSettings::default(),
    }
}
```

Replace with:

```rust
        explorer: ExplorerViewSettings::default(),
        files: FileSettings::default(),
        open: OpenSettings::default(),
    }
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
/// Upgrade any on-disk settings value to the current schema.
```

Replace with:

```rust
/// Older files keep everything they have; fields added since then
/// come from their serde defaults. Invalid files fall back to defaults.
fn migrate_keep_known(value: serde_json::Value) -> Settings {
    match serde_json::from_value::<Settings>(value) {
        Ok(mut settings) => {
            settings.schema_version = CURRENT_SCHEMA;
            if validate(&settings).is_ok() {
                settings
            } else {
                Settings::default()
            }
        }
        Err(_) => Settings::default(),
    }
}

/// Upgrade any on-disk settings value to the current schema.
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            Some(3) => Ok(migrate_v3(value.clone())),
```

Replace with:

```rust
            Some(4) => Ok(migrate_keep_known(value.clone())),
            Some(3) => Ok(migrate_v3(value.clone())),
```

In `src-tauri/src/main.rs`, find exactly:

```rust
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.schema_version, 4);
```

Replace with:

```rust
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.schema_version, 5);
```

In `src-tauri/src/main.rs`, find exactly:

```rust
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_source, "design");
```

Replace with:

```rust
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_source, "design");
```

In `src-tauri/src/main.rs`, find exactly:

```rust
        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_custom, "#112233");
```

Replace with:

```rust
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert_eq!(settings.theme.accent_custom, "#112233");
```

In `src-tauri/src/main.rs`, find exactly:

```rust
        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
```

Replace with:

```rust
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
```

In `src-tauri/src/main.rs`, find exactly:

```rust
    #[test]
    fn validation_rejects_bad_language() {
```

Replace with:

```rust
    #[test]
    fn settings_v4_migrates_to_v5_keeping_language_and_theme() {
        let value = serde_json::json!({
            "schema_version": 4,
            "language": "es",
            "theme": { "mode": "dark", "accent_source": "design", "accent_custom": "#0067C0" },
            "explorer": { "show_hidden": true, "show_extensions": true, "item_checkboxes": false, "details_pane": true, "group_by": "none" },
            "files": { "paste_image_format": "jpg" }
        });
        let settings = migrate(value).unwrap();
        assert_eq!(settings.schema_version, 5);
        assert_eq!(settings.language, "es");
        assert_eq!(settings.theme.mode, "dark");
        assert!(settings.explorer.show_hidden);
        assert_eq!(settings.files.paste_image_format, "jpg");
        assert_eq!(settings.open, OpenSettings::default());
        assert!(settings.open.protected_view);
    }

    #[test]
    fn settings_validate_rejects_bad_open_with() {
        let mut settings = Settings::default();
        settings
            .open
            .open_with
            .insert("txt".to_string(), "windows".to_string());
        settings
            .open
            .open_with
            .insert("c++".to_string(), "builtin".to_string());
        assert!(validate(&settings).is_ok());
        for (ext, choice) in [
            ("txt", "notepad"),
            ("TXT", "windows"),
            ("", "windows"),
            ("a.b", "windows"),
            ("abcdefghijklmnopq", "windows"),
        ] {
            let mut bad = Settings::default();
            bad.open
                .open_with
                .insert(ext.to_string(), choice.to_string());
            assert!(validate(&bad).is_err(), "{ext:?} {choice:?}");
        }
        let mut many = Settings::default();
        for n in 0..=MAX_OPEN_WITH {
            many.open
                .open_with
                .insert(format!("x{n}"), "windows".to_string());
        }
        assert!(validate(&many).is_err());
    }

    #[test]
    fn validation_rejects_bad_language() {
```

In `src/services/settings.ts`, find exactly:

```ts
export const SETTINGS_SCHEMA_VERSION = 4;
```

Replace with:

```ts
export const SETTINGS_SCHEMA_VERSION = 5;
```

In `src/services/settings.ts`, find exactly:

```ts
/** File-operation choices (schema 4): what Paste as file saves images as. */
export interface FileSettings {
  paste_image_format: PasteImageFormat;
}
```

Replace with:

```ts
/** File-operation choices (schema 4): what Paste as file saves images as. */
export interface FileSettings {
  paste_image_format: PasteImageFormat;
}

export type OpenWith = "builtin" | "windows";

/** How files open (schema 5, Step 04c): Settings > Opening files. */
export interface OpenSettings {
  /** Files from the internet open in protected view. */
  protected_view: boolean;
  /** Extension (lower case, no dot) to where it opens. An extension that
   * is not listed opens in the built-in viewer when there is one. */
  open_with: Record<string, OpenWith>;
}
```

In `src/services/settings.ts`, find exactly:

```ts
  explorer: ExplorerViewSettings;
  files: FileSettings;
}
```

Replace with:

```ts
  explorer: ExplorerViewSettings;
  files: FileSettings;
  open: OpenSettings;
}
```

In `src/services/settings.ts`, find exactly:

```ts
    files: {
      paste_image_format: "png",
    },
  };
}
```

Replace with:

```ts
    files: {
      paste_image_format: "png",
    },
    open: {
      protected_view: true,
      open_with: {},
    },
  };
}
```

In `src/services/settings.ts`, find exactly:

```ts
/** Pure: every field falls back independently when missing or invalid. */
```

Replace with:

```ts
/** Same rule as Rust `is_valid_extension_key`. */
const EXTENSION_KEY_RE = /^[a-z0-9_+-]{1,16}$/;
/** Same limit as Rust `MAX_OPEN_WITH`. */
export const MAX_OPEN_WITH = 500;

/** Keep only valid `open_with` entries, at most `MAX_OPEN_WITH`. */
function normalizeOpenWith(value: unknown): Record<string, OpenWith> {
  const result: Record<string, OpenWith> = {};
  if (!isRecord(value)) return result;
  let count = 0;
  for (const [ext, choice] of Object.entries(value)) {
    if (count >= MAX_OPEN_WITH) break;
    if (EXTENSION_KEY_RE.test(ext) && (choice === "builtin" || choice === "windows")) {
      result[ext] = choice;
      count += 1;
    }
  }
  return result;
}

/** Pure: every field falls back independently when missing or invalid. */
```

In `src/services/settings.ts`, find exactly:

```ts
  const filesInput = isRecord(input.files) ? input.files : {};
```

Replace with:

```ts
  const filesInput = isRecord(input.files) ? input.files : {};
  const openInput = isRecord(input.open) ? input.open : {};
```

In `src/services/settings.ts`, find exactly:

```ts
    files: {
      paste_image_format: pick(filesInput.paste_image_format, ["png", "jpg"] as const, defaults.files.paste_image_format),
    },
  };
}
```

Replace with:

```ts
    files: {
      paste_image_format: pick(filesInput.paste_image_format, ["png", "jpg"] as const, defaults.files.paste_image_format),
    },
    open: {
      protected_view: flag(openInput.protected_view, defaults.open.protected_view),
      open_with: normalizeOpenWith(openInput.open_with),
    },
  };
}
```

In `src/__tests__/settings.test.ts`, find exactly:

```ts
      explorer: defaultSettings().explorer,
      files: defaultSettings().files,
    });
```

Replace with:

```ts
      explorer: defaultSettings().explorer,
      files: defaultSettings().files,
      open: defaultSettings().open,
    });
```

In `src/__tests__/settings.test.ts`, find exactly:

```ts
    expect(defaultSettings().schema_version).toBe(4);
```

Replace with:

```ts
    expect(defaultSettings().schema_version).toBe(5);
```

In `src/__tests__/settings.test.ts`, find exactly:

```ts
  it("falls back per-field for invalid values", () => {
```

Replace with:

```ts
  it("keeps valid opening-file choices and drops invalid ones", () => {
    expect(defaultSettings().open).toEqual({ protected_view: true, open_with: {} });
    const result = normalizeSettings({
      open: { protected_view: false, open_with: { txt: "windows", md: "builtin", MP4: "windows", "a.b": "windows", png: "paint" } },
    });
    expect(result.open).toEqual({ protected_view: false, open_with: { txt: "windows", md: "builtin" } });
    expect(normalizeSettings({ open: { protected_view: "no", open_with: [] } }).open).toEqual(defaultSettings().open);
    const many: Record<string, string> = {};
    for (let n = 0; n < 600; n += 1) many[`x${n}`] = "windows";
    expect(Object.keys(normalizeSettings({ open: { open_with: many } }).open.open_with)).toHaveLength(500);
  });

  it("falls back per-field for invalid values", () => {
```

In `scripts/measure-ui.ps1`, find exactly:

```powershell
  schema_version = 4; language = $Language
  files = @{ paste_image_format = "png" }
```

Replace with:

```powershell
  schema_version = 5; language = $Language
  files = @{ paste_image_format = "png" }
  open = @{ protected_view = $true; open_with = @{} }
```

**Tests:** `settings_v4_migrates_to_v5_keeping_language_and_theme`, `settings_validate_rejects_bad_open_with` (Rust); "keeps valid opening-file choices and drops invalid ones" (`settings.test.ts`). The existing settings tests now expect schema 5.

**Commit:** `feat(settings): opening-files settings: protected view and default apps (schema 5) [step-04c/T1]`

### T2 - Mark of the Web

**Files:** create `src-tauri/src/zone.rs`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src-tauri/src/files.rs`, `src/services/files.ts`, `src/__tests__/handlers.test.ts`, `src/__tests__/openPipeline.test.ts`; add translation keys.

Create `src-tauri/src/zone.rs`:

```rust
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
```

In `src-tauri/src/main.rs`, find exactly:

```rust
mod shell;
```

Replace with:

```rust
mod shell;
mod zone;
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            links::open_external_url,
```

Replace with:

```rust
            links::open_external_url,
            zone::file_unblock,
```

In `src-tauri/isolation/index.html`, find exactly:

```html
'file_detect', 'file_grant', 'file_revoke', 'open_external_url'
```

Replace with:

```html
'file_detect', 'file_grant', 'file_revoke', 'open_external_url', 'file_unblock'
```

In `src-tauri/src/files.rs`, find exactly:

```rust
    pub online_only: bool,
    pub read_only: bool,
}
```

Replace with:

```rust
    pub online_only: bool,
    pub read_only: bool,
    /// Windows marked the file as downloaded from the internet (Step 04c,
    /// `crate::zone`): file tabs show it in protected view.
    pub from_internet: bool,
}
```

In `src-tauri/src/files.rs`, find exactly:

```rust
        read_only: meta.permissions().readonly(),
    })
```

Replace with:

```rust
        read_only: meta.permissions().readonly(),
        from_internet: crate::zone::is_from_internet(path),
    })
```

In `src/services/files.ts`, find exactly:

```ts
  online_only: boolean;
  read_only: boolean;
}
```

Replace with:

```ts
  online_only: boolean;
  read_only: boolean;
  /** Windows marked the file as downloaded from the internet (Step 04c). */
  from_internet: boolean;
}
```

In `src/services/files.ts`, find exactly:

```ts
export async function fileRevoke(token: string): Promise<void> {
  await invoke("file_revoke", { token });
}
```

Replace with:

```ts
export async function fileRevoke(token: string): Promise<void> {
  await invoke("file_revoke", { token });
}

/** Remove the "downloaded from the internet" mark (Step 04c). Rejects with
 * `files.unblock_denied` or `files.unblock_failed`. */
export async function fileUnblock(path: string): Promise<void> {
  await invoke("file_unblock", { path });
}
```

In `src/__tests__/handlers.test.ts`, find exactly:

```ts
  online_only: false,
  read_only: false,
});
```

Replace with:

```ts
  online_only: false,
  read_only: false,
  from_internet: false,
});
```

In `src/__tests__/openPipeline.test.ts`, find exactly:

```ts
  online_only: false,
  read_only: false,
});
```

Replace with:

```ts
  online_only: false,
  read_only: false,
  from_internet: false,
});
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `errors.files.unblock_denied` | Windows didn't allow removing the mark. The file may be read-only or in use. | Windows no permitió quitar la marca. Es posible que el archivo sea de solo lectura o esté en uso. |
| `errors.files.unblock_failed` | The mark couldn't be removed. | No se pudo quitar la marca. |

**Tests:** `mark_of_the_web_is_read_and_removed`, `only_internet_zones_count`, `zone_stream_never_targets_another_stream`, `unblock_refuses_folders_and_missing_files` (in `zone.rs`). The two UI test helpers get the new `from_internet` field.

**Commit:** `feat(files): recognize files from the internet and unblock them [step-04c/T2]`

### T3 - Protected view bar

**Files:** modify `themes/light.tokens.json`, `themes/dark.tokens.json` (then run `npm run tokens`), `src/handlers/types.ts`, `src/views/FileTabView.tsx`, `src/styles/filetabs.css`, `src/handlers/markdown/MarkdownView.tsx`, `src/App.tsx`; create `help/en/protected-view.md`, `help/es/protected-view.md`; add translation keys.

First the two caution colors (the Windows 11 caution colors):

In `themes/light.tokens.json`, find exactly:

```json
      "image": "#DEF3F4",
      "group": "rgba(127,86,217,0.16)"
    }
  },
```

Replace with:

```json
      "image": "#DEF3F4",
      "group": "rgba(127,86,217,0.16)"
    },
    "status": {
      "_note": "Message bars (Step 04c), from the Windows 11 caution colors.",
      "caution": "#9D5D00",
      "cautionBackground": "#FFF4CE"
    }
  },
```

In `themes/dark.tokens.json`, find exactly:

```json
      "image": "#DEF3F4",
      "group": "rgba(127,86,217,0.16)"
    }
  },
```

Replace with:

```json
      "image": "#DEF3F4",
      "group": "rgba(127,86,217,0.16)"
    },
    "status": {
      "_note": "Message bars (Step 04c), from the Windows 11 caution colors.",
      "caution": "#FCE100",
      "cautionBackground": "#433519"
    }
  },
```

Run `npm run tokens`. Check: `src/styles/tokens.css` now contains `--adp-color-status-caution-background` twice.

Then:

In `src/handlers/types.ts`, find exactly:

```ts
  /** What the search box asks for; views with `supportsFind` follow it. */
  find: FindRequest;
}
```

Replace with:

```ts
  /** What the search box asks for; views with `supportsFind` follow it. */
  find: FindRequest;
  /** The file came from the internet and protected view is on (Step 04c):
   * views keep links off (and, from Step 06a, start without editing). */
  protectedView: boolean;
}
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
import { ArrowUp, FileQuestion, RotateCw } from "lucide-react";
```

Replace with:

```tsx
import { ArrowUp, FileQuestion, RotateCw, ShieldAlert } from "lucide-react";
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
import Button from "../components/Button";
```

Replace with:

```tsx
import Button from "../components/Button";
import Dialog from "../components/Dialog";
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
import { fileDetect, fileGrant, fileRevoke, fileUrl, type FileTypeInfo } from "../services/files";
```

Replace with:

```tsx
import { fileDetect, fileGrant, fileRevoke, fileUnblock, fileUrl, type FileTypeInfo } from "../services/files";
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
  onOpenHelp: (slug: string) => void;
}
```

Replace with:

```tsx
  onOpenHelp: (slug: string) => void;
  /** Settings > Opening files > Protected view (Step 04c). */
  protectedViewEnabled: boolean;
}
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
export default function FileTabView({ tab, active, onShowInFolder, onOpenFolder, onClose, onViewState, onOpenHelp }: FileTabViewProps) {
```

Replace with:

```tsx
export default function FileTabView({ tab, active, onShowInFolder, onOpenFolder, onClose, onViewState, onOpenHelp, protectedViewEnabled }: FileTabViewProps) {
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
  const searchRef = useRef<HTMLDivElement | null>(null);
```

Replace with:

```tsx
  const searchRef = useRef<HTMLDivElement | null>(null);
  const [unblocked, setUnblocked] = useState(false);
  const [askUnblock, setAskUnblock] = useState(false);
  const [unblockError, setUnblockError] = useState<string | null>(null);
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
  const openInWindowsApp = useCallback(() => {
    if (isTauriRuntime()) void openItem(path).catch(() => undefined);
  }, [path]);
```

Replace with:

```tsx
  const openInWindowsApp = useCallback(() => {
    if (isTauriRuntime()) void openItem(path).catch(() => undefined);
  }, [path]);

  // Protected view (Step 04c): a file from the internet shows a yellow bar;
  // Unblock removes the mark after the user confirms.
  const protectedView = phase.kind === "ready" && phase.info.from_internet && protectedViewEnabled && !unblocked;
  const unblock = useCallback(() => {
    void fileUnblock(path)
      .then(() => {
        setUnblocked(true);
        setAskUnblock(false);
        setUnblockError(null);
      })
      .catch((error: unknown) => setUnblockError(errorText(t, error, "files")));
  }, [path, t]);
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
        <HelpButton onOpenHelp={() => onOpenHelp(handler?.helpSlug ?? "opening-files")} />
      </div>
      <div className="adp-filetab-body">
```

Replace with:

```tsx
        <HelpButton onOpenHelp={() => onOpenHelp(handler?.helpSlug ?? "opening-files")} />
      </div>
      {protectedView ? (
        <div className="adp-protected-bar" role="status">
          <ShieldAlert size={16} aria-hidden="true" className="adp-protected-icon" />
          <span className="adp-protected-text">{t("protected.message")}</span>
          <Button onClick={() => setAskUnblock(true)}>{t("protected.unblock")}</Button>
          <HelpButton onOpenHelp={() => onOpenHelp("protected-view")} />
        </div>
      ) : null}
      <div className="adp-filetab-body">
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
              find={find}
            />
```

Replace with:

```tsx
              find={find}
              protectedView={protectedView}
            />
```

In `src/views/FileTabView.tsx`, find exactly:

```tsx
      <footer className="adp-statusbar adp-filetab-status">
```

Replace with:

```tsx
      {askUnblock ? (
        <Dialog title={t("protected.unblockTitle")} onClose={() => setAskUnblock(false)}>
          <p className="adp-dialog-text">{t("protected.unblockBody", { name: tab.title ?? "" })}</p>
          {unblockError ? (
            <p className="adp-dialog-text adp-protected-error" role="alert">
              {unblockError}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={unblock}>
              {t("protected.unblock")}
            </Button>
            <Button onClick={() => setAskUnblock(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
      <footer className="adp-statusbar adp-filetab-status">
```

In `src/styles/filetabs.css`, find exactly:

```css
.adp-filetab-search .adp-search-input { flex: 1; min-width: 0; border: none; background: transparent; }
```

Replace with:

```css
.adp-filetab-search .adp-search-input { flex: 1; min-width: 0; border: none; background: transparent; }
/* Protected view bar (Step 04c). */
.adp-protected-bar { flex: none; display: flex; align-items: center; gap: var(--adp-space-4); min-height: 40px; padding: var(--adp-space-2) var(--adp-space-7); background: var(--adp-color-status-caution-background); border-bottom: 1px solid var(--adp-color-border-subtle); color: var(--adp-color-text-primary); font-size: var(--adp-font-body); }
.adp-protected-icon { flex: none; color: var(--adp-color-status-caution); }
.adp-protected-text { flex: 1; min-width: 0; }
.adp-protected-error { color: var(--adp-color-status-caution); }
```

In `src/handlers/markdown/MarkdownView.tsx`, find exactly:

```tsx
export default function MarkdownView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp, find }: HandlerViewProps) {
```

Replace with:

```tsx
export default function MarkdownView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp, find, protectedView }: HandlerViewProps) {
```

In `src/handlers/markdown/MarkdownView.tsx`, find exactly:

```tsx
  /** Reading position (0 to 1), kept when the page is rebuilt (zoom, theme). */
  const scrollRatio = useRef(0);
```

Replace with:

```tsx
  /** Reading position (0 to 1), kept when the page is rebuilt (zoom, theme). */
  const scrollRatio = useRef(0);
  /** Protected view (Step 04c): links do nothing. */
  const protectedRef = useRef(protectedView);
  protectedRef.current = protectedView;
```

In `src/handlers/markdown/MarkdownView.tsx`, find exactly:

```tsx
      if (isExternalUrl(href)) setPendingLink(href);
```

Replace with:

```tsx
      if (isExternalUrl(href) && !protectedRef.current) setPendingLink(href);
```

In `src/App.tsx`, find exactly:

```tsx
              onOpenHelp={(slug) => openTab("help", slug)}
            />
          ))}
```

Replace with:

```tsx
              onOpenHelp={(slug) => openTab("help", slug)}
              protectedViewEnabled={settings.open.protected_view}
            />
          ))}
```

Create `help/en/protected-view.md`:

```markdown
# Protected view

Files you download from the internet or save from an email can be harmful. Windows marks them, and Adperastra opens marked files in **protected view**: a yellow bar at the top of the tab says the file came from the internet.

## What protected view does

- The file is shown, but links in it do nothing (for example in Markdown files).
- Nothing in a file ever runs, and nothing is loaded from the internet, with or without protected view.

## Trusting a file

- If you trust where the file came from, click **Unblock** on the yellow bar, then **Unblock** again to confirm. Windows removes the mark, like the **Unblock** box in the file's Properties. The bar disappears and links work.
- Unblock only files from people and websites you trust.

## Good to know

- Unblocking removes only the mark; the file's content does not change.
- To stop using protected view for all files, go to **Settings** > **Opening files** and turn off **Protected view**. We recommend leaving it on.

See also: "Opening files in tabs" and "Choosing how files open".
```

Create `help/es/protected-view.md`:

```markdown
# Vista protegida

Los archivos que descargas de Internet o guardas desde un correo pueden ser dañinos. Windows los marca, y Adperastra abre los archivos marcados en **vista protegida**: una barra amarilla en la parte superior de la pestaña indica que el archivo proviene de Internet.

## Qué hace la vista protegida

- El archivo se muestra, pero sus vínculos no hacen nada (por ejemplo, en los archivos Markdown).
- Nada de un archivo se ejecuta nunca, y nada se carga desde Internet, con o sin vista protegida.

## Confiar en un archivo

- Si confías en el origen del archivo, haz clic en **Desbloquear** en la barra amarilla y luego otra vez en **Desbloquear** para confirmar. Windows quita la marca, como la casilla **Desbloquear** de las Propiedades del archivo. La barra desaparece y los vínculos funcionan.
- Desbloquea solo archivos de personas y sitios web en los que confíes.

## Bueno saberlo

- Desbloquear solo quita la marca; el contenido del archivo no cambia.
- Para dejar de usar la vista protegida con todos los archivos, ve a **Configuración** > **Abrir archivos** y desactiva **Vista protegida**. Te recomendamos dejarla activada.

Consulta también: «Abrir archivos en pestañas» y «Elegir cómo se abren los archivos».
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `protected.message` | This file came from the internet, so it opened in protected view. | Este archivo proviene de Internet, así que se abrió en vista protegida. |
| `protected.unblock` | Unblock | Desbloquear |
| `protected.unblockTitle` | Unblock this file? | ¿Desbloquear este archivo? |
| `protected.unblockBody` | Only unblock files from people and websites you trust. Windows will stop treating “{name}” as a file from the internet. | Desbloquea solo archivos de personas y sitios web en los que confíes. Windows dejará de tratar «{name}» como un archivo de Internet. |

**Tests:** no new tests (the bar needs Windows' mark; it is in "Check by hand"). Existing tests must pass.

**Commit:** `feat(tabs): protected view bar for files from the internet [step-04c/T3]`

### T4 - Subtitle files next to a video

**Files:** create `src-tauri/src/media.rs`, `src/services/media.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`, `src-tauri/src/files.rs`.

Create `src-tauri/src/media.rs`:

```rust
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
```

Create `src/services/media.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

/** Subtitle files (.srt, .vtt) next to a video, as full paths (Step 04c). */
export async function mediaSidecars(path: string): Promise<string[]> {
  return (await invoke("media_sidecars", { path })) as string[];
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
mod links;
```

Replace with:

```rust
mod links;
mod media;
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            zone::file_unblock,
```

Replace with:

```rust
            zone::file_unblock,
            media::media_sidecars,
```

In `src-tauri/isolation/index.html`, find exactly:

```html
'open_external_url', 'file_unblock'
```

Replace with:

```html
'open_external_url', 'file_unblock', 'media_sidecars'
```

In `src-tauri/src/files.rs`, find exactly:

```rust
        "webm" => "video/webm",
```

Replace with:

```rust
        "webm" => "video/webm",
        "weba" => "audio/webm",
```

**Tests:** `finds_subtitles_named_after_the_video`, `lists_at_most_twenty`, `reads_the_video_folder` (in `media.rs`).

**Commit:** `feat(media): list subtitle files next to a video [step-04c/T4]`

### T5 - The audio and video player

**Files:** create everything under `src/handlers/media/`, `src/styles/media.css`, `src/__tests__/mediaHelpers.test.ts`, `src/__tests__/mediaView.test.tsx`, `help/en/playing-audio-and-video.md`, `help/es/playing-audio-and-video.md`; modify `src/main.tsx`, `src/handlers/index.ts`, `src/ribbon/Ribbon.tsx`, `src/__tests__/openPipeline.test.ts`; add translation keys.

Create `src/handlers/media/helpers.ts`:

```ts
/** Audio and video helpers (Step 04c). Pure, unit-tested. */

/** Video types the built-in player plays (WebView2 decodes them). */
export const VIDEO_EXTENSIONS: readonly string[] = ["mp4", "m4v", "webm"];
/** Audio types the built-in player plays. */
export const AUDIO_EXTENSIONS: readonly string[] = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"];
/** Playback speeds offered on the ribbon. */
export const SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** True when the file should show a picture (a video), false for sound only. */
export function isVideo(info: { mime: string; ext: string }): boolean {
  if (AUDIO_EXTENSIONS.includes(info.ext)) return false;
  return info.mime.startsWith("video/") || VIDEO_EXTENSIONS.includes(info.ext);
}

/** "0:07", "3:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** SubRip (.srt) to WebVTT, the subtitle format browsers read: a header,
 * and "." instead of "," in times (00:00:01,500 becomes 00:00:01.500). */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{1,2}):(\d{2}):(\d{2}),(\d{3})/g, (_match, h: string, m: string, s: string, ms: string) => `${h.padStart(2, "0")}:${m}:${s}.${ms}`);
  return `WEBVTT\n\n${body.trim()}\n`;
}

/** A subtitle file's text as WebVTT (`.srt` files are converted). */
export function toVtt(fileName: string, text: string): string {
  if (fileName.toLowerCase().endsWith(".vtt")) return text.replace(/^﻿/, "");
  return srtToVtt(text);
}

/** How a subtitle file is listed: without the video's name when a
 * language part follows it ("Holidays.en.srt" is shown as "en.srt" for
 * "Holidays.mp4"); otherwise the whole file name. */
export function subtitleLabel(videoName: string, subtitleName: string): string {
  const dot = videoName.lastIndexOf(".");
  const stem = dot > 0 ? videoName.slice(0, dot) : videoName;
  const prefix = `${stem}.`;
  if (!subtitleName.toLowerCase().startsWith(prefix.toLowerCase())) return subtitleName;
  const rest = subtitleName.slice(prefix.length);
  return rest.includes(".") ? rest : subtitleName;
}
```

Create `src/handlers/media/index.ts`:

```ts
import { Film } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "./helpers";

/** Audio and video the built-in player plays (Step 04c). Other formats
 * (MKV, AVI, WMV, MOV...) open in their Windows app. Any size: the player
 * reads only the parts it needs. */
export const mediaHandler: Handler = {
  id: "media",
  version: 1,
  labelKey: "handlers.media",
  icon: Film,
  accent: "explorer",
  extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS],
  mimeTypes: [
    "video/mp4",
    "video/x-m4v",
    "video/webm",
    "audio/mpeg",
    "audio/m4a",
    "audio/mp4",
    "audio/aac",
    "audio/x-wav",
    "audio/wav",
    "audio/ogg",
    "audio/opus",
    "audio/x-flac",
    "audio/flac",
    "audio/webm",
  ],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "playing-audio-and-video",
  speedTier: "fast",
  supportsFind: false,
  view: lazy(() => import("./MediaView")),
};
```

Create `src/handlers/media/MediaView.tsx`:

```tsx
import { Music, Pause, Play, Repeat } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { fileGrant, fileRevoke, fileUrl } from "../../services/files";
import { formatSize } from "../../services/format";
import { mediaSidecars } from "../../services/media";
import { isTauriRuntime } from "../../services/settings";
import Ribbon from "../../ribbon/Ribbon";
import type { RibbonDef, RibbonGroup } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { decodeText, detectEncoding } from "../text/encoding";
import type { HandlerViewProps } from "../types";
import { formatDuration, isVideo, SPEEDS, subtitleLabel, toVtt } from "./helpers";

/** Largest subtitle file read. */
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const HELP = "playing-audio-and-video";

interface SavedMediaState {
  speed: number;
  loop: boolean;
}

interface MediaCtx {
  ready: boolean;
  playing: boolean;
  loop: boolean;
}

function readSaved(state: unknown): SavedMediaState {
  const value = (state ?? {}) as Partial<SavedMediaState>;
  return {
    speed: typeof value.speed === "number" && SPEEDS.includes(value.speed) ? value.speed : 1,
    loop: value.loop === true,
  };
}

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Read a subtitle file through a file token; returns a WebVTT Blob URL
 * (the caller revokes it). */
async function loadSubtitle(path: string): Promise<string> {
  const token = await fileGrant(path);
  try {
    const response = await fetch(fileUrl(token, nameOf(path)), { headers: { Range: `bytes=0-${MAX_SUBTITLE_BYTES - 1}` } });
    if (!response.ok) throw new Error("files.read_failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = decodeText(bytes, detectEncoding(bytes.subarray(0, 65536)).encoding);
    return URL.createObjectURL(new Blob([toVtt(nameOf(path), text)], { type: "text/vtt" }));
  } finally {
    void fileRevoke(token).catch(() => undefined);
  }
}

/** Audio and video player (Step 04c): the webview's own player and its
 * controls, plus a ribbon for play, loop, speed and subtitles. It keeps
 * playing while another tab is shown. */
export default function MediaView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const video = isVideo(info);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [settings, setSettings] = useState<SavedMediaState>(() => readSaved(savedState));
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noPicture, setNoPicture] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [sidecars, setSidecars] = useState<string[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [subtitleFailed, setSubtitleFailed] = useState(false);

  const update = useCallback(
    (patch: Partial<SavedMediaState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  // Speed and Loop follow the ribbon and the saved state.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = settings.speed;
    media.loop = settings.loop;
  }, [settings.speed, settings.loop, ready]);

  // The player gets the keyboard when it is first ready (Space plays).
  const focused = useRef(false);
  useEffect(() => {
    if (!ready || !active || focused.current) return;
    focused.current = true;
    mediaRef.current?.focus({ preventScroll: true });
  }, [ready, active]);

  // Subtitle files next to a video.
  useEffect(() => {
    if (!video || !isTauriRuntime()) return;
    let cancelled = false;
    mediaSidecars(info.path)
      .then((paths) => {
        if (!cancelled) setSidecars(paths);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [video, info.path]);

  // Load the chosen subtitle file.
  useEffect(() => {
    if (!subtitle) {
      setTrackUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setSubtitleFailed(false);
    loadSubtitle(subtitle)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        created = blobUrl;
        setTrackUrl(blobUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setSubtitleFailed(true);
        setSubtitle("");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [subtitle]);

  // A track added after the video loaded is not shown by itself.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    for (const track of Array.from(media.textTracks)) track.mode = trackUrl ? "showing" : "disabled";
  }, [trackUrl]);

  // Status bar: length, kind, size.
  useEffect(() => {
    const items: string[] = [];
    if (duration !== null && Number.isFinite(duration)) items.push(formatDuration(duration));
    items.push(t(video ? "media.video" : "media.audio"));
    if (subtitleFailed) items.push(t("media.subtitlesFailed"));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [duration, video, subtitleFailed, info.size, i18n.language, onStatus, t]);

  const ctx: MediaCtx = { ready, playing, loop: settings.loop };
  const commands = useMemo<Command<MediaCtx>[]>(
    () => [
      {
        id: "media.play",
        labelKey: "media.play",
        icon: Play,
        risk: "read-only",
        helpSlug: HELP,
        visibleWhen: (c) => !c.playing,
        enabledWhen: (c) => c.ready,
        run: () => {
          void mediaRef.current?.play().catch(() => undefined);
        },
      },
      {
        id: "media.pause",
        labelKey: "media.pause",
        icon: Pause,
        risk: "read-only",
        helpSlug: HELP,
        visibleWhen: (c) => c.playing,
        enabledWhen: (c) => c.ready,
        run: () => mediaRef.current?.pause(),
      },
      {
        id: "media.loop",
        labelKey: "media.loop",
        icon: Repeat,
        risk: "read-only",
        helpSlug: HELP,
        checkKind: "toggle",
        checkedWhen: (c) => c.loop,
        enabledWhen: () => true,
        run: (c) => update({ loop: !c.loop }),
      },
    ],
    [update],
  );

  const groups: RibbonGroup[] = [
    {
      id: "playback",
      labelKey: "ribbon.playback",
      controls: [
        { type: "button", command: "media.play", keyTip: "P" },
        { type: "button", command: "media.pause", keyTip: "P" },
        { type: "toggle", command: "media.loop", keyTip: "L" },
      ],
    },
    {
      id: "speed",
      labelKey: "media.speed",
      controls: [
        {
          type: "custom",
          id: "speed",
          render: () => (
            <label className="adp-ribbon-custom">
              {t("media.speed")}
              <select value={String(settings.speed)} onChange={(event) => update({ speed: Number(event.target.value) })}>
                {SPEEDS.map((speed) => (
                  <option key={speed} value={String(speed)}>
                    {t("media.speedValue", { speed })}
                  </option>
                ))}
              </select>
            </label>
          ),
        },
      ],
    },
  ];
  if (video) {
    groups.push({
      id: "subtitles",
      labelKey: "media.subtitles",
      controls: [
        {
          type: "custom",
          id: "subtitles",
          render: () => (
            <label className="adp-ribbon-custom">
              {t("media.subtitles")}
              <select value={subtitle} disabled={sidecars.length === 0} onChange={(event) => setSubtitle(event.target.value)}>
                <option value="">{sidecars.length === 0 ? t("media.noSubtitles") : t("media.subtitlesOff")}</option>
                {sidecars.map((path) => (
                  <option key={path} value={path}>
                    {subtitleLabel(info.name, nameOf(path))}
                  </option>
                ))}
              </select>
            </label>
          ),
        },
      ],
    });
  }
  const ribbon: RibbonDef = { tabs: [{ id: "play", labelKey: "ribbon.play", keyTip: "P", groups }] };

  const events = {
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget;
      setReady(true);
      setDuration(media.duration);
      if (media instanceof HTMLVideoElement && media.videoWidth === 0) setNoPicture(true);
    },
    onError: () => setFailed(true),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("media.cantPlay")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : (
        <div className="adp-media">
          {noPicture ? (
            <div className="adp-media-notice" role="status">
              <span>{t("media.noPicture")}</span>
              <Button onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
            </div>
          ) : null}
          {video ? (
            <video
              ref={(element) => {
                mediaRef.current = element;
              }}
              className="adp-media-video"
              src={url}
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              preload="metadata"
              {...events}
            >
              {trackUrl ? <track key={trackUrl} kind="subtitles" src={trackUrl} /> : null}
            </video>
          ) : (
            <div className="adp-media-audio">
              <Music size={64} aria-hidden="true" className="adp-media-icon" />
              <p className="adp-media-title">{info.name}</p>
              <audio
                ref={(element) => {
                  mediaRef.current = element;
                }}
                src={url}
                controls
                controlsList="nodownload noremoteplayback"
                preload="metadata"
                {...events}
              />
            </div>
          )}
        </div>
      )}
    </ViewerFrame>
  );
}
```

Create `src/styles/media.css`:

```css
/* Audio and video player (Step 04c). Colors only through tokens. */
.adp-media { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--adp-space-5); padding: var(--adp-space-7); }
.adp-media-video { flex: 1; min-height: 0; width: 100%; object-fit: contain; }
.adp-media-video:focus-visible, .adp-media-audio audio:focus-visible { outline: 2px solid var(--adp-accent-explorer); outline-offset: 2px; }
.adp-media-audio { display: flex; flex-direction: column; align-items: center; gap: var(--adp-space-5); width: min(560px, 100%); }
.adp-media-audio audio { width: 100%; }
.adp-media-icon { color: var(--adp-color-text-tertiary); }
.adp-media-title { margin: 0; font-size: var(--adp-font-command); color: var(--adp-color-text-primary); text-align: center; word-break: break-all; }
.adp-media-notice { flex: none; display: flex; align-items: center; gap: var(--adp-space-4); padding: var(--adp-space-3) var(--adp-space-5); border-radius: var(--adp-radius-md); background: var(--adp-color-status-caution-background); color: var(--adp-color-text-primary); font-size: var(--adp-font-body); }
```

Create `src/__tests__/mediaHelpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDuration, isVideo, srtToVtt, subtitleLabel, toVtt } from "../handlers/media/helpers";

describe("media helpers", () => {
  it("tells video from audio", () => {
    expect(isVideo({ mime: "video/mp4", ext: "mp4" })).toBe(true);
    expect(isVideo({ mime: "application/octet-stream", ext: "webm" })).toBe(true);
    expect(isVideo({ mime: "video/webm", ext: "weba" })).toBe(false);
    expect(isVideo({ mime: "audio/mpeg", ext: "mp3" })).toBe(false);
    expect(isVideo({ mime: "audio/mpeg", ext: "dat" })).toBe(false);
  });

  it("formats lengths", () => {
    expect(formatDuration(7.9)).toBe("0:07");
    expect(formatDuration(185)).toBe("3:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(-1)).toBe("0:00");
  });

  it("turns SubRip into WebVTT", () => {
    const srt = "﻿1\r\n0:00:01,500 --> 00:00:04,000\r\nHello\r\n\r\n2\r\n00:01:02,000 --> 00:01:03,250\r\n<i>World</i>\r\n";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n1\n00:00:01.500 --> 00:00:04.000\nHello\n\n2\n00:01:02.000 --> 00:01:03.250\n<i>World</i>\n");
    expect(toVtt("a.VTT", "﻿WEBVTT\n\nx")).toBe("WEBVTT\n\nx");
    expect(toVtt("a.srt", "1\n00:00:00,000 --> 00:00:01,000\nHi")).toContain("00:00:00.000");
  });

  it("lists subtitle files by what follows the video's name", () => {
    expect(subtitleLabel("Holidays.mp4", "Holidays.en.srt")).toBe("en.srt");
    expect(subtitleLabel("Holidays.mp4", "holidays.srt")).toBe("holidays.srt");
    expect(subtitleLabel("Holidays.mp4", "Other.srt")).toBe("Other.srt");
  });
});
```

Create `help/en/playing-audio-and-video.md`:

```markdown
# Playing audio and video

Music and videos open in a tab with a player: MP4, WebM, MP3, M4A, AAC, WAV, OGG, Opus and FLAC files.

## Playing

- Use the player's own controls: play and pause, the position bar, the volume and full screen. When the player is selected, **Space** plays and pauses.
- On the ribbon, **Play** and **Pause** do the same. **Loop** starts the file again when it ends.
- **Speed** plays slower or faster, from 0.5× to 2×.

## Subtitles

A subtitle file (.srt or .vtt) is listed when it is in the same folder as the video and its name starts with the video's name, for example `Holidays.srt` or `Holidays.en.srt` for `Holidays.mp4`. Choose it in **Subtitles** on the ribbon; choose **Off** to hide it.

## When a file doesn't play

MKV, AVI, WMV, MOV and other formats open in their Windows app. If a file can't be played here, the tab says so: click **Open in Windows app**.

## Good to know

- The player keeps playing while you look at another tab.
- The tab remembers the speed and **Loop**.

See also: "Opening files in tabs" and "The ribbon".
```

Create `help/es/playing-audio-and-video.md`:

```markdown
# Reproducir audio y video

La música y los videos se abren en una pestaña con un reproductor: archivos MP4, WebM, MP3, M4A, AAC, WAV, OGG, Opus y FLAC.

## Reproducir

- Usa los controles del propio reproductor: reproducir y pausar, la barra de posición, el volumen y la pantalla completa. Cuando el reproductor está seleccionado, **Espacio** reproduce y pausa.
- En la cinta de opciones, **Reproducir** y **Pausar** hacen lo mismo. **Repetir** vuelve a empezar el archivo cuando termina.
- **Velocidad** reproduce más lento o más rápido, de 0,5× a 2×.

## Subtítulos

Un archivo de subtítulos (.srt o .vtt) aparece en la lista cuando está en la misma carpeta que el video y su nombre empieza con el nombre del video, por ejemplo `Vacaciones.srt` o `Vacaciones.es.srt` para `Vacaciones.mp4`. Elígelo en **Subtítulos** en la cinta de opciones; elige **Desactivados** para ocultarlo.

## Cuando un archivo no se reproduce

Los formatos MKV, AVI, WMV, MOV y otros se abren en su aplicación de Windows. Si un archivo no se puede reproducir aquí, la pestaña lo indica: haz clic en **Abrir en la aplicación de Windows**.

## Bueno saberlo

- El reproductor sigue reproduciendo mientras miras otra pestaña.
- La pestaña recuerda la velocidad y **Repetir**.

Consulta también: «Abrir archivos en pestañas» y «La cinta de opciones».
```

Create `src/__tests__/mediaView.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import MediaView from "../handlers/media/MediaView";
import type { FileTypeInfo } from "../services/files";

const info = (name: string, mime: string): FileTypeInfo => ({
  path: `C:\\media\\${name}`,
  name,
  ext: name.split(".").pop() ?? "",
  mime,
  size: 1000,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function render(file: FileTypeInfo) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onStatus = vi.fn();
  await act(async () =>
    root?.render(
      <MediaView
        info={file}
        url="http://adpfile.localhost/0123456789abcdef0123456789abcdef/x"
        active={true}
        savedState={{ speed: 1.5, loop: true }}
        onStateChange={() => undefined}
        onStatus={onStatus}
        onOpenInWindowsApp={() => undefined}
        find={{ text: "", request: 0, backwards: false }}
        protectedView={false}
      />,
    ),
  );
  return onStatus;
}

describe("media player", () => {
  it("shows a video with the ribbon, the saved speed and an empty subtitles list", async () => {
    await render(info("clip.mp4", "video/mp4"));
    expect(container?.querySelector("video")).not.toBeNull();
    const selects = container?.querySelectorAll("select") ?? [];
    expect(selects).toHaveLength(2);
    expect((selects[0] as HTMLSelectElement).value).toBe("1.5");
    expect((selects[1] as HTMLSelectElement).disabled).toBe(true);
    // Loop is on (saved state); Play is shown, Pause is hidden.
    expect(container?.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(container?.querySelectorAll(".adp-ribbon-btn")).toHaveLength(2);
  });

  it("shows audio with its name and no subtitles list", async () => {
    const onStatus = await render(info("song.mp3", "audio/mpeg"));
    expect(container?.querySelector("audio")).not.toBeNull();
    expect(container?.textContent).toContain("song.mp3");
    expect(container?.querySelectorAll("select")).toHaveLength(1);
    expect(onStatus).toHaveBeenCalled();
  });

  it("offers the Windows app when the format can't be played", async () => {
    await render(info("clip.webm", "video/webm"));
    await act(async () => {
      container?.querySelector("video")?.dispatchEvent(new Event("error"));
    });
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container?.querySelector("video")).toBeNull();
  });
});
```

In `src/main.tsx`, find exactly:

```tsx
import "./styles/viewers.css";
```

Replace with:

```tsx
import "./styles/viewers.css";
import "./styles/media.css";
```

In `src/handlers/index.ts`, find exactly:

```ts
import { markdownHandler } from "./markdown";
```

Replace with:

```ts
import { markdownHandler } from "./markdown";
import { mediaHandler } from "./media";
```

In `src/handlers/index.ts`, find exactly:

```ts
  registry.register(imageHandler);
```

Replace with:

```ts
  registry.register(imageHandler);
  registry.register(mediaHandler);
```

In `src/ribbon/Ribbon.tsx`, find exactly:

```tsx
          const command = current.byId.get(control.command);
          if (!command) continue;
```

Replace with:

```tsx
          const command = current.byId.get(control.command);
          // A hidden control (Pause while stopped) shares its letter.
          if (!command || !isCommandVisible(command, current.ctx)) continue;
```

In `src/__tests__/openPipeline.test.ts`, find exactly:

```ts
  it("always opens programs, shortcuts and web pages in Windows", () => {
```

Replace with:

```ts
  it("plays audio and video in the app, other video types in Windows (Step 04c)", () => {
    expect(decideOpen(info("clip.mp4", "video/mp4"), registry)).toMatchObject({ kind: "tab", handler: { id: "media" } });
    expect(decideOpen(info("song.mp3", "audio/mpeg"), registry)).toMatchObject({ kind: "tab", handler: { id: "media" } });
    expect(decideOpen(info("voice.wav", "audio/x-wav"), registry)).toMatchObject({ kind: "tab", handler: { id: "media" } });
    expect(decideOpen(info("film.mkv", "video/x-matroska"), registry).kind).toBe("windows");
    expect(decideOpen(info("old.avi", "video/x-msvideo"), registry).kind).toBe("windows");
  });

  it("always opens programs, shortcuts and web pages in Windows", () => {
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `handlers.media` | Audio and video | Audio y video |
| `ribbon.play` | Play | Reproducir |
| `ribbon.playback` | Playback | Reproducción |
| `media.play` | Play | Reproducir |
| `media.pause` | Pause | Pausar |
| `media.loop` | Loop | Repetir |
| `media.speed` | Speed | Velocidad |
| `media.speedValue` | {speed, number}× | {speed, number}× |
| `media.subtitles` | Subtitles | Subtítulos |
| `media.subtitlesOff` | Off | Desactivados |
| `media.noSubtitles` | None found | No se encontraron |
| `media.subtitlesFailed` | The subtitle file couldn't be read. | No se pudo leer el archivo de subtítulos. |
| `media.video` | Video | Video |
| `media.audio` | Audio | Audio |
| `media.cantPlay` | This file can't be played here: the built-in player doesn't support its format. | Este archivo no se puede reproducir aquí: el reproductor integrado no admite su formato. |
| `media.noPicture` | There is no picture to show. If this video should have one, its format isn't supported here. | No hay imagen para mostrar. Si este video debería tener una, su formato no se admite aquí. |

**Tests:** `mediaHelpers.test.ts` (tells video from audio; formats lengths; turns SubRip into WebVTT; lists subtitle files by what follows the video's name), `mediaView.test.tsx` (shows a video with the ribbon, the saved speed and an empty subtitles list; shows audio with its name and no subtitles list; offers the Windows app when the format can't be played), and the new case in `openPipeline.test.ts`.

**Commit:** `feat(viewer): audio and video player with speed, loop and subtitles [step-04c/T5]`

### T6 - The hex viewer

**Files:** create everything under `src/handlers/hex/`, `src/styles/hex.css`, `src/__tests__/hexFormat.test.ts`, `src/__tests__/hexView.test.tsx`; modify `src/main.tsx`, `src/handlers/index.ts`, `src/ribbon/Ribbon.tsx`, `src/__tests__/ribbon.test.tsx`, `src/services/shortcuts.ts`, `src/__tests__/shortcuts.test.ts`; add translation keys.

Create `src/handlers/hex/format.ts`:

```ts
/** Hex viewer helpers (Step 04c). Pure, unit-tested. */

export const BYTES_PER_ROW = 16;
/** Bytes shown at a time ("part"), like the text viewer's large files. */
export const HEX_PART_BYTES = 1024 * 1024;

/** Number of parts of a file (at least 1, also for an empty file). */
export function hexPartCount(size: number): number {
  return Math.max(1, Math.ceil(size / HEX_PART_BYTES));
}

/** Hex digits of the offset column: 8, or 12 for files over 4 GB. */
export function offsetDigits(size: number): number {
  return size > 0xffffffff ? 12 : 8;
}

export interface HexRow {
  offset: string;
  hex: string;
  text: string;
}

/** One row: the offset in the file, up to 16 bytes in hex (a wider gap
 * after the 8th), and the same bytes as text (printable ASCII, "." for
 * anything else). `start` is the row's first index in `bytes`; `offset`
 * is that byte's position in the whole file. */
export function formatHexRow(bytes: Uint8Array, start: number, offset: number, digits: number): HexRow {
  const pairs: string[] = [];
  let text = "";
  for (let i = start; i < Math.min(bytes.length, start + BYTES_PER_ROW); i += 1) {
    const byte = bytes[i];
    pairs.push(byte.toString(16).toUpperCase().padStart(2, "0"));
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".";
  }
  const hex = pairs.length > 8 ? `${pairs.slice(0, 8).join(" ")}  ${pairs.slice(8).join(" ")}` : pairs.join(" ");
  return { offset: offset.toString(16).toUpperCase().padStart(digits, "0"), hex, text };
}
```

Create `src/handlers/hex/index.ts`:

```ts
import { Binary } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Hex viewer (Step 04c): the bytes of any file. It has no extensions and
 * no content types, so it is never chosen by itself; only "Open as hex"
 * uses it (plan/rules.md R-OPEN-2). */
export const hexHandler: Handler = {
  id: "hex",
  version: 1,
  labelKey: "handlers.hex",
  icon: Binary,
  accent: "explorer",
  extensions: [],
  mimeTypes: [],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "open-as-text-or-hex",
  speedTier: "fast",
  supportsFind: false,
  view: lazy(() => import("./HexView")),
};
```

Create `src/handlers/hex/HexView.tsx`:

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { BYTES_PER_ROW, formatHexRow, HEX_PART_BYTES, hexPartCount, offsetDigits } from "./format";

const ROW_HEIGHT = 20;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3;
const HELP = "open-as-text-or-hex";

interface SavedHexState {
  zoom: number;
}

interface HexCtx {
  zoom: number;
  part: number;
  parts: number;
}

function readSaved(state: unknown): SavedHexState {
  const value = (state ?? {}) as Partial<SavedHexState>;
  return { zoom: typeof value.zoom === "number" ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value.zoom)) : 1 };
}

/** Hex viewer (Step 04c): offset, 16 bytes in hex and as text per row,
 * read-only. Files over 1 MB show in parts of 1 MB, like big text files. */
export default function HexView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<SavedHexState>(() => readSaved(savedState));
  const [part, setPart] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState(false);
  const parts = hexPartCount(info.size);
  const digits = offsetDigits(info.size);
  const partStart = part * HEX_PART_BYTES;
  const rowHeight = Math.round(ROW_HEIGHT * settings.zoom);

  const update = useCallback(
    (patch: Partial<SavedHexState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  // Read the current part with one Range request.
  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    if (info.size === 0) {
      setBytes(new Uint8Array(0));
      return;
    }
    const end = Math.min(info.size, partStart + HEX_PART_BYTES) - 1;
    fetch(url, { headers: { Range: `bytes=${partStart}-${end}` } })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("files.read_failed"))))
      .then((buffer) => {
        if (!cancelled) setBytes(new Uint8Array(buffer));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, partStart, info.size]);

  const rowCount = bytes ? Math.ceil(bytes.length / BYTES_PER_ROW) : 0;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 24,
  });
  useEffect(() => {
    virtualizer.measure();
    // Row height changes with the zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [part]);

  // The rows get the keyboard (arrows, Page Up, Page Down) when shown.
  useEffect(() => {
    if (active && bytes) scrollRef.current?.focus({ preventScroll: true });
  }, [active, bytes]);

  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (parts > 1) items.unshift(t("text.part", { part: part + 1, parts }));
    onStatus({ items });
  }, [info.size, i18n.language, part, parts, onStatus, t]);

  const ctx: HexCtx = { zoom: settings.zoom, part, parts };
  const zoomTo = useCallback((zoom: number) => update({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10)) }), [update]);
  const commands = useMemo<Command<HexCtx>[]>(
    () => [
      { id: "hex.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom < ZOOM_MAX, run: (c) => zoomTo(c.zoom * 1.1) },
      { id: "hex.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom > ZOOM_MIN, run: (c) => zoomTo(c.zoom / 1.1) },
      { id: "hex.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom !== 1, run: () => zoomTo(1) },
      { id: "hex.previousPart", labelKey: "text.previousPart", icon: ChevronLeft, shortcut: "Alt+PageUp", risk: "read-only", helpSlug: HELP, visibleWhen: (c) => c.parts > 1, enabledWhen: (c) => c.part > 0, run: () => setPart((value) => Math.max(0, value - 1)) },
      { id: "hex.nextPart", labelKey: "text.nextPart", icon: ChevronRight, shortcut: "Alt+PageDown", risk: "read-only", helpSlug: HELP, visibleWhen: (c) => c.parts > 1, enabledWhen: (c) => c.part < c.parts - 1, run: (c) => setPart(Math.min(c.parts - 1, c.part + 1)) },
    ],
    [zoomTo],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "zoom",
            labelKey: "ribbon.zoom",
            controls: [
              { type: "button", command: "hex.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "hex.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "hex.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
          {
            id: "parts",
            labelKey: "text.parts",
            controls: [
              { type: "button", command: "hex.previousPart", keyTip: "P" },
              { type: "button", command: "hex.nextPart", keyTip: "X" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("hex.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="adp-hex"
          tabIndex={0}
          role="region"
          aria-label={t("hex.label", { name: info.name })}
          style={{ ["--adp-hex-zoom" as string]: String(settings.zoom) }}
        >
          <div className="adp-hex-rows" style={{ height: virtualizer.getTotalSize() }}>
            {bytes
              ? virtualizer.getVirtualItems().map((item) => {
                  const row = formatHexRow(bytes, item.index * BYTES_PER_ROW, partStart + item.index * BYTES_PER_ROW, digits);
                  return (
                    <div key={item.key} className="adp-hex-row" style={{ transform: `translateY(${item.start}px)`, height: rowHeight }}>
                      <span className="adp-hex-offset">{row.offset}</span>
                      <span className="adp-hex-bytes">{row.hex}</span>
                      <span className="adp-hex-text">{row.text}</span>
                    </div>
                  );
                })
              : null}
          </div>
        </div>
      )}
    </ViewerFrame>
  );
}
```

Create `src/styles/hex.css`:

```css
/* Hex viewer (Step 04c). Colors only through tokens. */
.adp-hex { flex: 1; min-width: 0; overflow: auto; background: var(--adp-color-surface-window); font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: calc(13px * var(--adp-hex-zoom, 1)); }
.adp-hex:focus-visible { outline: 2px solid var(--adp-accent-explorer); outline-offset: -2px; }
.adp-hex-rows { position: relative; min-width: 100%; }
.adp-hex-row { position: absolute; top: 0; left: 0; display: flex; align-items: center; gap: 3ch; padding: 0 var(--adp-space-7); white-space: pre; user-select: text; }
.adp-hex-offset { color: var(--adp-color-text-tertiary); }
.adp-hex-bytes { width: 48ch; color: var(--adp-color-text-primary); }
.adp-hex-text { color: var(--adp-color-text-secondary); }
```

Create `src/__tests__/hexFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatHexRow, HEX_PART_BYTES, hexPartCount, offsetDigits } from "../handlers/hex/format";

describe("hex viewer rows", () => {
  it("formats 16 bytes with a gap after the 8th and the bytes as text", () => {
    const bytes = new TextEncoder().encode("Hello, hex view!\u0001\u00ff");
    expect(formatHexRow(bytes, 0, 0, 8)).toEqual({
      offset: "00000000",
      hex: "48 65 6C 6C 6F 2C 20 68  65 78 20 76 69 65 77 21",
      text: "Hello, hex view!",
    });
    // The last row is short; bytes that are not printable show as ".".
    expect(formatHexRow(bytes, 16, 0x1000010, 8)).toEqual({ offset: "01000010", hex: "01 C3 BF", text: "..." });
  });

  it("counts parts and widens offsets for files over 4 GB", () => {
    expect(hexPartCount(0)).toBe(1);
    expect(hexPartCount(HEX_PART_BYTES)).toBe(1);
    expect(hexPartCount(HEX_PART_BYTES + 1)).toBe(2);
    expect(offsetDigits(1000)).toBe(8);
    expect(offsetDigits(5 * 1024 ** 3)).toBe(12);
  });
});
```

Create `src/__tests__/hexView.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import HexView from "../handlers/hex/HexView";
import type { FileTypeInfo } from "../services/files";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(0),
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({ index, start: index * opts.estimateSize(index), key: index })),
    measure: () => undefined,
  }),
}));

const info: FileTypeInfo = {
  path: "C:\\data\\sample.bin",
  name: "sample.bin",
  ext: "bin",
  mime: "application/octet-stream",
  size: 20,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe("hex viewer", () => {
  it("reads the file with a Range request and shows offset, hex and text rows", async () => {
    const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode("ABCDEFGHIJKLMNOPQRST")));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <HexView
          info={info}
          url="http://adpfile.localhost/0123456789abcdef0123456789abcdef/sample.bin"
          active={true}
          savedState={null}
          onStateChange={() => undefined}
          onStatus={() => undefined}
          onOpenInWindowsApp={() => undefined}
          find={{ text: "", request: 0, backwards: false }}
          protectedView={false}
        />,
      ),
    );
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { headers: { Range: "bytes=0-19" } });
    const rows = container.querySelectorAll(".adp-hex-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("00000000");
    expect(rows[0].textContent).toContain("ABCDEFGHIJKLMNOP");
    expect(rows[1].textContent).toContain("00000010");
    expect(rows[1].textContent).toContain("51 52 53 54");
  });
});
```

In `src/main.tsx`, find exactly:

```tsx
import "./styles/media.css";
```

Replace with:

```tsx
import "./styles/media.css";
import "./styles/hex.css";
```

In `src/handlers/index.ts`, find exactly:

```ts
import { imageHandler } from "./image";
```

Replace with:

```ts
import { hexHandler } from "./hex";
import { imageHandler } from "./image";
```

In `src/handlers/index.ts`, find exactly:

```ts
  registry.register(textHandler);
```

Replace with:

```ts
  registry.register(textHandler);
  // Never chosen by itself (no extensions or types): only "Open as hex".
  registry.register(hexHandler);
```

In `src/ribbon/Ribbon.tsx`, find exactly:

```tsx
  return (
    <div className="adp-ribbon" style={{ ["--adp-ribbon-accent" as string]: `var(--adp-accent-${accent})` }}>
```

Replace with:

```tsx
  // A group whose controls are all hidden (Parts for a small file) is left out.
  const isShown = (control: RibbonControl) => {
    if (control.type === "custom") return true;
    const command = byId.get(control.command);
    return command !== undefined && isCommandVisible(command, ctx);
  };

  return (
    <div className="adp-ribbon" style={{ ["--adp-ribbon-accent" as string]: `var(--adp-accent-${accent})` }}>
```

In `src/ribbon/Ribbon.tsx`, find exactly:

```tsx
        {tab.groups.map((group, index) => (
```

Replace with:

```tsx
        {tab.groups.filter((group) => group.controls.some(isShown)).map((group, index) => (
```

In `src/__tests__/ribbon.test.tsx`, find exactly:

```tsx
describe("shortcut matching", () => {
```

Replace with:

```tsx
describe("ribbon groups", () => {
  it("leaves out a group whose controls are all hidden", async () => {
    const twoGroups: RibbonDef = {
      tabs: [
        {
          id: "view",
          labelKey: "ribbon.view",
          keyTip: "V",
          groups: [
            { id: "a", labelKey: "ribbon.zoom", controls: [{ type: "button", command: "t.shown" }] },
            { id: "b", labelKey: "ribbon.show", controls: [{ type: "button", command: "t.hidden" }] },
          ],
        },
      ],
    };
    const commands: Command<Ctx>[] = [
      { id: "t.shown", labelKey: "viewer.zoomIn", icon: Bold, risk: "read-only", helpSlug: "viewing-images", enabledWhen: () => true, run: () => undefined },
      { id: "t.hidden", labelKey: "viewer.zoomOut", icon: Italic, risk: "read-only", helpSlug: "viewing-images", visibleWhen: () => false, enabledWhen: () => true, run: () => undefined },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Ribbon def={twoGroups} ctx={{ bold: false, canItalic: true }} commands={commands} accent="explorer" active={true} />));
    expect(container.querySelectorAll(".adp-ribbon-group")).toHaveLength(1);
    expect(container.querySelectorAll(".adp-ribbon-sep")).toHaveLength(0);
    await act(async () => root.unmount());
  });
});

describe("shortcut matching", () => {
```

In `src/services/shortcuts.ts`, find exactly:

```ts
  space: "keys.space",
};
```

Replace with:

```ts
  space: "keys.space",
  pageup: "keys.pageUp",
  pagedown: "keys.pageDown",
};
```

In `src/__tests__/shortcuts.test.ts`, find exactly:

```ts
    expect(formatShortcut("Alt+Left", t)).toBe("Alt+Flecha izquierda");
```

Replace with:

```ts
    expect(formatShortcut("Alt+Left", t)).toBe("Alt+Flecha izquierda");
    expect(formatShortcut("Alt+PageDown", t)).toBe("Alt+Av Pág");
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `handlers.hex` | Hex | Hexadecimal |
| `hex.label` | Bytes of {name} | Bytes de {name} |
| `hex.loadError` | The bytes of this file couldn't be read. | No se pudieron leer los bytes de este archivo. |
| `keys.pageUp` | Page Up | Re Pág |
| `keys.pageDown` | Page Down | Av Pág |

**Tests:** `hexFormat.test.ts`, `hexView.test.tsx` (reads the file with a Range request and shows offset, hex and text rows), "leaves out a group whose controls are all hidden" (`ribbon.test.tsx`), and the Page Down line in `shortcuts.test.ts`.

**Commit:** `feat(viewer): hex viewer in 1 MB parts [step-04c/T6]`

### T7 - Open as text and Open as hex

**Files:** create `help/en/open-as-text-or-hex.md`, `help/es/open-as-text-or-hex.md`; modify `src/commands/explorerCommands.ts`, `src/commands/menus.ts`, `src/views/ExplorerHome.tsx`, `src/App.tsx`; add translation keys.

Create `help/en/open-as-text-or-hex.md`:

```markdown
# Open as text or hex

Any file can be shown as text, or as its bytes, whatever its type. This helps to see the source of a web page, read a settings file that has no extension, or look inside a file that no app opens.

## How to use it

- Right-click one or more files > **Open as** > **Open as text**: the file opens in the text viewer, with search and encodings (see "Viewing text and code").
- Right-click > **Open as** > **Open as hex**: the file opens in the hex viewer. Each row shows the position in the file (in hexadecimal), 16 bytes in hexadecimal, and the same bytes as text; a byte that is not a letter, digit or symbol shows as a dot.
- In the hex viewer, **Ctrl++**, **Ctrl+-** and **Ctrl+0** change the text size. Files bigger than 1 MB show in parts of 1 MB: use **Next part** and **Previous part** (**Alt+Page Down** and **Alt+Page Up**).

## Good to know

- Both viewers are read-only: the file never changes.
- A file can be open in its usual viewer and as text or hex at the same time, in separate tabs.

See also: "Viewing text and code" and "Opening files in tabs".
```

Create `help/es/open-as-text-or-hex.md`:

```markdown
# Abrir como texto o hexadecimal

Cualquier archivo se puede mostrar como texto, o como sus bytes, sea del tipo que sea. Sirve para ver el código fuente de una página web, leer un archivo de configuración sin extensión o mirar dentro de un archivo que ninguna aplicación abre.

## Cómo usarlo

- Haz clic con el botón derecho en uno o más archivos > **Abrir como** > **Abrir como texto**: el archivo se abre en el visor de texto, con búsqueda y codificaciones (consulta «Ver texto y código»).
- Clic con el botón derecho > **Abrir como** > **Abrir como hexadecimal**: el archivo se abre en el visor hexadecimal. Cada fila muestra la posición en el archivo (en hexadecimal), 16 bytes en hexadecimal y esos mismos bytes como texto; un byte que no es una letra, un número o un símbolo se muestra como un punto.
- En el visor hexadecimal, **Ctrl++**, **Ctrl+-** y **Ctrl+0** cambian el tamaño del texto. Los archivos de más de 1 MB se muestran en partes de 1 MB: usa **Parte siguiente** y **Parte anterior** (**Alt+Av Pág** y **Alt+Re Pág**).

## Bueno saberlo

- Los dos visores son de solo lectura: el archivo nunca cambia.
- Un archivo puede estar abierto en su visor habitual y como texto o hexadecimal a la vez, en pestañas distintas.

Consulta también: «Ver texto y código» y «Abrir archivos en pestañas».
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
  ArrowUpNarrowWide,
  CalendarDays,
```

Replace with:

```ts
  ArrowUpNarrowWide,
  Binary,
  CalendarDays,
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
  FilePlus,
  FileType,
```

Replace with:

```ts
  FilePlus,
  FileText,
  FileType,
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
  /** Open the selected files in their Windows default apps (Step 04a). */
  openInWindowsApp: () => void;
```

Replace with:

```ts
  /** Open the selected files in their Windows default apps (Step 04a). */
  openInWindowsApp: () => void;
  /** Open the selected files in the text or hex viewer (Step 04c). */
  openAsText: () => void;
  openAsHex: () => void;
```

In `src/commands/explorerCommands.ts`, find exactly:

```ts
      run: () => actions.openWith(),
    },
```

Replace with:

```ts
      run: () => actions.openWith(),
    },
    {
      id: "explorer.openAsText",
      labelKey: "commands.openAsText",
      icon: FileText,
      risk: "read-only",
      helpSlug: "open-as-text-or-hex",
      visibleWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.openAsText(),
    },
    {
      id: "explorer.openAsHex",
      labelKey: "commands.openAsHex",
      icon: Binary,
      risk: "read-only",
      helpSlug: "open-as-text-or-hex",
      visibleWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      enabledWhen: (ctx) => ctx.selection.files > 0 && ctx.selection.folders === 0,
      run: () => actions.openAsHex(),
    },
```

In `src/commands/menus.ts`, find exactly:

```ts
import { ArrowDownWideNarrow, Group, List, Plus, type LucideIcon } from "lucide-react";
```

Replace with:

```ts
import { ArrowDownWideNarrow, FileCode, Group, List, Plus, type LucideIcon } from "lucide-react";
```

In `src/commands/menus.ts`, find exactly:

```ts
  cmd("explorer.openWith"),
  cmd("explorer.toggleFavorite"),
```

Replace with:

```ts
  cmd("explorer.openWith"),
  { type: "submenu", id: "openAs", labelKey: "commands.openAs", icon: FileCode, entries: [cmd("explorer.openAsText"), cmd("explorer.openAsHex")] },
  cmd("explorer.toggleFavorite"),
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
  onOpenFile?: (path: string, background: boolean) => Promise<void>;
```

Replace with:

```tsx
  onOpenFile?: (path: string, background: boolean) => Promise<void>;
  /** "Open as text" and "Open as hex" (Step 04c): show a file in a chosen viewer. */
  onOpenFileWith?: (path: string, handlerId: string) => void;
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
  onOpenFile,
  navigateRequest = null,
```

Replace with:

```tsx
  onOpenFile,
  onOpenFileWith,
  navigateRequest = null,
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openWith: () => {
```

Replace with:

```tsx
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openAsText: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const files = paths.filter((path) => byPath.get(path)?.kind === "file");
        for (const path of files.slice(0, OPEN_LIMIT)) onOpenFileWith?.(path, "text");
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openAsHex: () => {
        const { selectedPaths: paths, itemByPath: byPath } = live.current;
        const files = paths.filter((path) => byPath.get(path)?.kind === "file");
        for (const path of files.slice(0, OPEN_LIMIT)) onOpenFileWith?.(path, "hex");
        if (files.length > OPEN_LIMIT) notify(t("explorer.openedFirst", { count: OPEN_LIMIT }));
      },
      openWith: () => {
```

In `src/views/ExplorerHome.tsx`, find exactly:

```tsx
    [goToFolder, goToLocation, i18n, notify, notifyError, onViewChange, openOne, refresh, t, pasteImageFormat],
```

Replace with:

```tsx
    [goToFolder, goToLocation, i18n, notify, notifyError, onOpenFileWith, onViewChange, openOne, refresh, t, pasteImageFormat],
```

In `src/App.tsx`, find exactly:

```tsx
  /** Switch to the Explorer tab and open a folder there, optionally
```

Replace with:

```tsx
  /** "Open as text" and "Open as hex" (Step 04c): a chosen viewer for a
   * file, whatever its type. The same file can have one tab per viewer. */
  const openFileWith = useCallback((path: string, handlerId: string) => {
    const title = path.split(/[\\/]/).pop() ?? path;
    setTabsState((current) => openFileTab(current, { path, handler: handlerId, title }, false));
  }, []);

  /** Switch to the Explorer tab and open a folder there, optionally
```

In `src/App.tsx`, find exactly:

```tsx
            onOpenFile={openFile}
```

Replace with:

```tsx
            onOpenFile={openFile}
            onOpenFileWith={openFileWith}
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `commands.openAs` | Open as | Abrir como |
| `commands.openAsText` | Open as text | Abrir como texto |
| `commands.openAsHex` | Open as hex | Abrir como hexadecimal |

**Tests:** no new tests; `commands.test.ts` checks that the two new commands have a help page.

**Commit:** `feat(explorer): Open as text and Open as hex [step-04c/T7]`

### T8 - Settings > Opening files

**Files:** create `src/views/settings/OpeningFilesSettings.tsx`, `src/styles/settings.css`, `src/__tests__/defaultApps.test.tsx`, `help/en/default-apps.md`, `help/es/default-apps.md`; modify `src/handlers/openPipeline.ts`, `src/App.tsx`, `src/views/SettingsView.tsx`, `src/main.tsx`; add translation keys.

Create `src/views/settings/OpeningFilesSettings.tsx`:

```tsx
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import SearchBox from "../../components/SearchBox";
import Switch from "../../components/Switch";
import { handlers } from "../../handlers";
import type { OpenSettings, OpenWith } from "../../services/settings";

export interface DefaultAppGroup {
  id: string;
  labelKey: string;
  extensions: string[];
}

/** The file types that have a built-in viewer, one group per viewer. An
 * extension two viewers know (".md") belongs to the first one registered. */
export function defaultAppGroups(): DefaultAppGroup[] {
  const seen = new Set<string>();
  const groups: DefaultAppGroup[] = [];
  for (const handler of handlers.list()) {
    const extensions = handler.extensions.filter((ext) => !seen.has(ext));
    for (const ext of extensions) seen.add(ext);
    if (extensions.length > 0) groups.push({ id: handler.id, labelKey: handler.labelKey, extensions: [...extensions].sort() });
  }
  return groups;
}

/** New `open_with` after choosing `choice` for `extensions`. Only
 * "windows" is stored; "builtin" is the default and removes the entry. */
export function withChoice(openWith: Readonly<Record<string, OpenWith>>, extensions: readonly string[], choice: OpenWith): Record<string, OpenWith> {
  const next: Record<string, OpenWith> = { ...openWith };
  for (const ext of extensions) {
    if (choice === "windows") next[ext] = "windows";
    else delete next[ext];
  }
  return next;
}

export interface OpeningFilesSettingsProps {
  open: OpenSettings;
  onChange: (open: OpenSettings) => void;
  onOpenHelp: (slug: string) => void;
}

/** Settings > Opening files (Step 04c): protected view and Default apps. */
export default function OpeningFilesSettings({ open, onChange, onOpenHelp }: OpeningFilesSettingsProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => defaultAppGroups(), []);
  const query = filter.trim().replace(/^\./, "").toLowerCase();
  const choiceOf = (ext: string): OpenWith => (Object.hasOwn(open.open_with, ext) ? open.open_with[ext] : "builtin");
  const choose = (extensions: readonly string[], choice: OpenWith) => onChange({ ...open, open_with: withChoice(open.open_with, extensions, choice) });
  const visibleGroups = groups
    .map((group) => ({ group, shown: query ? group.extensions.filter((ext) => ext.includes(query)) : group.extensions }))
    .filter((entry) => entry.shown.length > 0);

  return (
    <section className="adp-settings-section" aria-labelledby="adp-opening-files-title">
      <div className="adp-view-header">
        <h3 id="adp-opening-files-title" className="adp-heading">
          {t("settings.openingFiles")}
        </h3>
        <HelpButton onOpenHelp={() => onOpenHelp("default-apps")} />
      </div>
      <div className="adp-setting-row">
        <Switch checked={open.protected_view} label={t("settings.protectedView")} onChange={(checked) => onChange({ ...open, protected_view: checked })} />
        <p className="adp-note">{t("settings.protectedViewNote")}</p>
      </div>
      <div className="adp-setting-row">
        <span className="adp-setting-label">{t("settings.defaultApps")}</span>
        <p className="adp-note">{t("settings.defaultAppsNote")}</p>
        <div className="adp-defaultapps-search">
          <SearchBox value={filter} onChange={setFilter} placeholder={t("settings.findFileType")} />
        </div>
        {visibleGroups.length === 0 ? <p className="adp-note">{t("settings.noFileTypes")}</p> : null}
        {visibleGroups.map(({ group, shown }) => {
          const choices = new Set(group.extensions.map(choiceOf));
          const groupValue = choices.size === 1 ? [...choices][0] : "mixed";
          const isOpen = query !== "" || expanded === group.id;
          const name = t(group.labelKey);
          return (
            <div key={group.id} className="adp-defaultapps-group">
              <div className="adp-defaultapps-head">
                <button
                  type="button"
                  className="adp-defaultapps-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                >
                  <ChevronRight size={16} aria-hidden="true" className={isOpen ? "adp-defaultapps-chevron adp-defaultapps-chevron--open" : "adp-defaultapps-chevron"} />
                  <span className="adp-defaultapps-name">{name}</span>
                  <span className="adp-note">{t("settings.fileTypeCount", { count: group.extensions.length })}</span>
                </button>
                <select
                  className="adp-defaultapps-select"
                  aria-label={t("settings.openGroupWith", { name })}
                  value={groupValue}
                  onChange={(event) => choose(group.extensions, event.target.value as OpenWith)}
                >
                  {groupValue === "mixed" ? (
                    <option value="mixed" disabled>
                      {t("settings.openMixed")}
                    </option>
                  ) : null}
                  <option value="builtin">{t("settings.openInAdperastra")}</option>
                  <option value="windows">{t("settings.openInWindowsApp")}</option>
                </select>
              </div>
              {isOpen ? (
                <ul className="adp-defaultapps-list">
                  {shown.map((ext) => (
                    <li key={ext} className="adp-defaultapps-item">
                      <span className="adp-defaultapps-ext">.{ext}</span>
                      <select
                        className="adp-defaultapps-select"
                        aria-label={t("settings.openTypeWith", { ext })}
                        value={choiceOf(ext)}
                        onChange={(event) => choose([ext], event.target.value as OpenWith)}
                      >
                        <option value="builtin">{t("settings.openInAdperastra")}</option>
                        <option value="windows">{t("settings.openInWindowsApp")}</option>
                      </select>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

Create `src/styles/settings.css`:

```css
/* Settings sections (Step 04c on). Colors only through tokens. */
.adp-settings-section { display: flex; flex-direction: column; gap: var(--adp-space-5); padding-top: var(--adp-space-6); border-top: 1px solid var(--adp-color-border-panel); }
.adp-defaultapps-search { width: min(320px, 100%); }
.adp-defaultapps-search .adp-search { width: 100%; height: 32px; }
.adp-defaultapps-search .adp-search-input { flex: 1; min-width: 0; }
.adp-defaultapps-group { border: 1px solid var(--adp-color-border-panel); border-radius: var(--adp-radius-md); }
.adp-defaultapps-head { display: flex; align-items: center; gap: var(--adp-space-4); padding: var(--adp-space-2) var(--adp-space-4); }
.adp-defaultapps-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--adp-space-3); height: 32px; padding: 0; border: none; background: transparent; color: var(--adp-color-text-primary); font: inherit; font-size: var(--adp-font-body); text-align: left; cursor: pointer; }
.adp-defaultapps-toggle:focus-visible, .adp-defaultapps-select:focus-visible { outline: 2px solid var(--adp-accent-explorer); outline-offset: 1px; }
.adp-defaultapps-chevron { flex: none; transition: transform 120ms ease; }
.adp-defaultapps-chevron--open { transform: rotate(90deg); }
.adp-defaultapps-name { font-weight: 600; }
.adp-defaultapps-select { height: 28px; border: 1px solid var(--adp-color-border-input); border-radius: var(--adp-radius-sm); background: var(--adp-color-surface-window); color: var(--adp-color-text-primary); font: inherit; font-size: var(--adp-font-body); }
.adp-defaultapps-list { list-style: none; margin: 0; padding: var(--adp-space-2) var(--adp-space-4) var(--adp-space-4); display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--adp-space-2) var(--adp-space-5); border-top: 1px solid var(--adp-color-border-panel); }
.adp-defaultapps-item { display: flex; align-items: center; justify-content: space-between; gap: var(--adp-space-3); }
.adp-defaultapps-ext { font-family: "Cascadia Mono", Consolas, monospace; font-size: var(--adp-font-body); color: var(--adp-color-text-primary); }
```

Create `src/__tests__/defaultApps.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { createHandlerRegistry } from "../handlers";
import { planOpen } from "../handlers/openPipeline";
import { fileDetect, type FileTypeInfo } from "../services/files";
import { defaultSettings, type OpenSettings } from "../services/settings";
import OpeningFilesSettings, { defaultAppGroups, withChoice } from "../views/settings/OpeningFilesSettings";

vi.mock("../services/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/files")>()),
  fileDetect: vi.fn(),
}));

const txt: FileTypeInfo = {
  path: "C:\\notes.txt",
  name: "notes.txt",
  ext: "txt",
  mime: "text/plain",
  size: 10,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("default apps", () => {
  it("lists every viewer's file types once, Markdown before text, without the hex viewer", () => {
    const groups = defaultAppGroups();
    const all = groups.flatMap((group) => group.extensions);
    expect(new Set(all).size).toBe(all.length);
    expect(groups.map((group) => group.id)).toEqual(["image", "media", "markdown", "text"]);
    expect(groups.find((group) => group.id === "markdown")?.extensions).toContain("md");
    expect(groups.find((group) => group.id === "text")?.extensions).not.toContain("md");
  });

  it("stores only Windows choices", () => {
    expect(withChoice({ txt: "windows" }, ["txt", "log"], "builtin")).toEqual({});
    expect(withChoice({}, ["mp3", "wav"], "windows")).toEqual({ mp3: "windows", wav: "windows" });
  });

  it("opens a type in its Windows app when the user chose that", async () => {
    vi.mocked(fileDetect).mockResolvedValue(txt);
    const registry = createHandlerRegistry();
    expect((await planOpen("C:\\notes.txt", registry)).kind).toBe("tab");
    expect((await planOpen("C:\\notes.txt", registry, { txt: "windows" })).kind).toBe("windows");
    expect((await planOpen("C:\\notes.txt", registry, { md: "windows" })).kind).toBe("tab");
  });

  it("changes a whole group and filters by extension", async () => {
    const onChange = vi.fn();
    const open: OpenSettings = defaultSettings().open;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<OpeningFilesSettings open={open} onChange={onChange} onOpenHelp={() => undefined} />));
    const groupSelects = container.querySelectorAll<HTMLSelectElement>(".adp-defaultapps-head select");
    expect(groupSelects).toHaveLength(4);
    await act(async () => {
      groupSelects[1].value = "windows";
      groupSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    const next = onChange.mock.calls[0][0] as OpenSettings;
    expect(next.open_with.mp4).toBe("windows");
    expect(next.open_with.mp3).toBe("windows");
    expect(next.protected_view).toBe(true);
    const input = container.querySelector<HTMLInputElement>(".adp-defaultapps-search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, ".txt");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const items = [...container.querySelectorAll(".adp-defaultapps-ext")].map((element) => element.textContent);
    expect(items).toContain(".txt");
    expect(items.every((item) => item?.includes("txt"))).toBe(true);
  });
});
```

Create `help/en/default-apps.md`:

```markdown
# Choosing how files open

When you double-click a file, Adperastra opens it in a tab if it has a built-in viewer: pictures, text and code, Markdown, audio and video. Other files open in their Windows app. You can change this for any type of file.

## Choosing where a type of file opens

1. Open **Settings** (the gear at the top right) and go to **Opening files**.
2. Under **Default apps**, find the group (for example **Text**), or type an extension in the search box (for example `txt`).
3. Choose **Windows app** to open that type in its Windows app, or **Adperastra** to open it here. The list next to a group's name changes every type in the group at once; click the group's name to see each type.

The change applies the next time you open a file.

## Good to know

- **Windows app** is the app Windows uses for that type. To change which app that is, right-click a file > **Open with…** and choose another app there.
- Programs, shortcuts and web pages always open in Windows.
- Right-click a file > **Open in Windows app** opens it there once, without changing this setting.
- **Protected view** (in the same section) shows files from the internet with their links turned off. See "Protected view".

See also: "Opening files in tabs" and "Protected view".
```

Create `help/es/default-apps.md`:

```markdown
# Elegir cómo se abren los archivos

Cuando haces doble clic en un archivo, Adperastra lo abre en una pestaña si tiene un visor integrado: imágenes, texto y código, Markdown, audio y video. Los demás archivos se abren en su aplicación de Windows. Puedes cambiarlo para cualquier tipo de archivo.

## Elegir dónde se abre un tipo de archivo

1. Abre **Configuración** (el engranaje arriba a la derecha) y ve a **Abrir archivos**.
2. En **Aplicaciones predeterminadas**, busca el grupo (por ejemplo **Texto**) o escribe una extensión en el cuadro de búsqueda (por ejemplo `txt`).
3. Elige **Aplicación de Windows** para abrir ese tipo en su aplicación de Windows, o **Adperastra** para abrirlo aquí. La lista junto al nombre de un grupo cambia todos los tipos del grupo a la vez; haz clic en el nombre del grupo para ver cada tipo.

El cambio se aplica la próxima vez que abras un archivo.

## Bueno saberlo

- **Aplicación de Windows** es la aplicación que Windows usa para ese tipo. Para cambiar cuál es, haz clic con el botón derecho en un archivo > **Abrir con…** y elige otra aplicación ahí.
- Los programas, los accesos directos y las páginas web siempre se abren en Windows.
- Clic con el botón derecho en un archivo > **Abrir en la aplicación de Windows** lo abre ahí una vez, sin cambiar esta configuración.
- **Vista protegida** (en la misma sección) muestra los archivos de Internet con sus vínculos desactivados. Consulta «Vista protegida».

Consulta también: «Abrir archivos en pestañas» y «Vista protegida».
```

In `src/handlers/openPipeline.ts`, find exactly:

```ts
/** Detect a file and decide. Rejects with a `files.*` code when the file
 * cannot be read (for example `files.not_found`). */
export async function planOpen(path: string, registry: HandlerRegistry): Promise<OpenDecision> {
  const info = await fileDetect(path);
  return decideOpen(info, registry);
}
```

Replace with:

```ts
/** Detect a file and decide, following the user's Default apps choices
 * (`open_with`, Step 04c). Rejects with a `files.*` code when the file
 * cannot be read (for example `files.not_found`). */
export async function planOpen(
  path: string,
  registry: HandlerRegistry,
  openWith: Readonly<Record<string, "builtin" | "windows">> = {},
): Promise<OpenDecision> {
  const info = await fileDetect(path);
  const preference = Object.hasOwn(openWith, info.ext) ? openWith[info.ext] : undefined;
  return decideOpen(info, registry, preference);
}
```

In `src/App.tsx`, find exactly:

```tsx
    const decision = await planOpen(path, handlers);
```

Replace with:

```tsx
    const decision = await planOpen(path, handlers, settingsRef.current.open.open_with);
```

In `src/App.tsx`, find exactly:

```tsx
            onOpenHelp={() => openTab("help", "changing-language-and-theme")}
          /></Suspense>
```

Replace with:

```tsx
            onOpenHelp={() => openTab("help", "changing-language-and-theme")}
            onOpenHelpPage={(slug) => openTab("help", slug)}
          /></Suspense>
```

In `src/views/SettingsView.tsx`, find exactly:

```tsx
import type { AppSettings, LanguageSetting } from "../services/settings";
```

Replace with:

```tsx
import type { AppSettings, LanguageSetting } from "../services/settings";
import OpeningFilesSettings from "./settings/OpeningFilesSettings";
```

In `src/views/SettingsView.tsx`, find exactly:

```tsx
  onOpenHelp: () => void;
}
```

Replace with:

```tsx
  onOpenHelp: () => void;
  /** Opens a help page by slug (the sections' own "?" buttons). */
  onOpenHelpPage: (slug: string) => void;
}
```

In `src/views/SettingsView.tsx`, find exactly:

```tsx
export default function SettingsView({ settings, onApply, onOpenHelp }: SettingsViewProps) {
```

Replace with:

```tsx
export default function SettingsView({ settings, onApply, onOpenHelp, onOpenHelpPage }: SettingsViewProps) {
```

In `src/views/SettingsView.tsx`, find exactly:

```tsx
      <p className="adp-note">{t("settings.persistNote")}</p>
```

Replace with:

```tsx
      <OpeningFilesSettings open={settings.open} onChange={(open) => onApply({ ...settings, open })} onOpenHelp={onOpenHelpPage} />
      <p className="adp-note">{t("settings.persistNote")}</p>
```

In `src/main.tsx`, find exactly:

```tsx
import "./styles/hex.css";
```

Replace with:

```tsx
import "./styles/hex.css";
import "./styles/settings.css";
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `settings.openingFiles` | Opening files | Abrir archivos |
| `settings.protectedView` | Protected view for files from the internet | Vista protegida para archivos de Internet |
| `settings.protectedViewNote` | Files downloaded from the internet open with a yellow bar, and their links stay off until you unblock them. | Los archivos descargados de Internet se abren con una barra amarilla, y sus vínculos quedan desactivados hasta que los desbloquees. |
| `settings.defaultApps` | Default apps | Aplicaciones predeterminadas |
| `settings.defaultAppsNote` | Choose where each type of file opens when you double-click it: in Adperastra or in its Windows app. | Elige dónde se abre cada tipo de archivo al hacer doble clic: en Adperastra o en su aplicación de Windows. |
| `settings.findFileType` | Find a file type (for example txt) | Buscar un tipo de archivo (por ejemplo, txt) |
| `settings.noFileTypes` | No file type matches. | Ningún tipo de archivo coincide. |
| `settings.fileTypeCount` | {count, plural, one {# file type} other {# file types}} | {count, plural, one {# tipo de archivo} other {# tipos de archivo}} |
| `settings.openGroupWith` | Open {name} files with | Abrir los archivos de {name} con |
| `settings.openTypeWith` | Open .{ext} files with | Abrir los archivos .{ext} con |
| `settings.openInAdperastra` | Adperastra | Adperastra |
| `settings.openInWindowsApp` | Windows app | Aplicación de Windows |
| `settings.openMixed` | Mixed | Mixto |

**Tests:** `defaultApps.test.tsx` (lists every viewer's file types once, Markdown before text, without the hex viewer; stores only Windows choices; opens a type in its Windows app when the user chose that; changes a whole group and filters by extension).

**Commit:** `feat(settings): Opening files section with protected view and default apps [step-04c/T8]`

### T9 - Speed measurement and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

In `scripts/measure-ui.mjs`, find exactly:

```js
/** A real PNG (a color gradient), so "open image" measures a real decode. */
```

Replace with:

```js
/** Step 04c samples: a 10 s tone as WAV, and a Markdown file marked as
 * downloaded from the internet (its Zone.Identifier stream). */
function writeMediaSamples(folder) {
  const rate = 44100;
  const samples = rate * 10;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(folder, "tone-10s.wav"), Buffer.concat([header, data]));
  writeFileSync(join(folder, "downloaded.md"), "# Downloaded notes\n\nA [web link](https://example.com).\n");
  try {
    writeFileSync(join(folder, "downloaded.md:Zone.Identifier"), "[ZoneTransfer]\r\nZoneId=3\r\n");
  } catch {
    // Not NTFS: the protected view screenshot shows no bar.
  }
}

/** A real PNG (a color gradient), so "open image" measures a real decode. */
```

In `scripts/measure-ui.mjs`, find exactly:

```js
writeTextSamples(demo);
```

Replace with:

```js
writeTextSamples(demo);
writeMediaSamples(demo);
```

In `scripts/measure-ui.mjs`, find exactly:

```js
  // Classic menu: time until the helper's menu is on screen. The runner
```

Replace with:

```js
  // Step 04c: open a WAV file in the player (until its length is known).
  try {
    await openFolder(demo);
    const values = [];
    for (let run = 0; run < 5; run += 1) {
      values.push(
        await page(`window.__m.timeUntil(
          () => [...window.__m.rows()].find((r) => r.textContent.includes("tone-10s.wav")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
          () => (document.querySelector(".adp-filetab:not([hidden]) audio")?.readyState ?? 0) >= 1)`),
      );
      await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
      await page(`window.__m.waitFor(() => document.querySelector(".adp-tabpane:not([hidden])") !== null)`);
      await sleep(200);
    }
    const result = { name: "open a WAV file in the player (first view)", median_ms: Math.round(median(values) * 10) / 10, max_ms: Math.round(Math.max(...values) * 10) / 10, runs: values.length };
    console.log(`${result.name}: median ${result.median_ms} ms (max ${result.max_ms})`);
    results.push(result);
  } catch (error) {
    console.log(`step 04c measurements failed: ${error.message ?? error}`);
  }

  // Classic menu: time until the helper's menu is on screen. The runner
```

In `scripts/measure-ui.mjs`, find exactly:

```js
    step: "04b",
```

Replace with:

```js
    step: "04c",
```

In `scripts/measure-ui.mjs`, find exactly:

```js
  await shot("14-markdown-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
```

Replace with:

```js
  await shot("14-markdown-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  // Step 04c: the audio player, and a downloaded file in protected view.
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("tone-10s.wav"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => (document.querySelector(".adp-filetab:not([hidden]) audio")?.readyState ?? 0) >= 1, 15000)`);
  await sleep(300);
  await shot("15-audio-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("downloaded.md"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-markdown-frame")?.contentDocument?.querySelector("main h1") != null, 15000)`);
  await sleep(300);
  await shot("16-protected-view");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
```

Check: `node --check scripts/measure-ui.mjs` prints nothing.

**Commit:** `test(bench): measure opening a WAV file; audio and protected view screenshots [step-04c/T9]`

## Check by hand

The owner does these checks in the packaged app (`.\scripts\gate.ps1 -Package`, then `build\Adperastra\Adperastra.exe`). Before telling the owner the step is ready, create the test files with these PowerShell commands (they go to your Temp folder; `downloaded.md` gets the same mark a browser adds to a download):

```powershell
$dir = Join-Path $env:TEMP "adperastra-04c"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -Path "$dir\downloaded.md" -Value @("# Downloaded notes", "", "A [web link](https://example.com).") -Encoding utf8
Set-Content -Path "$dir\downloaded.md" -Stream Zone.Identifier -Value @("[ZoneTransfer]", "ZoneId=3")
Set-Content -Path "$dir\Clip.srt" -Value @("1", "00:00:00,500 --> 00:00:04,000", "Hello from the subtitles") -Encoding utf8
Set-Content -Path "$dir\notes.txt" -Value "Some notes." -Encoding utf8
Set-Content -Path "$dir\page.html" -Value "<h1>Hello</h1>" -Encoding utf8
Copy-Item -Path "docs\screenshots\step-01a\06-first-run-en-light.png" -Destination "$dir\picture.png"
```

Also copy into that folder one MP4 video named `Clip.mp4`, one MP3 song, and one MKV video if you have them (any from your Videos and Music folders).

Then open the folder `%TEMP%\adperastra-04c` in Adperastra and check:

1. Double-click the MP3: the player shows the music icon, the file name and the controls. Press Space: it plays; Space again pauses. The status bar shows the length, "Audio" and the size.
2. While it plays, switch to the Explorer tab: the music keeps playing. Come back and click Pause on the ribbon.
3. Ribbon: Loop turns on and off; Speed 1.5× plays faster. Close the tab and open the MP3 again: Speed and Loop are as you left them.
4. Double-click `Clip.mp4`: the video plays in the tab. Subtitles on the ribbon lists "Clip.srt"; choose it: "Hello from the subtitles" shows in the first seconds. Choose Off: it disappears.
5. Double-click the MKV video: it opens in its Windows app, not in a tab.
6. Hold Alt in the player: P and L key tips show; Alt+P plays and pauses.
7. Double-click `downloaded.md`: the yellow bar says the file came from the internet. Click "web link" on the page: nothing happens.
8. Click Unblock on the bar, then Cancel: nothing changes. Click Unblock again, then Unblock in the dialog: the bar disappears; "web link" now asks before opening. In Windows Explorer, right-click `downloaded.md` > Properties: the Unblock box is gone.
9. Settings > Opening files: turn off Protected view, run the commands above again (they mark `downloaded.md` again) and open it again: no bar. Turn Protected view back on.
10. Right-click `picture.png` > Open as > Open as hex: a tab shows rows with offsets, hex and text; the first row's text starts with ".PNG". Ctrl+= makes it bigger. Double-click `picture.png`, then right-click it > Open as > Open as text: a third tab opens; the picture's tab stays.
11. Right-click `page.html` > Open as > Open as text: the text viewer shows it. Double-click `page.html`: it opens in the browser.
12. Settings > Opening files > Default apps: set Text to "Windows app", then double-click `notes.txt`: it opens in Notepad (or your text app). Set Text back to "Adperastra": it opens in a tab again. Type `mp3` in the search box: only the .mp3 row shows.
13. Right-click a folder: there is no Open as menu.
14. Spanish and dark theme: repeat 1, 7, 10 and 12.

## Speed

| Interaction | Tier | How |
|---|---|---|
| Open a WAV file in the player (first view) | Fast (1 s) | `scripts\measure-ui.ps1`, row "open a WAV file in the player (first view)" |
| Earlier rows (selection, menus, folder open, image, text and Markdown tabs) | as before | must not be more than 20 % slower than `docs/benchmarks/<date>-ui-step04b.json` |

## Screenshots

`15-audio-tab` and `16-protected-view` (new) plus all earlier ones, in English light, Spanish dark and the pseudo-locale, into `docs/screenshots/step-04c/`.

## Done when

- [ ] `.\scripts\gate.ps1 -Package` prints `GATE PASSED`.
- [ ] The owner has done every "Check by hand" item, in English light and Spanish dark, and all pass.
- [ ] The speed table is met and saved as `docs/benchmarks/<date>-ui-step04c.json`.
- [ ] Screenshots are in `docs/screenshots/step-04c/`.
- [ ] `docs/step-reports/step-04c.md`, `CHANGELOG.md` (Unreleased: "Audio and video player; protected view for downloads; Open as text or hex; choose where each file type opens"), `KNOWN_ISSUES.md` and `plan/STATUS.md` are updated.
