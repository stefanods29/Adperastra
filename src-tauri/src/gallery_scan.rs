//! Bounded, deduplicated Gallery discovery (Step 07c, decisions D3/D4).
//!
//! The scan is breadth-first from the authorized roots. Two directory workers
//! at most list folders through the existing attribute-only fs-service
//! enumeration, so online-only candidates are visible without any content
//! read. A visited set of stable identities stops loops, reparse directories
//! are never followed, and every bound (folders, depth, items) produces an
//! honest `partial` page instead of silently claiming complete coverage.

use crate::gallery_types::{
    gallery_path_key, volume_key, GalleryDateSource, GalleryItem, GallerySource,
};
use fs_service::{CancellationToken, Item, ItemKind, Listing, SortSpec};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

/// At most two directory workers (decision D4).
pub const MAX_SCAN_WORKERS: usize = 2;
/// At most 256 folders waiting to be listed.
pub const MAX_SCAN_FOLDERS: usize = 256;
/// Do not descend past this folder depth.
pub const MAX_SCAN_DEPTH: u32 = 64;
/// At most this many picture candidates are kept.
pub const MAX_SCAN_ITEMS: usize = 250_000;
/// The picture types of the current image handler that the 07a WIC helper can
/// decode. SVG/AVIF have no local thumbnail decoder yet; TIFF is decoded by
/// 07a but is not an image-handler extension, so it opens in its Windows app.
pub const GALLERY_IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "gif", "bmp", "webp", "ico", "tif", "tiff",
];

/// How one scan is bounded and filtered.
#[derive(Debug, Clone)]
pub struct GalleryScanConfig {
    pub workers: usize,
    pub max_folders: usize,
    pub max_depth: u32,
    pub max_items: usize,
    pub show_hidden: bool,
    pub show_system: bool,
}

impl Default for GalleryScanConfig {
    fn default() -> Self {
        Self {
            workers: MAX_SCAN_WORKERS,
            max_folders: MAX_SCAN_FOLDERS,
            max_depth: MAX_SCAN_DEPTH,
            max_items: MAX_SCAN_ITEMS,
            show_hidden: false,
            show_system: false,
        }
    }
}

/// True for the extensions the image handler and the 07a decoder share.
pub fn is_picture_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            GALLERY_IMAGE_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

/// Stable identity for deduplication: volume + file id when the listing says
/// it is stable, otherwise the normalized path.
pub fn gallery_identity(item: &Item) -> String {
    if item.attrs.file_id_stable {
        if let Some(id) = item.attrs.file_id {
            let volume = volume_key(&item.path);
            return format!(
                "{volume}:{id:016x}:{}",
                gallery_path_key(item.path.to_string_lossy().as_ref())
            );
        }
    }
    let path_key = gallery_path_key(item.path.to_string_lossy().as_ref());
    format!("path:{path_key}")
}

/// What the scan found and whether it was cut short.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanOutcome {
    pub complete: bool,
    pub partial: bool,
    pub skipped_count: u32,
    pub limit_reason: Option<String>,
}

/// The directory source is injectable so orchestration tests never touch disk.
pub trait GalleryLister: Send + Sync {
    fn list(&self, path: &Path, token: &CancellationToken) -> Result<Listing, String>;
    fn is_reparse_dir(&self, item: &Item) -> bool;
    fn accepts_picture(&self, _item: &Item) -> Result<bool, String> {
        Ok(true)
    }
}

/// The real lister: attribute-only enumeration with file IDs, cancellable
/// between directory buffers (U5/U8).
pub struct SystemGalleryLister;

impl SystemGalleryLister {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemGalleryLister {
    fn default() -> Self {
        Self::new()
    }
}

impl GalleryLister for SystemGalleryLister {
    fn list(&self, path: &Path, token: &CancellationToken) -> Result<Listing, String> {
        let _guard = crate::gallery_source::guard_directory(path)?;
        fs_service::list_dir_cancellable(path, SortSpec::default(), token)
            .map_err(|_| "gallery.unavailable".to_string())
    }

    fn accepts_picture(&self, item: &Item) -> Result<bool, String> {
        crate::gallery_source::accepts_picture(item)
    }

