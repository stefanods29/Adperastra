#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The trusted WebView helper host (Step 07d D2/D3/E7).
//!
//! A helper is a separate `Adperastra.exe` process with a static flag. Its
//! window is incognito, hidden, lives in its own data subfolder and serves
//! only its own grants. The parent owns the child: it refuses any sensitive
//! byte before the private-profile proof, mints the request ids and output
//! slots, checks every reply, every body length and every hash, and kills
//! the child on cancel or close. A child crash can never take the Explorer
//! down.
//!
//! The child registers exactly one command (`helper_reply`) and no main-app
//! capability; the parent's commands do not exist there.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fs_service::CancellationToken;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, Wry};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::file_grant_backing::GrantedBacking;
#[path = "webview_helper_admission.rs"]
mod admission;
use crate::helper_frames::{read_frame, FramedHelperProcess, HelperFrameEvent};
use crate::webview_helper_inputs::{ChildGrants, ChildInputState, InputRegistry};
use crate::webview_helper_protocol::{
    decode_control, encode_control, parse_output_path, validate_reply, validate_reply_shape,
    ActiveRequest, OutputSink,
};
use crate::webview_helper_types::{
    HelperControlFrame, HelperGrantDTO, HelperInputGrant, HelperInputManifest,
    HelperInputManifestSource, HelperInputSource, HelperOutput, HelperOutputReservation,
    HelperOutputSpec, HelperOutputStorage, HelperReplyEnvelope, HelperRequestEnvelope,
    WebviewHelperConfig, WebviewHelperKind, WebviewHelperRequest, WebviewHelperResult,
    CANCEL_GRACE, MAX_BODY_CHUNK, MAX_OUTPUT_SPECS, PROTOCOL_VERSION, READY_TIMEOUT,
    UPDATE_TIMEOUT,
};

/// Memory every helper child runs inside (768 MiB, D5).
pub const HELPER_MEMORY_LIMIT: usize = 768 * 1024 * 1024;
/// Framed pipe limit: one 1 MiB body plus its 24-byte prefix.
pub const HELPER_FRAME_BYTES: usize = 1_048_600;
/// First page render of a document has the longer wall timeout (D5).
pub const FIRST_RENDER_TIMEOUT: Duration = Duration::from_secs(15);
/// Every later request (D5).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// The generic helper flag; a static second argument names the kind.
pub const HELPER_FLAG: &str = "--webview-helper";
/// Longest one output body a child may produce (E7 cap is 1 GiB).
pub const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
/// How often a request is re-emitted while the frontend finishes loading.
const EMIT_RETRY: Duration = Duration::from_millis(250);
/// Largest number of emits for one request.
const MAX_EMITS: usize = 40;

/// The child window's label; only that window may answer a helper request.
pub fn helper_window_label(kind: WebviewHelperKind) -> &'static str {
    kind.window_label()
}

/// A helper command is only callable from the helper's own window.
pub fn ensure_helper_window(kind: WebviewHelperKind, label: &str) -> Result<(), String> {
    if label == helper_window_label(kind) {
        Ok(())
    } else {
        Err("command not allowed for window".to_string())
    }
}

// ---------------------------------------------------------------------------
// Parent side
// ---------------------------------------------------------------------------

/// One live helper child and everything the parent needs to talk to it.
pub struct WebviewHelperSession {
    kind: WebviewHelperKind,
    config: WebviewHelperConfig,
    process: FramedHelperProcess,
    inputs: InputRegistry,
    proof: Option<crate::webview_private::PrivateWebviewProof>,
    data_dir: PathBuf,
    closed: bool,
    rendered_once: bool,
    permit: Option<admission::HelperPermit>,
}

impl WebviewHelperSession {
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn kind(&self) -> WebviewHelperKind {
        self.kind
    }

    pub fn is_sensitive(&self) -> bool {
        self.inputs.is_sensitive()
    }

    /// The browser-safe grants the next request envelope carries.
    pub fn browser_grants(&self) -> &[HelperGrantDTO] {
        self.inputs.browser_grants()
    }

