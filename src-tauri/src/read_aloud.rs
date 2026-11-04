//! Installed-voice read aloud (Step 10f, read-aloud-1). Text is captured
//! once at start, split into bounded plain-text chunks and synthesized one
//! chunk at a time into memory grants. Nothing is written to disk, no SSML
//! is parsed, and Stop revokes every grant the session created.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::file_grant_backing::GrantedBacking;
use crate::files::FileGrants;
use crate::{ensure_main, read_aloud_stream};

pub const MAX_TEXT_SCALARS: usize = 100_000;
pub const MAX_CHUNK_SCALARS: usize = 1_000;
pub const MAX_CHUNK_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_SESSION_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_VOICES: usize = 256;
pub const SYNTHESIS_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadVoice {
    pub id: String,
    pub name: String,
    pub language: String,
    pub local: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadAloudRequest {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_revision: Option<u64>,
    /// Untrusted hint. The native side replaces it with the document's own
    /// classification before any chunk is synthesized.
    pub sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeechChunk {
    pub session_id: Uuid,
    pub sequence: u32,
    pub token: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    pub end: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeechSession {
    pub session_id: Uuid,
    pub chunk_count: u32,
    pub next_sequence: u32,
    /// `preparing`, `playing`, `paused` or `stopped`.
    pub state: String,
}

/// The installed-voice engine. Production uses Windows speech synthesis
/// (`read_aloud_stream`); tests inject a fake that only records calls.
pub trait SpeechBackend: Send + Sync {
    fn list_voices(&self) -> Result<Vec<ReadVoice>, String>;
    fn synthesize(&self, voice_id: Option<&str>, text: &str) -> Result<Vec<u8>, String>;
}

struct SessionData {
    chunks: Vec<String>,
    voice_id: Option<String>,
    sensitive: bool,
    state: String,
    tokens: HashMap<u32, String>,
    byte_lens: HashMap<u32, u64>,
    total_bytes: u64,
}

/// Live read-aloud sessions. Managed Tauri state; text lives only here.
#[derive(Default)]
pub struct ReadAloudSessions {
    map: Mutex<HashMap<Uuid, SessionData>>,
}

fn invalid() -> String {
    "read_aloud.invalid".to_string()
}

/// Splits plain text at sentence or space boundaries so every chunk holds
/// at most MAX_CHUNK_SCALARS Unicode scalar values. Markup characters are
/// ordinary text here and are read literally.
pub fn split_read_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut chunks: Vec<String> = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let hard_end = (start + MAX_CHUNK_SCALARS).min(chars.len());
        if hard_end == chars.len() {
            chunks.push(chars[start..].iter().collect());
            break;
        }
        let mut cut = hard_end;
        let mut sentence_cut = None;
        let mut space_cut = None;
        for index in start..hard_end {
            match chars[index] {
                '.' | '!' | '?' => {
                    if index + 1 < hard_end && chars[index + 1].is_whitespace() {
                        sentence_cut = Some(index + 1);
                    }
                }
                c if c.is_whitespace() => space_cut = Some(index + 1),
                _ => {}
            }
        }
        let at_boundary = sentence_cut.is_some() || space_cut.is_some();
        if let Some(at) = sentence_cut {
            cut = at;
        } else if let Some(at) = space_cut {
            cut = at;
        }
        chunks.push(chars[start..cut].iter().collect());
        start = cut;
        if at_boundary {
            while start < chars.len() && chars[start].is_whitespace() {
                start += 1;
            }
        }
    }
    chunks.retain(|chunk| !chunk.is_empty());
    chunks
}

pub fn validate_read_request(
    request: &ReadAloudRequest,
    installed_voice_ids: &[String],
) -> Result<Vec<String>, String> {
    let count = request.text.chars().count();
    if count == 0 || count > MAX_TEXT_SCALARS {
        return Err(invalid());
    }
    if let Some(voice_id) = &request.voice_id {
        if voice_id.chars().count() > 512 {
            return Err(invalid());
        }
        if !installed_voice_ids.iter().any(|id| id == voice_id) {
            return Err("read_aloud.no_voice".to_string());
        }
    }
    if matches!(request.source_revision, Some(v) if v > 9_007_199_254_740_991) {
        return Err(invalid());
    }
    Ok(split_read_text(&request.text))
}

/// Refuses audio that would exceed the chunk or session memory budget.
/// Called before any grant exists, so an oversized chunk is never served.
pub fn ensure_chunk_fits(byte_len: u64, session_total: u64) -> Result<(), String> {
    if byte_len > MAX_CHUNK_BYTES || session_total.saturating_add(byte_len) > MAX_SESSION_BYTES {
        return Err("read_aloud.too_large".to_string());
    }
    Ok(())
}

impl ReadAloudSessions {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<Uuid, SessionData>>, String> {
        self.map.lock().map_err(|_| "read_aloud.failed".to_string())
    }

    /// Captures the request text once. Later source edits cannot change
    /// these chunks; the caller's `sensitive` hint is replaced by the
    /// authoritative value the command resolved from the document.
    pub fn start(
        &self,
        request: &ReadAloudRequest,
        installed_voice_ids: &[String],
        authoritative_sensitive: bool,
    ) -> Result<SpeechSession, String> {
        let chunks = validate_read_request(request, installed_voice_ids)?;
        let session_id = Uuid::new_v4();
        let chunk_count = chunks.len() as u32;
        let mut map = self.lock()?;
        map.insert(
            session_id,
            SessionData {
                chunks,
                voice_id: request.voice_id.clone(),
                sensitive: authoritative_sensitive,
                state: "preparing".to_string(),
                tokens: HashMap::new(),
                byte_lens: HashMap::new(),
                total_bytes: 0,
            },
        );
        Ok(SpeechSession {
            session_id,
            chunk_count,
            next_sequence: 0,
            state: "preparing".to_string(),
        })
    }

    /// What one chunk call needs. `cached` is set when the chunk was already
    /// synthesized; its grant is replayed without new synthesis.
    pub fn prepare(
        &self,
        session_id: Uuid,
        sequence: u32,
    ) -> Result<(String, Option<String>, Option<SpeechChunk>), String> {
        let map = self.lock()?;
        let session = map.get(&session_id).ok_or_else(|| "read_aloud.expired".to_string())?;
        if session.state == "stopped" {
            return Err("read_aloud.expired".to_string());
        }
        let index = sequence as usize;
        if index >= session.chunks.len() {
            return Err(invalid());
        }
        let end = index + 1 == session.chunks.len();
        let cached = session.tokens.get(&sequence).map(|token| SpeechChunk {
            session_id,
            sequence,
            token: token.clone(),
            name: "speech.wav".to_string(),
            mime: "audio/wav".to_string(),
            byte_len: session.byte_lens.get(&sequence).copied().unwrap_or(0),
            end,
        });
        Ok((session.chunks[index].clone(), session.voice_id.clone(), cached))
    }

    /// Grants synthesized bytes. The size budget passes before any grant
    /// exists, so oversized audio is never served.
    pub fn finish(
        &self,
        grants: &FileGrants,
        session_id: Uuid,
        sequence: u32,
        bytes: Vec<u8>,
    ) -> Result<SpeechChunk, String> {
        let byte_len = bytes.len() as u64;
        let mut map = self.lock()?;
        let session = map
            .get_mut(&session_id)
            .ok_or_else(|| "read_aloud.expired".to_string())?;
        if session.state == "stopped" {
            return Err("read_aloud.expired".to_string());
        }
        ensure_chunk_fits(byte_len, session.total_bytes)?;
        let backing = Arc::new(GrantedBacking::Memory {
            length: byte_len,
            bytes: Arc::new(Zeroizing::new(bytes)),
            sensitive: session.sensitive,
        });
        let token = grants.grant_backing(backing)?;
        session.tokens.insert(sequence, token.clone());
        session.byte_lens.insert(sequence, byte_len);
        session.total_bytes += byte_len;
        if session.state == "preparing" {
            session.state = "playing".to_string();
        }
        Ok(SpeechChunk {
            session_id,
            sequence,
            token,
            name: "speech.wav".to_string(),
            mime: "audio/wav".to_string(),
            byte_len,
            end: (sequence as usize) + 1 == session.chunks.len(),
        })
    }

    /// Synthesizes (or replays) one chunk synchronously. Commands use
    /// `prepare`/`finish` around a timed blocking call instead.
    pub fn chunk(
        &self,
        backend: &dyn SpeechBackend,
        grants: &FileGrants,
        session_id: Uuid,
        sequence: u32,
    ) -> Result<SpeechChunk, String> {
        let (text, voice_id, cached) = self.prepare(session_id, sequence)?;
        if let Some(chunk) = cached {
            return Ok(chunk);
        }
        let bytes = backend.synthesize(voice_id.as_deref(), &text)?;
        self.finish(grants, session_id, sequence, bytes)
    }

    /// Ends a session now: every grant it created is revoked first, then
    /// the captured text is dropped.
    pub fn stop(&self, grants: &FileGrants, session_id: Uuid) -> Result<(), String> {
        let session = self.lock()?.remove(&session_id);
        if let Some(session) = session {
            for token in session.tokens.values() {
                grants.revoke(token);
            }
        }
        Ok(())
    }

    #[cfg(test)]
    fn session_count(&self) -> usize {
        self.lock().map(|map| map.len()).unwrap_or(0)
    }
}

fn valid_session_id(raw: &str) -> Result<Uuid, String> {
    Uuid::parse_str(raw).map_err(|_| invalid())
}

#[tauri::command]
pub async fn read_voices(window: WebviewWindow) -> Result<Vec<ReadVoice>, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(|| read_aloud_stream::WindowsSpeechBackend.list_voices())
        .await
        .map_err(|_| "read_aloud.failed".to_string())?
}

