//! The persistent, confined Office read actor (Step 12b E7).
//!
//! One actor process tree exists at a time. It starts only from a verified,
//! signed pack that advertises the `office_read_bridge` entrypoint; until such
//! a pack exists, `start_session` returns `engines.pack_missing` and nothing is
//! launched. The bridge (13 T3) speaks the framed protocol of
//! `engine_session_protocol`; this module owns the child, its private input and
//! output folders, and at most four read-only documents with their private
//! source copies.
//!
//! Every method does blocking pipe I/O. Callers run them on a blocking worker
//! thread, never the UI thread, and hold the session behind their own
//! `Arc<Mutex<..>>`. A dead or cancelled actor marks every document unusable
//! instead of pretending a warm session survived.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant};

use fs_service::owned_io::PinnedDirectory;
use sha2::Digest;
use uuid::Uuid;

use crate::engine_io::{next_frame, spawn_frame_reader, FrameItem};
use crate::engine_process::{spool_input, Counter, EngineHost, SpooledInput};
use crate::engine_security::{spawn_confined, ConfinedProcess, EngineLaunch, StdoutMode};
use crate::engine_session_protocol::{
    decode_heartbeat, decode_reply, send_cancel, send_request, KIND_HEARTBEAT, KIND_REPLY,
};
use crate::engine_session_types::{
    EngineReadDocument, EngineSessionArtifact, EngineSessionCommand,
    EngineSessionReplyResult, EngineSessionRequest, EngineSessionStart,
    OfficeSessionRenderRequest, ACTOR_KILL_GRACE_MS, CLOSE_DOCUMENT_TIMEOUT_MS, MAX_ARTIFACT_BYTES,
    MAX_CONTROL_FRAME_BYTES, MAX_QUEUED_COMMANDS, MAX_RENDER_BYTES, MAX_SESSION_DOCUMENTS,
    OPEN_DOCUMENT_TIMEOUT_MS, RENDER_TIMEOUT_MS, SESSION_HEARTBEAT_MS, SESSION_IDLE_SECONDS,
    SESSION_MEMORY_BYTES, SESSION_PROTOCOL_VERSION, SESSION_START_TIMEOUT_MS,
};
use crate::engine_types::{
    is_sha256_hex, EngineCapabilityId, EngineError, EngineInput, EngineOutput, OfficeFormat,
    OfficeRenderTarget, OfficeRenderedArtifact, RenderedOffice,
};
use crate::jobs::JobContext;

/// The private folders one actor owns.
struct SessionDirs {
    input: PinnedDirectory,
    output: PinnedDirectory,
}

/// One live read-only document: the retained input authorization and the
/// closed source copy the child may read.
struct LiveDocument {
    read: EngineReadDocument,
    input: Option<EngineInput>,
    copy: Option<SpooledInput>,
}

impl LiveDocument {
    /// Release the authorization and remove only our private copy.
    fn dispose(mut self) {
        if let Some(copy) = self.copy.take() {
            copy.dispose();
        }
        self.input.take();
    }
}

/// The Office read actor. Not `Clone`, not serializable: 13 owns one.
pub struct EngineSession {
    process: ConfinedProcess,
    frames: Receiver<FrameItem>,
    lease: Option<pack_store::PackLease>,
    dirs: SessionDirs,
    documents: HashMap<Uuid, LiveDocument>,
    idle_since: Option<Instant>,
    started_at: Instant,
    /// True after the bridge answered its first command; only the startup
    /// window is bounded by `started_at`, never a later close or render.
    established: bool,
    dead: bool,
    closed: bool,
    queued: usize,
    actors: Arc<Counter>,
}

