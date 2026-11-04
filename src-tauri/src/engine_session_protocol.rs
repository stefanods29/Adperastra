//! Framed control channel of the Office read actor (Step 12b E7).
//!
//! One frame is `kind u8` plus `length u32` little-endian plus exactly
//! `length` bytes of control JSON. Files never travel in a frame: the actor
//! reads its own private copy and writes private artifacts, and the parent
//! copies validated bytes into owned outputs.
//!
//! The parent writes kinds 1 (request) and 4 (cancel). The child writes kinds
//! 2 (reply) and 3 (heartbeat). An unknown kind, an oversized frame, a
//! duplicate reply or trailing bytes terminate the actor: a damaged bridge is
//! never trusted with more work.
#![allow(dead_code)]


use std::io::{Read, Write};

use uuid::Uuid;

use crate::engine_session_types::{
    EngineSessionCancel, EngineSessionHeartbeat, EngineSessionReply, EngineSessionRequest,
    MAX_CONTROL_FRAME_BYTES, SESSION_PROTOCOL_VERSION,
};
use crate::engine_types::EngineError;

/// Parent → child: one command.
pub const KIND_REQUEST: u8 = 1;
/// Child → parent: one reply.
pub const KIND_REPLY: u8 = 2;
/// Child → parent: one heartbeat.
pub const KIND_HEARTBEAT: u8 = 3;
/// Parent → child: cancel the named request.
pub const KIND_CANCEL: u8 = 4;

/// The five bytes in front of every frame.
pub const FRAME_HEADER_BYTES: usize = 5;

/// A frame the parent may write.
pub fn is_parent_kind(kind: u8) -> bool {
    matches!(kind, KIND_REQUEST | KIND_CANCEL)
}

/// A frame the child may write.
pub fn is_child_kind(kind: u8) -> bool {
    matches!(kind, KIND_REPLY | KIND_HEARTBEAT)
}

/// The conversation direction of one frame; `None` is an unknown variant.
pub fn direction(kind: u8) -> Option<Direction> {
    if is_parent_kind(kind) {
        Some(Direction::ParentToChild)
    } else if is_child_kind(kind) {
        Some(Direction::ChildToParent)
    } else {
        None
    }
}

/// Who may write a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    ParentToChild,
    ChildToParent,
}

/// Write one frame and flush it, so the other side sees it immediately.
pub fn write_frame<W: Write>(writer: &mut W, kind: u8, payload: &[u8]) -> Result<(), EngineError> {
    let length = u32::try_from(payload.len()).map_err(|_| EngineError::BadRequest)?;
    let mut header = [0u8; FRAME_HEADER_BYTES];
    header[0] = kind;
    header[1..].copy_from_slice(&length.to_le_bytes());
    writer
        .write_all(&header)
        .and_then(|()| writer.write_all(payload))
        .and_then(|()| writer.flush())
        .map_err(|_| EngineError::Failed)
}

/// Read exactly one frame. `Ok(None)` at a clean end of stream; a truncated
/// frame is an error, never a shorter message.
pub fn read_frame<R: Read>(
    reader: &mut R,
    max_payload: usize,
) -> Result<Option<(u8, Vec<u8>)>, EngineError> {
    let mut header = [0u8; FRAME_HEADER_BYTES];
    if !read_exact_or_end(reader, &mut header)? { return Ok(None) }
    let length = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if length > max_payload {
        return Err(EngineError::Failed);
    }
    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|_| EngineError::Failed)?;
    Ok(Some((header[0], payload)))
}

/// Fill `buffer`, or report a clean end before the first byte.
fn read_exact_or_end<R: Read>(reader: &mut R, buffer: &mut [u8]) -> Result<bool, EngineError> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => {
                return if filled == 0 {
                    Ok(false)
                } else {
                    Err(EngineError::Failed)
                }
            }
            Ok(read) => filled += read,
            Err(_) => return Err(EngineError::Failed),
        }
    }
    Ok(true)
}

/// A bounded JSON body: at most `MAX_CONTROL_FRAME_BYTES`.
fn encode_json<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, EngineError> {
    let bytes = serde_json::to_vec(value).map_err(|_| EngineError::BadRequest)?;
    if bytes.is_empty() || bytes.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(EngineError::BadRequest);
    }
    Ok(bytes)
}

