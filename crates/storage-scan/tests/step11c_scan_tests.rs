//! Step 11c T1/T2 scan oracles. Synthetic `ScanIo` fixtures keep cloud
//! placeholders, loops and hard links deterministic; no user file is touched.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use fs_service::FileIdentityKey;
use storage_scan::limits::ScanLimits;
use storage_scan::types::{Coverage, StorageNode, StorageScanRequest, StorageSummary};
use storage_scan::walk::{Inspected, ScanIo};
use storage_scan::{scan_storage_with, ScanRun, ScanSink};

struct FakeEntry {
    info: Inspected,
    children: Vec<PathBuf>,
}

struct FakeIo {
    entries: HashMap<PathBuf, FakeEntry>,
    network: HashSet<PathBuf>,
    content_reads: AtomicU64,
    writes: AtomicU64,
}

impl FakeIo {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            network: HashSet::new(),
            content_reads: AtomicU64::new(0),
            writes: AtomicU64::new(0),
        }
    }

    fn folder(&mut self, path: &str, children: &[&str]) {
        self.entries.insert(
            PathBuf::from(path),
            FakeEntry {
                info: info(path, 0, None, (0, 0), false, false, true),
                children: children.iter().map(PathBuf::from).collect(),
            },
        );
    }

    fn file(
        &mut self,
        path: &str,
        size: u64,
        allocated: Option<u64>,
        identity: (u32, u64),
        online_only: bool,
        hidden: bool,
    ) {
        self.entries.insert(
            PathBuf::from(path),
            FakeEntry {
                info: info(path, size, allocated, identity, online_only, hidden, false),
                children: Vec::new(),
            },
        );
    }
}

fn info(
    path: &str,
    size: u64,
    allocated: Option<u64>,
    identity: (u32, u64),
    online_only: bool,
    hidden: bool,
    is_dir: bool,
) -> Inspected {
    let path_buf = PathBuf::from(path);
    let path_key = path.to_lowercase().replace('/', "\\");
    Inspected {
        path: path_buf,
        name: Path::new(path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string()),
        is_dir,
        is_link: false,
        hidden,
        online_only,
        logical_bytes: size,
        allocated_bytes: allocated,
        key: FileIdentityKey {
            volume_id: format!("{:08x}", identity.0),
            file_id: format!("{:016x}", identity.1),
            path_key,
            stable: identity.0 != 0 && identity.1 != 0,
        },
        modified_unix: 1_700_000_000,
        modified_ticks: 0,
    }
}

impl ScanIo for FakeIo {
    fn is_network(&self, path: &Path) -> bool {
        self.network.contains(path)
    }

    fn read_dir(&self, path: &Path) -> std::io::Result<Vec<PathBuf>> {
        self.entries
            .get(path)
            .map(|entry| entry.children.clone())
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))
    }

    fn inspect(&self, path: &Path) -> std::io::Result<Inspected> {
        self.entries
            .get(path)
            .map(|entry| entry.info.clone())
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))
    }

    fn content_reads(&self) -> u64 {
        self.content_reads.load(Ordering::Relaxed)
    }
}

#[derive(Default)]
struct CollectSink {
    nodes: Vec<StorageNode>,
}

impl ScanSink for CollectSink {
    fn record_node(&mut self, node: StorageNode) -> Result<(), storage_scan::StorageError> {
        self.nodes.push(node);
        Ok(())
    }
}

fn request(root: &str) -> StorageScanRequest {
    StorageScanRequest {
        root: root.to_string(),
        allow_network: false,
        include_hidden: false,
        max_entries: storage_scan::MAX_ENTRIES,
    }
}

fn run() -> ScanRun {
    ScanRun {
        scan_id: "11111111-1111-4111-8111-111111111111".to_string(),
        generation: 7,
    }
}

fn scan(
    io: &FakeIo,
    limits: ScanLimits,
    cancel: Arc<AtomicBool>,
) -> (StorageSummary, Vec<StorageNode>) {
    let mut sink = CollectSink::default();
    let mut progress = |_progress: &fs_service::OpProgress| {};
    let summary = scan_storage_with(
        io,
        &request(r"C:\scan"),
        &run(),
        &mut sink,
        &cancel,
        &mut progress,
        &limits,
    )
    .expect("scan must return a summary");
    (summary, sink.nodes)
}

#[test]
fn cloud_placeholders_cause_zero_content_reads() {
    let mut io = FakeIo::new();
    io.folder(r"C:\scan", &[r"C:\scan\cloud.bin"]);
    io.file(r"C:\scan\cloud.bin", 4096, Some(4096), (1, 11), true, false);
    let cancel = Arc::new(AtomicBool::new(false));
    let (summary, nodes) = scan(&io, ScanLimits::default(), cancel);
    assert_eq!(io.content_reads(), 0);
    let file = nodes.iter().find(|node| node.name == "cloud.bin").unwrap();
    assert!(file.online_only);
    assert_eq!(file.logical_bytes, 4096);
    assert_eq!(summary.logical_bytes, 4096);
    assert_eq!(summary.allocated_unique_bytes, Some(4096));
    assert!(summary.coverage.is_complete());
}

