//! `Adperastra.exe --convert-helper`: the bounded conversion child process
//! (Step 08a T3/T4).
//!
//! The parent sends one bounded request frame and, for a snapshot, the exact
//! declared bytes in 1 MiB frames. The child pins an ordinary source itself,
//! keeps a sensitive snapshot in zeroizing memory, and answers only with
//! bounded output/metadata frames. It never receives a destination path.

use std::io::{Read, Write};
use std::path::PathBuf;

use convert::ConvertSource;
use fs_service::new_cancellation_token;
use fs_service::owned_io::{PinnedSource, SourceIdentity};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::convert_jobs::{
    HelperRequest, HelperSource, FRAME_ABORT, FRAME_BEGIN, FRAME_ERROR, FRAME_FINAL, FRAME_FINISH,
    FRAME_OUTPUT, FRAME_PREVIEW_PNG, FRAME_PROGRESS, FRAME_REQUEST, FRAME_SNAPSHOT_CHUNK,
};

pub const HELPER_FLAG: &str = "--convert-helper";
pub const MAX_REQUEST_JSON: usize = 64 * 1024;
pub const MAX_FRAME: usize = 1024 * 1024;
pub const MAX_OUTPUT_CHUNK: usize = 1024 * 1024;

fn read_exact_frame(reader: &mut impl Read) -> Result<(u8, Vec<u8>), String> {
    let mut header = [0u8; 5];
    reader
        .read_exact(&mut header)
        .map_err(|_| "helper.failed".to_string())?;
    let kind = header[0];
    let length = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if kind == 0 || length == 0 || length > MAX_FRAME {
        return Err("helper.failed".to_string());
    }
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| "helper.failed".to_string())?;
    Ok((kind, body))
}

fn send(kind: u8, body: &[u8]) -> Result<(), String> {
    if kind == 0 || body.len() > MAX_FRAME {
        return Err("helper.failed".to_string());
    }
    let mut out = std::io::stdout().lock();
    out.write_all(&[kind])
        .map_err(|_| "helper.failed".to_string())?;
    out.write_all(&(body.len() as u32).to_le_bytes())
        .map_err(|_| "helper.failed".to_string())?;
    out.write_all(body)
        .map_err(|_| "helper.failed".to_string())?;
    out.flush().map_err(|_| "helper.failed".to_string())
}

fn send_json<T: Serialize>(kind: u8, value: &T) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|_| "helper.failed".to_string())?;
    if body.len() > MAX_REQUEST_JSON {
        return Err("helper.failed".to_string());
    }
    send(kind, &body)
}

fn send_error(code: &str) -> i32 {
    let _ = send(FRAME_ERROR, code.as_bytes());
    0
}

/// A sink that names no path: the parent owns publication.
struct ChildSink {
    next: u32,
    open: Option<u32>,
}

impl convert::ConvertOutputSink for ChildSink {
    fn begin(&mut self, draft: convert::OutputDraft) -> Result<u32, convert::ConvertError> {
        if self.open.is_some() {
            return Err(convert::ConvertError::BadRequest);
        }
        let index = self.next;
        self.next = self
            .next
            .checked_add(1)
            .ok_or(convert::ConvertError::TooLarge)?;
        send_json(FRAME_BEGIN, &draft)
            .map_err(|_| convert::ConvertError::Io(std::io::Error::other("pipe")))?;
        self.open = Some(index);
        Ok(index)
    }

    fn write(&mut self, output_index: u32, bytes: &[u8]) -> Result<(), convert::ConvertError> {
        if self.open != Some(output_index) || bytes.len() > MAX_OUTPUT_CHUNK {
            return Err(convert::ConvertError::BadRequest);
        }
        send(FRAME_OUTPUT, bytes)
            .map_err(|_| convert::ConvertError::Io(std::io::Error::other("pipe")))
    }

    fn finish(
        &mut self,
        output_index: u32,
        metadata: convert::OutputMetadata,
    ) -> Result<(), convert::ConvertError> {
        if self.open != Some(output_index) {
            return Err(convert::ConvertError::BadRequest);
        }
        send_json(FRAME_FINISH, &metadata)
            .map_err(|_| convert::ConvertError::Io(std::io::Error::other("pipe")))?;
        self.open = None;
        Ok(())
    }

    fn abort(&mut self, output_index: u32) -> Result<(), convert::ConvertError> {
        send(FRAME_ABORT, &output_index.to_le_bytes())
            .map_err(|_| convert::ConvertError::Io(std::io::Error::other("pipe")))?;
        if self.open == Some(output_index) {
            self.open = None;
        }
        Ok(())
    }
}

fn read_snapshot(reader: &mut impl Read, byte_len: u64) -> Result<Zeroizing<Vec<u8>>, String> {
    if byte_len == 0 || byte_len > crate::export_snapshot_types::MAX_SNAPSHOT_BYTES {
        return Err("convert.too_large".to_string());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(usize::try_from(byte_len).unwrap_or(0)));
    while (bytes.len() as u64) < byte_len {
        let (kind, body) = read_exact_frame(reader)?;
        if kind != FRAME_SNAPSHOT_CHUNK || body.len() > MAX_OUTPUT_CHUNK {
            return Err("convert.bad_request".to_string());
        }
        if bytes.len() as u64 + body.len() as u64 > byte_len {
            return Err("convert.too_large".to_string());
        }
        bytes.extend_from_slice(&body);
    }
    Ok(bytes)
}

fn identity_matches(identity: &SourceIdentity, stamp: &fs_service::SourceStamp) -> bool {
    format!("{:08x}", identity.volume) == stamp.volume_id
        && format!("{:016x}", identity.index) == stamp.file_id
        && identity.size == stamp.size_bytes
}

