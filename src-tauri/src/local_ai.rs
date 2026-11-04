#![allow(dead_code)] // The startup wiring constructs these adapters from main.
//! Local AI commands and task runner (T2, E1/E2/E5).
//!
//! Only `upscale` is registered in Step 14c. Every other typed task returns
//! `ai.unsupported` until its producing step installs a verified provider.
//! The coordinator supplies the pack probe, document access, snapshot access,
//! decoder and encoder; this module never fakes a successful inference.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use fs_service::CancellationToken;
use pack_store::types::PackId;
use serde_json::Value;
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use ai_runtime::protocol::{encode_frame, FrameKind, MAX_INPUT_BYTES, MAX_PAYLOAD_CHUNK_BYTES};
use ai_runtime::types::*;
use ai_runtime::types_ui::{AiCapabilityStatus, AiHardwareInfo, AiTextPage, LocalAiSettings};
use ai_runtime::validation::{
    validate_options_keys, validate_request_shape, validate_result_shape,
};

use crate::document_types::DocumentRef;
use crate::documents::DocumentStore;
use crate::engine_io::{spawn_frame_reader, FrameItem};
use crate::engine_security::{
    spawn_confined, ConfinedProcess, EngineLaunch, EngineSandbox, StdoutMode,
};
use crate::export_snapshot_types::StoragePolicy;
use crate::file_grant_backing::{GrantedBacking, MAX_BACKING_CHUNK};
use crate::files::FileGrants;
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::local_ai_artifacts::AiArtifactStore;
use crate::local_ai_host::{AiHost, ConfinedChildLauncher, ProtocolChild};
use crate::local_ai_inputs::{
    AiDocumentAccess, AiInputRegistry, AiSnapshotAccess, AiSourceReader, DocumentAiSource,
    SnapshotAiSource,
};
use crate::local_ai_limits::{effective_memory_limit_mb, InferenceGate, MIB};
use crate::local_ai_types::AiInputAcquire;
use crate::local_ai_upscale::{
    run_upscale, AiImageDecoder, AiImageEncoder, DecodedAiImage, UpscaleRun,
};
use crate::packs::Packs;

const BAD_REQUEST: &str = "ai.bad_request";

/// A verified `ai_upscale` lease held for the whole job.
pub struct UpscalePack {
    pub pack_id: String,
    pub model_id: String,
    pub model_version: String,
    pub helper: PathBuf,
    pub model_root: PathBuf,
    /// 12a `PackLease` retained until the child and readers finish.
    pub retention: Arc<dyn Send + Sync>,
}

/// Coordinator implementation using 12a `Packs.acquire`.
pub trait AiPackProbe: Send + Sync {
    fn probe_upscale(&self) -> Result<UpscalePack, String>;
}

pub struct LocalAiRuntime {
    settings: Mutex<LocalAiSettings>,
    artifacts: Arc<AiArtifactStore>,
    inputs: Arc<AiInputRegistry>,
    host: Arc<AiHost>,
    text: Mutex<BTreeMap<JobRequestId, AiTextPage>>,
    packs: Arc<dyn AiPackProbe>,
    snapshots: Arc<dyn AiSnapshotAccess>,
    decoder: Arc<dyn AiImageDecoder>,
    encoder: Arc<dyn AiImageEncoder>,
    /// Private per-application job root supplied by 12a storage.
    job_root: PathBuf,
    /// Shared across command clones so disabling cancels running tasks.
    active: Arc<Mutex<BTreeMap<JobRequestId, CancellationToken>>>,
    /// One inference globally with a bounded wait queue (D7).
    inference: Arc<InferenceGate>,
}

