#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The wire of the trusted WebView helper host (Step 07d D3/E7).
//!
//! Two directions, one format:
//! - control frames (kind1) carry `HelperControlFrame`, at most 768 KiB;
//! - output bodies arrive over the child's own `adpfile` route
//!   `/helper-output/<request_id>/<output_id>` in chunks of at most 1 MiB,
//!   with a contiguous offset, and end with the exact length and SHA-256.
//!
//! Everything here is pure or state-only, so the rules can be tested without
//! a WebView. The parent verifies every body before it accepts a reply; the
//! child never chooses an id, a path or a route.

use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

use crate::webview_helper_types::{
    HelperControlFrame, HelperOutputDTO, HelperOutputReservation, HelperReplyEnvelope,
    HelperRequestEnvelope, MAX_BODY_CHUNK, MAX_CONTROL_BYTES, MAX_ERROR_CODE, MAX_MIME,
    PROTOCOL_VERSION,
};

/// Serialize one control frame, refusing anything over the cap.
pub fn encode_control(frame: &HelperControlFrame) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(frame).map_err(|_| "helper.failed".to_string())?;
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err("helper.too_large".to_string());
    }
    Ok(bytes)
}

/// Parse one control frame; an unknown kind or over-long body is refused.
pub fn decode_control(bytes: &[u8]) -> Result<HelperControlFrame, String> {
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err("helper.too_large".to_string());
    }
    serde_json::from_slice(bytes).map_err(|_| "helper.failed".to_string())
}

/// The one result route of one request.
pub fn output_route(request_id: Uuid, output_id: Uuid) -> String {
    format!("http://adpfile.localhost/helper-output/{request_id}/{output_id}")
}

/// Parse a helper-output path (`/helper-output/<request>/<output>`).
pub fn parse_output_path(path: &str) -> Option<(Uuid, Uuid)> {
    let mut parts = path.trim_start_matches('/').split('/');
    if parts.next()? != "helper-output" {
        return None;
    }
    let request = Uuid::parse_str(parts.next()?).ok()?;
    let output = Uuid::parse_str(parts.next()?).ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((request, output))
}

/// The error codes a child may report; an exception string never reaches
/// the UI.
pub fn allowed_error_code(code: &str) -> bool {
    if code.is_empty() || code.len() > MAX_ERROR_CODE {
        return false;
    }
    const PDF: [&str; 10] = [
        "pdf.bad_request",
        "pdf.too_large",
        "pdf.password_required",
        "pdf.bad_password",
        "pdf.permissions",
        "pdf.changed",
        "pdf.corrupt",
        "pdf.unavailable",
        "pdf.snapshot_unavailable",
        "pdf.unsupported_feature",
    ];
    const PDF_EDIT: [&str; 8] = [
        "pdf_edit.bad_request",
        "pdf_edit.read_only",
        "pdf_edit.unsupported",
        "pdf_edit.too_large",
        "pdf_edit.changed",
        "pdf_edit.missing_glyph",
        "pdf_edit.signature_change",
        "pdf_edit.failed",
    ];
    const HELPER: [&str; 4] = [
        "helper.busy",
        "helper.failed",
        "helper.timeout",
        "helper.sensitive_unsupported",
    ];
    // The Office quick helper reports the same bounded codes as the native
    // view command layer; an unknown code is still replaced by helper.failed.
    const OFFICE: [&str; 5] = [
        "office.bad_request",
        "office.unsupported",
        "office.too_large",
        "office.changed",
        "office.engine_failed",
    ];
    PDF.contains(&code)
        || PDF_EDIT.contains(&code)
        || HELPER.contains(&code)
        || OFFICE.contains(&code)
}

/// True for 64 lower-case hex characters.
pub fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// The request the child is currently answering.
#[derive(Debug, Clone)]
pub struct ActiveRequest {
    pub request_id: Uuid,
    pub action: crate::webview_helper_types::HelperAction,
    pub reservations: Vec<HelperOutputReservation>,
}

/// What a validated reply carries.
pub struct VerifiedReply {
    pub payload: serde_json::Value,
    pub outputs: Vec<HelperOutputDTO>,
}