    /// Send one feature request and collect its verified answer.
    pub fn request(
        &mut self,
        request: WebviewHelperRequest,
        cancel: CancellationToken,
    ) -> Result<WebviewHelperResult, String> {
        if self.closed {
            return Err("helper.failed".to_string());
        }
        if !request.is_valid()
            || request.serialized_len()? > crate::webview_helper_types::MAX_CONTROL_BYTES
            || request.output_specs.len() > MAX_OUTPUT_SPECS
        {
            return Err("pdf.bad_request".to_string());
        }
        let mut reserved_total = 0u64;
        for spec in &request.output_specs {
            if !spec.is_valid(self.config.max_output_bytes) || spec.mime != "image/png" {
                return Err("pdf.bad_request".to_string());
            }
            reserved_total = reserved_total.saturating_add(spec.max_bytes);
        }
        if reserved_total > self.config.max_output_bytes {
            return Err("pdf.too_large".to_string());
        }
        let sensitive = self.inputs.is_sensitive();
        if sensitive && self.proof.is_none() {
            return Err("helper.sensitive_unsupported".to_string());
        }
        let reservations = mint_reservations(&request, sensitive);
        let active = ActiveRequest {
            request_id: request.request_id,
            action: request.action,
            reservations: reservations.clone(),
        };
        let envelope = HelperRequestEnvelope {
            protocol_version: PROTOCOL_VERSION,
            request_id: request.request_id,
            action: request.action,
            inputs: self.inputs.browser_grants().to_vec(),
            output_reservations: reservations.clone(),
            payload: request.payload.clone(),
        };
        let bytes = encode_control(&HelperControlFrame::Request { request: envelope })?;
        self.process.send_frame(1, &bytes)?;
        let timeout = match request.action {
            crate::webview_helper_types::HelperAction::PdfRender if !self.rendered_once => {
                FIRST_RENDER_TIMEOUT
            }
            crate::webview_helper_types::HelperAction::PdfPrint => Duration::from_secs(300),
            _ => REQUEST_TIMEOUT,
        };
        let reply = match self.collect_reply(&active, timeout, &cancel) {
            Ok(reply) => reply,
            Err(error) => {
                self.kill();
                return Err(error);
            }
        };
        let verified = validate_reply(&active, &reply)?;
        let outputs = self.collect_outputs(&reservations, &verified.outputs, &cancel)?;
        self.rendered_once |=
            request.action == crate::webview_helper_types::HelperAction::PdfRender;
        Ok(WebviewHelperResult {
            request_id: request.request_id,
            reply: verified.payload,
            outputs,
        })
    }

    /// Replace the whole allowlist between two requests (E7).
    pub fn update_inputs(
        &mut self,
        inputs: Vec<HelperInputGrant>,
        cancel: CancellationToken,
    ) -> Result<(), String> {
        if self.closed {
            return Err("helper.failed".to_string());
        }
        let update_id = self
            .inputs
            .begin_update(inputs, false, self.proof.is_some())?;
        let pending: Vec<HelperInputGrant> = self
            .inputs
            .pending()
            .map(|update| update.grants.clone())
            .unwrap_or_default();
        let manifests = pending.iter().map(manifest_of).collect::<Vec<_>>();
        let bytes = encode_control(&HelperControlFrame::InputUpdate {
            update_id,
            inputs: manifests,
        })?;
        self.process.send_frame(1, &bytes)?;
        for grant in &pending {
            if let Err(error) = self.send_input_body(grant, &cancel) {
                self.inputs.abort();
                self.kill();
                return Err(error);
            }
        }
        let grants = match self.await_inputs_ready(update_id, &cancel) {
            Ok(grants) => grants,
            Err(error) => {
                self.inputs.abort();
                self.kill();
                return Err(error);
            }
        };
        if let Err(error) = self.inputs.commit(update_id, grants) {
            self.inputs.abort();
            self.kill();
            return Err(error);
        }
        Ok(())
    }

    fn send_input_body(
        &mut self,
        grant: &HelperInputGrant,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        match &grant.source {
            HelperInputSource::Disk { .. } => Ok(()),
            HelperInputSource::Memory { data, .. } => {
                send_bytes(&mut self.process, grant.grant_id, data, cancel)
            }
            HelperInputSource::Snapshot { backing, .. } => match backing.as_ref() {
                GrantedBacking::Memory { bytes, .. } => {
                    send_bytes(&mut self.process, grant.grant_id, bytes, cancel)
                }
                GrantedBacking::Disk { source, length } => send_file(
                    &mut self.process,
                    grant.grant_id,
                    source.file(),
                    *length,
                    cancel,
                ),
            },
        }
    }

