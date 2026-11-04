pub const HELPER_MEMORY: usize = 1024 * 1024 * 1024;
/// The largest frame this child may send, shared by requests and preview
/// PNGs. Output chunks stay at 1 MiB inside it.
pub const HELPER_FRAME_BYTES: usize = 1_048_600;
/// At most two conversion jobs run at once (plan D3).
pub const MAX_CONCURRENT_CONVERSIONS: usize = 2;

/// A blocking permit gate; the UI thread never waits on it.
#[derive(Default)]
pub struct ConvertGate {
    active: std::sync::Mutex<usize>,
    ready: std::sync::Condvar,
}

impl ConvertGate {
    pub fn acquire_with(&self, max: usize, cancel: &fs_service::CancellationToken) -> Result<ConvertPermit<'_>, String> {
        let max = max.clamp(1, MAX_CONCURRENT_CONVERSIONS);
        let mut active = self.active.lock().map_err(|_| "convert.io".to_string())?;
        while *active >= max {
            if cancel.load(Ordering::Relaxed) { return Err("convert.cancelled".into()); }
            active = self.ready.wait_timeout(active, Duration::from_millis(25))
                .map_err(|_| "convert.io".to_string())?.0;
        }
        if cancel.load(Ordering::Relaxed) { return Err("convert.cancelled".into()); }
        *active += 1;
        Ok(ConvertPermit { gate: self })
    }
}

pub struct ConvertPermit<'a> {
    gate: &'a ConvertGate,
}

impl Drop for ConvertPermit<'_> {
    fn drop(&mut self) {
        let mut active = self
            .gate
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *active = active.saturating_sub(1);
        self.gate.ready.notify_one();
    }
}
pub const FILE_TIMEOUT: Duration = Duration::from_secs(60);

pub const FRAME_REQUEST: u8 = 8;
pub const FRAME_SNAPSHOT_CHUNK: u8 = 9;
pub const FRAME_OUTPUT: u8 = 1;
pub const FRAME_PROGRESS: u8 = 2;
pub const FRAME_FINAL: u8 = 3;
pub const FRAME_ERROR: u8 = 4;
pub const FRAME_BEGIN: u8 = 5;
pub const FRAME_FINISH: u8 = 6;
pub const FRAME_ABORT: u8 = 7;
pub const FRAME_PREVIEW_PNG: u8 = 10;

/// What the parent sends before any byte of a source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperRequest {
    /// `convert` or `preview`.
    pub mode: String,
    pub converter_id: String,
    pub options: ConvertOptions,
    pub accepted_losses: Vec<MetadataCategory>,
    pub accepted_warning_codes: Vec<convert::ConversionWarningCode>,
    pub max_output_bytes: u64,
    pub input_index: u32,
    pub source: HelperSource,
    /// The native-owned intermediate root for bounded adapter work (archive
    /// extraction). The parent derives it from the job's app data folder; a
    /// helper never picks its own root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperSource {
    /// `file` or `snapshot`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamp: Option<SourceStamp>,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
}

/// The helper's small preview answer; PNG bytes arrive in frame 10.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperPreviewMeta {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub estimated_bytes: Option<u64>,
    #[serde(default)]
    pub estimated_ms: Option<u64>,
    pub warnings: Vec<convert::ConversionWarningCode>,
    pub metadata_lost: Vec<MetadataCategory>,
}

/// The preview the UI displays.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionPreview {
    pub image: CacheLease,
    pub input_revision: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_ms: Option<u64>,
    pub warnings: Vec<convert::ConversionWarningCode>,
    pub metadata_lost: Vec<MetadataCategory>,
}

/// One `combine` adapter invocation: several inputs, one output. Every input
/// is reported in selection order; the single published file carries all of
/// their indices.
pub struct CombineOutcome {
    pub items: Vec<convert::WorkItemResult>,
    pub outputs: Vec<convert::ConversionOutput>,
    pub cancelled: bool,
}

struct HelperOutcome {
    final_json: Value,
    preview_png: Option<Vec<u8>>,
}

struct ResolvedFile {
    name: String,
    mime: String,
    stamp: SourceStamp,
    _guard: PinnedSource,
}