/// Cheap shape check used by the child before it forwards a reply.
pub fn validate_reply_shape(
    active: &ActiveRequest,
    reply: &HelperReplyEnvelope<serde_json::Value>,
) -> Result<(), String> {
    if !reply.version_ok() || reply.request_id() != active.request_id {
        return Err("pdf.changed".to_string());
    }
    if let HelperReplyEnvelope::Ok { outputs, .. } = reply {
        if outputs.len() != active.reservations.len() {
            return Err("helper.failed".to_string());
        }
    }
    Ok(())
}

/// Check a reply against the request the child was given. A stale id, a
/// wrong version, an unknown error code, or an output that does not match a
/// reservation is refused before the parent reads any body.
pub fn validate_reply(
    active: &ActiveRequest,
    reply: &HelperReplyEnvelope<serde_json::Value>,
) -> Result<VerifiedReply, String> {
    if !reply.version_ok() || reply.request_id() != active.request_id {
        return Err("pdf.changed".to_string());
    }
    match reply {
        HelperReplyEnvelope::Error { error_code, .. } => {
            if !allowed_error_code(error_code) {
                return Err("pdf.corrupt".to_string());
            }
            Err(error_code.clone())
        }
        HelperReplyEnvelope::Ok {
            payload, outputs, ..
        } => {
            if outputs.len() != active.reservations.len() {
                return Err("helper.failed".to_string());
            }
            for output in outputs {
                let Some(reservation) = active
                    .reservations
                    .iter()
                    .find(|reservation| reservation.output_id == output.output_id)
                else {
                    return Err("helper.failed".to_string());
                };
                if output.mime != reservation.mime
                    || output.byte_len == 0
                    || output.byte_len > reservation.max_bytes
                    || !is_sha256_hex(&output.sha256)
                {
                    return Err("helper.failed".to_string());
                }
            }
            Ok(VerifiedReply {
                payload: payload.clone(),
                outputs: outputs.clone(),
            })
        }
    }
}

/// The child's upload slots: one per reservation of the active request.
#[derive(Default)]
pub struct OutputSink {
    slots: Mutex<HashMap<(Uuid, Uuid), Slot>>,
}

struct Slot {
    reservation: HelperOutputReservation,
    bytes: Vec<u8>,
    finished: bool,
}

impl OutputSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reserve every output of one request (sum of caps already checked by
    /// the parent before launch).
    pub fn reserve(
        &self,
        request_id: Uuid,
        reservations: &[HelperOutputReservation],
    ) -> Result<(), String> {
        let mut slots = self.slots.lock().map_err(|_| "helper.failed".to_string())?;
        if slots.keys().any(|(request, _)| *request == request_id) {
            return Err("helper.busy".to_string());
        }
        for reservation in reservations {
            if !reservation.is_valid() || reservation.mime.len() > MAX_MIME {
                return Err("helper.failed".to_string());
            }
            slots.insert(
                (request_id, reservation.output_id),
                Slot {
                    reservation: reservation.clone(),
                    bytes: Vec::new(),
                    finished: false,
                },
            );
        }
        Ok(())
    }

    /// Append a chunk at the exact next offset.
    pub fn append(
        &self,
        request_id: Uuid,
        output_id: Uuid,
        upload_token: &str,
        offset: u64,
        body: &[u8],
    ) -> Result<(), String> {
        if body.len() > MAX_BODY_CHUNK {
            return Err("pdf.too_large".to_string());
        }
        let mut slots = self.slots.lock().map_err(|_| "helper.failed".to_string())?;
        let Some(slot) = slots.get_mut(&(request_id, output_id)) else {
            return Err("helper.failed".to_string());
        };
        if slot.finished
            || slot.reservation.upload_token != upload_token
            || slot.bytes.len() as u64 != offset
        {
            return Err("helper.failed".to_string());
        }
        if (slot.bytes.len() + body.len()) as u64 > slot.reservation.max_bytes {
            return Err("pdf.too_large".to_string());
        }
        slot.bytes.extend_from_slice(body);
        Ok(())
    }

    /// Finish one output: the exact length and SHA-256 must match.
    pub fn finish(
        &self,
        request_id: Uuid,
        output_id: Uuid,
        upload_token: &str,
        length: u64,
        sha256: &str,
    ) -> Result<HelperOutputDTO, String> {
        let mut slots = self.slots.lock().map_err(|_| "helper.failed".to_string())?;
        let Some(slot) = slots.get_mut(&(request_id, output_id)) else {
            return Err("helper.failed".to_string());
        };
        if slot.finished
            || slot.reservation.upload_token != upload_token
            || slot.bytes.len() as u64 != length
            || !is_sha256_hex(sha256)
            || crate::webview_helper_protocol::sha256_hex(&slot.bytes) != sha256
        {
            return Err("helper.failed".to_string());
        }
        slot.finished = true;
        Ok(HelperOutputDTO {
            output_id,
            mime: slot.reservation.mime.clone(),
            byte_len: length,
            sha256: sha256.to_string(),
        })
    }

    /// The finished bytes of one output, if it is complete.
    pub fn take(
        &self,
        request_id: Uuid,
        output_id: Uuid,
    ) -> Option<(HelperOutputReservation, Vec<u8>)> {
        let mut slots = self.slots.lock().ok()?;
        let slot = slots.remove(&(request_id, output_id))?;
        if !slot.finished {
            return None;
        }
        Some((slot.reservation, slot.bytes))
    }

    /// Drop every slot of one request (also the unused reservations).
    pub fn clear_request(&self, request_id: Uuid) {
        if let Ok(mut slots) = self.slots.lock() {
            slots.retain(|(request, _), _| *request != request_id);
        }
    }

    pub fn pending(&self) -> usize {
        self.slots.lock().map(|slots| slots.len()).unwrap_or(0)
    }
}