impl LocalAiRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        settings: LocalAiSettings,
        artifacts: Arc<AiArtifactStore>,
        inputs: Arc<AiInputRegistry>,
        host: Arc<AiHost>,
        packs: Arc<dyn AiPackProbe>,
        snapshots: Arc<dyn AiSnapshotAccess>,
        decoder: Arc<dyn AiImageDecoder>,
        encoder: Arc<dyn AiImageEncoder>,
        job_root: PathBuf,
    ) -> Self {
        Self {
            settings: Mutex::new(settings.normalized()),
            artifacts,
            inputs,
            host,
            text: Mutex::new(BTreeMap::new()),
            packs,
            snapshots,
            decoder,
            encoder,
            job_root,
            active: Arc::new(Mutex::new(BTreeMap::new())),
            inference: Arc::new(InferenceGate::new()),
        }
    }

    /// Production wiring for app startup. The coordinator passes the managed
    /// artifact store, document store, grants, pack manager and snapshot
    /// registry; this builds the concrete adapters, the confined host and the
    /// private job root. A failure keeps the state unmanaged (no fake
    /// providers), so the AI commands report "state not managed".
    #[allow(clippy::too_many_arguments)]
    pub fn for_app(
        settings: LocalAiSettings,
        artifacts: Arc<AiArtifactStore>,
        documents: Arc<DocumentStore>,
        grants: Arc<FileGrants>,
        packs: Packs,
        snapshots: Arc<crate::export_snapshots::ExportSnapshots>,
        job_root: PathBuf,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&job_root).map_err(|_| "ai.failed".to_string())?;
        let inputs = Arc::new(AiInputRegistry::new());
        inputs.install_document_access(Arc::new(DocumentStoreAccess::new(documents, grants)))?;
        let host = Arc::new(AiHost::new(Arc::new(AppContainerAiLauncher::new())));
        Ok(Self::new(
            settings,
            artifacts,
            inputs,
            host,
            Arc::new(PackManagerProbe::new(packs)),
            Arc::new(ExportSnapshotAiAccess::new(snapshots)),
            Arc::new(WicAiImageDecoder),
            Arc::new(PngAiImageEncoder),
            job_root,
        ))
    }

    /// Drop idle expired artifacts. Input leases have no TTL in
    /// `InputLeases`; they are released by id, by profile switch or when local
    /// AI is disabled, exactly as the registry exposes. Returns the number of
    /// artifact entries dropped.
    pub fn release_expired(&self, now_unix: u64) -> Result<usize, String> {
        self.artifacts.artifacts.sweep(now_unix)
    }

    fn track_job(&self, id: &str, token: CancellationToken) {
        if let Ok(mut active) = self.active.lock() {
            active.insert(id.to_string(), token);
        }
    }

    fn finish_job(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(id);
        }
    }

    fn cancel_all(&self) {
        if let Ok(mut active) = self.active.lock() {
            for token in active.values() {
                token.store(true, Ordering::Relaxed);
            }
            active.clear();
        }
        self.host.unload_now();
    }

    pub fn apply_settings(&self, settings: LocalAiSettings) -> Result<(), String> {
        let next = settings.normalized();
        let disable = !next.enabled;
        *self
            .settings
            .lock()
            .map_err(|_| "ai-settings lock poisoned".to_string())? = next;
        if disable {
            self.cancel_all();
            self.inputs
                .release_all_for_profile(self.artifacts.profile.get())?;
        }
        Ok(())
    }

    pub fn install_document_access(&self, access: Arc<dyn AiDocumentAccess>) -> Result<(), String> {
        self.inputs.install_document_access(access)
    }

    /// Bounded bytes of one already-authorized input for 17b action sources.
    /// The registry re-checks profile, kind and revision before any read.
    pub fn read_action_source(
        &self,
        input: &AiInputRef,
        max_bytes: usize,
    ) -> Result<crate::local_ai_inputs::BoundedInput, String> {
        self.inputs
            .read_bounded(self.artifacts.profile.get(), input, max_bytes)
    }

    fn settings_snapshot(&self) -> Result<LocalAiSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "ai-settings lock poisoned".to_string())
    }

    /// E5: trusted native callers only; never a UI command with private buffers.
    pub fn run(
        &self,
        request: &AiTaskRequest,
        context: &JobContext,
    ) -> Result<AiTaskResult, String> {
        self.run_task(request.clone(), context)
    }

    fn run_task(&self, request: AiTaskRequest, context: &JobContext) -> Result<AiTaskResult, String> {
        let settings = self.settings_snapshot()?;
        if !settings.enabled || !settings.tasks.get(&request.task).copied().unwrap_or(false) {
            return Err(crate::local_ai_status::DISABLED.into());
        }
        validate_request_shape(&request)?;
        if request.task != AiTaskKind::Upscale {
            return Err("ai.unsupported".into());
        }
        let _permit = self.inference.acquire(context.token().as_ref())?;
        let pack = self.packs.probe_upscale()?;
        if !pack.helper.is_file() || !pack.model_root.join("runtime.onnx").is_file() {
            return Err("ai.pack_missing".into());
        }
        let profile = self.artifacts.profile.get();
        let mut input_refs = Vec::with_capacity(request.inputs.len());
        for input in &request.inputs {
            let lease = self
                .inputs
                .resolve(input.id, input.expected_revision, profile)?;
            input_refs.push(lease);
        }
        if input_refs.len() != 1 {
            return Err(BAD_REQUEST.into());
        }
        let lease = &input_refs[0];
        let len = self.inputs.source_len(lease.record().id)?;
        if len == 0 || len > MAX_INPUT_BYTES {
            return Err("ai.memory_limit".into());
        }
        let encoded = self.inputs.read(
            lease.record().id,
            lease.revision(),
            profile,
            0,
            len,
        )?;
        let sensitive = self.inputs.is_sensitive(lease.record().id);
        let hardware = crate::local_ai_hardware::query_hardware();
        let memory_mb = effective_memory_limit_mb(
            settings.memory_limit_mb,
            hardware.available_ram_bytes,
        );
        let requested_device = match &request.options {
            AiTaskOptions::Upscale { device, .. } => *device,
            _ => AiDevice::Cpu,
        };
        let cpu_memory_bytes = u64::from(memory_mb) * MIB;
        let gpu_memory_bytes =
            crate::local_ai_limits::gpu_memory_budget(hardware.dedicated_vram_bytes);
        let (device, memory_bytes) = match requested_device {
            AiDevice::Cpu => (AiDevice::Cpu, cpu_memory_bytes),
            AiDevice::Gpu => (
                AiDevice::Gpu,
                gpu_memory_bytes.ok_or_else(|| "ai.unsupported".to_string())?,
            ),
            // Automatic uses the CPU when Windows reports no dedicated VRAM;
            // no guessed GPU budget is ever invented.
            AiDevice::Auto => match gpu_memory_bytes {
                Some(bytes) => (AiDevice::Auto, bytes),
                None => (AiDevice::Cpu, cpu_memory_bytes),
            },
        };
        let expected_model = match &request.options {
            AiTaskOptions::Upscale { model, .. } => model.model_id().to_string(),
            _ => return Err(BAD_REQUEST.into()),
        };
        let expected_revision = pack.model_version.clone();
        let job_dir = self.job_root.join(&request.request_id);
        std::fs::create_dir_all(&job_dir).map_err(|_| "ai.memory_limit".to_string())?;
        let result = run_upscale(UpscaleRun {
            request: &request,
            input: lease,
            encoded,
            sensitive,
            artifacts: self.artifacts.as_ref(),
            host: self.host.as_ref(),
            decoder: self.decoder.as_ref(),
            encoder: self.encoder.as_ref(),
            context,
            helper: &pack.helper,
            model_root: &pack.model_root,
            job_root: &job_dir,
            model_revision: expected_revision.clone(),
            device,
            metadata_preservable: false,
            accepted_metadata_loss: false,
            memory_limit_bytes: memory_bytes,
            cpu_memory_limit_bytes: cpu_memory_bytes,
        })?;
        if result.model_id != expected_model || result.model_revision != expected_revision {
            return Err("ai.model_output".into());
        }
        validate_result_shape(&result)?;
        Ok(result)
    }
}

