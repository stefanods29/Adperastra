//! Explorer backend helpers (Step 02, slice 2): known folders, drives,
//! recent items. Tauri command wrappers live in main.rs; everything here
//! is plain Rust so it can be unit-tested without a window.

use fs_service::ItemKind;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownFolder {
    pub id: String,
    /// Display name from Windows (the user's Windows language).
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriveItem {
    /// Root path such as `C:\`.
    pub root: String,
    /// One of: removable, fixed, network, optical, ram, unknown.
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriveInfo {
    pub root: String,
    pub ready: bool,
    pub label: Option<String>,
    pub file_system: Option<String>,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentItem {
    pub name: String,
    pub path: String,
    pub kind: ItemKind,
    pub modified_unix: u64,
    pub size: u64,
}

pub fn drive_kind_name(code: u32) -> &'static str {
    match code {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "optical",
        6 => "ram",
        _ => "unknown",
    }
}

/// Newest first with an early stop: candidates are sorted by their own
/// timestamp, then resolved one at a time until `limit` distinct paths are
/// found, so a Recent folder with thousands of shortcuts costs about
/// `limit` resolves instead of thousands. A path appearing several times
/// keeps its newest entry (Windows Recent often holds several shortcuts to
/// the same file).
pub fn pick_newest_recent<T>(
    mut candidates: Vec<(u64, T)>,
    limit: usize,
    mut resolve: impl FnMut(u64, T) -> Option<RecentItem>,
) -> Vec<RecentItem> {
    candidates.sort_by_key(|c| std::cmp::Reverse(c.0));
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (modified_unix, candidate) in candidates {
        if out.len() >= limit {
            break;
        }
        let Some(item) = resolve(modified_unix, candidate) else {
            continue;
        };
        if seen.insert(item.path.to_lowercase()) {
            out.push(item);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// DTO conversion (the UI never receives raw PathBufs)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExplorerItem {
    pub path: String,
    pub name: String,
    pub kind: ItemKind,
    pub size: u64,
    pub modified_unix: u64,
    pub hidden: bool,
    pub system: bool,
    pub is_link: bool,
    pub online_only: bool,
    /// Decimal string: Windows file IDs can exceed 2^53, which a
    /// JavaScript number cannot hold exactly.
    pub file_id: Option<String>,
    pub file_id_stable: bool,
}

pub fn explorer_item(item: fs_service::Item) -> ExplorerItem {
    ExplorerItem {
        path: item.path.to_string_lossy().into_owned(),
        name: item.name,
        kind: item.kind,
        size: item.size,
        modified_unix: item.modified_unix,
        hidden: item.attrs.hidden,
        system: item.attrs.system,
        is_link: item.attrs.is_link,
        online_only: item.attrs.online_only,
        file_id: item.attrs.file_id.map(|id| id.to_string()),
        file_id_stable: item.attrs.file_id_stable,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FsEventDto {
    /// created, removed, modified, renamed, or rescan.
    pub kind: String,
    pub path: String,
}

pub fn fs_event_dto(event: fs_service::FsEvent) -> FsEventDto {
    let kind = match event.kind {
        fs_service::FsEventKind::Created => "created",
        fs_service::FsEventKind::Removed => "removed",
        fs_service::FsEventKind::Modified => "modified",
        fs_service::FsEventKind::Renamed => "renamed",
        fs_service::FsEventKind::Rescan => "rescan",
    };
    FsEventDto {
        kind: kind.to_string(),
        path: event.path.to_string_lossy().into_owned(),
    }
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn wide_null(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
struct ComGuard(bool);

#[cfg(windows)]
impl ComGuard {
    fn new() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        // SAFETY: balanced by CoUninitialize in Drop when init succeeded.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        Self(hr.0 >= 0)
    }
}

#[cfg(windows)]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: pairs with the successful CoInitializeEx above.
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
unsafe fn pwstr_to_string(ptr: windows::core::PWSTR) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: caller owns a CoTaskMem-allocated NUL-terminated string and
    // frees it exactly once here.
    let text = unsafe { ptr.to_string() }.unwrap_or_default();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(ptr.0 as *const std::ffi::c_void)) };
    text
}

#[cfg(windows)]
fn known_folder_path(guid: &windows::core::GUID) -> Option<String> {
    use windows::Win32::UI::Shell::SHGetKnownFolderPath;
    // SAFETY: guid is a FOLDERID constant; returned PWSTR freed in helper.
    let ptr = unsafe {
        SHGetKnownFolderPath(guid, windows::Win32::UI::Shell::KNOWN_FOLDER_FLAG(0), None)
    }
    .ok()?;
    // SAFETY: ptr came from SHGetKnownFolderPath (CoTaskMem).
    Some(unsafe { pwstr_to_string(ptr) })
}

#[cfg(windows)]
fn shell_display_name(path: &str) -> Option<String> {
    use windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromParsingName, SIGDN_NORMALDISPLAY};
    let wide = wide_null(path);
    // SAFETY: wide outlives the call; the COM object is released by Drop.
    let item: IShellItem = unsafe {
        SHCreateItemFromParsingName::<_, _, IShellItem>(windows::core::PCWSTR(wide.as_ptr()), None)
    }
    .ok()?;
    // SAFETY: GetDisplayName returns a CoTaskMem PWSTR freed in helper.
    let ptr = unsafe { item.GetDisplayName(SIGDN_NORMALDISPLAY) }.ok()?;
    // SAFETY: ptr came from GetDisplayName (CoTaskMem).
    let name = unsafe { pwstr_to_string(ptr) };
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}
#[cfg(windows)]
pub fn known_folders() -> Vec<KnownFolder> {
    use windows::Win32::UI::Shell::{
        FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music,
        FOLDERID_Pictures, FOLDERID_Profile, FOLDERID_Videos,
    };
    let defs: [(&str, windows::core::GUID); 7] = [
        ("home", FOLDERID_Profile),
        ("desktop", FOLDERID_Desktop),
        ("downloads", FOLDERID_Downloads),
        ("documents", FOLDERID_Documents),
        ("pictures", FOLDERID_Pictures),
        ("music", FOLDERID_Music),
        ("videos", FOLDERID_Videos),
    ];
    let _com = ComGuard::new();
    let mut out = Vec::new();
    for (id, guid) in defs {
        if let Some(path) = known_folder_path(&guid) {
            let fallback = Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let name = shell_display_name(&path).unwrap_or(fallback);
            out.push(KnownFolder {
                id: id.to_string(),
                name,
                path,
            });
        }
    }
    out
}

#[cfg(not(windows))]
pub fn known_folders() -> Vec<KnownFolder> {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let mk = |id: &str, folder: &str| KnownFolder {
        id: id.to_string(),
        name: folder.to_string(),
        path: format!("{home}\\{folder}"),
    };
    vec![
        mk("desktop", "Desktop"),
        mk("downloads", "Downloads"),
        mk("documents", "Documents"),
        mk("pictures", "Pictures"),
        mk("music", "Music"),
        mk("videos", "Videos"),
    ]
}

#[cfg(windows)]
pub fn list_drives() -> Vec<DriveItem> {
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDriveStringsW};
    // Fast by design: this reads the logical-drive bitmask only and never
    // touches volume metadata, so a sleeping drive cannot stall it.
    let mut buffer = [0u16; 256];
    // SAFETY: buffer is a writable slice sized for all drive roots.
    let written = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) };
    if written == 0 {
        return Vec::new();
    }
    let text = String::from_utf16_lossy(&buffer[..(written as usize).min(buffer.len())]);
    let mut out = Vec::new();
    for root in text.split('\0').filter(|s| !s.is_empty()) {
        let wide = wide_null(root);
        // SAFETY: wide is a NUL-terminated root path.
        let kind_code = unsafe { GetDriveTypeW(windows::core::PCWSTR(wide.as_ptr())) };
        out.push(DriveItem {
            root: root.to_string(),
            kind: drive_kind_name(kind_code).to_string(),
        });
    }
    out
}