    fn is_reparse_dir(&self, item: &Item) -> bool {
        if item.attrs.is_link {
            return true;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
            // Attribute-only metadata: no file content is opened.
            if let Ok(metadata) = std::fs::symlink_metadata(&item.path) {
                return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
            }
        }
        false
    }
}

#[derive(Debug)]
struct ScanState {
    items: Vec<GalleryItem>,
    by_identity: HashMap<String, usize>,
    needs_sort: bool,
    sorted_for: Option<GalleryDateSource>,
    complete: bool,
    partial: bool,
    skipped_count: u32,
    limit_reason: Option<String>,
    start_error: Option<String>,
}

/// The in-memory result of one scan. The scanner appends; page requests sort
/// once and read a bounded slice while holding the lock only for that slice.
pub struct GalleryScanShared {
    state: Mutex<ScanState>,
    changed: Condvar,
}

impl GalleryScanShared {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(ScanState {
                items: Vec::new(),
                by_identity: HashMap::new(),
                needs_sort: false,
                sorted_for: None,
                complete: false,
                partial: false,
                skipped_count: 0,
                limit_reason: None,
                start_error: None,
            }),
            changed: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, ScanState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn ensure_sorted(&self, state: &mut ScanState, date_source: GalleryDateSource) {
        if !state.needs_sort && state.sorted_for == Some(date_source) {
            return;
        }
        crate::gallery_order::sort_gallery_items(&mut state.items, date_source);
        state.by_identity = state
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| (item.identity.clone(), index))
            .collect();
        state.needs_sort = false;
        state.sorted_for = Some(date_source);
    }

    pub fn add_items(&self, items: Vec<GalleryItem>) {
        let mut state = self.lock();
        for item in items {
            let existing_index = state.by_identity.get(&item.identity).copied();
            if let Some(existing) = existing_index.and_then(|index| state.items.get_mut(index)) {
                for id in item.source_ids {
                    if existing.source_ids.len() < crate::gallery_types::MAX_GALLERY_SOURCE_IDS
                        && !existing.source_ids.contains(&id)
                    {
                        existing.source_ids.push(id);
                    }
                }
                continue;
            }
            let index = state.items.len();
            state.by_identity.insert(item.identity.clone(), index);
            state.items.push(item);
        }
        state.needs_sort = true;
        drop(state);
        self.changed.notify_all();
    }

    pub fn finish(&self, outcome: ScanOutcome) {
        let mut state = self.lock();
        state.complete = outcome.complete;
        state.partial = outcome.partial;
        state.skipped_count = outcome.skipped_count;
        state.limit_reason = outcome.limit_reason;
        drop(state);
        self.changed.notify_all();
    }

    pub fn set_start_error(&self, code: String) {
        let mut state = self.lock();
        state.start_error = Some(code);
        state.complete = true;
        drop(state);
        self.changed.notify_all();
    }

    pub fn start_error(&self) -> Option<String> {
        self.lock().start_error.clone()
    }

    pub fn count(&self) -> usize {
        self.lock().items.len()
    }

    pub fn is_complete(&self) -> bool {
        self.lock().complete
    }

    /// The current completion/partial flags, for the first page and the
    /// `gallery-scan-finished` event.
    pub fn flags(&self) -> (bool, bool, u32, Option<String>) {
        let state = self.lock();
        (
            state.complete,
            state.partial,
            state.skipped_count,
            state.limit_reason.clone(),
        )
    }

    /// Waits until the scanner published something, finished or errored.
    pub fn wait_changed(&self, timeout: Duration) {
        let state = self.lock();
        drop(self.changed.wait_timeout(state, timeout));
    }

    pub fn snapshot(&self, date_source: GalleryDateSource) -> Vec<GalleryItem> {
        let mut state = self.lock();
        self.ensure_sorted(&mut state, date_source);
        state.items.clone()
    }

    /// Reads one bounded slice. The first item is always included even when
    /// it alone exceeds `max_bytes`, so a path is never silently truncated.
    #[cfg(test)]
    pub fn page(
        &self,
        start: usize,
        max_rows: usize,
        max_bytes: usize,
        date_source: GalleryDateSource,
    ) -> crate::gallery_pages::PageData {
        let mut state = self.lock();
        self.ensure_sorted(&mut state, date_source);
        let mut items = Vec::new();
        let mut bytes = 0usize;
        let mut index = start;
        while index < state.items.len() && items.len() < max_rows {
            let item = &state.items[index];
            let size = serde_json::to_vec(item)
                .map(|bytes| bytes.len())
                .unwrap_or(0);
            if !items.is_empty() && bytes + size > max_bytes {
                break;
            }
            bytes += size;
            items.push(item.clone());
            index += 1;
        }
        crate::gallery_pages::PageData {
            items,
            next: index,
            total: state.items.len(),
            complete: state.complete,
            partial: state.partial,
            skipped_count: state.skipped_count,
            limit_reason: state.limit_reason.clone(),
        }
    }
}

