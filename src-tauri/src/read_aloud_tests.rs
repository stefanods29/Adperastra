use super::*;
use std::sync::Mutex as StdMutex;

struct FakeBackend {
    calls: StdMutex<Vec<String>>,
    byte_len: usize,
}

impl SpeechBackend for FakeBackend {
    fn list_voices(&self) -> Result<Vec<ReadVoice>, String> {
        Ok(vec![ReadVoice {
            id: "voice-1".to_string(),
            name: "Test voice".to_string(),
            language: "en-US".to_string(),
            local: true,
        }])
    }

    fn synthesize(&self, _voice_id: Option<&str>, text: &str) -> Result<Vec<u8>, String> {
        self.calls.lock().unwrap().push(text.to_string());
        Ok(vec![0u8; self.byte_len])
    }
}

fn request(text: &str) -> ReadAloudRequest {
    ReadAloudRequest {
        text: text.to_string(),
        voice_id: Some("voice-1".to_string()),
        document_id: None,
        source_revision: None,
        sensitive: false,
    }
}

#[test]
fn splits_1001_scalars_into_bounded_chunks() {
    let text = "a".repeat(1001);
    let chunks = split_read_text(&text);
    assert_eq!(chunks.len(), 2);
    assert!(chunks.iter().all(|c| c.chars().count() <= MAX_CHUNK_SCALARS));
    let words = split_read_text(&format!("{} rest", "word ".repeat(300)));
    assert!(words.iter().all(|c| c.chars().count() <= MAX_CHUNK_SCALARS));
}

#[test]
fn ssml_is_treated_as_plain_text() {
    let chunks = split_read_text("<speak>hello</speak>");
    assert_eq!(chunks, vec!["<speak>hello</speak>".to_string()]);
}

#[test]
fn unknown_voice_refused() {
    let mut req = request("hello");
    req.voice_id = Some("missing".to_string());
    assert_eq!(
        validate_read_request(&req, &["voice-1".to_string()]),
        Err("read_aloud.no_voice".to_string())
    );
}

#[test]
fn oversized_audio_fails_before_any_grant() {
    assert_eq!(
        ensure_chunk_fits(MAX_CHUNK_BYTES + 1, 0),
        Err("read_aloud.too_large".to_string())
    );
    assert!(ensure_chunk_fits(MAX_CHUNK_BYTES, 0).is_ok());
    assert!(ensure_chunk_fits(1, MAX_SESSION_BYTES).is_err());
}

#[test]
fn stop_revokes_all_and_capture_is_immutable() {
    let backend = FakeBackend {
        calls: StdMutex::new(Vec::new()),
        byte_len: 4,
    };
    let grants = FileGrants::default();
    let sessions = ReadAloudSessions::default();
    let mut req = request("first chunk text");
    let session = sessions
        .start(&req, &["voice-1".to_string()], true)
        .expect("session");
    // Editing the caller's text afterwards cannot change the capture.
    req.text = "changed".to_string();
    let chunk = sessions
        .chunk(&backend, &grants, session.session_id, 0)
        .expect("chunk");
    assert!(grants.path_for(&chunk.token).is_none());
    assert_eq!(backend.calls.lock().unwrap()[0], "first chunk text");
    sessions.stop(&grants, session.session_id).expect("stop");
    assert_eq!(sessions.session_count(), 0);
    assert_eq!(
        sessions.chunk(&backend, &grants, session.session_id, 0),
        Err("read_aloud.expired".to_string())
    );
}