#[cfg(not(windows))]
pub fn list_drives() -> Vec<DriveItem> {
    Vec::new()
}

/// Blocking volume query; callers run it on a blocking thread and the UI
/// applies its own timeout, so a sleeping drive shows "not available"
/// instead of freezing anything.
#[cfg(windows)]
pub fn drive_info(root: &str) -> DriveInfo {
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetVolumeInformationW};
    let not_ready = DriveInfo {
        root: root.to_string(),
        ready: false,
        label: None,
        file_system: None,
        total_bytes: None,
        free_bytes: None,
    };
    let wide = wide_null(root);
    let mut label = [0u16; 128];
    let mut fs_name = [0u16; 64];
    // SAFETY: buffers are valid writable slices for both calls.
    let volume = unsafe {
        GetVolumeInformationW(
            windows::core::PCWSTR(wide.as_ptr()),
            Some(&mut label),
            None,
            None,
            None,
            Some(&mut fs_name),
        )
    };
    if volume.is_err() {
        return not_ready;
    }
    let decode = |buf: &[u16]| {
        let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        let text = String::from_utf16_lossy(&buf[..end]);
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    };
    let (mut free, mut total) = (0u64, 0u64);
    // SAFETY: pointers reference locals that outlive the call.
    let space = unsafe {
        GetDiskFreeSpaceExW(
            windows::core::PCWSTR(wide.as_ptr()),
            Some(&mut free),
            Some(&mut total),
            None,
        )
    };
    DriveInfo {
        root: root.to_string(),
        ready: true,
        label: decode(&label),
        file_system: decode(&fs_name),
        total_bytes: if space.is_ok() { Some(total) } else { None },
        free_bytes: if space.is_ok() { Some(free) } else { None },
    }
}