#[tauri::command]
pub async fn read_aloud_start(
    window: WebviewWindow,
    sessions: State<'_, ReadAloudSessions>,
    documents: State<'_, Arc<crate::documents::DocumentStore>>,
    request: ReadAloudRequest,
) -> Result<SpeechSession, String> {
    ensure_main(window.label())?;
    let voices = tauri::async_runtime::spawn_blocking(|| {
        read_aloud_stream::WindowsSpeechBackend.list_voices()
    })
    .await
    .map_err(|_| "read_aloud.failed".to_string())??;
    let ids: Vec<String> = voices.iter().map(|voice| voice.id.clone()).collect();
    // The document's native classification wins; a caller can never turn a
    // sensitive document into an ordinary one. No document means spoken
    // file names only, which carry no document content.
    let authoritative_sensitive = match request.document_id {
        Some(document_id) => documents
            .entry(document_id)
            .map(|entry| entry.info.sensitive)
            .map_err(|_| "read_aloud.invalid".to_string())?,
        None => false,
    };
    sessions.start(&request, &ids, authoritative_sensitive)
}

#[tauri::command]
pub async fn read_aloud_chunk(
    window: WebviewWindow,
    sessions: State<'_, ReadAloudSessions>,
    grants: State<'_, Arc<FileGrants>>,
    session_id: String,
    sequence: u32,
) -> Result<SpeechChunk, String> {
    ensure_main(window.label())?;
    let session_id = valid_session_id(&session_id)?;
    let (text, voice_id, cached) = sessions.prepare(session_id, sequence)?;
    if let Some(chunk) = cached {
        return Ok(chunk);
    }
    // One synthesis at a time with a hard 20 s bound. A timed-out worker
    // thread's bytes are dropped; no grant is created for them.
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_aloud_stream::synthesize_with_timeout(voice_id.as_deref(), &text)
    })
    .await
    .map_err(|_| "read_aloud.failed".to_string())??;
    sessions.finish(grants.as_ref(), session_id, sequence, bytes)
}

#[tauri::command]
pub async fn read_aloud_stop(
    window: WebviewWindow,
    sessions: State<'_, ReadAloudSessions>,
    grants: State<'_, Arc<FileGrants>>,
    session_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let session_id = valid_session_id(&session_id)?;
    sessions.stop(grants.as_ref(), session_id)
}

#[cfg(test)]
#[path = "read_aloud_tests.rs"]
mod tests;