const UPSCALE_CAPABILITY: &str = "ai.upscale";
/// D4's default model reported to the capability card; each request still
/// selects its own catalog model in `AiTaskOptions::Upscale`.
const DEFAULT_UPSCALE_MODEL: &str = "realesr-general-x4v3";

fn map_pack_error(code: String) -> String {
    match code.as_str() {
        "packs.changed"
        | "packs.bad_hash"
        | "packs.bad_signature"
        | "packs.unsupported_schema" => "ai.unverified",
        "packs.busy" => "ai.unsupported",
        _ => "ai.pack_missing",
    }
    .to_string()
}

/// Production probe over 12a `Packs::acquire`: the verified version stays
/// leased (retention) until the child and every reader are gone.
pub struct PackManagerProbe {
    packs: Packs,
}

impl PackManagerProbe {
    pub fn new(packs: Packs) -> Self {
        Self { packs }
    }
}

impl AiPackProbe for PackManagerProbe {
    fn probe_upscale(&self) -> Result<UpscalePack, String> {
        let lease = self
            .packs
            .acquire(PackId::AiUpscale, UPSCALE_CAPABILITY)
            .map_err(map_pack_error)?;
        let helper = lease
            .entrypoint(UPSCALE_CAPABILITY)
            .map_err(|error| map_pack_error(error.code().to_string()))?;
        let model_root = lease.root().to_path_buf();
        // A verified entrypoint without its fixed ONNX runtime is not an
        // installed upscaler; the capability card must say pack_missing.
        if !helper.is_file() || !model_root.join("runtime.onnx").is_file() {
            return Err("ai.pack_missing".into());
        }
        let model_version = lease.version().to_string();
        Ok(UpscalePack {
            pack_id: PackId::AiUpscale.as_str().to_string(),
            model_id: DEFAULT_UPSCALE_MODEL.to_string(),
            model_version,
            helper,
            model_root,
            retention: Arc::new(lease),
        })
    }
}

