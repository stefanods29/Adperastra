//! Isolated privacy parser helper (Step 08c D1).
//!
//! `Adperastra.exe --privacy-helper` reads one bounded control frame,
//! then input bytes, and answers with metadata or a cleaned result. The
//! parent owns the source guard, destination, publication and Cancel; this
//! process owns only its bounded bytes.

use std::io::{Read, Write};
use std::time::{Duration, Instant};

use convert::MetadataCategory;
use fs_service::{new_cancellation_token, OpProgress};
use privacy::{default_registry, Coverage, PrivacyCleanSummary, PrivacyContext, PrivacyField};
use serde::{Deserialize, Serialize};

use crate::helper_frames::{FramedHelperProcess, HelperFrameEvent};

pub const HELPER_FLAG: &str = "--privacy-helper";
pub const HELPER_MEMORY_BYTES: usize = 1024 * 1024 * 1024;
/// Bounded control frame; a 10,000-field inspection JSON fits, while the
/// 1 MiB input/output frames stay unchanged.
pub const HELPER_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub const HELPER_CONTROL_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_INPUT_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
pub const FILE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyHelperAction {
    Inspect,
    Clean,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyHelperRequest {
    pub action: PrivacyHelperAction,
    /// `image` or `pdf`.
    pub adapter: String,
    pub categories: Vec<MetadataCategory>,
    pub input_len: u64,
    pub max_output_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyHelperReply {
    pub fields: Vec<PrivacyField>,
    pub signatures_present: bool,
    pub summary: Option<PrivacyCleanSummary>,
    pub output_len: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn read_exact_frame(reader: &mut impl Read) -> Result<(u8, Vec<u8>), String> {
    let mut header = [0u8; 5];
    reader
        .read_exact(&mut header)
        .map_err(|_| "privacy.helper_protocol".to_string())?;
    let kind = header[0];
    let length = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if kind == 0 || length > HELPER_FRAME_BYTES {
        return Err("privacy.helper_protocol".to_string());
    }
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| "privacy.helper_protocol".to_string())?;
    Ok((kind, body))
}

fn write_frame(writer: &mut impl Write, kind: u8, body: &[u8]) -> Result<(), String> {
    if kind == 0 || body.len() > HELPER_FRAME_BYTES {
        return Err("privacy.helper_protocol".to_string());
    }
    writer
        .write_all(&[kind])
        .and_then(|_| writer.write_all(&(body.len() as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(body))
        .and_then(|_| writer.flush())
        .map_err(|_| "privacy.helper_protocol".to_string())
}

/// The child process entry. Reads bounded frames from stdin and writes
/// bounded frames to stdout; no path, token or user text is accepted.
pub fn run_privacy_helper() -> i32 {
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let Ok((kind, control)) = read_exact_frame(&mut input) else {
        return 64;
    };
    if kind != 1 {
        return 64;
    }
    let request: PrivacyHelperRequest = match serde_json::from_slice(&control) {
        Ok(value) => value,
        Err(_) => return 64,
    };
    if request.input_len > MAX_INPUT_BYTES as u64
        || request.input_len == 0
        || request.max_output_bytes > MAX_OUTPUT_BYTES
    {
        let _ = write_reply(
            std::io::stdout().lock(),
            &PrivacyHelperReply {
                fields: Vec::new(),
                signatures_present: false,
                summary: None,
                output_len: 0,
                error: Some("privacy.too_large".to_string()),
            },
            None,
        );
        return 0;
    }
    let mut bytes = Vec::with_capacity(request.input_len as usize);
    while bytes.len() < request.input_len as usize {
        let Ok((kind, body)) = read_exact_frame(&mut input) else {
            return 64;
        };
        if kind != 2 || bytes.len() + body.len() > request.input_len as usize {
            return 64;
        }
        bytes.extend_from_slice(&body);
    }
    let Ok((kind, _)) = read_exact_frame(&mut input) else {
        return 64;
    };
    if kind != 3 {
        return 64;
    }

    let mut context = PrivacyContext::new(
        new_cancellation_token(),
        None,
        request.max_output_bytes,
    );
    let registry = default_registry();
    let Some(adapter) = registry.get(&request.adapter) else {
        let _ = write_reply(
            std::io::stdout().lock(),
            &PrivacyHelperReply {
                fields: Vec::new(),
                signatures_present: false,
                summary: None,
                output_len: 0,
                error: Some("privacy.unsupported".to_string()),
            },
            None,
        );
        return 0;
    };
    match request.action {
        PrivacyHelperAction::Inspect => {
            let mut cursor = std::io::Cursor::new(bytes.as_slice());
            let (fields, signatures_present) = match adapter.id() {
                "pdf" => match privacy::pdf_fields::inspect_pdf(&bytes, &mut context) {
                    Ok((fields, signatures)) => (fields, signatures),
                    Err(error) => {
                        let _ = write_reply(
                            std::io::stdout().lock(),
                            &PrivacyHelperReply {
                                fields: Vec::new(),
                                signatures_present: false,
                                summary: None,
                                output_len: 0,
                                error: Some(error.code().to_string()),
                            },
                            None,
                        );
                        return 0;
                    }
                },
                _ => match adapter.inspect(&mut cursor, &mut context) {
                    Ok(fields) => (fields, false),
                    Err(error) => {
                        let _ = write_reply(
                            std::io::stdout().lock(),
                            &PrivacyHelperReply {
                                fields: Vec::new(),
                                signatures_present: false,
                                summary: None,
                                output_len: 0,
                                error: Some(error.code().to_string()),
                            },
                            None,
                        );
                        return 0;
                    }
                },
            };
            let reply = PrivacyHelperReply {
                fields,
                signatures_present,
                summary: None,
                output_len: 0,
                error: None,
            };
            let _ = write_reply(std::io::stdout().lock(), &reply, None);
            0
        }
        PrivacyHelperAction::Clean => {
            let mut output = Vec::new();
            let mut cursor = std::io::Cursor::new(bytes);
            match adapter.clean(&mut cursor, &request.categories, &mut output, &mut context) {
                Ok(summary) => {
                    let reply = PrivacyHelperReply {
                        fields: Vec::new(),
                        signatures_present: false,
                        summary: Some(summary),
                        output_len: output.len() as u64,
                        error: None,
                    };
                    let _ = write_reply(std::io::stdout().lock(), &reply, Some(&output));
                    0
                }
                Err(error) => {
                    let _ = write_reply(
                        std::io::stdout().lock(),
                        &PrivacyHelperReply {
                            fields: Vec::new(),
                            signatures_present: false,
                            summary: None,
                            output_len: 0,
                            error: Some(error.code().to_string()),
                        },
                        None,
                    );
                    0
                }
            }
        }
    }
}

fn write_reply(
    mut writer: impl Write,
    reply: &PrivacyHelperReply,
    output: Option<&[u8]>,
) -> Result<(), String> {
    let control = serde_json::to_vec(reply).map_err(|_| "privacy.serialize".to_string())?;
    write_frame(&mut writer, 1, &control)?;
    if let Some(bytes) = output {
        for chunk in bytes.chunks(1024 * 1024) {
            write_frame(&mut writer, 2, chunk)?;
        }
    }
    write_frame(&mut writer, 3, &[])?;
    Ok(())
}

fn send_bytes(process: &mut FramedHelperProcess, bytes: &[u8]) -> Result<(), String> {
    for chunk in bytes.chunks(1024 * 1024) {
        process.send_frame(2, chunk)?;
    }
    process.send_frame(3, &[])
}

fn receive_reply(
    process: &mut FramedHelperProcess,
    cancel: &fs_service::CancellationToken,
    timeout: Duration,
    output_cap: u64,
) -> Result<(PrivacyHelperReply, Vec<u8>), String> {
    let deadline = Instant::now() + timeout;
    let mut control: Option<PrivacyHelperReply> = None;
    let mut output = Vec::new();
    while Instant::now() < deadline {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            process.kill();
            return Err("privacy.cancelled".to_string());
        }
        let Some(event) = process.recv_frame(Duration::from_millis(200)) else {
            continue;
        };
        match event {
            HelperFrameEvent::Frame { kind: 1, body } => {
                if control.is_some() || body.len() > HELPER_CONTROL_BYTES {
                    process.kill();
                    return Err("privacy.failed".into());
                }
                control = Some(
                    serde_json::from_slice(&body)
                        .map_err(|_| "privacy.failed".to_string())?,
                );
            }
            HelperFrameEvent::Frame { kind: 2, body } => {
                let declared = control.as_ref().ok_or_else(|| "privacy.failed".to_string())?.output_len;
                if declared > output_cap || (output.len() as u64).checked_add(body.len() as u64).is_none_or(|size| size > declared || size > output_cap) { process.kill(); return Err("privacy.too_large".into()); }
                output.extend_from_slice(&body);
                if output.len() as u64 > output_cap {
                    process.kill();
                    return Err("privacy.too_large".to_string());
                }
            }
            HelperFrameEvent::Frame { kind: 3, .. } => {
                let Some(control) = control else {
                    return Err("privacy.failed".to_string());
                };
                if let Some(error) = &control.error {
                    return Err(match error.as_str() { "privacy.bad_request" | "privacy.unsupported" | "privacy.changed" | "privacy.unverified" | "privacy.too_large" | "privacy.no_space" | "privacy.cancelled" | "privacy.failed" | "privacy.version_failed" => error.clone(), _ => "privacy.failed".into() });
                }
                if output.len() as u64 != control.output_len { return Err("privacy.unverified".into()); }
                return Ok((control, output));
            }
            HelperFrameEvent::Frame { .. } => {
                process.kill();
                return Err("privacy.failed".to_string());
            }
            HelperFrameEvent::TooLarge | HelperFrameEvent::Malformed => {
                process.kill();
                return Err("privacy.failed".to_string());
            }
            HelperFrameEvent::Closed => return Err("privacy.failed".to_string()),
        }
    }
    process.kill();
    Err("privacy.failed".to_string())
}

fn run_helper(
    request: PrivacyHelperRequest,
    input: &[u8],
    cancel: &fs_service::CancellationToken,
) -> Result<(PrivacyHelperReply, Vec<u8>), String> {
    let mut command = std::process::Command::new(std::env::current_exe().map_err(|_| "privacy.failed".to_string())?);
    command.arg(HELPER_FLAG);
    let mut process = FramedHelperProcess::spawn_command(command, HELPER_MEMORY_BYTES, HELPER_FRAME_BYTES)?;
    let control = serde_json::to_vec(&request).map_err(|_| "privacy.serialize".to_string())?;
    process.send_frame(1, &control)?;
    send_bytes(&mut process, input)?;
    receive_reply(&mut process, cancel, FILE_TIMEOUT, request.max_output_bytes)
}

/// Inspect bounded source bytes in the helper process.
pub fn inspect_in_helper(
    adapter: &str,
    bytes: &[u8],
    categories: Vec<MetadataCategory>,
    cancel: &fs_service::CancellationToken,
) -> Result<(Vec<PrivacyField>, bool), String> {
    if bytes.is_empty() || bytes.len() > MAX_INPUT_BYTES {
        return Err("privacy.too_large".to_string());
    }
    let request = PrivacyHelperRequest {
        action: PrivacyHelperAction::Inspect,
        adapter: adapter.to_string(),
        categories,
        input_len: bytes.len() as u64,
        max_output_bytes: MAX_OUTPUT_BYTES,
    };
    let (reply, _) = run_helper(request, bytes, cancel)?;
    if reply.fields.len() > privacy::inspect::MAX_INSPECTION_FIELDS {
        return Err("privacy.too_large".to_string());
    }
    for field in &reply.fields {
        field
            .validate()
            .map_err(|error| error.code().to_string())?;
    }
    Ok((reply.fields, reply.signatures_present))
}

/// Clean bounded source bytes in the helper process.
pub fn clean_in_helper(
    adapter: &str,
    bytes: &[u8],
    categories: Vec<MetadataCategory>,
    max_output_bytes: u64,
    cancel: &fs_service::CancellationToken,
) -> Result<(Vec<u8>, PrivacyCleanSummary), String> {
    if bytes.is_empty() || bytes.len() > MAX_INPUT_BYTES {
        return Err("privacy.too_large".to_string());
    }
    let request = PrivacyHelperRequest {
        action: PrivacyHelperAction::Clean,
        adapter: adapter.to_string(),
        categories,
        input_len: bytes.len() as u64,
        max_output_bytes: max_output_bytes.min(MAX_OUTPUT_BYTES),
    };
    let output_cap = request.max_output_bytes;
    let (reply, output) = run_helper(request, bytes, cancel)?;
    let summary = reply.summary.ok_or_else(|| "privacy.failed".to_string())?;
    if summary.coverage != Coverage::Complete {
        return Err("privacy.unverified".to_string());
    }
    if summary.output_bytes != output.len() as u64 {
        return Err("privacy.unverified".to_string());
    }
    if output.len() as u64 != reply.output_len || output.len() as u64 > output_cap {
        return Err("privacy.unverified".to_string());
    }
    Ok((output, summary))
}

/// Progress used by the native job wrapper.
pub fn privacy_progress(done: usize, total: usize, current: &str) -> OpProgress {
    OpProgress {
        items_done: done,
        items_total: total,
        bytes_done: 0,
        bytes_total: 0,
        current: current.to_string(),
    }
}