    fn await_inputs_ready(
        &mut self,
        update_id: Uuid,
        cancel: &CancellationToken,
    ) -> Result<Vec<HelperGrantDTO>, String> {
        let deadline = Instant::now() + UPDATE_TIMEOUT;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("pdf.changed".to_string());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("helper.timeout".to_string());
            }
            match self
                .process
                .recv_frame(remaining.min(Duration::from_millis(50)))
            {
                None => {}
                Some(HelperFrameEvent::Frame { kind: 1, body }) => {
                    let frame = decode_control(&body)?;
                    match frame {
                        HelperControlFrame::InputsReady {
                            update_id: ready_id,
                            inputs,
                            private_profile,
                        } => {
                            if ready_id != update_id {
                                return Err("helper.failed".to_string());
                            }
                            if inputs.iter().any(|grant| grant.sensitive) && !private_profile {
                                return Err("helper.sensitive_unsupported".to_string());
                            }
                            return Ok(inputs);
                        }
                        HelperControlFrame::Ready { .. } => {}
                        _ => return Err("helper.failed".to_string()),
                    }
                }
                Some(HelperFrameEvent::Closed) | Some(HelperFrameEvent::Malformed) => {
                    return Err("helper.failed".to_string())
                }
                Some(HelperFrameEvent::TooLarge) => return Err("helper.too_large".to_string()),
                Some(HelperFrameEvent::Frame { .. }) => return Err("helper.failed".to_string()),
            }
        }
    }

    fn collect_reply(
        &mut self,
        active: &ActiveRequest,
        timeout: Duration,
        cancel: &CancellationToken,
    ) -> Result<HelperReplyEnvelope<serde_json::Value>, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::Relaxed) {
                self.cancel_child();
                return Err("pdf.changed".to_string());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.kill();
                return Err("helper.timeout".to_string());
            }
            match self
                .process
                .recv_frame(remaining.min(Duration::from_millis(50)))
            {
                None => {}
                Some(HelperFrameEvent::Frame { kind: 1, body }) => {
                    let frame = decode_control(&body)?;
                    match frame {
                        HelperControlFrame::Reply { reply } => {
                            validate_reply_shape(active, &reply)?;
                            return Ok(reply);
                        }
                        HelperControlFrame::Ready { .. }
                        | HelperControlFrame::InputsReady { .. } => {}
                        _ => return Err("helper.failed".to_string()),
                    }
                }
                Some(HelperFrameEvent::Closed) | Some(HelperFrameEvent::Malformed) => {
                    return Err("helper.failed".to_string())
                }
                Some(HelperFrameEvent::TooLarge) => return Err("helper.too_large".to_string()),
                Some(HelperFrameEvent::Frame { .. }) => {
                    // Bodies only arrive after the reply that announces them.
                    self.kill();
                    return Err("helper.failed".to_string());
                }
            }
        }
    }

    fn collect_outputs(
        &mut self,
        reservations: &[HelperOutputReservation],
        announced: &[crate::webview_helper_types::HelperOutputDTO],
        cancel: &CancellationToken,
    ) -> Result<Vec<HelperOutput>, String> {
        if announced.is_empty() {
            return Ok(Vec::new());
        }
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        let mut bodies: HashMap<Uuid, Vec<u8>> = HashMap::new();
        let mut done: HashMap<Uuid, (u64, [u8; 32])> = HashMap::new();
        while done.len() < announced.len() {
            if cancel.load(Ordering::Relaxed) {
                self.cancel_child();
                return Err("pdf.changed".to_string());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.kill();
                return Err("helper.timeout".to_string());
            }
            match self
                .process
                .recv_frame(remaining.min(Duration::from_millis(50)))
            {
                None => {}
                Some(HelperFrameEvent::Frame { kind: 3, body }) => {
                    if body.len() < 24 {
                        return Err("helper.failed".to_string());
                    }
                    let output_id = Uuid::from_bytes(slice16(&body[..16])?);
                    let mut offset = [0u8; 8];
                    offset.copy_from_slice(&body[16..24]);
                    let offset = u64::from_le_bytes(offset);
                    let chunk = &body[24..];
                    let Some(reservation) = reservations
                        .iter()
                        .find(|entry| entry.output_id == output_id)
                    else {
                        return Err("helper.failed".to_string());
                    };
                    if chunk.len() > MAX_BODY_CHUNK {
                        return Err("pdf.too_large".to_string());
                    }
                    let buffer = bodies.entry(output_id).or_default();
                    if buffer.len() as u64 != offset
                        || (buffer.len() + chunk.len()) as u64 > reservation.max_bytes
                    {
                        return Err("helper.failed".to_string());
                    }
                    buffer.extend_from_slice(chunk);
                }
                Some(HelperFrameEvent::Frame { kind: 4, body }) => {
                    if body.len() != 56 {
                        return Err("helper.failed".to_string());
                    }
                    let output_id = Uuid::from_bytes(slice16(&body[..16])?);
                    let mut total = [0u8; 8];
                    total.copy_from_slice(&body[16..24]);
                    let total = u64::from_le_bytes(total);
                    let mut hash = [0u8; 32];
                    hash.copy_from_slice(&body[24..56]);
                    let Some(buffer) = bodies.get(&output_id) else {
                        return Err("helper.failed".to_string());
                    };
                    if buffer.len() as u64 != total
                        || sha256_bytes(buffer) != hash
                        || !announced.iter().any(|entry| entry.output_id == output_id)
                    {
                        return Err("helper.failed".to_string());
                    }
                    done.insert(output_id, (total, hash));
                }
                Some(HelperFrameEvent::Frame { kind: 5, body }) => {
                    let code = String::from_utf8_lossy(&body).to_string();
                    return Err(
                        if crate::webview_helper_protocol::allowed_error_code(&code) {
                            code
                        } else {
                            "helper.failed".to_string()
                        },
                    );
                }
                Some(HelperFrameEvent::Closed) | Some(HelperFrameEvent::Malformed) => {
                    return Err("helper.failed".to_string())
                }
                Some(HelperFrameEvent::TooLarge) => return Err("helper.too_large".to_string()),
                Some(HelperFrameEvent::Frame { .. }) => return Err("helper.failed".to_string()),
            }
        }
        let mut outputs = Vec::new();
        for manifest in announced {
            let Some(bytes) = bodies.remove(&manifest.output_id) else {
                return Err("helper.failed".to_string());
            };
            if bytes.len() as u64 != manifest.byte_len {
                return Err("helper.failed".to_string());
            }
            let storage = self.store_output(&manifest.mime, bytes)?;
            outputs.push(HelperOutput {
                output_id: manifest.output_id,
                mime: manifest.mime.clone(),
                byte_len: manifest.byte_len,
                storage,
            });
        }
        Ok(outputs)
    }

    /// Ordinary results go to an owned staging file; sensitive ones stay in
    /// memory (E8).
    fn store_output(&self, _mime: &str, bytes: Vec<u8>) -> Result<HelperOutputStorage, String> {
        if self
            .inputs
            .current()
            .iter()
            .any(|grant| !matches!(grant.source, HelperInputSource::Disk { .. }))
        {
            return Ok(HelperOutputStorage::Memory(Zeroizing::new(bytes)));
        }
        let directory = fs_service::owned_io::PinnedDirectory::open(&self.data_dir.join("out"))
            .map_err(|_| "helper.failed".to_string())?;
        let mut output = fs_service::owned_io::OwnedOutput::create(&directory, "page")
            .map_err(|_| "helper.failed".to_string())?;
        output
            .file_mut()
            .write_all(&bytes)
            .map_err(|_| "helper.failed".to_string())?;
        output
            .flush_sync()
            .map_err(|_| "helper.failed".to_string())?;
        Ok(HelperOutputStorage::OwnedFile(output))
    }

    fn cancel_child(&mut self) {
        std::thread::sleep(CANCEL_GRACE);
        self.kill();
    }

    fn kill(&mut self) {
        self.closed = true;
        self.inputs.abort();
        self.process.kill();
        self.permit.take();
    }

    /// Terminate the child and release everything the session owns.
    pub fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        self.process.kill();
        self.permit.take();
        self.inputs.abort();
        Ok(())
    }

    fn await_ready(&mut self, cancel: &CancellationToken) -> Result<bool, String> {
        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            if cancel.load(Ordering::Relaxed) {
                self.kill();
                return Err("pdf.changed".to_string());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.kill();
                return Err("helper.timeout".to_string());
            }
            match self
                .process
                .recv_frame(remaining.min(Duration::from_millis(50)))
            {
                None => {}
                Some(HelperFrameEvent::Frame { kind: 1, body }) => {
                    if let HelperControlFrame::Ready {
                        private_profile, ..
                    } = decode_control(&body)?
                    {
                        return Ok(private_profile);
                    }
                    return Err("helper.failed".to_string());
                }
                Some(HelperFrameEvent::Closed) | Some(HelperFrameEvent::Malformed) => {
                    return Err("helper.failed".to_string())
                }
                Some(HelperFrameEvent::TooLarge) => return Err("helper.too_large".to_string()),
                Some(HelperFrameEvent::Frame { .. }) => return Err("helper.failed".to_string()),
            }
        }
    }
}