impl Drop for EngineSession {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

impl EngineHost {
    /// E7: start the single confined Office read actor. Blocking; run it on a
    /// blocking worker thread.
    pub fn start_session(
        &self,
        start: EngineSessionStart,
        context: &JobContext,
    ) -> Result<EngineSession, String> {
        start.validate().map_err(|error| error.message())?;
        if context.token().load(Ordering::Relaxed) {
            return Err(EngineError::Cancelled.message());
        }
        let actors = self.office_actor_counter();
        if !actors.try_acquire() {
            return Err(EngineError::Busy.message());
        }
        let started = self.start_session_inner(actors.clone(), context);
        if started.is_err() {
            actors.release();
        }
        started
    }

    fn start_session_inner(
        &self,
        actors: Arc<Counter>,
        context: &JobContext,
    ) -> Result<EngineSession, String> {
        // Without a verified signed bridge there is no actor: no placeholder
        // process and no unrestricted fallback.
        let (lease, program) = self.acquire(EngineCapabilityId::OfficeReadBridge)?;
        if context.token().load(Ordering::Relaxed) {
            return Err(EngineError::Cancelled.message());
        }
        let sandbox = self.sandbox()?;
        // Only the exact hash-verified bridge's directory is readable; wider
        // pack paths need a signed inventory check of every file first.
        if let Some(parent) = program.parent() {
            sandbox.grant_read(parent)?;
        }
        let (root, pinned_root) = self.new_private_root("office-session")?;
        let temp = root.join("profile");
        for path in [root.join("input"), root.join("output"), temp.clone()] {
            std::fs::create_dir_all(&path).map_err(|_| EngineError::SandboxFailed.message())?;
            sandbox.grant_private(&path)?;
        }
        let input = PinnedDirectory::open(&root.join("input"))
            .map_err(|_| EngineError::SandboxFailed.message())?;
        let output = PinnedDirectory::open(&root.join("output"))
            .map_err(|_| EngineError::SandboxFailed.message())?;
        let environment = vec![
            ("TEMP".to_string(), temp.to_string_lossy().into_owned()),
            ("TMP".to_string(), temp.to_string_lossy().into_owned()),
            (
                "PATH".to_string(),
                program
                    .parent()
                    .map(|parent| parent.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            ),
        ];
        let launch = EngineLaunch {
            program: &program,
            // The bridge takes no command-line arguments: everything it needs
            // arrives in framed requests.
            arguments: String::new(),
            working_directory: &root,
            environment,
            memory_bytes: SESSION_MEMORY_BYTES,
            cpu_percent: crate::engine_process::ENGINE_CPU_PERCENT,
            stdout_mode: StdoutMode::Raw,
        };
        let mut process = spawn_confined(&sandbox, &launch)?;
        let stdout = process
            .take_stdout_reader()
            .ok_or_else(|| EngineError::SandboxFailed.message())?;
        let frames = spawn_frame_reader(stdout, MAX_CONTROL_FRAME_BYTES);
        drop(pinned_root);
        Ok(EngineSession {
            process,
            frames,
            lease: Some(lease),
            dirs: SessionDirs { input, output },
            documents: HashMap::new(),
            idle_since: None,
            started_at: Instant::now(),
            established: false,
            dead: false,
            closed: false,
            queued: 0,
            actors,
        })
    }
}

impl EngineSession {
    /// Open one read-only document from an authorized input. The input and its
    /// private copy stay owned until `close_document`.
    pub fn open_document(
        &mut self,
        input: EngineInput,
        format: OfficeFormat,
        context: &JobContext,
    ) -> Result<EngineReadDocument, String> {
        self.ensure_alive()?;
        // A sensitive document is refused before anything is copied (D3).
        input.refuse_sensitive().map_err(EngineError::message)?;
        if self.documents.len() >= usize::from(MAX_SESSION_DOCUMENTS) {
            return Err(EngineError::Busy.message());
        }
        if format.is_template() {
            return Err(EngineError::Unsupported.message());
        }
        // The caller's format must describe this exact authorized input; a
        // snapshot is identified by its MIME, a disk file by its suffix.
        if input.office_format() != Some(format) {
            return Err(EngineError::Unsupported.message());
        }
        let document_id = Uuid::new_v4();
        // The source identity comes from the authorized input before it moves
        // into the session: a snapshot keeps its exact revision/content ID,
        // an unedited disk file is revision 1 with no content ID.
        let source_revision = input.source_revision();
        let source_content_id = input.source_content_id();
        let spooled = spool_input(
            &input,
            &self.dirs.input,
            crate::engine_types::OFFICE_MAX_SOURCE_BYTES,
        )?;
        let Some(copy_name) = spooled
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            spooled.dispose();
            return Err(EngineError::Failed.message());
        };
        // Preflight refuses macros, external relationships and DDE before the
        // bridge ever opens the file.
        if let Err(error) = crate::office_preflight::preflight(&spooled.path, format) {
            spooled.dispose();
            return Err(error);
        }
        let reply = self.exchange(
            EngineSessionCommand::Open {
                document_id,
                input_name: copy_name,
                format,
                source_revision,
                source_content_id,
            },
            OPEN_DOCUMENT_TIMEOUT_MS,
            Some(context),
        );
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                spooled.dispose();
                return Err(error);
            }
        };
        let document = match reply {
            EngineSessionReplyResult::Opened { document } => document,
            EngineSessionReplyResult::Error { code } => {
                self.fail();
                spooled.dispose();
                return Err(code.message());
            }
            _ => {
                self.fail();
                spooled.dispose();
                return Err(EngineError::Failed.message());
            }
        };
        // The reply must describe exactly the document we asked for.
        if document.document_id != document_id
            || document.format != format
            || document.source_revision != source_revision
            || document.source_content_id != source_content_id
        {
            self.fail();
            spooled.dispose();
            return Err(EngineError::Changed.message());
        }
        if let Err(error) = document.validate() {
            spooled.dispose();
            self.fail();
            return Err(error.message());
        }
        self.idle_since = None;
        self.documents.insert(
            document_id,
            LiveDocument {
                read: document.clone(),
                input: Some(input),
                copy: Some(spooled),
            },
        );
        Ok(document)
    }

    /// Render selected sections of one open document into owned artifacts.
    pub fn render_document(
        &mut self,
        request: &OfficeSessionRenderRequest,
        context: &JobContext,
    ) -> Result<RenderedOffice, String> {
        self.ensure_alive()?;
        request.validate().map_err(|error| error.message())?;
        let (engine_version, source_revision) = {
            let document = self
                .documents
                .get(&request.document_id)
                .ok_or_else(|| EngineError::Changed.message())?;
            if !request.selects_known_sections(&document.read) {
                return Err(EngineError::BadRequest.message());
            }
            (
                document.read.engine_version.clone(),
                document.read.source_revision,
            )
        };
        let requested: HashSet<&str> = request.section_ids.iter().map(String::as_str).collect();
        let reply = self.exchange(
            EngineSessionCommand::Render {
                request: request.clone(),
            },
            RENDER_TIMEOUT_MS,
            Some(context),
        )?;
        let artifacts = match reply {
            EngineSessionReplyResult::Rendered { artifacts } => artifacts,
            EngineSessionReplyResult::Error { code } => {
                self.fail();
                return Err(code.message());
            }
            _ => {
                self.fail();
                return Err(EngineError::Failed.message());
            }
        };
        let mut outputs = Vec::new();
        let mut total: u64 = 0;
        let mut returned: HashSet<String> = HashSet::new();
        let mut sections_returned: HashSet<String> = HashSet::new();
        for artifact in &artifacts {
            if let Err(error) = artifact.validate() {
                // A malformed artifact means the bridge is not trustworthy.
                self.fail();
                return Err(error.message());
            }
            // The bridge may only answer for the exact sections and target
            // this call requested; an extra section is not a bonus artifact.
            if !requested.contains(artifact.section_id.as_str())
                || artifact.format != request.target
            {
                self.fail();
                return Err(EngineError::Failed.message());
            }
            if !sections_returned.insert(artifact.section_id.clone()) {
                self.fail();
                return Err(EngineError::Failed.message());
            }
            if !returned.insert(artifact.relative_name.clone()) {
                self.fail();
                return Err(EngineError::Failed.message());
            }
            let output = self.copy_artifact(artifact)?;
            total = total.saturating_add(output.byte_len);
            if total > MAX_RENDER_BYTES {
                self.fail();
                return Err(EngineError::Failed.message());
            }
            outputs.push(OfficeRenderedArtifact {
                output,
                section_id: artifact.section_id.clone(),
                format: artifact.format,
                page_count: artifact.page_count,
            });
        }
        self.refuse_unexpected_artifacts(&returned)?;
        let mut rendered = RenderedOffice {
            artifacts: outputs,
            engine_version,
            source_revision,
        };
        rendered.validate().map_err(|error| error.message())?;
        Ok(rendered)
    }

    /// Close one document; an unknown ID changes nothing.
    pub fn close_document(
        &mut self,
        document_id: Uuid,
        _context: &JobContext,
    ) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        let Some(document) = self.documents.remove(&document_id) else {
            return Ok(());
        };
        if !self.dead {
            let reply = self.exchange(
                EngineSessionCommand::CloseDocument { document_id },
                CLOSE_DOCUMENT_TIMEOUT_MS,
                None,
            );
            match reply {
                Ok(EngineSessionReplyResult::Closed {}) => {}
                Ok(EngineSessionReplyResult::Error { code }) => {
                    document.dispose();
                    self.fail();
                    return Err(code.message());
                }
                Ok(_) => {
                    document.dispose();
                    self.fail();
                    return Err(EngineError::Failed.message());
                }
                // A hung close ends the whole actor: no half-closed document
                // is left behind pretending to be reusable.
                Err(_) => {
                    document.dispose();
                    self.fail();
                    return Err(EngineError::Timeout.message());
                }
            }
        }
        document.dispose();
        if self.documents.is_empty() {
            // The idle countdown starts after the final document closes.
            self.idle_since = Some(Instant::now());
        }
        Ok(())
    }

    /// True once no document has been open for the whole idle window.
    pub fn idle_expired(&self, now: Instant) -> bool {
        self.documents.is_empty()
            && self.idle_since.is_some_and(|since| {
                now.duration_since(since) >= Duration::from_secs(u64::from(SESSION_IDLE_SECONDS))
            })
    }

    /// Reopening before the idle window ends cancels the countdown.
    pub fn cancel_idle(&mut self) {
        if !self.documents.is_empty() {
            self.idle_since = None;
        }
    }

    /// True while this session can still serve reads.
    pub fn is_alive(&self) -> bool {
        !self.dead && !self.closed
    }

    /// The number of documents this actor still holds open.
    pub fn open_documents(&self) -> usize {
        self.documents.len()
    }

    /// Close gracefully, then end the whole tree. Idempotent.
    pub fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        let documents: Vec<LiveDocument> = self.documents.drain().map(|(_, doc)| doc).collect();
        for document in documents {
            document.dispose();
        }
        if !self.dead {
            let _ = self.exchange(EngineSessionCommand::Close {}, 1_000, None);
            if self
                .process
                .wait(Duration::from_millis(ACTOR_KILL_GRACE_MS))
                .is_none()
            {
                self.process.terminate();
                let _ = self.process.wait(Duration::from_secs(2));
            }
        }
        // The pack version is released only after the child is dead.
        self.lease.take();
        self.actors.release();
        Ok(())
    }

    fn ensure_alive(&self) -> Result<(), String> {
        if self.closed {
            return Err(EngineError::Cancelled.message());
        }
        if self.dead {
            return Err(EngineError::Failed.message());
        }
        Ok(())
    }

    /// A dead actor invalidates every handle it handed out.
    fn fail(&mut self) {
        self.dead = true;
        self.process.terminate();
        let _ = self.process.wait(Duration::from_millis(ACTOR_KILL_GRACE_MS));
    }

    /// Send one command and wait for its reply, honouring the deadline, the
    /// cancellation token and the heartbeat silence limit.
    fn exchange(
        &mut self,
        command: EngineSessionCommand,
        timeout_ms: u64,
        context: Option<&JobContext>,
    ) -> Result<EngineSessionReplyResult, String> {
        if self.queued >= MAX_QUEUED_COMMANDS {
            return Err(EngineError::Busy.message());
        }
        let request_id = Uuid::new_v4();
        let request = EngineSessionRequest {
            protocol_version: SESSION_PROTOCOL_VERSION,
            request_id,
            command,
        };
        self.write_request(&request)?;
        let mut deadline = Instant::now() + Duration::from_millis(timeout_ms);
        // Before the bridge answers its first command, the whole startup
        // window bounds every answer: a bridge that needs longer than 60 s is
        // not usable. Once established, later calls use only their own
        // deadline (closing the final document is not a startup).
        if !self.established {
            let startup_deadline =
                self.started_at + Duration::from_millis(SESSION_START_TIMEOUT_MS);
            deadline = deadline.min(startup_deadline);
        }
        let mut last_heartbeat = Instant::now();
        loop {
            if context.is_some_and(|context| context.token().load(Ordering::Relaxed)) {
                self.write_cancel(request_id);
                self.fail();
                return Err(EngineError::Cancelled.message());
            }
            let now = Instant::now();
            if now >= deadline
                || last_heartbeat.elapsed() > Duration::from_millis(SESSION_HEARTBEAT_MS)
            {
                self.fail();
                return Err(EngineError::Timeout.message());
            }
            let Some(item) = next_frame(&self.frames, Duration::from_millis(50)) else {
                continue;
            };
            match item {
                FrameItem::Frame { kind, payload } if kind == KIND_HEARTBEAT => {
                    match decode_heartbeat(&payload) {
                        Ok(_) => last_heartbeat = Instant::now(),
                        Err(error) => {
                            // A malformed heartbeat is damaged wire, not a
                            // reason to keep waiting on the same actor.
                            self.fail();
                            return Err(error.message());
                        }
                    }
                }
                FrameItem::Frame { kind, payload } if kind == KIND_REPLY => {
                    return match decode_reply(&payload, request_id) {
                        Ok(reply) => {
                            self.established = true;
                            Ok(reply.result)
                        }
                        Err(error) => {
                            self.fail();
                            Err(error.message())
                        }
                    };
                }
                // Unknown kinds, truncated frames and closings all mean the
                // actor is no longer trustworthy.
                _ => {
                    self.fail();
                    return Err(EngineError::Failed.message());
                }
            }
        }
    }

    fn write_request(&mut self, request: &EngineSessionRequest) -> Result<(), String> {
        self.queued += 1;
        let outcome = send_request(&mut StdinWriter(&mut self.process), request);
        self.queued = self.queued.saturating_sub(1);
        if outcome.is_err() {
            self.fail();
        }
        outcome.map(|_| ()).map_err(|error| error.message())
    }

    fn write_cancel(&mut self, request_id: Uuid) {
        let _ = send_cancel(&mut StdinWriter(&mut self.process), request_id);
    }

    /// Copy one validated private artifact into an owned output.
    fn copy_artifact(&mut self, artifact: &EngineSessionArtifact) -> Result<EngineOutput, String> {
        let path = self.dirs.output.path().join(&artifact.relative_name);
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| EngineError::Failed.message())?;
        if !metadata.is_file() || is_reparse(&metadata) {
            self.fail();
            return Err(EngineError::Failed.message());
        }
        let mut source = File::open(&path).map_err(|_| EngineError::Failed.message())?;
        if fs_service::owned_io::handle_link_count(&source)
            .map_err(|_| EngineError::Failed.message())?
            > 1
        {
            self.fail();
            return Err(EngineError::Failed.message());
        }
        if metadata.len() != artifact.byte_len || artifact.byte_len > MAX_ARTIFACT_BYTES {
            self.fail();
            return Err(EngineError::Failed.message());
        }
        // An extension and a MIME string are claims; check the real header
        // before the bytes become a published artifact.
        let mut prefix = [0u8; 1024];
        let prefix_len = source
            .read(&mut prefix)
            .map_err(|_| EngineError::Failed.message())?;
        source
            .seek(SeekFrom::Start(0))
            .map_err(|_| EngineError::Failed.message())?;
        if !valid_artifact_prefix(&prefix[..prefix_len], artifact.format) {
            self.fail();
            return Err(EngineError::Changed.message());
        }
        // The copy lives in the same private output folder; its staging name
        // is the one this parent owns.
        let mut owned = fs_service::owned_io::OwnedOutput::create(
            &self.dirs.output,
            &artifact.relative_name,
        )
        .map_err(|_| EngineError::Failed.message())?;
        let mut hasher = sha2::Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = source
                .read(&mut buffer)
                .map_err(|_| EngineError::Failed.message())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            owned
                .file_mut()
                .write_all(&buffer[..read])
                .map_err(|_| EngineError::Failed.message())?;
        }
        owned
            .flush_sync()
            .map_err(|_| EngineError::Failed.message())?;
        let hash = hex::encode(hasher.finalize());
        if !is_sha256_hex(&hash) || hash != artifact.sha256 {
            self.fail();
            return Err(EngineError::Changed.message());
        }
        // The bridge's private artifact has been copied and verified; remove
        // it so a later render of another section is not rejected as an
        // unexpected leftover. This is our own temporary folder, not user data.
        drop(source);
        if std::fs::remove_file(&path).is_err() {
            self.fail();
            return Err(EngineError::Failed.message());
        }
        Ok(EngineOutput {
            output_id: Uuid::new_v4(),
            relative_name: artifact.relative_name.clone(),
            mime: artifact.mime.clone(),
            byte_len: artifact.byte_len,
            content_hash_sha256: hash,
            owned_output: owned,
        })
    }

    /// Refuse any file the bridge left behind that it did not report.
    fn refuse_unexpected_artifacts(&mut self, returned: &HashSet<String>) -> Result<(), String> {
        let Ok(entries) = std::fs::read_dir(self.dirs.output.path()) else {
            self.fail();
            return Err(EngineError::Failed.message());
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Our own staging copies are named `~adp-...` and are not the
            // bridge's artifacts.
            if returned.contains(&name) || name.starts_with("~adp-") {
                continue;
            }
            self.fail();
            return Err(EngineError::Failed.message());
        }
        Ok(())
    }
}

/// Adapts the child's stdin to `std::io::Write` without exposing the handle.
struct StdinWriter<'a>(&'a mut ConfinedProcess);

impl Write for StdinWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0
            .write_stdin(bytes)
            .map(|()| bytes.len())
            .map_err(|_| std::io::Error::other("engine.stdin"))
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The real header of one rendered artifact, independent of its name/claim.
fn valid_artifact_prefix(prefix: &[u8], format: OfficeRenderTarget) -> bool {
    match format {
        OfficeRenderTarget::Pdf => prefix.starts_with(b"%PDF-"),
        OfficeRenderTarget::Html => {
            let text = String::from_utf8_lossy(prefix);
            let text = text.trim_start_matches('\u{feff}').trim_start();
            let lowered = text.to_ascii_lowercase();
            lowered.starts_with("<!doctype html")
                || lowered.starts_with("<html")
                || lowered.starts_with("<head")
        }
        OfficeRenderTarget::Txt => !prefix.contains(&0),
    }
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