#[cfg(not(windows))]
pub fn drive_info(root: &str) -> DriveInfo {
    DriveInfo {
        root: root.to_string(),
        ready: false,
        label: None,
        file_system: None,
        total_bytes: None,
        free_bytes: None,
    }
}

#[cfg(windows)]
fn resolve_shortcut(path: &Path) -> Option<PathBuf> {
    use windows::core::Interface;
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    // SAFETY: all COM objects are used on this thread and released by Drop.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = link.cast().ok()?;
        let wide = wide_null(&path.to_string_lossy());
        persist
            .Load(windows::core::PCWSTR(wide.as_ptr()), STGM_READ)
            .ok()?;
        let mut buffer = [0u16; 32768];
        link.GetPath(&mut buffer, std::ptr::null_mut(), 0).ok()?;
        let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        let target = String::from_utf16_lossy(&buffer[..end]);
        if target.is_empty() {
            None
        } else {
            Some(PathBuf::from(target))
        }
    }
}

/// Recent items from the Windows Recent folder (shortcuts resolved,
/// targets that no longer exist skipped), merged newest-first.
pub fn recent_items(limit: usize) -> Vec<RecentItem> {
    #[cfg(windows)]
    {
        let _com = ComGuard::new();
        let recent_dir = match known_folder_path(&windows::Win32::UI::Shell::FOLDERID_Recent) {
            Some(dir) => PathBuf::from(dir),
            None => return Vec::new(),
        };
        let listing = match fs_service::list_dir_std(&recent_dir, fs_service::SortSpec::default()) {
            Ok(listing) => listing,
            Err(_) => return Vec::new(),
        };
        let shortcuts: Vec<(u64, PathBuf)> = listing
            .items
            .into_iter()
            .filter(|entry| {
                entry
                    .path
                    .extension()
                    .map(|e| e.eq_ignore_ascii_case("lnk"))
                    .unwrap_or(false)
            })
            .map(|entry| (entry.modified_unix, entry.path))
            .collect();
        pick_newest_recent(shortcuts, limit, |modified_unix, link| {
            let target = resolve_shortcut(&link)?;
            let metadata = std::fs::metadata(&target).ok()?;
            let kind = if metadata.is_dir() {
                ItemKind::Folder
            } else {
                ItemKind::File
            };
            let name = target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| target.to_string_lossy().into_owned());
            Some(RecentItem {
                name,
                path: target.to_string_lossy().into_owned(),
                kind,
                modified_unix,
                size: if metadata.is_file() {
                    metadata.len()
                } else {
                    0
                },
            })
        })
    }
    #[cfg(not(windows))]
    {
        let _ = limit;
        Vec::new()
    }
}
// Explorer backend helpers tests (Step 02, slice 2).