impl Drop for WebviewHelperSession {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

fn slice16(bytes: &[u8]) -> Result<[u8; 16], String> {
    bytes.try_into().map_err(|_| "helper.failed".to_string())
}

fn sha256_bytes(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

fn mint_reservations(
    request: &WebviewHelperRequest,
    sensitive: bool,
) -> Vec<HelperOutputReservation> {
    request
        .output_specs
        .iter()
        .map(|spec: &HelperOutputSpec| {
            let output_id = Uuid::new_v4();
            HelperOutputReservation {
                output_id,
                mime: spec.mime.clone(),
                token_url: crate::webview_helper_protocol::output_route(
                    request.request_id,
                    output_id,
                ),
                upload_token: Uuid::new_v4().simple().to_string(),
                max_bytes: spec.max_bytes,
                sensitive,
            }
        })
        .collect()
}

fn manifest_of(grant: &HelperInputGrant) -> HelperInputManifest {
    let source = match &grant.source {
        HelperInputSource::Disk { path, expected, .. } => HelperInputManifestSource::Disk {
            path: path.display().to_string(),
            expected: expected.clone(),
        },
        HelperInputSource::Memory {
            data,
            document_id,
            revision,
            content_id,
            sensitive,
        } => HelperInputManifestSource::Memory {
            document_id: document_id.clone(),
            revision: *revision,
            content_id: *content_id,
            sensitive: *sensitive,
            byte_len: data.len() as u64,
        },
        HelperInputSource::Snapshot {
            backing,
            document_id,
            revision,
            content_id,
            sensitive,
        } => HelperInputManifestSource::Memory {
            document_id: document_id.clone(),
            revision: *revision,
            content_id: *content_id,
            sensitive: *sensitive,
            byte_len: backing.length(),
        },
    };
    HelperInputManifest {
        grant_id: grant.grant_id,
        name: grant.name.clone(),
        mime: grant.mime.clone(),
        source,
    }
}

fn send_bytes(
    process: &mut FramedHelperProcess,
    grant_id: Uuid,
    bytes: &[u8],
    cancel: &CancellationToken,
) -> Result<(), String> {
    let mut offset = 0u64;
    while offset < bytes.len() as u64 {
        if cancel.load(Ordering::Relaxed) {
            return Err("pdf.changed".to_string());
        }
        let end = (offset as usize + MAX_BODY_CHUNK).min(bytes.len());
        send_body_frame(process, grant_id, offset, &bytes[offset as usize..end])?;
        offset = end as u64;
    }
    send_body_end(process, grant_id, bytes.len() as u64, &sha256_bytes(bytes))
}

fn send_file(
    process: &mut FramedHelperProcess,
    grant_id: Uuid,
    file: &std::fs::File,
    length: u64,
    cancel: &CancellationToken,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let mut reader = file.try_clone().map_err(|_| "helper.failed".to_string())?;
    let mut offset = 0u64;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; MAX_BODY_CHUNK];
    while offset < length {
        if cancel.load(Ordering::Relaxed) {
            return Err("pdf.changed".to_string());
        }
        let want = ((length - offset) as usize).min(MAX_BODY_CHUNK);
        let read = reader
            .read(&mut buffer[..want])
            .map_err(|_| "helper.failed".to_string())?;
        if read == 0 {
            return Err("pdf.changed".to_string());
        }
        hasher.update(&buffer[..read]);
        send_body_frame(process, grant_id, offset, &buffer[..read])?;
        offset += read as u64;
    }
    let digest = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&digest);
    send_body_end(process, grant_id, length, &hash)
}