/// One bounded reader over a `GrantedBacking`. The backing's public read is
/// capped at one protocol chunk, so larger AI reads are assembled here under
/// the caller's already checked `MAX_INPUT_BYTES` bound.
struct BackingSource(Arc<GrantedBacking>);

impl AiSourceReader for BackingSource {
    fn byte_len(&self) -> u64 {
        self.0.length()
    }

    fn read_range(&self, offset: u64, length: u64) -> Result<Vec<u8>, String> {
        if length == 0 {
            return Ok(Vec::new());
        }
        let end = offset.checked_add(length).ok_or_else(|| BAD_REQUEST.to_string())?;
        if end > self.0.length() {
            return Err("ai.source_changed".into());
        }
        let capacity = usize::try_from(length).map_err(|_| "ai.memory_limit".to_string())?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(capacity)
            .map_err(|_| "ai.memory_limit".to_string())?;
        let mut done = 0u64;
        while done < length {
            let take = (length - done).min(MAX_BACKING_CHUNK as u64) as usize;
            let chunk = self
                .0
                .read_range(offset + done, take)
                .map_err(|_| "ai.source_changed".to_string())?;
            if chunk.len() != take {
                return Err("ai.source_changed".into());
            }
            bytes.extend_from_slice(&chunk);
            done += take as u64;
        }
        Ok(bytes)
    }
}

/// Production 09a document access: one opened, still-authorized original
/// backing at revision 1. A draft (unsaved content) is refused; it must arrive
/// as an 08a snapshot instead.
pub struct DocumentStoreAccess {
    store: Arc<DocumentStore>,
    grants: Arc<FileGrants>,
}

impl DocumentStoreAccess {
    pub fn new(store: Arc<DocumentStore>, grants: Arc<FileGrants>) -> Self {
        Self { store, grants }
    }
}

