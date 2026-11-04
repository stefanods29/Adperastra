//! Bounded Server-Sent Events parser (Step 17a T4).
//!
//! Used only by the assistant API gateway. Event and line sizes are capped
//! before allocation, provisional text is capped at 256 KiB and the final
//! JSON at 1 MiB. A cancelled body reader is dropped/closed by the caller.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

pub const MAX_SSE_EVENT_BYTES: usize = 64 * 1024;
pub const MAX_SSE_LINE_BYTES: usize = 64 * 1024;
pub const MAX_PROVISIONAL_BYTES: usize = 256 * 1024;
pub const MAX_FINAL_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
    line_bytes: usize,
    event_bytes: usize,
    event_name: Option<String>,
    data_lines: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    fn reset_event(&mut self) {
        self.event_name = None;
        self.data_lines.clear();
        self.event_bytes = 0;
    }

    fn handle_line(&mut self, line: &str) -> Result<Option<SseEvent>, String> {
        if line.is_empty() {
            if self.data_lines.is_empty() {
                self.reset_event();
                return Ok(None);
            }
            let event = SseEvent {
                event: self.event_name.take(),
                data: self.data_lines.join("\n"),
            };
            self.reset_event();
            return Ok(Some(event));
        }
        if let Some(comment) = line.strip_prefix(':') {
            let _ = comment;
            return Ok(None);
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => {
                if value.len() > 64 {
                    return Err("assistant.api_response".to_string());
                }
                self.event_name = Some(value.to_string());
            }
            "data" => {
                self.event_bytes += value.len() + 1;
                if self.event_bytes > MAX_SSE_EVENT_BYTES {
                    return Err("assistant.api_response".to_string());
                }
                self.data_lines.push(value.to_string());
            }
            _ => {}
        }
        Ok(None)
    }

    /// Feed one HTTP body chunk; returns complete events. A line or event
    /// over 64 KiB fails before it is buffered further.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<SseEvent>, String> {
        let mut events = Vec::new();
        for byte in chunk {
            if *byte == b'\n' {
                if self.buffer.last() == Some(&b'\r') {
                    self.buffer.pop();
                }
                let line = String::from_utf8(std::mem::take(&mut self.buffer))
                    .map_err(|_| "assistant.api_response".to_string())?;
                self.line_bytes = 0;
                if let Some(event) = self.handle_line(&line)? {
                    if event.data == "[DONE]" {
                        events.push(event);
                        break;
                    }
                    events.push(event);
                }
            } else {
                self.buffer.push(*byte);
                self.line_bytes += 1;
                if self.line_bytes > MAX_SSE_LINE_BYTES || self.buffer.len() > MAX_SSE_LINE_BYTES {
                    return Err("assistant.api_response".to_string());
                }
            }
        }
        Ok(events)
    }
}

#[derive(Default)]
pub struct ProvisionalText {
    text: String,
}

impl ProvisionalText {
    pub fn push(&mut self, piece: &str) -> Result<(), String> {
        if self.text.len() + piece.len() > MAX_PROVISIONAL_BYTES {
            return Err("assistant.api_response".to_string());
        }
        self.text.push_str(piece);
        Ok(())
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn finish(self) -> Result<String, String> {
        if self.text.len() > MAX_FINAL_BYTES {
            return Err("assistant.api_response".to_string());
        }
        Ok(self.text)
    }
}

/// A fake/real body reader boundary that cancellation must close.
pub trait BodyReader {
    fn close(&mut self) -> Result<(), String>;
}

/// Cancellation is one call and closes the body exactly once.
pub fn cancel_body(reader: &mut dyn BodyReader) -> Result<(), String> {
    reader.close()
}