fn send_body_frame(
    process: &mut FramedHelperProcess,
    grant_id: Uuid,
    offset: u64,
    chunk: &[u8],
) -> Result<(), String> {
    let mut body = Vec::with_capacity(24 + chunk.len());
    body.extend_from_slice(grant_id.as_bytes());
    body.extend_from_slice(&offset.to_le_bytes());
    body.extend_from_slice(chunk);
    process.send_frame(2, &body)
}

fn send_body_end(
    process: &mut FramedHelperProcess,
    grant_id: Uuid,
    total: u64,
    sha256: &[u8; 32],
) -> Result<(), String> {
    let mut body = Vec::with_capacity(56);
    body.extend_from_slice(grant_id.as_bytes());
    body.extend_from_slice(&total.to_le_bytes());
    body.extend_from_slice(sha256);
    process.send_frame(4, &body)
}

/// Start a helper child and deliver its first inputs.
pub fn start_webview_helper(
    config: WebviewHelperConfig,
    inputs: Vec<HelperInputGrant>,
    cancel: CancellationToken,
) -> Result<WebviewHelperSession, String> {
    config.validate()?;
    std::fs::create_dir_all(config.data_dir.join("out"))
        .map_err(|_| "helper.start_failed".to_string())?;
    let exe = std::env::current_exe().map_err(|_| "helper.start_failed".to_string())?;
    let mut command = Command::new(exe);
    command.arg(config.helper_flag());
    if config.kind != WebviewHelperKind::Pdf {
        command.arg(config.kind.wire_name());
    }
    let permit = admission::HelperPermit::acquire()?;
    let process =
        FramedHelperProcess::spawn_command(command, HELPER_MEMORY_LIMIT, HELPER_FRAME_BYTES)
            .map_err(|_| "helper.start_failed".to_string())?;
    let process_id = process.process_id();
    let mut session = WebviewHelperSession {
        kind: config.kind,
        data_dir: config.data_dir.clone(),
        config,
        process,
        inputs: InputRegistry::new(),
        proof: None,
        closed: false,
        rendered_once: false,
        permit: Some(permit),
    };
    // Bootstrap carries no source manifest or grant before the private proof.
    let start = encode_control(&HelperControlFrame::Start {
        protocol_version: PROTOCOL_VERSION,
        kind: session.kind,
        placement: session.config.placement.clone(),
        inputs: Vec::new(),
    })?;
    session.process.send_frame(1, &start)?;
    let private_profile = session.await_ready(&cancel)?;
    if inputs.iter().any(|grant| grant.source.is_sensitive()) && !private_profile {
        session.kill();
        return Err("helper.sensitive_unsupported".to_string());
    }
    if private_profile {
        session.proof = crate::webview_private::proof_from_answer(
            helper_window_label(session.kind),
            process_id,
            Ok(true),
        )
        .ok();
    }
    session.update_inputs(inputs, cancel)?;
    Ok(session)
}

/// One-shot convenience: start, request, close. Persistent viewers keep the
/// session instead.
pub fn run_webview_helper(
    config: WebviewHelperConfig,
    inputs: Vec<HelperInputGrant>,
    request: WebviewHelperRequest,
    cancel: CancellationToken,
) -> Result<WebviewHelperResult, String> {
    let mut session = start_webview_helper(config, inputs, cancel.clone())?;
    let result = session.request(request, cancel);
    let _ = session.close();
    result
}

// ---------------------------------------------------------------------------
// Child side
// ---------------------------------------------------------------------------

/// State of the child process: grants, the active request and the reply slot.
pub struct HelperChildState {
    pub kind: WebviewHelperKind,
    pub frontend_ready: std::sync::atomic::AtomicBool,
    pub private_profile: std::sync::atomic::AtomicBool,
    pub grants: Arc<ChildGrants>,
    pub inputs: Arc<Mutex<ChildInputState>>,
    pub sink: Arc<OutputSink>,
    pub active: Arc<Mutex<Option<ActiveRequest>>>,
    pub reply: Arc<Mutex<Option<SyncSender<HelperReplyEnvelope<serde_json::Value>>>>>,
}