impl AiDocumentAccess for DocumentStoreAccess {
    fn original_for_ai(&self, document_id: &str) -> Result<DocumentAiSource, String> {
        let id = Uuid::parse_str(document_id).map_err(|_| BAD_REQUEST.to_string())?;
        let entry = self.store.entry(id).map_err(|_| "ai.expired".to_string())?;
        if entry.info.document_id != document_id {
            return Err("ai.source_changed".into());
        }
        if matches!(&entry.info.source, DocumentRef::Draft { .. }) {
            return Err(BAD_REQUEST.into());
        }
        let backing = crate::document_grants::resolve_backing(&self.grants, &entry.token)
            .ok_or_else(|| "ai.expired".to_string())?;
        let sensitive = entry.info.sensitive
            || backing.is_sensitive()
            || matches!(&entry.info.source, DocumentRef::Virtual { .. });
        Ok(DocumentAiSource {
            document_id: document_id.to_string(),
            // The opened document id is this handle's immutable identity for
            // the original backing; bytes are pinned by the grant.
            content_id: id,
            revision: 1,
            sensitive,
            reader: Arc::new(BackingSource(backing)),
        })
    }
}

fn map_snapshot_error(code: String) -> String {
    match code.as_str() {
        "snapshot.changed" => "ai.source_changed",
        "snapshot.bad_request" => BAD_REQUEST,
        _ => "ai.expired",
    }
    .to_string()
}

/// Keeps the 08a snapshot lease alive for the input entry without exposing a
/// second retention protocol to the AI crate.
struct SnapshotRetentionBox(
    #[allow(dead_code)] Arc<dyn crate::export_snapshots::SnapshotRetention>,
);

/// Production 08a snapshot access: only the exact finalized snapshot,
/// document and revision resolve, and its lease is retained by the input.
pub struct ExportSnapshotAiAccess {
    snapshots: Arc<crate::export_snapshots::ExportSnapshots>,
}

impl ExportSnapshotAiAccess {
    pub fn new(snapshots: Arc<crate::export_snapshots::ExportSnapshots>) -> Self {
        Self { snapshots }
    }
}

impl AiSnapshotAccess for ExportSnapshotAiAccess {
    fn resolve_for_ai(
        &self,
        snapshot_id: Uuid,
        document_id: &str,
        revision: u64,
    ) -> Result<SnapshotAiSource, String> {
        let lease = self
            .snapshots
            .resolve(&snapshot_id.to_string(), document_id, revision)
            .map_err(map_snapshot_error)?;
        let sensitive = lease.snapshot.storage_policy == StoragePolicy::Sensitive
            || lease.backing.is_sensitive();
        let content_id = lease.snapshot.content_id;
        let reader = Arc::new(BackingSource(Arc::clone(&lease.backing)));
        let retention: Arc<dyn Send + Sync> = Arc::new(SnapshotRetentionBox(lease.retention));
        Ok(SnapshotAiSource {
            content_id,
            sensitive,
            reader,
            retention,
        })
    }
}

fn map_decode_error(code: String) -> String {
    match code.as_str() {
        "thumbnail.too_large" => "ai.unsupported",
        "thumbnail.bad_request" => BAD_REQUEST,
        _ => "ai.failed",
    }
    .to_string()
}

/// True when the source's own color type carries alpha. Formats outside the
/// 14b decoder set report false; the decoded RGBA buffer and its alpha plane
/// are still preserved by the output encoder.
fn encoded_has_alpha(encoded: &[u8]) -> bool {
    use image::ImageDecoder;
    let Ok(reader) =
        image::ImageReader::new(std::io::Cursor::new(encoded)).with_guessed_format()
    else {
        return false;
    };
    let Ok(decoder) = reader.into_decoder() else {
        return false;
    };
    decoder.color_type().has_alpha()
}

/// 07a WIC decode from bounded memory: orientation is applied once and the
/// result is upright RGBA. A source above D6's edge/pixel bounds is refused
/// instead of being silently scaled down by the thumbnail decoder.
pub struct WicAiImageDecoder;

