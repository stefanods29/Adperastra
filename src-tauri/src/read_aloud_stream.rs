//! Windows installed-voice synthesis (Step 10f T4). Only voices already
//! installed on this PC are used, through
//! `Windows.Media.SpeechSynthesis.SpeechSynthesizer`; text is always plain
//! (no SSML), and audio moves as bounded memory bytes, never as JSON.

use std::sync::mpsc;
use std::time::Duration;

use crate::read_aloud::{ReadVoice, SpeechBackend, MAX_CHUNK_BYTES, MAX_VOICES, SYNTHESIS_TIMEOUT_SECS};

pub struct WindowsSpeechBackend;

fn failed() -> String {
    "read_aloud.failed".to_string()
}

/// WinRT speech synthesis needs an initialized apartment on the calling
/// thread. Voice listing and synthesis run on blocking-pool or worker
/// threads, which have none, so every Windows call enters its own apartment.
#[cfg(windows)]
struct ComApartment {
    uninit: bool,
}

#[cfg(windows)]
impl ComApartment {
    fn enter() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self {
            uninit: result.is_ok(),
        }
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.uninit {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
fn list_installed_voices() -> Result<Vec<ReadVoice>, String> {
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;

    let _apartment = ComApartment::enter();

    let voices = SpeechSynthesizer::AllVoices().map_err(|_| failed())?;
    let count = voices.Size().map_err(|_| failed())?.min(MAX_VOICES as u32);
    let mut result = Vec::new();
    for index in 0..count {
        let voice = voices.GetAt(index).map_err(|_| failed())?;
        result.push(ReadVoice {
            id: voice.Id().map_err(|_| failed())?.to_string(),
            name: voice.DisplayName().map_err(|_| failed())?.to_string(),
            language: voice.Language().map_err(|_| failed())?.to_string(),
            local: true,
        });
    }
    Ok(result)
}

#[cfg(windows)]
fn synthesize_once(voice_id: Option<&str>, text: &str) -> Result<Vec<u8>, String> {
    use windows::core::HSTRING;
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;
    use windows::Storage::Streams::DataReader;

    let _apartment = ComApartment::enter();
    let synth = SpeechSynthesizer::new().map_err(|_| failed())?;
    if let Some(wanted) = voice_id {
        let voices = SpeechSynthesizer::AllVoices().map_err(|_| failed())?;
        let count = voices.Size().map_err(|_| failed())?;
        let mut chosen = None;
        for index in 0..count {
            let voice = voices.GetAt(index).map_err(|_| failed())?;
            if voice.Id().map_err(|_| failed())? == wanted {
                chosen = Some(voice);
                break;
            }
        }
        let voice = chosen.ok_or_else(|| "read_aloud.no_voice".to_string())?;
        synth.SetVoice(&voice).map_err(|_| failed())?;
    }
    let stream = synth
        .SynthesizeTextToStreamAsync(&HSTRING::from(text))
        .map_err(|_| failed())?
        .get()
        .map_err(|_| failed())?;
    // Refuse oversized audio before reading it into memory or granting it.
    let size = stream.Size().map_err(|_| failed())?;
    if size > MAX_CHUNK_BYTES {
        return Err("read_aloud.too_large".to_string());
    }
    let reader = DataReader::CreateDataReader(&stream).map_err(|_| failed())?;
    let loaded = reader
        .LoadAsync(size as u32)
        .map_err(|_| failed())?
        .get()
        .map_err(|_| failed())?;
    if u64::from(loaded) != size {
        return Err(failed());
    }
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).map_err(|_| failed())?;
    Ok(bytes)
}

#[cfg(not(windows))]
fn list_installed_voices() -> Result<Vec<ReadVoice>, String> {
    Err(failed())
}

#[cfg(not(windows))]
fn synthesize_once(_voice_id: Option<&str>, _text: &str) -> Result<Vec<u8>, String> {
    Err(failed())
}

impl SpeechBackend for WindowsSpeechBackend {
    fn list_voices(&self) -> Result<Vec<ReadVoice>, String> {
        list_installed_voices()
    }

    fn synthesize(&self, voice_id: Option<&str>, text: &str) -> Result<Vec<u8>, String> {
        synthesize_once(voice_id, text)
    }
}

/// Synthesis with the guide's 20 s bound. The worker thread cannot be
/// killed safely; on timeout its result is dropped unheard and ungranted.
pub fn synthesize_with_timeout(voice_id: Option<&str>, text: &str) -> Result<Vec<u8>, String> {
    let (sender, receiver) = mpsc::channel();
    let voice = voice_id.map(str::to_string);
    let owned = text.to_string();
    std::thread::spawn(move || {
        let _ = sender.send(synthesize_once(voice.as_deref(), &owned));
    });
    receiver
        .recv_timeout(Duration::from_secs(SYNTHESIS_TIMEOUT_SECS))
        .map_err(|_| failed())?
}
