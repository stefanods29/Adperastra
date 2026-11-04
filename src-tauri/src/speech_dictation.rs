//! Explicit dictation sessions (Step 17b D9, `speech-1` E3).
//!
//! A session is created only by the human Start action, lives at most two
//! minutes, keeps its samples in RAM, and ends by Stop, Cancel, a tab change,
//! a profile change or device loss. Stop transcribes locally and returns a
//! preview; nothing is ever inserted by this module.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use uuid::Uuid;
use zeroize::Zeroize;

use tauri::Manager;

use crate::ai_actions::active_profile;
use crate::speech::{
    capability, capability_error, provider_error, speech_available, transcribe_pcm,
    transcript_store, whisper_adapter,
};
use crate::speech_microphone::{
    open_after_consent, CaptureBuffer, DictationOrigin, MicrophoneConsent, MicrophoneDevice,
    MicrophoneStream,
};
use crate::speech_types::{
    validate_dictation, DictationRequest, DictationSession, DictationState, SpeechLanguage,
    TranscriptInfo, ERR_CHANGED, ERR_DEVICE, ERR_FAILED, ERR_INVALID, ERR_PERMISSION,
    ERR_TOO_LONG, SAMPLE_RATE,
};

pub const DICTATION_HARD_LIMIT: Duration = Duration::from_secs(120);
/// A session that nobody touches for this long is dropped with its samples.
pub const DICTATION_IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);

/// The reader that owns the device. A pull adapter is read by `capture`; a
/// background adapter is drained by its own worker into the same buffer.
enum CaptureOwner {
    Pull(Box<dyn MicrophoneStream>),
    Background(BackgroundCapture),
}

struct BackgroundCapture {
    stop: Arc<AtomicBool>,
    lost: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

struct Session {
    state: DictationSession,
    buffer: Arc<Mutex<CaptureBuffer>>,
    capture: Option<CaptureOwner>,
    language: String,
    profile: Uuid,
    started: Instant,
    last_activity: Instant,
    /// The exact content identity reviewed with the recognized text.
    reviewed_content_id: Option<Uuid>,
    transcript_id: Option<Uuid>,
}

/// One stopped recording handed to the local ASR pipeline. The caller owns
/// the samples and must zeroize them after decoding.
pub struct StoppedCapture {
    pub session: DictationSession,
    pub pcm: Vec<f32>,
    pub language: String,
}

pub struct DictationController {
    sessions: Mutex<HashMap<Uuid, Session>>,
}

impl Default for DictationController {
    fn default() -> Self {
        Self::new()
    }
}

impl DictationController {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    fn lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, Session>>, String> {
        self.sessions.lock().map_err(|_| "speech dictation lock poisoned".to_string())
    }

    /// Starts after the native Allow/Cancel dialog; a tool origin never opens.
    pub fn start(
        &self,
        origin: DictationOrigin,
        consent: &MicrophoneConsent,
        device: &dyn MicrophoneDevice,
        request: DictationRequest,
    ) -> Result<DictationSession, String> {
        validate_dictation(&request)?;
        let stream = open_after_consent(origin, consent, device)?;
        let profile = active_profile()?;
        let session = DictationSession {
            id: Uuid::new_v4(),
            document_id: request.document_id,
            expected_revision: request.expected_revision,
            expected_content_id: request.expected_content_id,
            state: DictationState::Recording,
            started_unix: now_unix(),
        };
        let buffer = Arc::new(Mutex::new(CaptureBuffer::new(request.max_seconds)?));
        let started = Instant::now();
        let capture = if stream.captures_in_background() {
            CaptureOwner::Background(spawn_background_capture(
                stream,
                Arc::clone(&buffer),
                started,
            )?)
        } else {
            CaptureOwner::Pull(stream)
        };
        let mut sessions = self.lock()?;
        Self::sweep(&mut sessions);
        sessions.insert(
            session.id,
            Session {
                state: session.clone(),
                buffer,
                capture: Some(capture),
                language: request.language,
                profile,
                started,
                last_activity: started,
                reviewed_content_id: None,
                transcript_id: None,
            },
        );
        Ok(session)
    }

