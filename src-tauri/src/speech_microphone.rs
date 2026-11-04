//! Explicit microphone capture for dictation (Step 17b D9).
//!
//! One session exists only after the owner allows this exact recording in a
//! native dialog. Nothing records without that session, nothing restarts, and
//! the buffer never reaches disk or a log. The concrete Windows AudioGraph
//! adapter is verified by the coordinator against the pinned `windows`
//! 0.61.3 generated source before the pack is enabled; this build therefore
//! exposes only the typed unavailable device.
#![allow(dead_code)]


use std::sync::Mutex;

use zeroize::Zeroize;

use crate::speech_types::{
    DICTATION_MAX_FLOAT_BYTES, DICTATION_MAX_SECONDS, ERR_DEVICE, ERR_INVALID, ERR_PERMISSION,
    SAMPLE_RATE,
};

/// AudioGraph configuration: mono float32 at 16 kHz, Speech category.
pub const MIC_CHANNELS: u16 = 1;
pub const MIC_SAMPLE_RATE: u32 = SAMPLE_RATE;
pub const MIC_ENCODING: &str = "float32";

/// Who asked for the microphone. Model/tool paths are never allowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DictationOrigin {
    HumanUi,
    AssistantTool,
}

impl DictationOrigin {
    pub fn allows_capture(self) -> bool {
        matches!(self, DictationOrigin::HumanUi)
    }
}

/// A frame reader the platform adapter implements.
pub trait MicrophoneStream: Send {
    /// Reads at most `max_frames` mono samples; an empty answer means the
    /// device ended or was lost.
    fn read_frames(&mut self, max_frames: usize) -> Result<Vec<f32>, String>;
    fn stop(&mut self);

    /// True when the adapter itself reads the device continuously, so the
    /// controller drains it into the bounded buffer on a worker thread.
    /// Pull adapters (and test doubles) keep the default. A background
    /// adapter must return from `read_frames` within 100 ms even when the
    /// device is silent, so Stop/Cancel can always join its worker.
    fn captures_in_background(&self) -> bool {
        false
    }
}

/// One owned device session; opening is the only place consent is consumed.
pub trait MicrophoneDevice: Send + Sync {
    fn open(&self) -> Result<Box<dyn MicrophoneStream>, String>;
}

/// The typed device available while Windows AudioGraph is not compiled in.
///
/// Step 17b D9 needs Media_Audio/Media_Capture/Media_MediaProperties features
/// and verified 0.61.3 signatures. Until the coordinator records that review,
/// Start fails with `speech.device_unavailable` instead of opening a device
/// through an unverified path.
pub struct AudioGraphUnavailable;

impl MicrophoneDevice for AudioGraphUnavailable {
    fn open(&self) -> Result<Box<dyn MicrophoneStream>, String> {
        Err(ERR_DEVICE.to_string())
    }
}

/// The honest platform device for this build.
pub fn platform_device() -> Box<dyn MicrophoneDevice> {
    Box::new(AudioGraphUnavailable)
}

/// Native-owned consent: only the human Allow click sets this to true.
pub struct MicrophoneConsent {
    granted: Mutex<bool>,
}

impl Default for MicrophoneConsent {
    fn default() -> Self {
        Self { granted: Mutex::new(false) }
    }
}

impl MicrophoneConsent {
    /// Called by the native dialog owner only.
    pub fn allow_this_recording(&self) {
        if let Ok(mut granted) = self.granted.lock() {
            *granted = true;
        }
    }

    pub fn deny(&self) {
        if let Ok(mut granted) = self.granted.lock() {
            *granted = false;
        }
    }

    /// Consumes the grant; a second recording needs a new Allow.
    pub fn take(&self) -> bool {
        self.granted.lock().map(|mut granted| std::mem::replace(&mut *granted, false)).unwrap_or(false)
    }
}

/// The exact float32 cap for a session length.
pub fn max_float_bytes(max_seconds: u16) -> Result<u64, String> {
    if !(1..=DICTATION_MAX_SECONDS).contains(&max_seconds) {
        return Err(ERR_INVALID.to_string());
    }
    (max_seconds as u64)
        .checked_mul(SAMPLE_RATE as u64)
        .and_then(|frames| frames.checked_mul(4))
        .ok_or_else(|| ERR_INVALID.to_string())
}

/// A capture buffer that can only grow up to its declared cap.
#[derive(Debug, Default)]
pub struct CaptureBuffer {
    samples: Vec<f32>,
    capacity_frames: usize,
    overflowed: bool,
}

impl CaptureBuffer {
    pub fn new(max_seconds: u16) -> Result<Self, String> {
        let bytes = max_float_bytes(max_seconds)?;
        if bytes > DICTATION_MAX_FLOAT_BYTES {
            return Err(ERR_INVALID.to_string());
        }
        Ok(Self {
            samples: Vec::new(),
            capacity_frames: (bytes / 4) as usize,
            overflowed: false,
        })
    }

    /// Appends frames; a full buffer reports the limit instead of growing.
    pub fn push(&mut self, frames: &[f32]) -> Result<(), String> {
        if self.samples.len() + frames.len() > self.capacity_frames {
            self.overflowed = true;
            return Err("speech.too_long".to_string());
        }
        self.samples.extend_from_slice(frames);
        Ok(())
    }

    pub fn frames(&self) -> usize {
        self.samples.len()
    }

    pub fn bytes(&self) -> u64 {
        self.samples.len() as u64 * 4
    }

    pub fn overflowed(&self) -> bool {
        self.overflowed
    }

    /// Wipes the samples in place; used by stop, cancel and device loss.
    pub fn zeroize(&mut self) {
        self.samples.zeroize();
        self.samples.clear();
        self.samples.shrink_to_fit();
    }

    pub fn take(&mut self) -> Vec<f32> {
        let mut samples = std::mem::take(&mut self.samples);
        samples.shrink_to_fit();
        samples
    }
}

/// Errors a device can report; the UI shows one honest indicator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceStatus {
    Ready,
    PermissionDenied,
    Unavailable,
    Lost,
}

impl DeviceStatus {
    pub fn error_code(self) -> Option<&'static str> {
        match self {
            DeviceStatus::Ready => None,
            DeviceStatus::PermissionDenied => Some(ERR_PERMISSION),
            DeviceStatus::Unavailable | DeviceStatus::Lost => Some(ERR_DEVICE),
        }
    }
}

/// Opens a device only when consent and origin both allow it.
pub fn open_after_consent(
    origin: DictationOrigin,
    consent: &MicrophoneConsent,
    device: &dyn MicrophoneDevice,
) -> Result<Box<dyn MicrophoneStream>, String> {
    if !origin.allows_capture() {
        // The tool path never even consumes a human grant.
        return Err(ERR_PERMISSION.to_string());
    }
    if !consent.take() {
        return Err(ERR_PERMISSION.to_string());
    }
    device.open()
}
