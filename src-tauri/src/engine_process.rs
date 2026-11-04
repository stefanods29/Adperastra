//! One confined engine lifecycle (Step 12b E3).
//!
//! `EngineHost::run` is the only place an engine process starts: it pins the
//! verified pack version, copies the authorized inputs into a private job
//! folder, launches inside the AppContainer of `engine_security`, bounds both
//! streams, enforces the D4 deadlines and cancellation, verifies every
//! produced file, and copies it into an `OwnedOutput` the parent may publish.
//! The engine never receives a user destination (E6).
#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fs_service::owned_io::{OwnedOutput, PinnedDirectory};
use fs_service::{CancellationToken, OpProgress};
use sha2::Digest;
use uuid::Uuid;

use crate::engine_io::{classify_stderr, next_item, ProgressTracker, StreamItem};
use crate::engine_security::{spawn_confined, EngineLaunch, EngineSandbox};
use crate::engine_types::{
    EngineAction, EngineCapability, EngineCapabilityId, EngineError, EngineId, EngineInput,
    EngineOutput, EngineRequest, EngineResult, EngineSource, EngineUnavailableReason,
};
use crate::jobs::JobContext;
use crate::media_arguments;
use crate::office_profile;
use crate::packs::Packs;

/// The most probe JSON one run may collect (D4: 1 MiB).
pub const MAX_STDOUT_BYTES: usize = 1024 * 1024;
/// How long a cancelled child has to stop by itself (D4).
pub const CANCEL_GRACE_MS: u64 = 5_000;
/// How often the driver looks at the child and the clock.
const TICK_MS: u64 = 50;
/// The CPU hard cap given to one engine job (percent of one core).
pub const ENGINE_CPU_PERCENT: u32 = 100;
/// The memory budget of one media engine child (D4).
pub const MEDIA_MEMORY_BYTES: u64 = 1024 * 1024 * 1024;

/// What one invocation produced, plus the bounded stdout the probe parser
/// needs. The JSON never reaches the UI.
pub struct EngineRun {
    pub result: EngineResult,
    pub stdout: Vec<u8>,
    /// The verified pack version that ran; never a caller-supplied string.
    pub engine_version: String,
}

/// Counts the live Office read actors. There is at most one in the app, so a
/// second `start_session` is `engines.busy` instead of a second process tree.
#[derive(Default)]
pub struct Counter {
    live: std::sync::atomic::AtomicUsize,
}

impl Counter {
    /// Take the single actor slot; `None` while an actor is alive.
    pub fn try_acquire(&self) -> bool {
        self.live
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    /// Give the slot back; exactly one holder calls this.
    pub fn release(&self) {
        self.live.store(0, Ordering::SeqCst);
    }

    pub fn live(&self) -> usize {
        self.live.load(Ordering::SeqCst)
    }
}

/// The private folders of one job, each pinned for the whole invocation.
struct PrivateDirs {
    input: PinnedDirectory,
    output: PinnedDirectory,
    staging: PinnedDirectory,
}

impl PrivateDirs {
    fn prepare(work_dir: &PinnedDirectory, sandbox: &EngineSandbox) -> Result<Self, String> {
        let failed = || EngineError::SandboxFailed.message();
        let mut made = Vec::new();
        for name in ["input", "output", "staging"] {
            let path = work_dir.path().join(name);
            std::fs::create_dir_all(&path).map_err(|_| failed())?;
            sandbox.grant_private(&path)?;
            made.push(path);
        }
        Ok(Self {
            input: PinnedDirectory::open(&made[0]).map_err(|_| failed())?,
            output: PinnedDirectory::open(&made[1]).map_err(|_| failed())?,
            staging: PinnedDirectory::open(&made[2]).map_err(|_| failed())?,
        })
    }
}

/// The engine host: pack leases, sandbox, private work roots and the one
/// launch path. One host lives in the app; `data_root` is the app's own data
/// folder (`%LOCALAPPDATA%\Adperastra` or the configured one).
pub struct EngineHost {
    packs: Arc<Packs>,
    data_root: PathBuf,
    sandbox: Mutex<Option<Arc<EngineSandbox>>>,
    sandbox_failed: Mutex<bool>,
    /// Live Office read actors; there is at most one in the whole app.
    office_actors: Arc<Counter>,
}

impl EngineHost {
    pub fn new(packs: Arc<Packs>, data_root: PathBuf) -> Self {
        Self {
            packs,
            data_root,
            sandbox: Mutex::new(None),
            sandbox_failed: Mutex::new(false),
            office_actors: Arc::new(Counter::default()),
        }
    }