    /// Copies one device read into the bounded buffer.
    pub fn capture(&self, id: Uuid) -> Result<usize, String> {
        let mut sessions = self.lock()?;
        Self::sweep(&mut sessions);
        let session = Self::session(&mut sessions, id, active_profile()?)?;
        if session.state.state != DictationState::Recording {
            return Err(ERR_CHANGED.to_string());
        }
        session.last_activity = Instant::now();
        if session.started.elapsed() >= DICTATION_HARD_LIMIT {
            // The two-minute cap ends the capture but keeps the samples for
            // the Stop that follows; it never grows past the declared budget.
            if let Err(error) = Self::halt_capture(session) {
                let _ = Self::cancel_locked(session);
                return Err(error);
            }
            return Self::buffer_frames(session);
        }
        let background_flags = match session.capture.as_ref() {
            Some(CaptureOwner::Background(background)) => Some((
                background.lost.load(Ordering::Relaxed),
                background.overflow.load(Ordering::Relaxed),
            )),
            _ => None,
        };
        if let Some((lost, overflow)) = background_flags {
            if lost {
                let _ = Self::cancel_locked(session);
                return Err(ERR_DEVICE.to_string());
            }
            if overflow {
                let _ = Self::cancel_locked(session);
                return Err(ERR_TOO_LONG.to_string());
            }
            return Self::buffer_frames(session);
        }
        let mut frames = match session.capture.as_mut() {
            Some(CaptureOwner::Pull(stream)) => {
                stream.read_frames(SAMPLE_RATE as usize / 10).map_err(provider_error)?
            }
            _ => return Err(ERR_DEVICE.to_string()),
        };
        if frames.is_empty() {
            let _ = Self::cancel_locked(session);
            return Err(ERR_DEVICE.to_string());
        }
        let pushed = Self::push_frames(session, &frames);
        frames.zeroize();
        pushed
    }

    /// Stops the device and hands the bounded samples to local transcription.
    /// The session stays in `Processing` until `finish_transcription` or
    /// `cancel`; no text is inserted by this module.
    pub fn stop_capture(&self, id: Uuid) -> Result<StoppedCapture, String> {
        let mut sessions = self.lock()?;
        Self::sweep(&mut sessions);
        let session = Self::session(&mut sessions, id, active_profile()?)?;
        if session.state.state != DictationState::Recording {
            return Err(ERR_CHANGED.to_string());
        }
        if let Err(error) = Self::halt_capture(session) {
            let _ = Self::cancel_locked(session);
            return Err(error);
        }
        session.state.state = DictationState::Processing;
        session.last_activity = Instant::now();
        let pcm = {
            let mut buffer = Self::buffer_lock(&session.buffer)?;
            buffer.take()
        };
        Ok(StoppedCapture {
            session: session.state.clone(),
            pcm,
            language: session.language.clone(),
        })
    }

    /// Records the finished local transcript and marks its content reviewed.
    pub fn finish_transcription(
        &self,
        id: Uuid,
        transcript_id: Uuid,
    ) -> Result<DictationSession, String> {
        let mut sessions = self.lock()?;
        let session = Self::session(&mut sessions, id, active_profile()?)?;
        if session.state.state != DictationState::Processing {
            return Err(ERR_CHANGED.to_string());
        }
        session.state.state = DictationState::Stopped;
        session.transcript_id = Some(transcript_id);
        session.reviewed_content_id = Some(session.state.expected_content_id);
        session.last_activity = Instant::now();
        Ok(session.state.clone())
    }

    /// Stop keeps the recognized text for review and inserts nothing.
    pub fn stop(
        &self,
        id: Uuid,
        transcript_id: Uuid,
        reviewed_content_id: Uuid,
    ) -> Result<DictationSession, String> {
        let mut stopped = self.stop_capture(id)?;
        stopped.pcm.zeroize();
        if reviewed_content_id != stopped.session.expected_content_id {
            let _ = self.cancel(id);
            return Err(ERR_CHANGED.to_string());
        }
        self.finish_transcription(id, transcript_id)
    }