impl AiImageDecoder for WicAiImageDecoder {
    fn decode_oriented(&self, encoded: &[u8]) -> Result<DecodedAiImage, String> {
        let decoded = crate::thumbnail_decode::decode_pixels_from_memory(
            encoded,
            crate::image_encode::MAX_IMAGE_EDGE,
            crate::image_encode::MAX_IMAGE_PIXELS,
        )
        .map_err(map_decode_error)?;
        if decoded.original_width > crate::image_encode::MAX_IMAGE_EDGE
            || decoded.original_height > crate::image_encode::MAX_IMAGE_EDGE
            || u64::from(decoded.original_width) * u64::from(decoded.original_height)
                > crate::image_encode::MAX_IMAGE_PIXELS
            || decoded.width != decoded.original_width
            || decoded.height != decoded.original_height
            || decoded.rgba.len()
                != decoded.width as usize * decoded.height as usize * 4
        {
            return Err("ai.unsupported".into());
        }
        Ok(DecodedAiImage {
            width: decoded.width,
            height: decoded.height,
            rgba: decoded.rgba,
            had_alpha: encoded_has_alpha(encoded),
        })
    }
}

fn map_encode_error(code: String) -> String {
    match code.as_str() {
        "image_edit.bad_request" => BAD_REQUEST,
        "image_edit.too_large" | "snapshots.too_large" | "convert.metadata_loss" => {
            "ai.unsupported"
        }
        _ => "ai.failed",
    }
    .to_string()
}

/// 14b PNG capture encoder. PNG ignores the quality/background fields; the
/// caller independently validates the decoded PNG before publishing it.
pub struct PngAiImageEncoder;

impl AiImageEncoder for PngAiImageEncoder {
    fn encode_png(&self, width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
        let request = crate::image_encode::EncodeRequest {
            mime: crate::image_encode::CaptureMime::Png,
            width,
            height,
            quality: 100,
            background_rgba: [0, 0, 0, 0],
            metadata_keep: false,
            source_has_icc: false,
            accepted_metadata_loss: true,
        };
        crate::image_encode::encode_rgba(&request, rgba).map_err(map_encode_error)
    }
}

fn protocol_arguments(args: &[OsString]) -> Result<String, String> {
    let mut values = Vec::with_capacity(args.len());
    for arg in args {
        values.push(
            arg.to_str()
                .ok_or_else(|| "ai.sandbox_failed".to_string())?
                .to_string(),
        );
    }
    Ok(crate::media_arguments::command_line(&values))
}

/// D2 launcher: the 12b AppContainer with no capabilities. Only the verified
/// pack and the private job root are granted; a failure is
/// `ai.sandbox_failed` and never an unconfined launch.
pub struct AppContainerAiLauncher {
    sandbox: Mutex<Option<Arc<EngineSandbox>>>,
    /// One ACL update per path; a request spawns one child per tile and must
    /// not grow the pack folder's DACL with identical entries.
    granted: Mutex<BTreeSet<PathBuf>>,
}

impl Default for AppContainerAiLauncher {
    fn default() -> Self {
        Self::new()
    }
}

impl AppContainerAiLauncher {
    pub fn new() -> Self {
        Self {
            sandbox: Mutex::new(None),
            granted: Mutex::new(BTreeSet::new()),
        }
    }

    fn sandbox(&self) -> Result<Arc<EngineSandbox>, String> {
        let mut slot = self
            .sandbox
            .lock()
            .map_err(|_| "ai.sandbox_failed".to_string())?;
        if let Some(sandbox) = slot.as_ref() {
            return Ok(Arc::clone(sandbox));
        }
        let sandbox = Arc::new(
            EngineSandbox::prepare().map_err(|_| "ai.sandbox_failed".to_string())?,
        );
        *slot = Some(Arc::clone(&sandbox));
        Ok(sandbox)
    }

