//! Immutable, bounded editor snapshots (Step 08a T2, `export-snapshot-2`).
//!
//! An editor uploads its current model through the `adpfile` protocol in
//! 1 MiB chunks. Ordinary captures use one owned staging file under
//! `<data>/export-input`; sensitive captures stay in zeroizing memory and
//! never touch the disk. A finalized snapshot is immutable and can only be
//! resolved by its exact document/revision (and, for PDF, content ID).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fs_service::owned_io::{OwnedOutput, PinnedDirectory, PinnedSource};
use fs_service::SourceStamp;
use sha2::{Digest, Sha256};
use tauri::{State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::export_snapshot_types::{
    now_unix, valid_snapshot_mime, valid_upload_token, ExportSnapshot, SnapshotBeginReply,
    SnapshotBeginRequest, StoragePolicy, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_CHUNK,
    MAX_SNAPSHOT_TOTAL_BYTES, SNAPSHOT_LEASE_IDLE_SECS, SNAPSHOT_UPLOAD_IDLE_SECS,
};
use crate::file_grant_backing::GrantedBacking;
use crate::snapshot_authorities::SnapshotAuthorityRegistry;

include!("export_snapshot_storage.rs");
include!("export_snapshot_begin.rs");
include!("export_snapshot_finish.rs");
include!("export_snapshot_resolve.rs");
include!("export_snapshot_commands.rs");
