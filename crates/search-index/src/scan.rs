//! Bounded root traversal. Two workers list folders; the caller's thread
//! writes batches of at most 256 records. Reparse folders are never followed,
//! visited file identities stop loops, access-denied entries are counted and
//! the scan continues, and online-only files never reach a content extractor.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::source_stamp::{capture_file_identity, capture_source_stamp, FileIdentityKey};
use fs_service::{list_dir_cancellable, CancellationToken, Item, ItemKind, SortSpec};

use crate::content_extractors::ContentExtractorRegistry;
use crate::limits::{
    path_is_under, path_key, COMMIT_BATCH_MS, COMMIT_BATCH_RECORDS, MAX_CONTENT_INPUT_BYTES,
    MAX_SCAN_DEPTH, OCR_FILES_PER_SESSION, SCAN_QUEUE, SCAN_WORKERS,
};
use crate::store::{BatchReport, SearchStore};
use crate::types::{ExtractedText, ExtractionCoverage, ExtractorRequest, IndexRoot, ScannedFile};
use crate::SearchError;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub content_max_chars: u32,
    pub excluded_paths: Vec<String>,
    /// 09k's sensitive virtual sources and any other caller-denied subtrees.
    pub denied_roots: Vec<String>,
    /// Explicit per-root OCR consent is still required in addition to this.
    pub ocr_allowed: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            content_max_chars: crate::limits::MAX_EXTRACTED_CHARS as u32,
            excluded_paths: Vec::new(),
            denied_roots: Vec::new(),
            ocr_allowed: false,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ScanReport {
    pub scanned: u64,
    pub inserted: u64,
    pub updated: u64,
    pub unchanged: u64,
    pub skipped: u32,
    pub ocr_files: u32,
    pub limit_reached: bool,
    pub cancelled: bool,
    pub errors: Vec<String>,
}

#[derive(Debug)]
struct WorkItem {
    path: PathBuf,
    depth: usize,
}

#[allow(clippy::large_enum_variant)]
enum ScanMessage {
    Entry(Box<ScannedFile>, Option<ExtractedText>),
    Skipped,
    Error(String),
}

type Queue = Arc<(Mutex<VecDeque<WorkItem>>, Condvar)>;

/// Identical access failures collapse to one skipped count; only the first
/// few distinct messages are kept in the report.
const MAX_SCAN_ERRORS: usize = 16;

