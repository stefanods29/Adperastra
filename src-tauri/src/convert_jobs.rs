//! Cancellable conversion jobs and the helper conversation (Step 08a T4).
//!
//! The parent guards each source, keeps every output in owned staging and
//! publishes only after the helper's length and SHA-256 agree. A failed
//! item keeps the outputs that really landed; cancellation keeps completed
//! items and drops only the unfinished one.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use cache_store::CacheLease;
use convert::{
    ConversionInput, ConversionOutput, ConversionPreviewRequest, ConversionRequest, ConvertOptions,
    ConvertOutputSink, ConverterSpec, FormatId, MetadataCategory, PreparedOutput, WorkItemResult,
    WorkItemStatus,
};
use fs_service::owned_io::{PinnedDirectory, PinnedSource, SourceIdentity};
use fs_service::OpProgress;
use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::convert_helper;
use crate::convert_publish::PublishSink;
use crate::convert_reports::{ConversionReports, StoredReport};
use crate::export_snapshots::ExportSnapshots;
use crate::file_grant_backing::GrantedBacking;
use crate::helper::HelperProcess;
use crate::helper_frames::HelperFrameEvent;

include!("convert_job_types.rs");
include!("convert_source.rs");
include!("convert_transport.rs");
include!("convert_item.rs");
include!("convert_batch.rs");
include!("convert_preview.rs");
include!("convert_commands.rs");