/// SHA-256 of a body, lower-case hex (the same check the frontend makes).
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// True when a request envelope is inside every protocol bound.
pub fn request_is_bounded<T>(request: &HelperRequestEnvelope<T>) -> bool
where
    T: serde::Serialize,
{
    if !request.is_valid() {
        return false;
    }
    serde_json::to_vec(request)
        .map(|bytes| bytes.len() <= MAX_CONTROL_BYTES)
        .unwrap_or(false)
}

/// Build the `start` frame the parent sends first (manifests only).
pub fn start_frame(
    kind: crate::webview_helper_types::WebviewHelperKind,
    placement: crate::webview_helper_types::HelperWindowPlacement,
    manifests: Vec<crate::webview_helper_types::HelperInputManifest>,
) -> HelperControlFrame {
    HelperControlFrame::Start {
        protocol_version: PROTOCOL_VERSION,
        kind,
        placement,
        inputs: manifests,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::webview_helper_types::{
        HelperAction, HelperOutputDTO, HelperOutputReservation, HelperReplyEnvelope,
    };
    use serde_json::json;

    fn reservation(max_bytes: u64) -> HelperOutputReservation {
        HelperOutputReservation {
            output_id: Uuid::new_v4(),
            mime: "image/png".to_string(),
            token_url: "http://adpfile.localhost/helper-output/a/b".to_string(),
            upload_token: "0123456789abcdef0123456789abcdef".to_string(),
            max_bytes,
            sensitive: false,
        }
    }

    #[test]
    fn control_frames_round_trip_and_stay_bounded() {
        let frame = start_frame(
            crate::webview_helper_types::WebviewHelperKind::Pdf,
            crate::webview_helper_types::HelperWindowPlacement::Hidden,
            Vec::new(),
        );
        let bytes = encode_control(&frame).unwrap();
        assert_eq!(decode_control(&bytes).unwrap(), frame);
        assert!(decode_control(b"{\"kind\":\"nope\"}").is_err());
    }

    #[test]
    fn output_routes_are_exact() {
        let request = Uuid::new_v4();
        let output = Uuid::new_v4();
        let url = output_route(request, output);
        let path = url.trim_start_matches("http://adpfile.localhost");
        assert_eq!(parse_output_path(path), Some((request, output)));
        assert_eq!(parse_output_path("/helper-output/x/y"), None);
        assert_eq!(parse_output_path("/0123/x"), None);
    }

    #[test]
    fn uploads_are_contiguous_and_hashed() {
        let sink = OutputSink::new();
        let request = Uuid::new_v4();
        let slot = reservation(16);
        sink.reserve(request, std::slice::from_ref(&slot)).unwrap();
        // Wrong offset, wrong token, then the right chunks.
        assert!(sink
            .append(request, slot.output_id, &slot.upload_token, 2, b"ab")
            .is_err());
        assert!(sink
            .append(
                request,
                slot.output_id,
                "ffffffffffffffffffffffffffffffff",
                0,
                b"ab"
            )
            .is_err());
        sink.append(request, slot.output_id, &slot.upload_token, 0, b"abc")
            .unwrap();
        sink.append(request, slot.output_id, &slot.upload_token, 3, b"def")
            .unwrap();
        let hash = sha256_hex(b"abcdef");
        assert!(sink
            .finish(
                request,
                slot.output_id,
                &slot.upload_token,
                6,
                &sha256_hex(b"abcde")
            )
            .is_err());
        let output = sink
            .finish(request, slot.output_id, &slot.upload_token, 6, &hash)
            .unwrap();
        assert_eq!(output.byte_len, 6);
        let (_, bytes) = sink.take(request, slot.output_id).unwrap();
        assert_eq!(bytes, b"abcdef");
        // A finished slot cannot be written again.
        assert!(sink
            .append(request, slot.output_id, &slot.upload_token, 6, b"x")
            .is_err());
    }

    #[test]
    fn an_oversized_upload_is_refused_before_storing() {
        let sink = OutputSink::new();
        let request = Uuid::new_v4();
        let slot = reservation(4);
        sink.reserve(request, std::slice::from_ref(&slot)).unwrap();
        assert_eq!(
            sink.append(request, slot.output_id, &slot.upload_token, 0, b"abcde")
                .err(),
            Some("pdf.too_large".to_string())
        );
    }

    #[test]
    fn replies_are_checked_before_any_body_is_read() {
        let reservation = reservation(8);
        let active = ActiveRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfRender,
            reservations: vec![reservation.clone()],
        };
        let good_output = HelperOutputDTO {
            output_id: reservation.output_id,
            mime: "image/png".to_string(),
            byte_len: 4,
            sha256: sha256_hex(b"abcd"),
        };
        let good = HelperReplyEnvelope::Ok {
            protocol_version: PROTOCOL_VERSION,
            request_id: active.request_id,
            payload: json!({ "page": 1 }),
            outputs: vec![good_output.clone()],
        };
        assert!(validate_reply(&active, &good).is_ok());
        // Another request's id is stale.
        let stale = HelperReplyEnvelope::Ok {
            protocol_version: PROTOCOL_VERSION,
            request_id: Uuid::new_v4(),
            payload: json!({}),
            outputs: vec![good_output.clone()],
        };
        assert_eq!(
            validate_reply(&active, &stale).err(),
            Some("pdf.changed".to_string())
        );
        // An output that was never reserved is refused.
        let foreign = HelperReplyEnvelope::Ok {
            protocol_version: PROTOCOL_VERSION,
            request_id: active.request_id,
            payload: json!({}),
            outputs: vec![HelperOutputDTO {
                output_id: Uuid::new_v4(),
                ..good_output.clone()
            }],
        };
        assert_eq!(
            validate_reply(&active, &foreign).err(),
            Some("helper.failed".to_string())
        );
        // An error code outside the allowed list cannot reach the UI.
        let bad_code = HelperReplyEnvelope::Error {
            protocol_version: PROTOCOL_VERSION,
            request_id: active.request_id,
            error_code: "TypeError: undefined is not a function".to_string(),
        };
        assert_eq!(
            validate_reply(&active, &bad_code).err(),
            Some("pdf.corrupt".to_string())
        );
        let known = HelperReplyEnvelope::Error {
            protocol_version: PROTOCOL_VERSION,
            request_id: active.request_id,
            error_code: "pdf.corrupt".to_string(),
        };
        assert_eq!(
            validate_reply(&active, &known).err(),
            Some("pdf.corrupt".to_string())
        );
    }
}