/// Scan one root into the index. The caller supplies the registry so 07d,
/// 07e and 13 adapters are used exactly as registered.
pub fn scan_root(
    store: &mut SearchStore,
    root: &IndexRoot,
    options: &ScanOptions,
    registry: &ContentExtractorRegistry,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(u64),
) -> ScanReport {
    let mut report = ScanReport::default();
    if root.validate().is_err() {
        report.errors.push("search.invalid".to_string());
        return report;
    }
    if !root.enabled || !root.filename {
        return report;
    }
    let queue: Queue = Arc::new((
        Mutex::new(VecDeque::from([WorkItem {
            path: PathBuf::from(&root.path),
            depth: 0,
        }])),
        Condvar::new(),
    ));
    let active = Arc::new(AtomicUsize::new(0));
    let visited = Arc::new(Mutex::new(HashSet::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let ocr_budget = Arc::new(AtomicUsize::new(0));
    let ocr_gate = Arc::new(Mutex::new(()));
    let (sender, receiver) = mpsc::sync_channel::<ScanMessage>(SCAN_QUEUE);

    std::thread::scope(|scope| {
        for _ in 0..SCAN_WORKERS {
            let sender = sender.clone();
            let queue = queue.clone();
            let active = active.clone();
            let visited = visited.clone();
            let stop = stop.clone();
            let ocr_budget = ocr_budget.clone();
            let ocr_gate = ocr_gate.clone();
            scope.spawn(move || {
                worker(
                    &queue,
                    &active,
                    &visited,
                    &stop,
                    root,
                    options,
                    registry,
                    cancel,
                    &ocr_budget,
                    &ocr_gate,
                    &sender,
                );
            });
        }
        drop(sender);

        let mut pending: Vec<(ScannedFile, Option<ExtractedText>)> = Vec::new();
        let mut last_flush = Instant::now();
        loop {
            match receiver.recv_timeout(Duration::from_millis(25)) {
                Ok(ScanMessage::Entry(file, content)) => {
                    report.scanned += 1;
                    // `ocr_files` counts OCR extraction, not every content
                    // file; the session budget applies to the same adapters.
                    let resolved = registry.resolve(&file.path);
                    let content_is_ocr =
                        content.is_some() && resolved.is_some_and(|extractor| extractor.is_ocr());
                    if content_is_ocr {
                        report.ocr_files += 1;
                    }
                    pending.push((*file, content));
                }
                Ok(ScanMessage::Skipped) => report.skipped = report.skipped.saturating_add(1),
                Ok(ScanMessage::Error(error)) => {
                    // Keep the report bounded even when a whole volume is
                    // inaccessible; the skipped counter still counts them all.
                    if report.errors.len() < MAX_SCAN_ERRORS {
                        report.errors.push(error);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            let due = pending.len() >= COMMIT_BATCH_RECORDS
                || (!pending.is_empty()
                    && last_flush.elapsed() >= Duration::from_millis(COMMIT_BATCH_MS));
            if due {
                flush(store, root, &mut pending, &mut report, &stop);
                last_flush = Instant::now();
                progress(report.scanned);
            }
            if stop.load(Ordering::Relaxed) {
                break;
            }
        }
        if !pending.is_empty() {
            flush(store, root, &mut pending, &mut report, &stop);
        }
        progress(report.scanned);
        if cancel.load(Ordering::Relaxed) {
            report.cancelled = true;
        }
    });
    report
}

fn flush(
    store: &mut SearchStore,
    root: &IndexRoot,
    pending: &mut Vec<(ScannedFile, Option<ExtractedText>)>,
    report: &mut ScanReport,
    stop: &AtomicBool,
) {
    if pending.is_empty() {
        return;
    }
    match store.apply_batch(&root.id, pending) {
        Ok(batch) => {
            report.inserted += batch.inserted;
            report.updated += batch.updated;
            report.unchanged += batch.unchanged;
            if batch.limit_reached {
                report.limit_reached = true;
                stop.store(true, Ordering::Relaxed);
            }
        }
        Err(error) => {
            report.errors.push(error.code().to_string());
            stop.store(true, Ordering::Relaxed);
        }
    }
    pending.clear();
}

#[allow(clippy::too_many_arguments)]
fn worker(
    queue: &Queue,
    active: &AtomicUsize,
    visited: &Mutex<HashSet<String>>,
    stop: &AtomicBool,
    root: &IndexRoot,
    options: &ScanOptions,
    registry: &ContentExtractorRegistry,
    cancel: &CancellationToken,
    ocr_budget: &AtomicUsize,
    ocr_gate: &Mutex<()>,
    sender: &mpsc::SyncSender<ScanMessage>,
) {
    let mut local: Vec<WorkItem> = Vec::new();
    loop {
        if stop.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
            break;
        }
        let item = if let Some(item) = local.pop() {
            item
        } else {
            let mut guard = match queue.0.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };
            loop {
                if let Some(item) = guard.pop_front() {
                    break item;
                }
                if active.load(Ordering::SeqCst) == 0 {
                    return;
                }
                guard = match queue.1.wait_timeout(guard, Duration::from_millis(50)) {
                    Ok((guard, _)) => guard,
                    Err(_) => return,
                };
            }
        };
        active.fetch_add(1, Ordering::SeqCst);
        process_dir(
            &item, queue, &mut local, visited, stop, root, options, registry, cancel, ocr_budget,
            ocr_gate, sender,
        );
        active.fetch_sub(1, Ordering::SeqCst);
        queue.1.notify_all();
    }
}

#[allow(clippy::too_many_arguments)]
fn process_dir(
    item: &WorkItem,
    queue: &Queue,
    local: &mut Vec<WorkItem>,
    visited: &Mutex<HashSet<String>>,
    stop: &AtomicBool,
    root: &IndexRoot,
    options: &ScanOptions,
    registry: &ContentExtractorRegistry,
    cancel: &CancellationToken,
    ocr_budget: &AtomicUsize,
    ocr_gate: &Mutex<()>,
    sender: &mpsc::SyncSender<ScanMessage>,
) {
    if item.depth > MAX_SCAN_DEPTH {
        let _ = sender.send(ScanMessage::Skipped);
        return;
    }
    if is_excluded(&item.path, options) {
        let _ = sender.send(ScanMessage::Skipped);
        return;
    }
    if !mark_visited(visited, &item.path) {
        return;
    }
    let listing = match list_dir_cancellable(&item.path, SortSpec::default(), cancel) {
        Ok(listing) => listing,
        Err(_) => {
            // A cancelled listing is not a denied folder; the worker loop
            // stops on the token without reporting an error.
            if !cancel.load(Ordering::Relaxed) {
                let _ = sender.send(ScanMessage::Error("search.denied".to_string()));
                let _ = sender.send(ScanMessage::Skipped);
            }
            return;
        }
    };
    for _ in &listing.skipped {
        let _ = sender.send(ScanMessage::Skipped);
    }
    for child in listing.items {
        if stop.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
            return;
        }
        match child.kind {
            ItemKind::Folder => {
                if child.attrs.is_link || is_excluded(&child.path, options) {
                    let _ = sender.send(ScanMessage::Skipped);
                    continue;
                }
                let next = WorkItem {
                    path: child.path,
                    depth: item.depth + 1,
                };
                push_work(queue, local, next);
            }
            ItemKind::File => {
                if is_excluded(&child.path, options) {
                    let _ = sender.send(ScanMessage::Skipped);
                    continue;
                }
                let file = match file_from_item(&child) {
                    Ok(file) => file,
                    Err(_) => {
                        let _ = sender.send(ScanMessage::Skipped);
                        continue;
                    }
                };
                let content =
                    content_for_index(&file, root, options, registry, cancel, ocr_budget, ocr_gate);
                if sender
                    .send(ScanMessage::Entry(Box::new(file), content))
                    .is_err()
                {
                    return;
                }
            }
            ItemKind::Drive | ItemKind::Other => {
                let _ = sender.send(ScanMessage::Skipped);
            }
        }
    }
}

fn push_work(queue: &Queue, local: &mut Vec<WorkItem>, item: WorkItem) {
    let mut guard = match queue.0.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if guard.len() < SCAN_QUEUE {
        guard.push_back(item);
        queue.1.notify_one();
    } else {
        drop(guard);
        local.push(item);
    }
}

fn mark_visited(visited: &Mutex<HashSet<String>>, path: &Path) -> bool {
    let path = path.to_string_lossy().to_string();
    let identity = capture_file_identity(Path::new(&path)).ok();
    let key = identity
        .as_ref()
        .map(identity_key)
        .unwrap_or_else(|| format!("path:{}", path_key(&path)));
    match visited.lock() {
        Ok(mut visited) => visited.insert(key),
        Err(_) => false,
    }
}

/// Add one identity to the visited set. `false` means the worker already
/// followed this folder through another path (a junction loop).
pub fn first_visit(visited: &mut HashSet<String>, identity: &FileIdentityKey) -> bool {
    visited.insert(identity_key(identity))
}

fn identity_key(identity: &FileIdentityKey) -> String {
    if identity.stable {
        format!("{}:{}", identity.volume_id, identity.file_id)
    } else {
        format!("path:{}", identity.path_key)
    }
}

fn is_excluded(path: &Path, options: &ScanOptions) -> bool {
    let value = path.to_string_lossy();
    options
        .excluded_paths
        .iter()
        .chain(options.denied_roots.iter())
        .any(|root| path_is_under(&value, root))
}

pub fn file_from_item(item: &Item) -> Result<ScannedFile, SearchError> {
    let identity = capture_file_identity(&item.path).map_err(|_| SearchError::Denied)?;
    let stamp = capture_source_stamp(&item.path).map_err(|_| SearchError::Changed)?;
    let metadata = std::fs::symlink_metadata(&item.path).map_err(|_| SearchError::Denied)?;
    let created_unix = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    let name = item.name.clone();
    let extension = Path::new(&name)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    Ok(ScannedFile {
        identity,
        stamp,
        path: item.path.clone(),
        name,
        extension,
        kind: item.kind,
        size: item.size,
        modified_unix: item.modified_unix,
        created_unix,
        date_taken_unix: None,
        width: None,
        height: None,
        duration_ms: None,
        pages: None,
        author: None,
        hidden: item.attrs.hidden,
        system: item.attrs.system,
        is_link: item.attrs.is_link,
        online_only: item.attrs.online_only,
    })
}

/// One watched file, through the same limits and consent as a full scan.
pub fn scan_one(
    store: &mut SearchStore,
    root: &IndexRoot,
    path: &Path,
    options: &ScanOptions,
    registry: &ContentExtractorRegistry,
    cancel: &CancellationToken,
) -> Result<BatchReport, SearchError> {
    if is_excluded(path, options) {
        return Ok(BatchReport::default());
    }
    if !path_is_under(&path.to_string_lossy(), &root.path) {
        return Err(SearchError::Denied);
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| SearchError::Denied)?;
    if !metadata.is_file() {
        return Err(SearchError::Invalid);
    }
    let item = Item {
        path: path.to_path_buf(),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .ok_or(SearchError::Invalid)?,
        kind: ItemKind::File,
        backing: fs_service::BackingKind::Real,
        size: metadata.len(),
        modified_unix: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|age| age.as_secs())
            .unwrap_or(0),
        attrs: item_attrs(&metadata),
    };
    let file = file_from_item(&item)?;
    let budget = AtomicUsize::new(0);
    let gate = Mutex::new(());
    let content = content_for_index(&file, root, options, registry, cancel, &budget, &gate);
    store.apply_batch(&root.id, &[(file, content)])
}

fn item_attrs(metadata: &std::fs::Metadata) -> fs_service::ItemAttrs {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        const REPARSE: u32 = 0x400;
        const OFFLINE: u32 = 0x1000;
        const RECALL_ON_OPEN: u32 = 0x0004_0000;
        const RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
        let attributes = metadata.file_attributes();
        fs_service::ItemAttrs {
            hidden: attributes & HIDDEN != 0,
            system: attributes & SYSTEM != 0,
            is_link: attributes & REPARSE != 0,
            online_only: attributes & (OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0,
            file_id: None,
            file_id_stable: false,
        }
    }
    #[cfg(not(windows))]
    {
        fs_service::ItemAttrs {
            is_link: metadata.file_type().is_symlink(),
            ..fs_service::ItemAttrs::default()
        }
    }
}

/// Bounded content extraction for one file. Returns `None` when the root did
/// not consent, the file is online-only, no adapter claims the format, or the
/// OCR budget is exhausted.
pub fn content_for_index(
    file: &ScannedFile,
    root: &IndexRoot,
    options: &ScanOptions,
    registry: &ContentExtractorRegistry,
    cancel: &CancellationToken,
    ocr_budget: &AtomicUsize,
    ocr_gate: &Mutex<()>,
) -> Option<ExtractedText> {
    if !root.content || file.online_only || file.is_link || file.size > MAX_CONTENT_INPUT_BYTES {
        return None;
    }
    if is_excluded(&file.path, options) {
        return None;
    }
    let extractor = registry.resolve(&file.path)?;
    if extractor.is_ocr() {
        if !options.ocr_allowed || !root.ocr {
            return None;
        }
        if ocr_budget.fetch_add(1, Ordering::SeqCst) >= OCR_FILES_PER_SESSION {
            return None;
        }
    }
    let _ocr_guard = if extractor.is_ocr() {
        match ocr_gate.lock() {
            Ok(guard) => Some(guard),
            Err(_) => return None,
        }
    } else {
        None
    };
    let source = SourceIdentity::capture(&file.path).ok()?;
    // Indexing is background work: open with the no-recall policy so a
    // placeholder that became online-only after enumeration can never be
    // hydrated by a content read.
    let pinned = PinnedSource::open_background(&file.path, &source).ok()?;
    let request = ExtractorRequest {
        path: file.path.clone(),
        stamp: file.stamp.clone(),
        max_chars: options.content_max_chars,
        deadline: Instant::now() + Duration::from_secs(30),
        pinned: Arc::new(pinned),
    };
    let extracted = extractor.extract(&request, cancel).ok()?;
    if extracted.validate().is_err() {
        return None;
    }
    if extracted.coverage == ExtractionCoverage::Unsupported {
        return None;
    }
    Some(extracted)
}

#[cfg(test)]
mod tests {
    use super::{content_for_index, is_excluded, mark_visited, ScanOptions};
    use crate::content_extractors::{ContentExtractor, ContentExtractorRegistry};
    use crate::types::{
        ExtractedText, ExtractionCoverage, ExtractorRequest, IndexRoot, ScannedFile, SourceStamp,
    };
    use fs_service::new_cancellation_token;
    use fs_service::source_stamp::FileIdentityKey;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    struct Counting {
        id: &'static str,
        ocr: bool,
        calls: Arc<AtomicUsize>,
    }

    impl ContentExtractor for Counting {
        fn id(&self) -> &'static str {
            self.id
        }
        fn extensions(&self) -> &'static [&'static str] {
            if self.ocr {
                &["png"]
            } else {
                &["txt"]
            }
        }
        fn extract(
            &self,
            _request: &ExtractorRequest,
            _cancel: &fs_service::CancellationToken,
        ) -> Result<ExtractedText, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(ExtractedText {
                text: "alpha".to_string(),
                truncated: false,
                coverage: ExtractionCoverage::Complete,
                metadata: Vec::new(),
            })
        }
        fn is_ocr(&self) -> bool {
            self.ocr
        }
    }

    fn file(path: &str, online_only: bool) -> ScannedFile {
        ScannedFile {
            identity: FileIdentityKey {
                volume_id: "00000000".to_string(),
                file_id: "0000000000000000".to_string(),
                path_key: path.to_lowercase(),
                stable: false,
            },
            stamp: SourceStamp {
                path_key: path.to_lowercase(),
                volume_id: "00000000".to_string(),
                file_id: "0000000000000000".to_string(),
                modified_ticks: "0".to_string(),
                size_bytes: 0,
            },
            path: std::path::PathBuf::from(path),
            name: path.rsplit('\\').next().unwrap_or(path).to_string(),
            extension: std::path::Path::new(path)
                .extension()
                .map(|value| value.to_string_lossy().to_lowercase())
                .unwrap_or_default(),
            kind: fs_service::ItemKind::File,
            size: 1,
            modified_unix: 0,
            created_unix: 0,
            date_taken_unix: None,
            width: None,
            height: None,
            duration_ms: None,
            pages: None,
            author: None,
            hidden: false,
            system: false,
            is_link: false,
            online_only,
        }
    }

    #[test]
    fn online_only_reaches_no_extractor() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut registry = ContentExtractorRegistry::default();
        registry
            .register(
                "text",
                &["txt"],
                Arc::new(Counting {
                    id: "text",
                    ocr: false,
                    calls: calls.clone(),
                }),
            )
            .unwrap();
        let root = IndexRoot {
            content: true,
            ..IndexRoot::new(r"C:\Docs")
        };
        let result = content_for_index(
            &file(r"C:\Docs\cloud.txt", true),
            &root,
            &ScanOptions::default(),
            &registry,
            &new_cancellation_token(),
            &AtomicUsize::new(0),
            &Mutex::new(()),
        );
        assert!(result.is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn ocr_off_makes_zero_ocr_calls() {
        let text_calls = Arc::new(AtomicUsize::new(0));
        let ocr_calls = Arc::new(AtomicUsize::new(0));
        let mut registry = ContentExtractorRegistry::default();
        registry
            .register(
                "text",
                &["txt"],
                Arc::new(Counting {
                    id: "text",
                    ocr: false,
                    calls: text_calls.clone(),
                }),
            )
            .unwrap();
        registry
            .register_with_kind(
                "ocr",
                &["png"],
                true,
                Arc::new(Counting {
                    id: "ocr",
                    ocr: true,
                    calls: ocr_calls.clone(),
                }),
            )
            .unwrap();
        let root = IndexRoot {
            content: true,
            ocr: false,
            ..IndexRoot::new(r"C:\Docs")
        };
        let result = content_for_index(
            &file(r"C:\Docs\scan.png", false),
            &root,
            &ScanOptions::default(),
            &registry,
            &new_cancellation_token(),
            &AtomicUsize::new(0),
            &Mutex::new(()),
        );
        assert!(result.is_none());
        assert_eq!(ocr_calls.load(Ordering::SeqCst), 0);
        assert_eq!(text_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_ocr_budget_stops_at_one_hundred_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("scan.png");
        std::fs::write(&path, [7u8]).unwrap();
        let ocr_calls = Arc::new(AtomicUsize::new(0));
        let mut registry = ContentExtractorRegistry::default();
        registry
            .register_with_kind(
                "ocr",
                &["png"],
                true,
                Arc::new(Counting {
                    id: "ocr",
                    ocr: true,
                    calls: ocr_calls.clone(),
                }),
            )
            .unwrap();
        let root = IndexRoot {
            content: true,
            ocr: true,
            ..IndexRoot::new(directory.path().to_string_lossy().to_string())
        };
        let options = ScanOptions {
            ocr_allowed: true,
            ..ScanOptions::default()
        };
        let budget = AtomicUsize::new(0);
        let gate = Mutex::new(());
        let scanned = file(&path.to_string_lossy(), false);
        for _ in 0..101 {
            let _ = content_for_index(
                &scanned,
                &root,
                &options,
                &registry,
                &new_cancellation_token(),
                &budget,
                &gate,
            );
        }
        assert_eq!(ocr_calls.load(Ordering::SeqCst), 100);
    }

    #[test]
    fn a_denied_virtual_root_is_never_extracted() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut registry = ContentExtractorRegistry::default();
        registry
            .register(
                "text",
                &["txt"],
                Arc::new(Counting {
                    id: "text",
                    ocr: false,
                    calls: calls.clone(),
                }),
            )
            .unwrap();
        let root = IndexRoot {
            content: true,
            ..IndexRoot::new(r"C:\Docs")
        };
        let options = ScanOptions {
            denied_roots: vec![r"C:\Docs\Secret".to_string()],
            ..ScanOptions::default()
        };
        let result = content_for_index(
            &file(r"C:\Docs\Secret\a.txt", false),
            &root,
            &options,
            &registry,
            &new_cancellation_token(),
            &AtomicUsize::new(0),
            &Mutex::new(()),
        );
        assert!(result.is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(is_excluded(
            std::path::Path::new(r"C:\Docs\Secret\a.txt"),
            &options
        ));
    }

    #[test]
    fn a_visited_identity_is_not_followed_twice() {
        let visited = Mutex::new(HashSet::new());
        let path = std::path::Path::new(r"C:\Docs\folder");
        assert!(mark_visited(&visited, path));
        assert!(!mark_visited(&visited, path));
    }
}