/// Parse a bounded JSON body and check the envelope.
fn decode_json<T: serde::de::DeserializeOwned>(payload: &[u8]) -> Result<T, EngineError> {
    if payload.is_empty() || payload.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(EngineError::Failed);
    }
    serde_json::from_slice(payload).map_err(|_| EngineError::Failed)
}

/// Send one command and return the request ID the reply must echo.
pub fn send_request<W: Write>(
    writer: &mut W,
    request: &EngineSessionRequest,
) -> Result<Uuid, EngineError> {
    request.validate()?;
    let body = encode_json(request)?;
    write_frame(writer, KIND_REQUEST, &body)?;
    Ok(request.request_id)
}

/// Send the cancel notice for one request.
pub fn send_cancel<W: Write>(writer: &mut W, request_id: Uuid) -> Result<(), EngineError> {
    let cancel = EngineSessionCancel {
        protocol_version: SESSION_PROTOCOL_VERSION,
        request_id,
    };
    let body = encode_json(&cancel)?;
    write_frame(writer, KIND_CANCEL, &body)
}

/// Parse one reply frame and check its envelope against the request.
pub fn decode_reply(payload: &[u8], request_id: Uuid) -> Result<EngineSessionReply, EngineError> {
    let reply: EngineSessionReply = decode_json(payload)?;
    reply.validate(request_id)?;
    Ok(reply)
}

/// Parse one heartbeat frame.
pub fn decode_heartbeat(payload: &[u8]) -> Result<EngineSessionHeartbeat, EngineError> {
    let heartbeat: EngineSessionHeartbeat = decode_json(payload)?;
    if heartbeat.protocol_version != SESSION_PROTOCOL_VERSION {
        return Err(EngineError::Failed);
    }
    heartbeat.validate()?;
    Ok(heartbeat)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine_session_types::EngineSessionCommand;
    use std::io::Cursor;

    fn request() -> EngineSessionRequest {
        EngineSessionRequest {
            protocol_version: SESSION_PROTOCOL_VERSION,
            request_id: Uuid::from_u128(7),
            command: EngineSessionCommand::Close {},
        }
    }

    #[test]
    fn frames_round_trip_exactly() {
        let mut stream = Vec::new();
        send_request(&mut stream, &request()).unwrap();
        let mut reader = Cursor::new(stream);
        let (kind, payload) = read_frame(&mut reader, MAX_CONTROL_FRAME_BYTES).unwrap().unwrap();
        assert_eq!(kind, KIND_REQUEST);
        let decoded: EngineSessionRequest = decode_json(&payload).unwrap();
        assert_eq!(decoded.request_id, Uuid::from_u128(7));
        // Exactly one frame, then a clean end.
        assert!(read_frame(&mut reader, MAX_CONTROL_FRAME_BYTES).unwrap().is_none());
    }

    #[test]
    fn oversized_frames_are_refused_before_allocation() {
        let mut stream = vec![KIND_REPLY, 0xff, 0xff, 0xff, 0x0f];
        stream.extend_from_slice(b"{}");
        let mut reader = Cursor::new(stream);
        assert_eq!(
            read_frame(&mut reader, MAX_CONTROL_FRAME_BYTES),
            Err(EngineError::Failed)
        );
    }

    #[test]
    fn truncated_frames_are_errors() {
        let mut stream = vec![KIND_REPLY, 4, 0, 0, 0];
        stream.extend_from_slice(b"{}");
        let mut reader = Cursor::new(stream);
        assert_eq!(
            read_frame(&mut reader, MAX_CONTROL_FRAME_BYTES),
            Err(EngineError::Failed)
        );
    }

    #[test]
    fn a_reply_must_echo_its_request() {
        let reply = EngineSessionReply {
            protocol_version: SESSION_PROTOCOL_VERSION,
            request_id: Uuid::from_u128(8),
            result: crate::engine_session_types::EngineSessionReplyResult::Closed {},
        };
        let body = serde_json::to_vec(&reply).unwrap();
        assert_eq!(
            decode_reply(&body, Uuid::from_u128(7)).err(),
            Some(EngineError::Failed)
        );
        assert!(decode_reply(&body, Uuid::from_u128(8)).is_ok());
    }
}