    /// The app data folder this host may create private engine folders in.
    pub fn data_root(&self) -> &Path {
        &self.data_root
    }

    /// The shared actor counter, so a session can release its slot exactly
    /// once when it ends.
    pub fn office_actor_counter(&self) -> Arc<Counter> {
        self.office_actors.clone()
    }

    /// A private root folder under the app data folder, pinned.
    pub(crate) fn new_private_root(
        &self,
        scope: &str,
    ) -> Result<(PathBuf, PinnedDirectory), String> {
        let failed = || EngineError::SandboxFailed.message();
        let root = self
            .data_root
            .join("engines")
            .join(format!("{scope}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).map_err(|_| failed())?;
        let pinned = PinnedDirectory::open(&root).map_err(|_| failed())?;
        Ok((root, pinned))
    }

    /// The shared AppContainer, created once. A failure is remembered: the
    /// engine is reported as `sandbox_failed` and never run unconfined.
    pub(crate) fn sandbox(&self) -> Result<Arc<EngineSandbox>, String> {
        if let Ok(Some(sandbox)) = self.sandbox.lock().map(|guard| guard.clone()) {
            return Ok(sandbox);
        }
        if *self
            .sandbox_failed
            .lock()
            .map_err(|_| EngineError::SandboxFailed.message())?
        {
            return Err(EngineError::SandboxFailed.message());
        }
        match EngineSandbox::prepare() {
            Ok(sandbox) => {
                let sandbox = Arc::new(sandbox);
                if let Ok(mut guard) = self.sandbox.lock() {
                    *guard = Some(sandbox.clone());
                }
                Ok(sandbox)
            }
            Err(error) => {
                if let Ok(mut failed) = self.sandbox_failed.lock() {
                    *failed = true;
                }
                Err(error)
            }
        }
    }

    /// Pin the verified pack version for this capability.
    pub(crate) fn acquire(
        &self,
        capability: EngineCapabilityId,
    ) -> Result<(pack_store::PackLease, PathBuf), String> {
        let pack_id = match capability.engine() {
            EngineId::Media => pack_store::PackId::Media,
            EngineId::Office => pack_store::PackId::Office,
        };
        let lease = self
            .packs
            .acquire(pack_id, capability.as_str())
            .map_err(|code| map_pack_error(&code, capability))?;
        let entrypoint = lease
            .entrypoint(capability.as_str())
            // The entrypoint is revalidated here; a changed size/hash must
            // surface as `unsafe_build`, never as a generic missing pack.
            .map_err(|error| map_pack_error(error.code(), capability))?;
        Ok((lease, entrypoint))
    }

    /// True when the verified pack for this capability can be acquired now.
    /// Converter registration uses this gate; it never starts a process and
    /// drops the probe lease immediately (the launch path re-acquires).
    pub fn capability_verified(&self, capability: EngineCapabilityId) -> bool {
        self.acquire(capability).is_ok()
    }

    /// What the installed packs actually support (E1).
    pub fn capabilities(&self) -> Vec<EngineCapability> {
        let mut listed = Vec::new();
        // A container that cannot be prepared makes every engine unusable, so
        // no capability may claim availability.
        let sandbox_ready = self.sandbox().is_ok();
        for capability in [
            EngineCapabilityId::MediaProbe,
            EngineCapabilityId::MediaPreview,
            EngineCapabilityId::MediaEncode,
            EngineCapabilityId::OfficeConvert,
            EngineCapabilityId::OfficeReadBridge,
        ] {
            if !sandbox_ready {
                listed.push(EngineCapability {
                    id: capability.as_str().to_string(),
                    available: false,
                    version: String::new(),
                    reason: Some(EngineUnavailableReason::SandboxFailed),
                });
                continue;
            }
            let (available, version, reason) = match self.acquire(capability) {
                Ok((lease, _)) => (true, lease.version().to_string(), None),
                Err(code) if code == EngineError::UnsafeBuild.code() => (
                    false,
                    String::new(),
                    Some(EngineUnavailableReason::UnsafeBuild),
                ),
                Err(code) if code == EngineError::SandboxFailed.code() => (
                    false,
                    String::new(),
                    Some(EngineUnavailableReason::SandboxFailed),
                ),
                Err(code) if code == EngineError::Unsupported.code() => (
                    false,
                    String::new(),
                    Some(EngineUnavailableReason::Unsupported),
                ),
                Err(_) => (
                    false,
                    String::new(),
                    Some(EngineUnavailableReason::PacksMissing),
                ),
            };
            listed.push(EngineCapability {
                id: capability.as_str().to_string(),
                available,
                version,
                reason,
            });
        }
        listed
    }

    /// E3: run one request and return its validated outputs.
    pub fn run(
        &self,
        request: &EngineRequest,
        context: &JobContext,
    ) -> Result<EngineResult, String> {
        self.run_capture(request, context).map(|run| run.result)
    }

    /// The same, keeping the bounded stdout for the probe parser.
    pub fn run_capture(
        &self,
        request: &EngineRequest,
        context: &JobContext,
    ) -> Result<EngineRun, String> {
        request.validate().map_err(|error| error.message())?;
        for input in request.action.inputs() {
            input.refuse_sensitive().map_err(EngineError::message)?;
        }
        let capability = request.action.capability();
        let (lease, program) = self.acquire(capability)?;
        let kit = matches!(&request.action, EngineAction::RenderOffice { .. })
            && crate::office_kit_arguments::is_kit_worker(&program);
        if kit {
            // Kit loads its resources below the entrypoint directory. Check
            // the entire signed inventory before granting that tree access.
            lease
                .verify_inventory()
                .map_err(|_| EngineError::Failed.message())?;
        }
        let sandbox = self.sandbox()?;
        // Grant only the directory of the exact hash-verified entrypoint.
        // Broader pack paths stay unreadable until a signed inventory check
        // verifies every file that would be reached through them.
        if kit {
            sandbox.grant_read(lease.root())?;
        } else if let Some(parent) = program.parent() {
            sandbox.grant_read(parent)?;
        }
        let dirs = PrivateDirs::prepare(&request.work_dir, &sandbox)?;

        let mut spooled: HashMap<u32, SpooledInput> = HashMap::new();
        for input in request.action.inputs() {
            spooled.insert(
                input.input_index,
                spool_input(input, &dirs.input, capability.engine().max_source_bytes())?,
            );
        }

        let plan = plan_for(request, &program, &dirs, &spooled)?;
        let launch = EngineLaunch {
            program: &program,
            arguments: media_arguments::command_line(&plan.arguments),
            working_directory: dirs.staging.path(),
            environment: plan.environment,
            memory_bytes: plan.memory_bytes,
            cpu_percent: ENGINE_CPU_PERCENT,
            stdout_mode: crate::engine_security::StdoutMode::Lines,
        };
        let mut process = spawn_confined(&sandbox, &launch)?;
        let stdout = process
            .take_stdout_lines()
            .ok_or_else(|| EngineError::Failed.message())?;
        let outcome = drive(&mut process, &stdout, request, context)?;
        let metadata_lost = plan.metadata_lost.clone();
        // Only our private copies are removed; the user's source is untouched.
        for (_, copy) in spooled {
            copy.dispose();
        }
        // Cancellation and a deadline stay visible as themselves even when a
        // partially written artifact exists; a failed child is diagnosed from
        // its stable stderr codes, never by copying whatever it left behind.
        if outcome.cancelled {
            return Err(EngineError::Cancelled.message());
        }
        if outcome.timed_out {
            return Err(EngineError::Timeout.message());
        }
        if outcome.exit_code != 0 {
            return Err(map_diagnostics(&classify_stderr(&outcome.stderr)));
        }
        let outputs = collect_outputs(
            &dirs,
            &plan.expected,
            capability.engine().max_output_bytes(),
        )?;
        let mut result = EngineResult {
            exit_code: outcome.exit_code,
            outputs,
            bytes_written: 0,
            metadata_lost,
            stderr_codes: classify_stderr(&outcome.stderr),
        };
        result.bytes_written = result.outputs.iter().map(|output| output.byte_len).sum();
        // The verified pack version stays pinned until every result is
        // validated; only then may it be released.
        let engine_version = lease.version().to_string();
        result.validate().map_err(|error| error.message())?;
        let _lease = lease;
        Ok(EngineRun {
            result,
            stdout: outcome.stdout,
            engine_version,
        })
    }
}

/// The engine command for one action, with everything it may write named in
/// advance so extra artifacts are refused.
struct LaunchPlan {
    arguments: Vec<String>,
    environment: Vec<(String, String)>,
    expected: Vec<ExpectedOutput>,
    metadata_lost: Vec<convert::MetadataCategory>,
    memory_bytes: u64,
}

/// One output the parent will look for, with the MIME it must carry.
#[derive(Clone)]
struct ExpectedOutput {
    relative_name: String,
    mime: String,
}

/// What one source copy produced: the closed private file the engine reads,
/// the owned handle that disposes it afterwards, and the original file name
/// the parent uses (never a user path on the wire).
pub(crate) struct SpooledInput {
    pub(crate) path: PathBuf,
    pub(crate) name: String,
    copy: Option<fs_service::owned_io::ClosedOutput>,
}

impl SpooledInput {
    /// Remove the private copy; never touches the user's source.
    pub(crate) fn dispose(mut self) {
        if let Some(copy) = self.copy.take() {
            let _ = copy.dispose();
        }
    }
}

impl Drop for SpooledInput {
    fn drop(&mut self) {
        // Every early return (spawn failure, plan rejection, cancellation)
        // still removes our private copy. `dispose` clears the option first.
        if let Some(copy) = self.copy.take() {
            let _ = copy.dispose();
        }
    }
}

/// What the driver saw while the child ran.
struct DriveOutcome {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: String,
    cancelled: bool,
    timed_out: bool,
}

fn plan_for(
    request: &EngineRequest,
    program: &Path,
    dirs: &PrivateDirs,
    spooled: &HashMap<u32, SpooledInput>,
) -> Result<LaunchPlan, String> {
    let mut environment = Vec::new();
    let (arguments, expected, metadata_lost, memory_bytes) = match &request.action {
        EngineAction::ProbeMedia { inputs } => {
            let input = spooled
                .get(&inputs[0].input_index)
                .ok_or_else(|| EngineError::BadRequest.message())?;
            (
                media_arguments::probe_arguments(&input.path),
                Vec::new(),
                Vec::new(),
                MEDIA_MEMORY_BYTES,
            )
        }
        EngineAction::PreviewMedia { inputs, options } => {
            let input = spooled
                .get(&inputs[0].input_index)
                .ok_or_else(|| EngineError::BadRequest.message())?;
            let audio_only = input_is_audio(input);
            let output_name = if audio_only {
                "sample.wav".to_string()
            } else {
                "sample.webm".to_string()
            };
            let output = dirs.output.path().join(&output_name);
            let start_us = options.start_ms.unwrap_or(0).saturating_mul(1000);
            (
                media_arguments::preview_arguments(
                    &input.path,
                    &output,
                    start_us,
                    crate::engine_types::PREVIEW_SAMPLE_US,
                    audio_only,
                ),
                vec![ExpectedOutput {
                    relative_name: output_name,
                    mime: if audio_only {
                        "audio/wav".to_string()
                    } else {
                        "video/webm".to_string()
                    },
                }],
                Vec::new(),
                MEDIA_MEMORY_BYTES,
            )
        }
        EngineAction::ConvertMedia {
            inputs,
            output_format,
            options,
            ..
        } => {
            let input = spooled
                .get(&inputs[0].input_index)
                .ok_or_else(|| EngineError::BadRequest.message())?;
            let name = media_arguments::format_name(output_format);
            let output_name = format!("converted.{name}");
            let output = dirs.output.path().join(&output_name);
            let video = output_is_video(output_format);
            let mut lost = Vec::new();
            if !options.keep_metadata {
                lost.extend(default_metadata_loss());
            }
            (
                media_arguments::convert_arguments(
                    &input.path,
                    &output,
                    output_format,
                    options,
                    video,
                ),
                vec![ExpectedOutput {
                    relative_name: output_name,
                    mime: media_arguments::format_mime(output_format).to_string(),
                }],
                lost,
                MEDIA_MEMORY_BYTES,
            )
        }
        EngineAction::RenderOffice { inputs, options } => {
            let input = spooled
                .get(&inputs[0].input_index)
                .ok_or_else(|| EngineError::BadRequest.message())?;
            let profile = office_profile::write_profile(dirs.staging.path())?;
            let kit = crate::office_kit_arguments::is_kit_worker(program);
            if kit
                && (options.target != crate::engine_types::OfficeRenderTarget::Pdf
                    || options.include_comments
                    || options.include_notes
                    || !options.ranges.is_empty())
            {
                return Err(EngineError::Unsupported.message());
            }
            // PATH names the verified pack directory, never the executable
            // file itself.
            let pack_dir = program.parent().unwrap_or(program);
            environment = office_profile::environment(&profile, pack_dir);
            // `--convert-to` names the result after the private input stem,
            // not after an arbitrary label. The private copy is already
            // `input-<index>.<ext>`, so that is the exact name to verify.
            let stem = input
                .path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .ok_or_else(|| EngineError::Failed.message())?;
            let name = format!("{stem}.{}", options.target.extension());
            let expected = vec![ExpectedOutput {
                relative_name: name,
                mime: options.target.mime().to_string(),
            }];
            (
                if kit {
                    crate::office_kit_arguments::pdf_arguments(
                        program,
                        &input.path,
                        &dirs.output.path().join(&expected[0].relative_name),
                        &profile,
                    )
                } else {
                    office_profile::one_shot_arguments(
                        &input.path,
                        dirs.output.path(),
                        &profile,
                        options.format,
                        options.target,
                        options.include_comments,
                    )
                },
                expected,
                Vec::new(),
                crate::engine_session_types::SESSION_MEMORY_BYTES,
            )
        }
    };
    Ok(LaunchPlan {
        arguments,
        environment,
        expected,
        metadata_lost,
        memory_bytes,
    })
}

fn input_is_audio(input: &SpooledInput) -> bool {
    matches!(
        input.name.rsplit_once('.').map(|(_, extension)| extension.to_ascii_lowercase()),
        Some(extension) if ["mp3", "wav", "flac", "ogg", "opus", "aac", "m4a"].contains(&extension.as_str())
    )
}

fn output_is_video(format: &convert::FormatId) -> bool {
    matches!(
        media_arguments::format_name(format),
        "webm" | "mp4" | "mkv" | "mov" | "gif"
    )
}

/// Metadata categories a conversion cannot keep when metadata is cleared.
fn default_metadata_loss() -> Vec<convert::MetadataCategory> {
    vec![
        convert::MetadataCategory::Exif,
        convert::MetadataCategory::Xmp,
        convert::MetadataCategory::Date,
        convert::MetadataCategory::Encoder,
    ]
}

fn map_pack_error(code: &str, _capability: EngineCapabilityId) -> String {
    match code {
        // `changed` is what `capability_path` returns when the installed file
        // no longer matches the signed size/hash: never retry it as a generic
        // failure or a missing pack.
        "packs.bad_hash" | "packs.bad_signature" | "packs.changed" => {
            EngineError::UnsafeBuild.message()
        }
        "packs.busy" => EngineError::Busy.message(),
        // A missing capability and a missing pack look the same to the user:
        // the optional pack is not installed for this purpose.
        _ => EngineError::PackMissing.message(),
    }
}

fn map_diagnostics(codes: &[crate::engine_types::EngineDiagnostic]) -> String {
    use crate::engine_types::EngineDiagnostic;
    for code in codes {
        match code {
            EngineDiagnostic::SandboxDenied => return EngineError::SandboxFailed.message(),
            EngineDiagnostic::NoSpace => return EngineError::Failed.message(),
            EngineDiagnostic::MacrosBlocked | EngineDiagnostic::ExternalLinkBlocked => {
                return EngineError::Unsupported.message()
            }
            _ => {}
        }
    }
    EngineError::Failed.message()
}

/// Copy one authorized input into the private folder. The copy is closed
/// before the engine may read it and stays owned by the returned value.
pub(crate) fn spool_input(
    input: &EngineInput,
    directory: &PinnedDirectory,
    max_bytes: u64,
) -> Result<SpooledInput, String> {
    input.refuse_sensitive().map_err(EngineError::message)?;
    let (name, source_name) = match &input.original {
        convert::ConversionInput::File { path, .. } => (
            format!("input-{}.{}", input.input_index, extension_of(path)),
            file_name_of(path),
        ),
        convert::ConversionInput::Snapshot { document_id, .. } => {
            let EngineSource::Snapshot(lease) = &input.source else {
                return Err(EngineError::Changed.message());
            };
            (
                format!(
                    "input-{}.{}",
                    input.input_index,
                    snapshot_extension(&lease.snapshot.mime)
                ),
                document_id.clone(),
            )
        }
    };
    let mut owned =
        OwnedOutput::create(directory, &name).map_err(|_| EngineError::SandboxFailed.message())?;
    let mut byte_len = 0u64;
    match &input.source {
        EngineSource::Disk(pinned) => {
            let mut file = pinned.file();
            let mut buffer = vec![0u8; 1024 * 1024];
            loop {
                let read = file
                    .read(&mut buffer)
                    .map_err(|_| EngineError::Failed.message())?;
                if read == 0 {
                    break;
                }
                byte_len = byte_len.saturating_add(read as u64);
                if byte_len > max_bytes {
                    return Err(EngineError::BadRequest.message());
                }
                owned
                    .file_mut()
                    .write_all(&buffer[..read])
                    .map_err(|_| EngineError::Failed.message())?;
            }
            // The copy is only usable while the source handle still names the
            // file the user authorized.
            pinned
                .verify_after_read()
                .map_err(|_| EngineError::Changed.message())?;
        }
        EngineSource::Snapshot(lease) => {
            if lease.snapshot.byte_len > max_bytes {
                return Err(EngineError::BadRequest.message());
            }
            let mut reader = lease.backing.reader();
            let mut hasher = sha2::Sha256::new();
            let mut buffer = vec![0u8; 1024 * 1024];
            loop {
                let read = reader
                    .read(&mut buffer)
                    .map_err(|_| EngineError::Changed.message())?;
                if read == 0 {
                    break;
                }
                byte_len += read as u64;
                if byte_len > lease.snapshot.byte_len {
                    return Err(EngineError::Changed.message());
                }
                sha2::Digest::update(&mut hasher, &buffer[..read]);
                owned
                    .file_mut()
                    .write_all(&buffer[..read])
                    .map_err(|_| EngineError::Failed.message())?;
            }
            if byte_len != lease.snapshot.byte_len
                || format!("{:x}", sha2::Digest::finalize(hasher)) != lease.content_sha256
            {
                return Err(EngineError::Changed.message());
            }
        }
    }
    // A snapshot's stamp identifies its original disk source, not the
    // encoded live model. Its own length and hash were checked above.
    if let Some(stamp) = input
        .stamp
        .as_ref()
        .filter(|_| matches!(&input.source, EngineSource::Disk(_)))
    {
        if stamp.size_bytes != byte_len {
            return Err(EngineError::Changed.message());
        }
    }
    owned
        .flush_sync()
        .map_err(|_| EngineError::Failed.message())?;
    // The child can only open the file once this handle is closed; the
    // `ClosedOutput` still knows which exact file it wrote.
    let copy = owned.close();
    let path = copy.path().to_path_buf();
    Ok(SpooledInput {
        path,
        name: source_name,
        copy: Some(copy),
    })
}

fn snapshot_extension(mime: &str) -> &'static str {
    // One MIME table lives on `OfficeFormat`; an unknown snapshot type stays
    // `.dat` and is refused by preflight instead of guessing a container.
    crate::engine_types::OfficeFormat::from_mime(mime)
        .map(crate::engine_types::OfficeFormat::as_str)
        .unwrap_or("dat")
}

fn extension_of(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty() && extension.len() <= 16)
        .unwrap_or_else(|| "dat".to_string())
}

fn file_name_of(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

/// Watch the child until it ends, the caller cancels or a deadline passes.
fn drive(
    process: &mut crate::engine_security::ConfinedProcess,
    stdout_lines: &std::sync::mpsc::Receiver<StreamItem>,
    request: &EngineRequest,
    context: &JobContext,
) -> Result<DriveOutcome, String> {
    let token: &CancellationToken = context.token();
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    let mut tracker = ProgressTracker::default();
    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut last_activity = Instant::now();
    let mut cancelled = false;
    let mut timed_out = false;
    let mut stdout_closed = false;
    let mut stderr_closed = false;

    loop {
        if token.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let now = Instant::now();
        if now >= deadline {
            timed_out = true;
            break;
        }
        if last_activity.elapsed() > Duration::from_millis(crate::engine_types::EXPORT_HEARTBEAT_MS)
        {
            timed_out = true;
            break;
        }
        let mut saw_line = false;
        for _ in 0..16 {
            if stdout_closed {
                break;
            }
            let Some(item) = next_item(stdout_lines, Duration::from_millis(0)) else {
                break;
            };
            last_activity = Instant::now();
            match item {
                StreamItem::Line(line) => {
                    tracker.observe(&line);
                    saw_line = true;
                    if request.action.capability() == EngineCapabilityId::MediaProbe {
                        stdout.extend_from_slice(line.as_bytes());
                        stdout.push(b'\n');
                        if stdout.len() > MAX_STDOUT_BYTES {
                            return Err(EngineError::Failed.message());
                        }
                    }
                }
                StreamItem::Overflow => return Err(EngineError::Failed.message()),
                StreamItem::Closed => stdout_closed = true,
            }
        }
        if saw_line {
            // `bytes_done` carries the monotonic completed media time of D4;
            // `current` stays empty because it would be untranslated text.
            context.set_progress(&OpProgress {
                items_done: 0,
                items_total: 1,
                bytes_done: tracker.completed_us(),
                bytes_total: 0,
                current: String::new(),
            });
        }
        if !stderr_closed {
            for _ in 0..64 {
                let Some(item) = next_item(process.stderr(), Duration::from_millis(0)) else {
                    break;
                };
                match item {
                    StreamItem::Line(line) => {
                        if stderr.len() + line.len() < crate::engine_io::MAX_STDERR_BYTES {
                            stderr.push_str(&line);
                            stderr.push('\n');
                        }
                        last_activity = Instant::now();
                    }
                    // More than 1 MiB of diagnostics is a bounded failure.
                    StreamItem::Overflow => return Err(EngineError::Failed.message()),
                    StreamItem::Closed => {
                        stderr_closed = true;
                        break;
                    }
                }
            }
        }
        if let Some(exit_code) = process.wait(Duration::from_millis(TICK_MS)) {
            // The process ending does not mean its pipes are drained: a probe
            // writes its JSON and exits immediately. Read the remaining
            // bounded lines before reporting the exit, or a valid result
            // would look truncated.
            let drain_deadline = Instant::now() + Duration::from_millis(2_000);
            while (!stdout_closed || !stderr_closed) && Instant::now() < drain_deadline {
                let mut drained = false;
                if !stdout_closed {
                    for _ in 0..64 {
                        let Some(item) = next_item(stdout_lines, Duration::from_millis(0)) else {
                            break;
                        };
                        drained = true;
                        match item {
                            StreamItem::Line(line) => {
                                tracker.observe(&line);
                                if request.action.capability() == EngineCapabilityId::MediaProbe {
                                    stdout.extend_from_slice(line.as_bytes());
                                    stdout.push(b'\n');
                                    if stdout.len() > MAX_STDOUT_BYTES {
                                        return Err(EngineError::Failed.message());
                                    }
                                }
                            }
                            StreamItem::Overflow => return Err(EngineError::Failed.message()),
                            StreamItem::Closed => stdout_closed = true,
                        }
                    }
                }
                if !stderr_closed {
                    for _ in 0..64 {
                        let Some(item) = next_item(process.stderr(), Duration::from_millis(0))
                        else {
                            break;
                        };
                        drained = true;
                        match item {
                            StreamItem::Line(line) => {
                                if stderr.len() + line.len() < crate::engine_io::MAX_STDERR_BYTES {
                                    stderr.push_str(&line);
                                    stderr.push('\n');
                                }
                            }
                            StreamItem::Overflow => return Err(EngineError::Failed.message()),
                            StreamItem::Closed => stderr_closed = true,
                        }
                    }
                }
                if !drained {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            context.set_progress(&OpProgress {
                items_done: 1,
                items_total: 1,
                bytes_done: tracker.completed_us(),
                bytes_total: 0,
                current: String::new(),
            });
            return Ok(DriveOutcome {
                exit_code,
                stdout,
                stderr,
                cancelled: false,
                timed_out: false,
            });
        }
    }

    // Cancel or deadline: close stdin first, then end the whole job.
    process.close_stdin();
    let waited = process.wait(Duration::from_millis(CANCEL_GRACE_MS));
    let exit_code = match waited {
        Some(code) => code,
        None => {
            process.terminate();
            1
        }
    };
    Ok(DriveOutcome {
        exit_code,
        stdout,
        stderr,
        cancelled,
        timed_out,
    })
}

/// Copy every validated artifact into an owned output; refuse extras.
fn collect_outputs(
    dirs: &PrivateDirs,
    expected: &[ExpectedOutput],
    max_total: u64,
) -> Result<Vec<EngineOutput>, String> {
    let failed = || EngineError::Failed.message();
    let mut entries: Vec<PathBuf> = Vec::new();
    for entry in std::fs::read_dir(dirs.output.path()).map_err(|_| failed())? {
        let entry = entry.map_err(|_| failed())?;
        if entries.len() >= crate::engine_types::MAX_ENGINE_OUTPUTS {
            return Err(failed());
        }
        entries.push(entry.path());
    }
    if entries.len() != expected.len() {
        // A missing or unexpected artifact is a failure, before any output is
        // handed to the sink.
        return Err(failed());
    }
    let mut outputs = Vec::new();
    let mut total: u64 = 0;
    for wanted in expected {
        let wanted_name = &wanted.relative_name;
        let source = entries
            .iter()
            .find(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy() == *wanted_name)
                    .unwrap_or(false)
            })
            .ok_or_else(failed)?;
        // The child must have written a plain file, not a reparse point or a
        // hardlink to something outside its private output folder.
        let metadata = std::fs::symlink_metadata(source).map_err(|_| failed())?;
        if !metadata.is_file() || is_reparse(&metadata) {
            return Err(failed());
        }
        let mut file = std::fs::File::open(source).map_err(|_| failed())?;
        if fs_service::owned_io::handle_link_count(&file).map_err(|_| failed())? > 1 {
            return Err(failed());
        }
        if metadata.len() > max_total {
            return Err(failed());
        }
        total = total.saturating_add(metadata.len());
        if total > max_total {
            return Err(failed());
        }
        let opened = file.metadata().map_err(|_| failed())?;
        if !opened.is_file() || opened.len() != metadata.len() {
            return Err(failed());
        }
        let mut owned = OwnedOutput::create(&dirs.staging, wanted_name).map_err(|_| failed())?;
        let mut hasher = sha2::Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        let mut copied: u64 = 0;
        loop {
            let read = file.read(&mut buffer).map_err(|_| failed())?;
            if read == 0 {
                break;
            }
            copied = copied.saturating_add(read as u64);
            hasher.update(&buffer[..read]);
            owned
                .file_mut()
                .write_all(&buffer[..read])
                .map_err(|_| failed())?;
        }
        if copied != metadata.len() {
            // The artifact changed while it was being copied.
            return Err(failed());
        }
        owned.flush_sync().map_err(|_| failed())?;
        outputs.push(EngineOutput {
            output_id: Uuid::new_v4(),
            relative_name: wanted_name.clone(),
            mime: wanted.mime.clone(),
            byte_len: copied,
            content_hash_sha256: hex::encode(hasher.finalize()),
            owned_output: owned,
        });
    }
    Ok(outputs)
}

#[cfg(windows)]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

/// `engines_capabilities` (E1): what the installed packs actually support.
#[tauri::command]
pub fn engines_capabilities(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Arc<EngineHost>>,
) -> Result<Vec<EngineCapability>, String> {
    crate::ensure_main(window.label())?;
    // The app manages one `Arc<EngineHost>` (shared with preview/probe); the
    // command must read that exact instance, not a second managed value.
    Ok(host.capabilities())
}

#[cfg(test)]
mod tests {
    use super::{default_metadata_loss, extension_of, file_name_of};

    #[test]
    fn private_names_never_escape_the_folder() {
        assert_eq!(extension_of("C:\\clips\\a.MP4"), "mp4");
        assert_eq!(extension_of("no-extension"), "dat");
        assert_eq!(file_name_of("C:\\clips\\a.mp4"), "a.mp4");
    }

    #[test]
    fn clearing_metadata_names_every_lost_category() {
        let lost = default_metadata_loss();
        assert!(lost.contains(&convert::MetadataCategory::Encoder));
        assert!(lost.contains(&convert::MetadataCategory::Date));
    }
}