#[test]
fn link_loops_are_skipped() {
    let mut io = FakeIo::new();
    io.folder(r"C:\scan", &[r"C:\scan\a"]);
    io.folder(r"C:\scan\a", &[r"C:\scan"]);
    let cancel = Arc::new(AtomicBool::new(false));
    let (summary, _nodes) = scan(&io, ScanLimits::default(), cancel);
    assert!(summary.coverage == Coverage::Partial);
    assert!(summary.reason_codes.iter().any(|code| code == "loop"));
    assert_eq!(summary.folders_count, 2);
}

#[test]
fn hardlinks_count_logical_twice_and_allocated_once() {
    let mut io = FakeIo::new();
    io.folder(
        r"C:\scan",
        &[
            r"C:\scan\ten.bin",
            r"C:\scan\twenty.bin",
            r"C:\scan\ten-alias.bin",
        ],
    );
    io.file(r"C:\scan\ten.bin", 10, Some(10), (1, 1), false, false);
    io.file(r"C:\scan\twenty.bin", 20, Some(20), (1, 2), false, false);
    io.file(r"C:\scan\ten-alias.bin", 10, Some(10), (1, 1), false, false);
    let cancel = Arc::new(AtomicBool::new(false));
    let (summary, nodes) = scan(&io, ScanLimits::default(), cancel);
    assert_eq!(summary.logical_bytes, 40);
    assert_eq!(summary.allocated_unique_bytes, Some(30));
    assert_eq!(summary.link_count, 1);
    assert_eq!(summary.files_count, 3);
    let alias = nodes
        .iter()
        .find(|node| node.name == "ten-alias.bin")
        .unwrap();
    assert_eq!(alias.allocated_bytes, Some(10));
}

#[test]
fn unknown_allocation_is_not_zero() {
    let mut io = FakeIo::new();
    io.folder(r"C:\scan", &[r"C:\scan\unknown.bin"]);
    io.file(r"C:\scan\unknown.bin", 100, None, (1, 9), false, false);
    let cancel = Arc::new(AtomicBool::new(false));
    let (summary, nodes) = scan(&io, ScanLimits::default(), cancel);
    let file = nodes
        .iter()
        .find(|node| node.name == "unknown.bin")
        .unwrap();
    assert_eq!(file.allocated_bytes, None);
    assert_eq!(summary.unknown_allocated_count, 1);
    assert_eq!(summary.allocated_unique_bytes, None);
}

#[test]
fn the_entry_cap_returns_a_partial_summary() {
    let mut io = FakeIo::new();
    io.folder(
        r"C:\scan",
        &[
            r"C:\scan\a.bin",
            r"C:\scan\b.bin",
            r"C:\scan\c.bin",
            r"C:\scan\d.bin",
        ],
    );
    for (index, name) in ["a.bin", "b.bin", "c.bin", "d.bin"].iter().enumerate() {
        io.file(
            &format!(r"C:\scan\{name}"),
            1,
            Some(1),
            (1, index as u64 + 1),
            false,
            false,
        );
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let (summary, _nodes) = scan(&io, ScanLimits::with_max_entries(3), cancel);
    assert_eq!(summary.coverage, Coverage::Partial);
    assert!(summary.reason_codes.iter().any(|code| code == "limit"));
    assert!(summary.files_count < 4);
    assert!(!summary.cancelled);
}

#[test]
fn cancel_preserves_the_source_and_returns_partial() {
    let mut io = FakeIo::new();
    io.folder(r"C:\scan", &[r"C:\scan\a.bin"]);
    io.file(r"C:\scan\a.bin", 12, Some(12), (1, 1), false, false);
    let cancel = Arc::new(AtomicBool::new(true));
    let (summary, _nodes) = scan(&io, ScanLimits::default(), cancel);
    assert!(summary.cancelled);
    assert_eq!(summary.coverage, Coverage::Partial);
    assert!(summary.reason_codes.iter().any(|code| code == "cancelled"));
    assert_eq!(io.content_reads(), 0);
    assert_eq!(io.writes.load(Ordering::Relaxed), 0);
    // The source entry is still there with its reported size.
    assert_eq!(
        io.entries[Path::new(r"C:\scan\a.bin")].info.logical_bytes,
        12
    );
}

#[test]
fn network_roots_are_refused_without_explicit_allowance() {
    let mut io = FakeIo::new();
    io.folder(r"C:\scan", &[]);
    io.network.insert(PathBuf::from(r"C:\scan"));
    let cancel = Arc::new(AtomicBool::new(false));
    let mut sink = CollectSink::default();
    let mut progress = |_progress: &fs_service::OpProgress| {};
    let error = scan_storage_with(
        &io,
        &request(r"C:\scan"),
        &run(),
        &mut sink,
        &cancel,
        &mut progress,
        &ScanLimits::default(),
    )
    .unwrap_err();
    assert_eq!(error.code(), "storage.invalid");
    assert_eq!(io.content_reads(), 0);
}