fn parse_file(
    request: &HelperSource,
    input_index: u32,
) -> Result<(ConvertSource, PinnedSource), String> {
    let path = request
        .path
        .as_deref()
        .ok_or_else(|| "convert.bad_request".to_string())?;
    let parsed = PathBuf::from(path);
    if !parsed.is_absolute()
        || parsed
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("convert.bad_request".to_string());
    }
    let stamp = request
        .stamp
        .as_ref()
        .ok_or_else(|| "convert.bad_request".to_string())?;
    let identity = SourceIdentity::capture(&parsed).map_err(|_| "convert.changed".to_string())?;
    if !identity_matches(&identity, stamp) {
        return Err("convert.changed".to_string());
    }
    let pin = PinnedSource::open(&parsed, &identity).map_err(|_| "convert.changed".to_string())?;
    let file = pin
        .file()
        .try_clone()
        .map_err(|_| "convert.io".to_string())?;
    let source = ConvertSource {
        input_index,
        name: request.name.clone(),
        mime: request.mime.clone(),
        byte_len: identity.size,
        source_stamp: Some(stamp.clone()),
        reader: Box::new(file),
    };
    Ok((source, pin))
}

fn progress_hook(
) -> Box<dyn FnMut(fs_service::OpProgress) -> Result<(), convert::ConvertError> + Send> {
    Box::new(|progress| {
        let body = serde_json::to_vec(&progress)
            .map_err(|_| convert::ConvertError::Io(std::io::Error::other("pipe")))?;
        if body.len() > MAX_REQUEST_JSON {
            return Err(convert::ConvertError::TooLarge);
        }
        send(FRAME_PROGRESS, &body)
            .map_err(|_| convert::ConvertError::Io(std::io::Error::other("pipe")))
    })
}

/// The helper entry point called from `main()`.
pub fn run_helper() -> i32 {
    let mut stdin = std::io::stdin();
    let (kind, body) = match read_exact_frame(&mut stdin) {
        Ok(frame) => frame,
        Err(_) => return send_error("convert.io"),
    };
    if kind != FRAME_REQUEST || body.len() > MAX_REQUEST_JSON {
        return send_error("convert.bad_request");
    }
    let request: HelperRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return send_error("convert.bad_request"),
    };
    if request.mode != "convert" && request.mode != "preview" {
        return send_error("convert.bad_request");
    }
    // The pin keeps an ordinary source guarded for the whole conversion.
    let mut pin: Option<PinnedSource> = None;
    let mut source = match request.source.kind.as_str() {
        "file" => match parse_file(&request.source, request.input_index) {
            Ok((source, guard)) => {
                pin = Some(guard);
                source
            }
            Err(code) => return send_error(&code),
        },
        "snapshot" => {
            let bytes = match read_snapshot(&mut stdin, request.source.byte_len) {
                Ok(bytes) => bytes,
                Err(code) => return send_error(&code),
            };
            ConvertSource::from_bytes(
                request.input_index,
                request.source.name.clone(),
                request.source.mime.clone(),
                bytes.to_vec(),
                request.source.stamp.clone(),
            )
        }
        _ => return send_error("convert.bad_request"),
    };
    let _pin = pin;
    // Only the native parent names the bounded intermediate root, and only
    // inside the app data folder. Without it the archive adapters are absent
    // and archive requests fail closed.
    let registry = match request
        .work_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
    {
        Some(root) => {
            let root = PathBuf::from(root);
            // A root outside the native app data folder is ignored rather
            // than trusted: the archive adapters then stay absent while
            // image/table work still runs.
            if root.is_absolute() && root.starts_with(crate::resolve_data_dir()) {
                convert::builtin_registry_with_work_root(root)
            } else {
                convert::builtin_registry()
            }
        }
        None => convert::builtin_registry(),
    };
    let Some(converter) = registry.get(request.converter_id.as_str()) else {
        return send_error("convert.bad_request");
    };
    if let Err(error) = request.options.validate() {
        return send_error(error.code());
    }
    let mut context = convert::ConvertContext {
        cancel: new_cancellation_token(),
        progress: progress_hook(),
        max_output_bytes: request.max_output_bytes,
    };
    if request.mode == "preview" {
        let preview = match convert::run_preview(
            converter,
            std::slice::from_mut(&mut source),
            &request.options,
            &mut context,
        ) {
            Ok(preview) => preview,
            Err(error) => return send_error(error.code()),
        };
        for chunk in preview.png.chunks(MAX_OUTPUT_CHUNK) {
            if send(FRAME_PREVIEW_PNG, chunk).is_err() {
                return send_error("convert.io");
            }
        }
        let meta = HelperPreviewMeta {
            width: preview.width,
            height: preview.height,
            estimated_bytes: preview.estimated_bytes,
            estimated_ms: preview.estimated_ms,
            warnings: preview.warnings,
            metadata_lost: preview.metadata_lost,
        };
        if send_json(FRAME_FINAL, &meta).is_err() {
            return send_error("convert.io");
        }
        return 0;
    }
    let mut sink = ChildSink {
        next: 0,
        open: None,
    };
    let result = convert::run_conversion(
        converter,
        std::slice::from_mut(&mut source),
        &request.options,
        &request.accepted_losses,
        &request.accepted_warning_codes,
        &mut sink,
        &mut context,
    );
    match result {
        Ok(prepared) => {
            if send_json(FRAME_FINAL, &prepared).is_err() {
                return send_error("convert.io");
            }
            0
        }
        Err(error) => send_error(error.code()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HelperPreviewMeta {
    width: u32,
    height: u32,
    estimated_bytes: Option<u64>,
    estimated_ms: Option<u64>,
    warnings: Vec<convert::ConversionWarningCode>,
    metadata_lost: Vec<convert::MetadataCategory>,
}