impl Default for GalleryScanShared {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Breadth-first bounded scan
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct ScanTask {
    path: PathBuf,
    depth: u32,
    source_ids: Vec<String>,
    descend: bool,
}

#[derive(Debug)]
struct FrontierState {
    queue: VecDeque<ScanTask>,
    root_ids: HashMap<String, Vec<String>>,
    visited: HashSet<String>,
    active: usize,
    stop: bool,
    discovered: usize,
    candidates: HashSet<String>,
    skipped: u32,
    partial: bool,
    limit_reason: Option<String>,
    access_errors: Vec<String>,
}

struct Frontier {
    state: Mutex<FrontierState>,
    wake: Condvar,
    config: GalleryScanConfig,
}

impl Frontier {
    fn new(
        seeds: Vec<ScanTask>,
        root_ids: HashMap<String, Vec<String>>,
        config: GalleryScanConfig,
    ) -> Self {
        let mut visited = HashSet::new();
        for seed in &seeds {
            visited.insert(gallery_path_key(seed.path.to_string_lossy().as_ref()));
        }
        Self {
            state: Mutex::new(FrontierState {
                queue: seeds.into_iter().collect(),
                root_ids,
                visited,
                active: 0,
                stop: false,
                discovered: 0,
                candidates: HashSet::new(),
                skipped: 0,
                partial: false,
                limit_reason: None,
                access_errors: Vec::new(),
            }),
            wake: Condvar::new(),
            config,
        }
    }