/// The child's one command: deliver the frontend's reply to the frame loop.
#[tauri::command]
pub fn helper_reply(
    window: WebviewWindow,
    state: State<'_, HelperChildState>,
    reply: HelperReplyEnvelope<serde_json::Value>,
) -> Result<(), String> {
    ensure_helper_window(state.kind, window.label())?;
    let active = state
        .active
        .lock()
        .map_err(|_| "helper.failed".to_string())?
        .clone()
        .ok_or_else(|| "pdf.bad_request".to_string())?;
    validate_reply_shape(&active, &reply)?;
    let sender = state
        .reply
        .lock()
        .map_err(|_| "helper.failed".to_string())?
        .take()
        .ok_or_else(|| "helper.failed".to_string())?;
    sender
        .try_send(reply)
        .map_err(|_| "helper.failed".to_string())
}

/// Public bootstrap acknowledgment contains no source/token/document data.
#[tauri::command]
pub fn helper_ready(
    window: WebviewWindow,
    state: State<'_, HelperChildState>,
) -> Result<(), String> {
    ensure_helper_window(state.kind, window.label())?;
    state.frontend_ready.store(true, Ordering::Relaxed);
    Ok(())
}

/// Run the child's Tauri app. Called from `main()` before the main app is
/// built, with a static flag only, and with the child's own data folder.
pub fn run_helper_process(kind: WebviewHelperKind, data_dir: PathBuf) -> ! {
    let state = HelperChildState {
        kind,
        frontend_ready: std::sync::atomic::AtomicBool::new(false),
        private_profile: std::sync::atomic::AtomicBool::new(false),
        grants: Arc::new(ChildGrants::new()),
        inputs: Arc::new(Mutex::new(ChildInputState::new())),
        sink: Arc::new(OutputSink::new()),
        active: Arc::new(Mutex::new(None)),
        reply: Arc::new(Mutex::new(None)),
    };
    let result = tauri::Builder::default()
        .manage(state)
        .register_asynchronous_uri_scheme_protocol(crate::files::SCHEME, child_protocol)
        .invoke_handler(tauri::generate_handler![helper_reply, helper_ready])
        .setup(move |app| {
            let _ = std::fs::create_dir_all(&data_dir);
            let window = tauri::WebviewWindowBuilder::new(
                app,
                helper_window_label(kind),
                WebviewUrl::App(kind.entry().into()),
            )
            .title("Adperastra helper")
            .inner_size(1024.0, 768.0)
            .visible(false)
            .incognito(true)
            .on_navigation(|url| {
                matches!(url.host_str(), Some("tauri.localhost") | Some("localhost"))
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .data_directory(data_dir.clone())
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                run_child_loop(handle.clone(), kind, window);
                handle.exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!("tauri.helper.conf.json"));
    match result {
        Ok(()) => std::process::exit(0),
        Err(_) => std::process::exit(1),
    }
}

fn run_child_loop(app: tauri::AppHandle, kind: WebviewHelperKind, window: WebviewWindow<Wry>) {
    let private_profile = match crate::webview_private::require_private_webview(&window) {
        Ok(proof) => proof.is_for(window.label()),
        // No proof means no sensitive route; ordinary viewing may continue
        // through this child (the parent refuses sensitive inputs before it
        // sends a byte).
        Err(_) => false,
    };
    if let Some(state) = app.try_state::<HelperChildState>() {
        state
            .private_profile
            .store(private_profile, std::sync::atomic::Ordering::Relaxed);
    }
    let frontend_deadline = Instant::now() + READY_TIMEOUT;
    while !app
        .state::<HelperChildState>()
        .frontend_ready
        .load(Ordering::Relaxed)
    {
        if Instant::now() >= frontend_deadline {
            let _ = window.close();
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = write_control(&HelperControlFrame::Ready {
        protocol_version: PROTOCOL_VERSION,
        private_profile,
    });
    let mut manifests: Vec<HelperInputManifest> = Vec::new();
    let mut pending_update: Option<Uuid> = None;
    let mut finished: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut stdin = std::io::stdin();
    loop {
        match read_frame(&mut stdin, HELPER_FRAME_BYTES) {
            HelperFrameEvent::Frame { kind: 1, body } => {
                let Ok(frame) = decode_control(&body) else {
                    return;
                };
                match frame {
                    HelperControlFrame::Start { .. } => {}
                    HelperControlFrame::InputUpdate {
                        update_id,
                        inputs: next,
                    } => {
                        manifests = next;
                        pending_update = Some(update_id);
                        finished.clear();
                        let child = app.state::<HelperChildState>();
                        let mut inputs = match child.inputs.lock() {
                            Ok(inputs) => inputs,
                            Err(_) => return,
                        };
                        if inputs
                            .accept_update(update_id, &manifests, private_profile)
                            .is_err()
                        {
                            let _ = write_error("helper.sensitive_unsupported");
                            return;
                        }
                        // Disk inputs need no body; finish them now.
                        for manifest in &manifests {
                            if matches!(manifest.source, HelperInputManifestSource::Disk { .. }) {
                                finished.insert(manifest.grant_id);
                            }
                        }
                        drop(inputs);
                        if finished.len() == manifests.len() {
                            if send_inputs_ready(&app, update_id, &manifests).is_err() {
                                return;
                            }
                            pending_update = None;
                        }
                    }
                    HelperControlFrame::Request { request } => {
                        if !request.action.is_pdf() {
                            let _ = write_error("pdf.bad_request");
                            continue;
                        }
                        if run_request(&app, request).is_err() {
                            let _ = write_error("helper.failed");
                            return;
                        }
                    }
                    _ => return,
                }
                let _ = kind;
            }
            HelperFrameEvent::Frame { kind: 2, body } => {
                if body.len() < 24 {
                    return;
                }
                let Ok(id) = slice16(&body[..16]) else {
                    return;
                };
                let grant_id = Uuid::from_bytes(id);
                let mut offset = [0u8; 8];
                offset.copy_from_slice(&body[16..24]);
                let offset = u64::from_le_bytes(offset);
                let child = app.state::<HelperChildState>();
                let Ok(mut inputs) = child.inputs.lock() else {
                    return;
                };
                if inputs.accept_body(grant_id, offset, &body[24..]).is_err() {
                    return;
                }
            }
            HelperFrameEvent::Frame { kind: 4, body } => {
                if body.len() != 56 {
                    return;
                }
                let Ok(id) = slice16(&body[..16]) else {
                    return;
                };
                let grant_id = Uuid::from_bytes(id);
                let mut total = [0u8; 8];
                total.copy_from_slice(&body[16..24]);
                let total = u64::from_le_bytes(total);
                let mut hash = [0u8; 32];
                hash.copy_from_slice(&body[24..56]);
                let child = app.state::<HelperChildState>();
                let Ok(mut inputs) = child.inputs.lock() else {
                    return;
                };
                if inputs.finish_body(grant_id, total, &hash).is_err() {
                    return;
                }
                finished.insert(grant_id);
                let all = manifests
                    .iter()
                    .all(|manifest| finished.contains(&manifest.grant_id));
                drop(inputs);
                if all {
                    if let Some(update_id) = pending_update {
                        if send_inputs_ready(&app, update_id, &manifests).is_err() {
                            return;
                        }
                        pending_update = None;
                    }
                }
            }
            HelperFrameEvent::Frame { kind: 5, .. } => return,
            _ => return,
        }
    }
}

/// Install the accepted inputs as grants and report their browser-safe DTOs.
///
/// Memory bodies are the bytes the parent streamed; a disk input is opened by
/// the child itself and re-verified against the stamp the parent announced,
/// so no path and no stamp ever comes from the PDF.
fn send_inputs_ready(
    app: &tauri::AppHandle,
    update_id: Uuid,
    manifests: &[HelperInputManifest],
) -> Result<(), String> {
    let state = app.state::<HelperChildState>();
    let mut inputs = state
        .inputs
        .lock()
        .map_err(|_| "helper.failed".to_string())?;
    let sensitive = inputs.is_sensitive();
    let mut grants = Vec::new();
    for manifest in manifests {
        let backing = match &manifest.source {
            HelperInputManifestSource::Memory { .. } => {
                let Some(body) = inputs.take_body(manifest.grant_id) else {
                    return Err("helper.failed".to_string());
                };
                Arc::new(GrantedBacking::Memory {
                    length: body.len() as u64,
                    bytes: Arc::new(body),
                    sensitive,
                })
            }
            HelperInputManifestSource::Disk { path, expected } => {
                let path = std::path::PathBuf::from(path);
                let stamp = fs_service::capture_source_stamp(&path)
                    .map_err(|_| "pdf.changed".to_string())?;
                if stamp != *expected {
                    return Err("pdf.changed".to_string());
                }
                let identity = fs_service::owned_io::SourceIdentity::capture(&path)
                    .map_err(|_| "pdf.changed".to_string())?;
                let length = identity.size;
                let pinned = fs_service::owned_io::PinnedSource::open(&path, &identity)
                    .map_err(|_| "pdf.changed".to_string())?;
                Arc::new(GrantedBacking::Disk {
                    source: Arc::new(pinned),
                    length,
                })
            }
        };
        let dto =
            state
                .grants
                .install(manifest.grant_id, &manifest.name, &manifest.mime, backing)?;
        grants.push(dto);
    }
    inputs.finish_update()?;
    drop(inputs);
    let frame = HelperControlFrame::InputsReady {
        update_id,
        inputs: grants,
        private_profile: state
            .private_profile
            .load(std::sync::atomic::Ordering::Relaxed),
    };
    write_control(&frame)
}

/// Send one request to the frontend, retrying the event until the reply
/// arrives (the page may still be executing its first script).
fn run_request(
    app: &tauri::AppHandle,
    request: HelperRequestEnvelope<serde_json::Value>,
) -> Result<(), String> {
    let state = app.state::<HelperChildState>();
    let active = ActiveRequest {
        request_id: request.request_id,
        action: request.action,
        reservations: request.output_reservations.clone(),
    };
    {
        let mut slot = state
            .active
            .lock()
            .map_err(|_| "helper.failed".to_string())?;
        if slot.is_some() {
            return Err("helper.busy".to_string());
        }
        *slot = Some(active);
    }
    state
        .sink
        .reserve(request.request_id, &request.output_reservations)?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    {
        let mut slot = state
            .reply
            .lock()
            .map_err(|_| "helper.failed".to_string())?;
        *slot = Some(sender);
    }
    let window = app
        .get_webview_window(helper_window_label(state.kind))
        .ok_or_else(|| "helper.failed".to_string())?;
    let mut reply = None;
    for _ in 0..MAX_EMITS {
        window
            .emit("helper-request", &request)
            .map_err(|_| "helper.failed".to_string())?;
        match receiver.recv_timeout(EMIT_RETRY) {
            Ok(value) => {
                reply = Some(value);
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("helper.failed".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    let reply = reply.ok_or_else(|| "helper.timeout".to_string())?;
    write_control(&HelperControlFrame::Reply {
        reply: reply.clone(),
    })?;
    if let HelperReplyEnvelope::Ok { outputs, .. } = &reply {
        for output in outputs {
            if let Some((_reservation, bytes)) =
                state.sink.take(request.request_id, output.output_id)
            {
                send_output_body(output.output_id, &bytes)?;
            }
        }
    }
    state.sink.clear_request(request.request_id);
    if let Ok(mut slot) = state.reply.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = state.active.lock() {
        *slot = None;
    }
    Ok(())
}

fn send_output_body(output_id: Uuid, bytes: &[u8]) -> Result<(), String> {
    let mut offset = 0u64;
    while offset < bytes.len() as u64 {
        let end = (offset as usize + MAX_BODY_CHUNK).min(bytes.len());
        let mut body = Vec::with_capacity(24 + (end - offset as usize));
        body.extend_from_slice(output_id.as_bytes());
        body.extend_from_slice(&offset.to_le_bytes());
        body.extend_from_slice(&bytes[offset as usize..end]);
        write_frame(3, &body)?;
        offset = end as u64;
    }
    let mut body = Vec::with_capacity(56);
    body.extend_from_slice(output_id.as_bytes());
    body.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    body.extend_from_slice(&sha256_bytes(bytes));
    write_frame(4, &body)
}

fn write_control(frame: &HelperControlFrame) -> Result<(), String> {
    let bytes = encode_control(frame)?;
    write_frame(1, &bytes)
}

fn write_frame(kind: u8, body: &[u8]) -> Result<(), String> {
    let frame = crate::helper_frames::encode_frame(kind, body)?;
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&frame)
        .and_then(|_| stdout.flush())
        .map_err(|_| "helper.failed".to_string())
}

fn write_error(code: &str) -> Result<(), String> {
    let mut body = code.as_bytes().to_vec();
    body.truncate(crate::webview_helper_types::MAX_ERROR_CODE);
    write_frame(5, &body)
}

/// The child's `adpfile` responder: guarded grant ranges and output uploads.
pub fn child_protocol(
    ctx: tauri::UriSchemeContext<'_, Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    std::thread::spawn(move || {
        let Some(state) = app.try_state::<HelperChildState>() else {
            responder.respond(empty_response());
            return;
        };
        if let Some((request_id, output_id)) = parse_output_path(&path) {
            handle_output_upload(
                state.inner(),
                request_id,
                output_id,
                &method,
                &request,
                responder,
            );
            return;
        }
        let token = path.trim_start_matches('/').split('/').next().unwrap_or("");
        match state.grants.resolve(token) {
            Some(backing) => {
                responder.respond(crate::file_grant_backing::serve_backing(
                    &backing,
                    "application/octet-stream",
                    &method,
                    range.as_deref(),
                ));
            }
            None => responder.respond(empty_response()),
        }
    });
}

fn handle_output_upload(
    state: &HelperChildState,
    request_id: Uuid,
    output_id: Uuid,
    method: &tauri::http::Method,
    request: &tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    use tauri::http::{header, StatusCode};
    if method == tauri::http::Method::OPTIONS {
        let response = tauri::http::Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "POST, OPTIONS")
            .header(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                "Content-Type, X-Adp-Upload-Token, X-Adp-Offset, X-Adp-Final-Length, X-Adp-Sha256",
            )
            .header(header::CACHE_CONTROL, "no-store")
            .body(Vec::new())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
        responder.respond(response);
        return;
    }
    if request.body().len() > MAX_BODY_CHUNK {
        responder.respond(empty_response());
        return;
    }
    if method != tauri::http::Method::POST {
        responder.respond(empty_response());
        return;
    }
    let token = request
        .headers()
        .get("X-Adp-Upload-Token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let offset = request
        .headers()
        .get("X-Adp-Offset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(u64::MAX);
    let final_length = request
        .headers()
        .get("X-Adp-Final-Length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let body = request.body();
    let ok = match final_length {
        Some(length) => {
            if !body.is_empty() || offset != length {
                responder.respond(empty_response());
                return;
            }
            let hash = request
                .headers()
                .get("X-Adp-Sha256")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            state
                .sink
                .finish(request_id, output_id, token, length, hash)
                .is_ok()
        }
        None => state
            .sink
            .append(request_id, output_id, token, offset, body)
            .is_ok(),
    };
    let status = if ok {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::BAD_REQUEST
    };
    let response = tauri::http::Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
    responder.respond(response);
}

fn empty_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::NOT_FOUND)
        .header(tauri::http::header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}