    /// A tab change, profile change or close cancels and wipes the samples.
    pub fn tab_switch_or_close(&self, id: Uuid) -> Result<(), String> {
        let mut sessions = self.lock()?;
        Self::sweep(&mut sessions);
        match sessions.get_mut(&id) {
            Some(session) => Self::cancel_locked(session),
            None => Ok(()),
        }
    }

    /// Cancel releases the device and keeps the document unchanged.
    pub fn cancel(&self, id: Uuid) -> Result<(), String> {
        let mut sessions = self.lock()?;
        Self::sweep(&mut sessions);
        match sessions.remove(&id) {
            Some(mut session) => {
                let _ = Self::halt_capture(&mut session);
                if let Ok(mut buffer) = session.buffer.lock() {
                    buffer.zeroize();
                }
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// True only while the reviewed text still matches the open content.
    pub fn review_is_current(&self, id: Uuid, content_id: Uuid) -> Result<bool, String> {
        let mut sessions = self.lock()?;
        let session = Self::session(&mut sessions, id, active_profile()?)?;
        Ok(session.reviewed_content_id == Some(content_id))
    }

    /// This step never inserts; the consumer must use its own proposal flow.
    pub fn inserts_text(&self) -> bool {
        false
    }

    /// Removes recordings and reviews left idle too long. The worker thread is
    /// joined and the samples are wiped before removal.
    pub fn cleanup_idle(&self) -> usize {
        let Ok(mut sessions) = self.sessions.lock() else {
            return 0;
        };
        Self::sweep(&mut sessions)
    }

    pub fn retained(&self) -> usize {
        self.lock()
            .map(|mut sessions| {
                Self::sweep(&mut sessions);
                sessions.len()
            })
            .unwrap_or(0)
    }

    fn session(
        sessions: &mut HashMap<Uuid, Session>,
        id: Uuid,
        profile: Uuid,
    ) -> Result<&mut Session, String> {
        let Some(session) = sessions.get_mut(&id) else {
            return Err(ERR_CHANGED.to_string());
        };
        if session.profile != profile {
            return Err(ERR_CHANGED.to_string());
        }
        Ok(session)
    }

    fn buffer_lock(
        buffer: &Arc<Mutex<CaptureBuffer>>,
    ) -> Result<MutexGuard<'_, CaptureBuffer>, String> {
        buffer.lock().map_err(|_| ERR_FAILED.to_string())
    }

    fn push_frames(session: &mut Session, frames: &[f32]) -> Result<usize, String> {
        let pushed = {
            let mut buffer = Self::buffer_lock(&session.buffer)?;
            let pushed = buffer.push(frames);
            (pushed, buffer.frames())
        };
        match pushed.0 {
            Ok(()) => Ok(pushed.1),
            Err(_) => {
                let _ = Self::cancel_locked(session);
                Err(ERR_TOO_LONG.to_string())
            }
        }
    }

    fn buffer_frames(session: &Session) -> Result<usize, String> {
        Self::buffer_lock(&session.buffer).map(|buffer| buffer.frames())
    }

    fn halt_capture(session: &mut Session) -> Result<(), String> {
        match session.capture.take() {
            Some(CaptureOwner::Pull(mut stream)) => {
                stream.stop();
                Ok(())
            }
            Some(CaptureOwner::Background(mut background)) => {
                background.stop.store(true, Ordering::Release);
                let joined = match background.join.take() {
                    Some(join) => join.join().is_ok(),
                    None => true,
                };
                if !joined || background.lost.load(Ordering::Relaxed) {
                    return Err(ERR_DEVICE.to_string());
                }
                if background.overflow.load(Ordering::Relaxed) {
                    return Err(ERR_TOO_LONG.to_string());
                }
                Ok(())
            }
            None => Ok(()),
        }
    }

    fn cancel_locked(session: &mut Session) -> Result<(), String> {
        let _ = Self::halt_capture(session);
        if let Ok(mut buffer) = session.buffer.lock() {
            buffer.zeroize();
        }
        session.state.state = DictationState::Stopped;
        Ok(())
    }

    fn sweep(sessions: &mut HashMap<Uuid, Session>) -> usize {
        let expired: Vec<Uuid> = sessions
            .iter()
            .filter(|(_, session)| session.last_activity.elapsed() > DICTATION_IDLE_LIMIT)
            .map(|(id, _)| *id)
            .collect();
        for id in &expired {
            if let Some(mut session) = sessions.remove(id) {
                let _ = Self::halt_capture(&mut session);
                if let Ok(mut buffer) = session.buffer.lock() {
                    buffer.zeroize();
                }
            }
        }
        expired.len()
    }
}

impl Drop for DictationController {
    fn drop(&mut self) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        for (_, mut session) in sessions.drain() {
            let _ = Self::halt_capture(&mut session);
            if let Ok(mut buffer) = session.buffer.lock() {
                buffer.zeroize();
            }
        }
    }
}

fn spawn_background_capture(
    mut stream: Box<dyn MicrophoneStream>,
    buffer: Arc<Mutex<CaptureBuffer>>,
    started: Instant,
) -> Result<BackgroundCapture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let lost = Arc::new(AtomicBool::new(false));
    let overflow = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let lost_thread = Arc::clone(&lost);
    let overflow_thread = Arc::clone(&overflow);
    let join = std::thread::Builder::new()
        .name("dictation-capture".to_string())
        .spawn(move || {
            loop {
                if stop_thread.load(Ordering::Acquire) {
                    break;
                }
                if started.elapsed() >= DICTATION_HARD_LIMIT {
                    break;
                }
                match stream.read_frames(SAMPLE_RATE as usize / 10) {
                    Ok(frames) if frames.is_empty() => {
                        lost_thread.store(true, Ordering::Relaxed);
                        break;
                    }
                    Ok(mut frames) => {
                        let pushed = match buffer.lock() {
                            Ok(mut buffer) => buffer.push(&frames),
                            Err(_) => {
                                frames.zeroize();
                                lost_thread.store(true, Ordering::Relaxed);
                                break;
                            }
                        };
                        frames.zeroize();
                        if pushed.is_err() {
                            overflow_thread.store(true, Ordering::Relaxed);
                            break;
                        }
                    }
                    Err(_) => {
                        lost_thread.store(true, Ordering::Relaxed);
                        break;
                    }
                }
            }
            stream.stop();
        })
        .map_err(|_| ERR_DEVICE.to_string())?;
    Ok(BackgroundCapture { stop, lost, overflow, join: Some(join) })
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn speech_language(tag: &str) -> Result<SpeechLanguage, String> {
    match tag {
        "en" => Ok(SpeechLanguage::En),
        "es" => Ok(SpeechLanguage::Es),
        _ => Err(ERR_INVALID.to_string()),
    }
}

/// The human-facing command: the native dialog owns the Allow click.
#[tauri::command]
pub fn speech_dictation_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    controller: tauri::State<'_, DictationController>,
    consent: tauri::State<'_, MicrophoneConsent>,
    request: DictationRequest,
) -> Result<DictationSession, String> {
    crate::ensure_main(window.label())?;
    validate_dictation(&request)?;
    let capability = capability();
    if !speech_available(&capability, true) {
        return Err(capability_error(&capability));
    }
    let device = app
        .try_state::<DictationDeviceState>()
        .ok_or_else(|| ERR_DEVICE.to_string())?;
    let result = controller.start(DictationOrigin::HumanUi, &consent, device.device(), request);
    if result.is_err() {
        // A grant is for exactly one recording attempt, including a failed one.
        consent.deny();
    }
    result
}

/// Stop transcribes the reviewed recording; insertion stays with a consumer.
#[tauri::command]
pub async fn speech_dictation_stop(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<TranscriptInfo, String> {
    crate::ensure_main(window.label())?;
    let session = Uuid::parse_str(&session_id).map_err(|_| ERR_CHANGED.to_string())?;
    let capability = capability();
    if !speech_available(&capability, true) {
        let _ = app.state::<DictationController>().cancel(session);
        return Err(capability_error(&capability));
    }
    // Fail before the recording is consumed when no local decoder is present.
    if let Err(error) = whisper_adapter() {
        let _ = app.state::<DictationController>().cancel(session);
        return Err(error);
    }
    let profile = match active_profile() {
        Ok(profile) => profile,
        Err(error) => {
            let _ = app.state::<DictationController>().cancel(session);
            return Err(error);
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        transcribe_stopped(app, session, profile, capability)
    })
    .await
    .map_err(|_| ERR_FAILED.to_string())?
}

fn transcribe_stopped(
    app: tauri::AppHandle,
    session_id: Uuid,
    profile: Uuid,
    capability: crate::speech::SpeechCapability,
) -> Result<TranscriptInfo, String> {
    let controller = app.state::<DictationController>();
    let stopped = match controller.stop_capture(session_id) {
        Ok(stopped) => stopped,
        Err(error) => {
            let _ = controller.cancel(session_id);
            return Err(error);
        }
    };
    let mut pcm = stopped.pcm;
    let frames = pcm.len();
    let language = match speech_language(&stopped.language) {
        Ok(language) => language,
        Err(error) => {
            pcm.zeroize();
            let _ = controller.cancel(session_id);
            return Err(error);
        }
    };
    let transcription = transcribe_pcm(&pcm, language);
    pcm.zeroize();
    let (segments, partial) = match transcription {
        Ok(result) => result,
        Err(error) => {
            let _ = controller.cancel(session_id);
            return Err(error);
        }
    };
    let duration_us = (frames as u64).saturating_mul(1_000_000) / SAMPLE_RATE as u64;
    let info = TranscriptInfo {
        id: Uuid::new_v4(),
        source_input_id: stopped.session.document_id,
        source_revision: stopped.session.expected_revision,
        language: language.tag().to_string(),
        duration_us,
        segment_count: segments.len() as u32,
        partial,
        model_id: capability.model_id.clone().unwrap_or_else(|| "ggml-base".to_string()),
        model_revision: "5359861c739e955e79d9a303bcbc70fb988958b1".to_string(),
        expires_unix: now_unix() + 3_600,
    };
    let info = match transcript_store().insert(info, segments, false, profile) {
        Ok(info) => info,
        Err(error) => {
            let _ = controller.cancel(session_id);
            return Err(error);
        }
    };
    match controller.finish_transcription(session_id, info.id) {
        Ok(_) => Ok(info),
        Err(error) => {
            let _ = transcript_store().release(info.id, profile);
            let _ = controller.cancel(session_id);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn speech_dictation_cancel(
    window: tauri::WebviewWindow,
    controller: tauri::State<'_, DictationController>,
    session_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let session = Uuid::parse_str(&session_id).map_err(|_| ERR_CHANGED.to_string())?;
    controller.cancel(session)
}

/// Holds the platform microphone adapter the coordinator installs at startup.
pub struct DictationDeviceState {
    device: Box<dyn MicrophoneDevice>,
}

impl DictationDeviceState {
    pub fn new(device: Box<dyn MicrophoneDevice>) -> Self {
        Self { device }
    }

    /// The typed unavailable device for a build without verified AudioGraph.
    pub fn platform() -> Self {
        Self::new(crate::speech_microphone::platform_device())
    }

    pub fn device(&self) -> &dyn MicrophoneDevice {
        self.device.as_ref()
    }
}

/// A denied dialog never reaches the device; callers share one code.
pub fn permission_denied() -> String {
    ERR_PERMISSION.to_string()
}