    fn lock(&self) -> MutexGuard<'_, FrontierState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn next_task(&self, token: &CancellationToken) -> Option<ScanTask> {
        let mut state = self.lock();
        loop {
            if state.stop || token.load(Ordering::Relaxed) {
                return None;
            }
            if let Some(task) = state.queue.pop_front() {
                state.active += 1;
                return Some(task);
            }
            if state.active == 0 {
                return None;
            }
            state = self
                .wake
                .wait_timeout(state, Duration::from_millis(50))
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    fn complete_task(&self) {
        let mut state = self.lock();
        state.active = state.active.saturating_sub(1);
        drop(state);
        self.wake.notify_all();
    }

    fn visit_folder(&self, identity: &str) -> bool {
        self.lock().visited.insert(identity.to_string())
    }

    fn is_source_root(&self, key: &str) -> bool {
        self.lock().root_ids.contains_key(key)
    }

    fn set_limit(&self, state: &mut FrontierState, reason: &str) {
        if state.limit_reason.is_none() || state.limit_reason.as_deref() == Some("access") {
            state.limit_reason = Some(reason.to_string());
        }
    }

    fn count_candidate(&self, identity: &str) -> bool {
        let mut state = self.lock();
        if state.candidates.contains(identity) {
            return true;
        }
        if state.discovered >= self.config.max_items {
            state.stop = true;
            state.partial = true;
            state.skipped = state.skipped.saturating_add(1);
            self.set_limit(&mut state, "items");
            return false;
        }
        state.discovered += 1;
        state.candidates.insert(identity.to_string());
        true
    }

    fn push_folder(&self, task: ScanTask) {
        let mut state = self.lock();
        if state.stop {
            state.skipped = state.skipped.saturating_add(1);
            return;
        }
        if task.depth > self.config.max_depth {
            state.partial = true;
            state.skipped = state.skipped.saturating_add(1);
            self.set_limit(&mut state, "depth");
            return;
        }
        if state.queue.len() >= self.config.max_folders {
            state.partial = true;
            state.skipped = state.skipped.saturating_add(1);
            self.set_limit(&mut state, "folders");
            return;
        }
        state.queue.push_back(task);
        drop(state);
        self.wake.notify_all();
    }

    fn access_error(&self, path: &Path, message: String) {
        let mut state = self.lock();
        state.partial = true;
        state.skipped = state.skipped.saturating_add(1);
        let display = path.display();
        if state.access_errors.len() < 32 {
            state.access_errors.push(format!("{display}: {message}"));
        }
        if state.limit_reason.is_none() {
            state.limit_reason = Some("access".to_string());
        }
    }

    fn outcome(&self, complete: bool) -> ScanOutcome {
        let state = self.lock();
        ScanOutcome {
            complete,
            partial: state.partial || !state.access_errors.is_empty(),
            skipped_count: state.skipped,
            limit_reason: state.limit_reason.clone(),
        }
    }
}

fn worker_loop(
    frontier: Arc<Frontier>,
    lister: Arc<dyn GalleryLister>,
    token: CancellationToken,
    sink: Arc<GalleryScanShared>,
) {
    while let Some(task) = frontier.next_task(&token) {
        if token.load(Ordering::Relaxed) {
            frontier.complete_task();
            break;
        }
        match lister.list(&task.path, &token) {
            Ok(listing) => {
                // Entries the listing could not read are reported, not hidden
                // (R-FS-6): the folder continues and the page says how many.
                for issue in &listing.skipped {
                    frontier.access_error(&issue.path, issue.message.clone());
                }
                let mut found = Vec::new();
                for item in listing.items {
                    let is_hidden = (item.attrs.hidden && !frontier.config.show_hidden)
                        || (item.attrs.system && !frontier.config.show_system);
                    match item.kind {
                        ItemKind::Folder => {
                            if !task.descend || lister.is_reparse_dir(&item) {
                                continue;
                            }
                            // An explicitly chosen source root is traversed
                            // even when it is hidden or a system folder; its
                            // own children still follow the view flags.
                            let key = gallery_path_key(item.path.to_string_lossy().as_ref());
                            if is_hidden && !frontier.is_source_root(&key) {
                                continue;
                            }
                            let folder_id = if item.attrs.file_id_stable {
                                item.attrs
                                    .file_id
                                    .map(|id| format!("{}:{id:016x}", volume_key(&item.path)))
                                    .unwrap_or_else(|| key.clone())
                            } else {
                                key.clone()
                            };
                            let identity = format!("{}:{folder_id}", task.source_ids.join(","));
                            if !frontier.visit_folder(&identity) {
                                continue;
                            }
                            frontier.push_folder(ScanTask {
                                path: item.path,
                                depth: task.depth + 1,
                                source_ids: task.source_ids.clone(),
                                descend: true,
                            });
                        }
                        ItemKind::File => {
                            if is_hidden {
                                continue;
                            }
                            if !is_picture_path(&item.path)
                                || !frontier.count_candidate(&gallery_identity(&item))
                            {
                                continue;
                            }
                            match if item.attrs.online_only {
                                Ok(true)
                            } else {
                                lister.accepts_picture(&item)
                            } {
                                Ok(true) => {}
                                Ok(false) => continue,
                                Err(code) => {
                                    frontier.access_error(&item.path, code);
                                    continue;
                                }
                            }
                            found.push(GalleryItem {
                                identity: gallery_identity(&item),
                                group_key: crate::gallery_order::gallery_group_key(
                                    None,
                                    item.modified_unix,
                                    GalleryDateSource::Modified,
                                ),
                                item: crate::explorer::explorer_item(item),
                                taken_utc: None,
                                source_ids: task.source_ids.clone(),
                            });
                        }
                        _ => {}
                    }
                }
                if !found.is_empty() {
                    sink.add_items(found);
                }
            }
            Err(message) => frontier.access_error(&task.path, message),
        }
        frontier.complete_task();
    }
}

/// Runs the scan to completion (or cancellation) and fills `sink`.
pub fn run_scan(
    sources: &[GallerySource],
    config: &GalleryScanConfig,
    lister: Arc<dyn GalleryLister>,
    token: CancellationToken,
    sink: Arc<GalleryScanShared>,
) {
    let mut root_ids: HashMap<String, Vec<String>> = HashMap::new();
    for source in sources {
        root_ids
            .entry(gallery_path_key(source.path.as_str()))
            .or_default()
            .push(source.id.clone());
    }
    let seeds = sources
        .iter()
        .map(|source| ScanTask {
            path: PathBuf::from(&source.path),
            depth: 0,
            source_ids: vec![source.id.clone()],
            descend: source.recursive,
        })
        .collect();
    let frontier = Arc::new(Frontier::new(seeds, root_ids, config.clone()));
    let workers = config.workers.clamp(1, MAX_SCAN_WORKERS);
    let mut handles = Vec::with_capacity(workers);
    for _ in 0..workers {
        let frontier = frontier.clone();
        let lister = lister.clone();
        let token = token.clone();
        let sink = sink.clone();
        handles.push(std::thread::spawn(move || {
            worker_loop(frontier, lister, token, sink);
        }));
    }
    for handle in handles {
        if handle.join().is_err() {
            frontier.access_error(Path::new(""), "gallery.unavailable".into());
        }
    }
    sink.finish(frontier.outcome(!token.load(Ordering::Relaxed)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::{BackingKind, ItemAttrs};
    use std::sync::atomic::AtomicUsize;

    fn source(index: u32, path: &str, recursive: bool) -> GallerySource {
        GallerySource {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            path: path.to_string(),
            recursive,
        }
    }

    fn item(path: &str, id: u64, kind: ItemKind) -> Item {
        Item {
            path: PathBuf::from(path),
            name: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            kind,
            backing: BackingKind::Real,
            size: 1,
            modified_unix: 1_700_000_000,
            attrs: ItemAttrs {
                hidden: false,
                system: false,
                is_link: false,
                online_only: false,
                file_id: Some(id),
                file_id_stable: true,
            },
        }
    }

    fn file(path: &str, id: u64) -> Item {
        item(path, id, ItemKind::File)
    }

    fn folder(path: &str, id: u64) -> Item {
        item(path, id, ItemKind::Folder)
    }

    #[derive(Default)]
    struct FakeLister {
        tree: HashMap<String, Vec<Item>>,
        reparse: HashSet<String>,
        errors: HashSet<String>,
        content_reads: Arc<AtomicUsize>,
    }

    impl GalleryLister for FakeLister {
        fn list(&self, path: &Path, _token: &CancellationToken) -> Result<Listing, String> {
            let key = gallery_path_key(path.to_string_lossy().as_ref());
            if self.errors.contains(&key) {
                return Err("access denied".to_string());
            }
            Ok(Listing {
                path: path.to_path_buf(),
                items: self.tree.get(&key).cloned().unwrap_or_default(),
                skipped: Vec::new(),
            })
        }

        fn accepts_picture(&self, _item: &Item) -> Result<bool, String> {
            self.content_reads.fetch_add(1, Ordering::Relaxed);
            Ok(true)
        }

        fn is_reparse_dir(&self, item: &Item) -> bool {
            self.reparse
                .contains(&gallery_path_key(item.path.to_string_lossy().as_ref()))
        }
    }

    fn scan(
        sources: &[GallerySource],
        lister: FakeLister,
        config: GalleryScanConfig,
    ) -> Arc<GalleryScanShared> {
        let shared = Arc::new(GalleryScanShared::new());
        let token = fs_service::new_cancellation_token();
        run_scan(sources, &config, Arc::new(lister), token, shared.clone());
        shared
    }

    fn default_scan(sources: &[GallerySource], lister: FakeLister) -> Arc<GalleryScanShared> {
        scan(
            sources,
            lister,
            GalleryScanConfig {
                workers: 1,
                ..GalleryScanConfig::default()
            },
        )
    }

    #[test]
    fn overlapping_roots_list_one_file_with_two_source_ids() {
        let mut lister = FakeLister::default();
        lister.tree.insert(
            gallery_path_key("C:\\Pics"),
            vec![file("C:\\Pics\\a.png", 10), folder("C:\\Pics\\sub", 20)],
        );
        lister.tree.insert(
            gallery_path_key("C:\\Pics\\sub"),
            vec![file("C:\\Pics\\sub\\b.png", 30)],
        );
        let shared = default_scan(
            &[
                source(1, "C:\\Pics", true),
                source(2, "C:\\Pics\\sub", true),
            ],
            lister,
        );
        let page = shared.page(
            0,
            crate::gallery_types::MAX_GALLERY_PAGE_ROWS,
            crate::gallery_types::MAX_GALLERY_PAGE_BYTES,
            GalleryDateSource::Modified,
        );
        assert_eq!(page.items.len(), 2);
        let a = page
            .items
            .iter()
            .find(|item| item.item.name == "a.png")
            .unwrap();
        let b = page
            .items
            .iter()
            .find(|item| item.item.name == "b.png")
            .unwrap();
        assert_eq!(a.source_ids.len(), 1);
        assert_eq!(b.source_ids.len(), 2);
        assert!(b.source_ids.contains(&source(2, "x", true).id));
        assert_eq!(shared.count(), 2);
    }

    #[test]
    fn loop_skipped_by_visited_identity() {
        let mut lister = FakeLister::default();
        lister.tree.insert(
            gallery_path_key("C:\\Pics"),
            vec![folder("C:\\Pics\\loop", 99)],
        );
        lister.tree.insert(
            gallery_path_key("C:\\Pics\\loop"),
            vec![
                file("C:\\Pics\\loop\\inside.png", 100),
                folder("C:\\Pics\\loop", 99),
            ],
        );
        let shared = default_scan(&[source(1, "C:\\Pics", true)], lister);
        assert_eq!(shared.count(), 1);
        let loops = shared
            .page(
                0,
                10,
                crate::gallery_types::MAX_GALLERY_PAGE_BYTES,
                GalleryDateSource::Modified,
            )
            .items
            .into_iter()
            .filter(|entry| entry.item.name == "inside.png")
            .count();
        assert_eq!(loops, 1);
    }

    #[test]
    fn online_only_candidate_is_visible_without_content_read() {
        let mut lister = FakeLister::default();
        let reads = lister.content_reads.clone();
        let mut cloud = file("C:\\Pics\\cloud.png", 7);
        cloud.attrs.online_only = true;
        lister
            .tree
            .insert(gallery_path_key("C:\\Pics"), vec![cloud]);
        let shared = default_scan(&[source(1, "C:\\Pics", true)], lister);
        let page = shared.page(
            0,
            crate::gallery_types::MAX_GALLERY_PAGE_ROWS,
            crate::gallery_types::MAX_GALLERY_PAGE_BYTES,
            GalleryDateSource::Modified,
        );
        assert_eq!(page.items.len(), 1);
        assert!(page.items[0].item.online_only);
        assert_eq!(page.items[0].taken_utc, None);
        assert_eq!(
            reads.load(Ordering::Relaxed),
            0,
            "the scan must never read file content"
        );
    }

    #[test]
    fn the_250_001st_candidate_returns_partial_reason_items() {
        let mut lister = FakeLister::default();
        let many: Vec<Item> = (0..250_001u64)
            .map(|index| file(&format!("C:\\Pics\\p{index}.png"), index + 1))
            .collect();
        lister.tree.insert(gallery_path_key("C:\\Pics"), many);
        let shared = default_scan(&[source(1, "C:\\Pics", true)], lister);
        let (complete, partial, skipped, reason) = shared.flags();
        assert!(complete);
        assert!(partial);
        assert_eq!(skipped, 1);
        assert_eq!(reason.as_deref(), Some("items"));
        assert_eq!(shared.count(), MAX_SCAN_ITEMS);
    }

    #[test]
    fn access_error_preserves_the_other_root() {
        let mut lister = FakeLister::default();
        lister.tree.insert(
            gallery_path_key("C:\\Good"),
            vec![file("C:\\Good\\a.png", 1)],
        );
        lister.errors.insert(gallery_path_key("C:\\Bad"));
        let shared = default_scan(
            &[source(1, "C:\\Good", true), source(2, "C:\\Bad", true)],
            lister,
        );
        let page = shared.page(
            0,
            crate::gallery_types::MAX_GALLERY_PAGE_ROWS,
            crate::gallery_types::MAX_GALLERY_PAGE_BYTES,
            GalleryDateSource::Modified,
        );
        assert_eq!(page.items.len(), 1);
        let (_, partial, skipped, reason) = shared.flags();
        assert!(partial);
        assert_eq!(skipped, 1);
        assert_eq!(reason.as_deref(), Some("access"));
    }

    #[test]
    fn byte_limit_stops_without_truncating_a_name() {
        let shared = GalleryScanShared::new();
        let mut items = Vec::new();
        for index in 0..10 {
            let mut entry = crate::gallery_types::GalleryItem {
                item: crate::explorer::explorer_item(file(
                    &format!("C:\\Pics\\p{index}.png"),
                    index + 1,
                )),
                identity: format!("path:c:\\pics\\p{index}.png"),
                taken_utc: None,
                group_key: "2023-11".to_string(),
                source_ids: vec!["00000000-0000-4000-8000-000000000001".to_string()],
            };
            entry.item.name = "x".repeat(400);
            items.push(entry);
        }
        shared.add_items(items);
        let page = shared.page(0, 256, 600, GalleryDateSource::Modified);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].item.name.len(), 400);
        assert_eq!(page.next, 1);
    }
}
