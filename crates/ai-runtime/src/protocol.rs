//! Framing for `AdperastraAiHost.exe` (T3).
//!
//! One frame is `kind: u8 | length: u32 little-endian | payload`. The header
//! is a fixed binary record with length-prefixed ASCII ids (no JSON parser in
//! the helper). It is at most 64 KiB; every payload chunk is at most 1 MiB.
//! The helper never receives a user path or an executable name.

pub use crate::protocol_header::{
    decode_header, encode_header, wire_options, HelperHeader, WireOptions,
};

use sha2::{Digest, Sha256};

pub const PROTOCOL_VERSION: u32 = 1;
pub const HEADER_MAGIC: [u8; 8] = *b"ADPAIH01";
pub const MAX_HEADER_BYTES: usize = 65_536;
pub const MAX_PAYLOAD_CHUNK_BYTES: usize = 1_048_576;
pub const MAX_INPUT_BYTES: u64 = 268_435_456;
pub const MAX_OUTPUT_BYTES: u64 = 1_073_741_824;
pub const MAX_ERROR_CODE_BYTES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    Header = 1,
    InputChunk = 2,
    Cancel = 4,
    OutputChunk = 5,
    Progress = 6,
    Result = 7,
    Error = 8,
    Heartbeat = 9,
}

impl FrameKind {
    pub fn from_u8(value: u8) -> Option<Self> {
        Some(match value {
            1 => FrameKind::Header,
            2 => FrameKind::InputChunk,
            4 => FrameKind::Cancel,
            5 => FrameKind::OutputChunk,
            6 => FrameKind::Progress,
            7 => FrameKind::Result,
            8 => FrameKind::Error,
            9 => FrameKind::Heartbeat,
            _ => return None,
        })
    }
}

pub fn encode_frame(kind: FrameKind, payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() > MAX_PAYLOAD_CHUNK_BYTES {
        return Err("ai.bad_request".into());
    }
    let mut frame = Vec::with_capacity(5 + payload.len());
    frame.push(kind as u8);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn decode_frame(bytes: &[u8]) -> Result<(FrameKind, &[u8]), String> {
    if bytes.len() < 5 {
        return Err("ai.bad_request".into());
    }
    let kind = FrameKind::from_u8(bytes[0]).ok_or("ai.bad_request")?;
    let length = u32::from_le_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as usize;
    if length > MAX_PAYLOAD_CHUNK_BYTES || bytes.len() != 5 + length {
        return Err("ai.bad_request".into());
    }
    Ok((kind, &bytes[5..]))
}

/// Streaming SHA-256 used to verify helper output independently.
pub struct OutputHasher(Sha256);

#[allow(clippy::new_without_default)]
impl OutputHasher {
    pub fn new() -> Self {
        Self(Sha256::new())
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub fn hex(&self) -> String {
        format!("{:x}", self.0.clone().finalize())
    }
}

pub fn validate_error_code(code: &str) -> Result<(), String> {
    if code.is_empty()
        || code.len() > MAX_ERROR_CODE_BYTES
        || !code.is_ascii()
        || !code.starts_with("ai.")
        || !code
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_')
    {
        return Err("ai.failed".into());
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct StreamBudget {
    pub input_limit: u64,
    pub output_limit: u64,
    input_used: u64,
    output_used: u64,
}

impl StreamBudget {
    pub fn new(input_limit: u64, output_limit: u64) -> Result<Self, String> {
        if input_limit == 0
            || input_limit > MAX_INPUT_BYTES
            || output_limit == 0
            || output_limit > MAX_OUTPUT_BYTES
        {
            return Err("ai.bad_request".into());
        }
        Ok(Self {
            input_limit,
            output_limit,
            input_used: 0,
            output_used: 0,
        })
    }

    pub fn add_input(&mut self, bytes: usize) -> Result<(), String> {
        self.input_used = self
            .input_used
            .checked_add(bytes as u64)
            .ok_or("ai.memory_limit")?;
        if self.input_used > self.input_limit {
            return Err("ai.memory_limit".into());
        }
        Ok(())
    }

    pub fn add_output(&mut self, bytes: usize) -> Result<(), String> {
        self.output_used = self
            .output_used
            .checked_add(bytes as u64)
            .ok_or("ai.memory_limit")?;
        if self.output_used > self.output_limit {
            return Err("ai.memory_limit".into());
        }
        Ok(())
    }
}