#[cfg(test)]
mod tests {
    use super::{drive_kind_name, pick_newest_recent, RecentItem};
    use fs_service::ItemKind;

    #[test]
    fn drive_kind_names_cover_windows_drive_types() {
        assert_eq!(drive_kind_name(2), "removable");
        assert_eq!(drive_kind_name(3), "fixed");
        assert_eq!(drive_kind_name(4), "network");
        assert_eq!(drive_kind_name(5), "optical");
        assert_eq!(drive_kind_name(0), "unknown");
        assert_eq!(drive_kind_name(99), "unknown");
    }

    fn recent(name: &str, path: &str, modified: u64) -> RecentItem {
        RecentItem {
            name: name.to_string(),
            path: path.to_string(),
            kind: ItemKind::File,
            modified_unix: modified,
            size: 0,
        }
    }

    #[test]
    fn explorer_item_preserves_flags_and_id() {
        let item = fs_service::Item {
            path: std::path::PathBuf::from("C:\\Temp\\a.txt"),
            name: "a.txt".to_string(),
            kind: ItemKind::File,
            backing: fs_service::BackingKind::Real,
            size: 42,
            modified_unix: 99,
            attrs: fs_service::ItemAttrs {
                hidden: true,
                system: false,
                is_link: false,
                online_only: true,
                // Above 2^53: must survive the trip to JavaScript exactly.
                file_id: Some(u64::MAX - 1),
                file_id_stable: true,
            },
        };
        let dto = super::explorer_item(item);
        assert_eq!(dto.path, "C:\\Temp\\a.txt");
        assert_eq!(dto.size, 42);
        assert!(dto.hidden && dto.online_only);
        assert_eq!(dto.file_id.as_deref(), Some("18446744073709551614"));
        assert!(dto.file_id_stable);
        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains(r#""file_id":"18446744073709551614""#));
    }
    fn as_candidates(items: Vec<RecentItem>) -> Vec<(u64, RecentItem)> {
        items.into_iter().map(|i| (i.modified_unix, i)).collect()
    }

    #[test]
    fn recent_items_are_newest_first_deduped_and_capped() {
        let items = vec![
            recent("a", "C:\\a.txt", 10),
            recent("b", "C:\\b.txt", 30),
            recent("a again", "c:\\A.txt", 20),
            recent("c", "C:\\c.txt", 40),
        ];
        let out = pick_newest_recent(as_candidates(items), 2, |_, i| Some(i));
        assert_eq!(
            out.iter().map(|i| i.path.as_str()).collect::<Vec<_>>(),
            vec!["C:\\c.txt", "C:\\b.txt"]
        );
        // The kept copy of a path is the newest one.
        let out = pick_newest_recent(
            as_candidates(vec![
                recent("old", "C:\\a.txt", 10),
                recent("new", "c:\\A.txt", 20),
            ]),
            10,
            |_, i| Some(i),
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "new");
    }

    #[test]
    fn recent_items_stop_resolving_once_the_limit_is_reached() {
        // 5,000 shortcuts, one dead target among the newest: only enough
        // to fill the limit (plus the skipped one) may be resolved.
        let candidates: Vec<(u64, u64)> = (0..5000u64).map(|n| (n, n)).collect();
        let mut resolved = 0;
        let out = pick_newest_recent(candidates, 30, |modified, n| {
            resolved += 1;
            if n == 4990 {
                return None;
            }
            Some(recent("x", &format!("C:\\{n}.txt"), modified))
        });
        assert_eq!(out.len(), 30);
        assert_eq!(out[0].path, "C:\\4999.txt");
        assert_eq!(resolved, 31);
    }
}