    fn grant_once(&self, path: &Path, private: bool) -> Result<(), String> {
        if self
            .granted
            .lock()
            .map_err(|_| "ai.sandbox_failed".to_string())?
            .contains(path)
        {
            return Ok(());
        }
        let sandbox = self.sandbox()?;
        if private {
            sandbox.grant_private(path)
        } else {
            sandbox.grant_read(path)
        }
        .map_err(|_| "ai.sandbox_failed".to_string())?;
        self.granted
            .lock()
            .map_err(|_| "ai.sandbox_failed".to_string())?
            .insert(path.to_path_buf());
        Ok(())
    }
}

impl ConfinedChildLauncher for AppContainerAiLauncher {
    fn spawn_protocol_child(
        &self,
        helper: &Path,
        args: &[OsString],
        read_roots: &[PathBuf],
        write_root: &Path,
        memory_limit_bytes: u64,
        cpu_rate_percent: u32,
    ) -> Result<Box<dyn ProtocolChild>, String> {
        let failed = || "ai.sandbox_failed".to_string();
        let sandbox = self.sandbox()?;
        for root in read_roots {
            self.grant_once(root, false)?;
        }
        self.grant_once(write_root, true)?;
        let arguments = protocol_arguments(args)?;
        let environment = vec![
            ("TEMP".to_string(), write_root.to_string_lossy().into_owned()),
            ("TMP".to_string(), write_root.to_string_lossy().into_owned()),
            (
                "PATH".to_string(),
                helper
                    .parent()
                    .map(|parent| parent.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            ),
        ];
        let launch = EngineLaunch {
            program: helper,
            arguments,
            working_directory: write_root,
            environment,
            memory_bytes: memory_limit_bytes,
            cpu_percent: cpu_rate_percent,
            stdout_mode: StdoutMode::Raw,
        };
        let mut process = spawn_confined(&sandbox, &launch).map_err(|_| failed())?;
        let stdout = process.take_stdout_reader().ok_or_else(failed)?;
        let frames = spawn_frame_reader(stdout, MAX_PAYLOAD_CHUNK_BYTES);
        Ok(Box::new(FramedProtocolChild { process, frames }))
    }
}

/// One AppContainer child speaking the AI framed protocol. The reader thread
/// is bounded by the pipe and the job object, so `read_frame` always honors
/// its timeout and `kill_tree` terminates descendants with the job.
struct FramedProtocolChild {
    process: ConfinedProcess,
    frames: Receiver<FrameItem>,
}

impl ProtocolChild for FramedProtocolChild {
    fn read_frame(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String> {
        match self.frames.recv_timeout(timeout) {
            Ok(FrameItem::Frame { kind, payload }) => {
                let kind = FrameKind::from_u8(kind).ok_or_else(|| "ai.failed".to_string())?;
                encode_frame(kind, &payload).map(Some)
            }
            Ok(FrameItem::Invalid) | Ok(FrameItem::Closed) => Err("ai.failed".into()),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err("ai.failed".into()),
        }
    }

    fn write_stdin(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.process
            .write_stdin(bytes)
            .map_err(|_| "ai.failed".to_string())
    }

    fn wait_timeout(&mut self, timeout: Duration) -> Result<bool, String> {
        Ok(self.process.wait(timeout).is_some())
    }

    fn kill_tree(&mut self) -> Result<(), String> {
        self.process.terminate();
        Ok(())
    }
}

#[tauri::command]
pub async fn ai_capabilities(
    window: WebviewWindow,
    state: State<'_, LocalAiRuntime>,
) -> Result<Vec<AiCapabilityStatus>, String> {
    crate::ensure_main(window.label())?;
    let settings = state.settings_snapshot()?;
    let packs = state.packs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::local_ai_status::capabilities(&settings, packs.as_ref())
    })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ai_hardware(window: WebviewWindow) -> Result<AiHardwareInfo, String> {
    crate::ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(crate::local_ai_hardware::query_hardware)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ai_task_start(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, LocalAiRuntime>,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: Value,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id).map_err(|_| BAD_REQUEST.to_string())?;
    let task_value = request.get("task").cloned().ok_or(BAD_REQUEST)?;
    let task: AiTaskKind =
        serde_json::from_value(task_value).map_err(|_| BAD_REQUEST.to_string())?;
    let options = request.get("options").ok_or(BAD_REQUEST)?;
    validate_options_keys(options, task)?;
    let request: AiTaskRequest =
        serde_json::from_value(request).map_err(|_| BAD_REQUEST.to_string())?;
    if request_id != request.request_id {
        return Err(BAD_REQUEST.into());
    }
    validate_request_shape(&request)?;
    let settings = state.settings_snapshot()?;
    let token = jobs.begin(&request_id, 1)?;
    state.track_job(&request_id, token.clone());
    let artifacts = state.artifacts.clone();
    let inputs = state.inputs.clone();
    let host = state.host.clone();
    let packs = state.packs.clone();
    let snapshots = state.snapshots.clone();
    let decoder = state.decoder.clone();
    let encoder = state.encoder.clone();
    let job_root = state.job_root.clone();
    let runner = LocalAiRuntime {
        settings: Mutex::new(settings),
        artifacts,
        inputs,
        host,
        text: Mutex::new(BTreeMap::new()),
        packs,
        snapshots,
        decoder,
        encoder,
        job_root,
        active: state.active.clone(),
        inference: state.inference.clone(),
    };
    let tracked = request_id.clone();
    spawn_job(app, request_id, token, move |context| {
        let outcome = runner
            .run_task(request, context)
            .and_then(|result| serde_json::to_value(result).map_err(|_| "ai.failed".to_string()));
        runner.finish_job(&tracked);
        outcome
    });
    Ok(())
}

#[tauri::command]
pub fn ai_text_page(
    window: WebviewWindow,
    state: State<'_, LocalAiRuntime>,
    job_id: String,
    after_sequence: u64,
) -> Result<AiTextPage, String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&job_id).map_err(|_| BAD_REQUEST.to_string())?;
    let text = state
        .text
        .lock()
        .map_err(|_| "ai-text lock poisoned".to_string())?;
    let page = text.get(&job_id).ok_or("ai.expired")?;
    if page.after_sequence < after_sequence {
        return Err("ai.expired".into());
    }
    Ok(page.clone())
}

#[tauri::command]
pub fn ai_shutdown(window: WebviewWindow, state: State<'_, LocalAiRuntime>) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    state.cancel_all();
    state
        .inputs
        .release_all_for_profile(state.artifacts.profile.get())
}

#[tauri::command]
pub fn ai_input_acquire(
    window: WebviewWindow,
    state: State<'_, LocalAiRuntime>,
    input: AiInputAcquire,
) -> Result<AiInputRef, String> {
    crate::ensure_main(window.label())?;
    let profile = state.artifacts.profile.get();
    match input {
        AiInputAcquire::Document { document_id } => {
            state.inputs.acquire_document(profile, &document_id)
        }
        AiInputAcquire::Snapshot {
            snapshot_id,
            document_id,
            revision,
        } => {
            let source = state
                .snapshots
                .resolve_for_ai(snapshot_id, &document_id, revision)?;
            state.inputs.acquire_snapshot(
                profile,
                snapshot_id,
                source.content_id,
                revision,
                source.sensitive,
                source.reader,
                source.retention,
            )
        }
    }
}

#[tauri::command]
pub fn ai_document_input_acquire(
    window: WebviewWindow,
    state: State<'_, LocalAiRuntime>,
    document_id: String,
) -> Result<AiInputRef, String> {
    crate::ensure_main(window.label())?;
    if document_id.is_empty() || document_id.len() > 128 {
        return Err(BAD_REQUEST.into());
    }
    let profile = state.artifacts.profile.get();
    state.inputs.acquire_document(profile, &document_id)
}

#[tauri::command]
pub fn ai_input_release(
    window: WebviewWindow,
    state: State<'_, LocalAiRuntime>,
    id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let id = Uuid::parse_str(&id).map_err(|_| BAD_REQUEST.to_string())?;
    state.inputs.release(id)
}
