//! Canonical wire types for optional packs and App storage (Step 12a,
//! `packs-1` / `storage-providers-1`). JSON fields are snake_case; integers
//! that cross the IPC boundary stay inside the JavaScript safe range.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The largest integer JSON may carry without losing precision in the UI.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// How many descriptors one catalog may hold.
pub const MAX_CATALOG_PACKS: usize = 64;
/// How many files one pack may install.
pub const MAX_PACK_FILES: usize = 100_000;
/// How many dependencies one pack may declare.
pub const MAX_PACK_DEPENDENCIES: usize = 16;
/// How many capabilities one pack may enable.
pub const MAX_PACK_ENABLES: usize = 64;
/// How many source links one descriptor may carry.
pub const MAX_PACK_SOURCES: usize = 128;
/// How many license names one descriptor may carry.
pub const MAX_PACK_LICENSES: usize = 128;
/// How many origins a signed catalog may trust.
pub const MAX_ALLOWED_ORIGINS: usize = 16;
/// Longest relative installed path, in UTF-16 units.
pub const MAX_PACK_PATH_UNITS: usize = 240;
/// Longest translation key stored by a descriptor.
pub const MAX_PACK_KEY_CHARS: usize = 128;

/// A pack this step knows about. AI ids are reserved for their producing
/// steps; `TestFixture` exists only in a test-injected catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackId {
    Media,
    Office,
    Ocr,
    AiRuntime,
    AiUpscale,
    AiAssistantSmall,
    AiAssistant,
    AiAssistantPro,
    AiEmbeddingsText,
    AiEmbeddingsVision,
    AiSpeech,
    AiForeground,
    AiInpaint,
    TestFixture,
}

impl PackId {
    /// The packs that may be offered on a normal first run.
    pub const PRODUCTION: &'static [PackId] = &[PackId::Media, PackId::Office, PackId::Ocr];

    /// AI ids reserved for Steps 14c, 17a, 17b and 17c. They stay
    /// unavailable until their signed artifact is produced and verified.
    pub const RESERVED_AI: &'static [PackId] = &[
        PackId::AiRuntime,
        PackId::AiUpscale,
        PackId::AiAssistantSmall,
        PackId::AiAssistant,
        PackId::AiAssistantPro,
        PackId::AiEmbeddingsText,
        PackId::AiEmbeddingsVision,
        PackId::AiSpeech,
        PackId::AiForeground,
        PackId::AiInpaint,
    ];

    /// The literal wire spelling (also used by the database and log lines).
    pub fn as_str(self) -> &'static str {
        match self {
            PackId::Media => "media",
            PackId::Office => "office",
            PackId::Ocr => "ocr",
            PackId::AiRuntime => "ai_runtime",
            PackId::AiUpscale => "ai_upscale",
            PackId::AiAssistantSmall => "ai_assistant_small",
            PackId::AiAssistant => "ai_assistant",
            PackId::AiAssistantPro => "ai_assistant_pro",
            PackId::AiEmbeddingsText => "ai_embeddings_text",
            PackId::AiEmbeddingsVision => "ai_embeddings_vision",
            PackId::AiSpeech => "ai_speech",
            PackId::AiForeground => "ai_foreground",
            PackId::AiInpaint => "ai_inpaint",
            PackId::TestFixture => "test_fixture",
        }
    }

    /// True for an id whose capability is not built in this step.
    pub fn is_ai(self) -> bool {
        Self::RESERVED_AI.contains(&self)
    }

    /// True for the packs a normal first run may select.
    pub fn is_production(self) -> bool {
        Self::PRODUCTION.contains(&self)
    }

    /// Parse one literal wire id; unknown or reserved test ids are ignored by
    /// callers that filter with [`PackId::is_production`].
    pub fn parse(value: &str) -> Option<Self> {
        Self::PRODUCTION
            .iter()
            .chain(Self::RESERVED_AI.iter())
            .copied()
            .find(|id| id.as_str() == value)
            .or_else(|| (value == "test_fixture").then_some(PackId::TestFixture))
    }
}

/// Setup-profile selections filtered to the non-AI first-run allowlist.
pub fn selected_production_packs(values: &[String]) -> Vec<PackId> {
    let mut selected = Vec::new();
    for value in values {
        if let Some(id) = PackId::parse(value) {
            if id.is_production() && !selected.contains(&id) {
                selected.push(id);
            }
        }
    }
    selected
}

/// One file a pack installs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackFile {
    /// A relative path with forward slashes; never absolute or a drive/ADS.
    pub path: String,
    pub size: u64,
    /// Exactly 64 lowercase hexadecimal characters.
    pub sha256: String,
    /// The file may be started as a helper or tool by a trusted caller.
    pub executable: bool,
}

/// One signed dependency edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackDependency {
    pub id: PackId,
    pub version: String,
}

/// One signed pack offer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackDescriptor {
    pub id: PackId,
    pub version: String,
    pub name_key: String,
    pub description_key: String,
    pub download_url: String,
    pub download_bytes: u64,
    pub install_bytes: u64,
    /// SHA-256 of the complete signed archive.
    pub sha256: String,
    pub licenses: Vec<String>,
    pub source_urls: Vec<String>,
    pub files: Vec<PackFile>,
    pub dependencies: Vec<PackDependency>,
    pub enables: Vec<String>,
    /// Fixed capability id -> relative installed file path.
    pub entrypoints: BTreeMap<String, String>,
    /// The catalog revision this descriptor came from.
    pub catalog_revision: u32,
}

impl PackDescriptor {
    /// The relative file that provides `capability`, when the descriptor has
    /// one. Callers must still verify the packed file (see
    /// [`crate::validation::validate_capability`]).
    pub fn entrypoint(&self, capability: &str) -> Option<&str> {
        self.entrypoints.get(capability).map(String::as_str)
    }

    /// A stable digest over the exact descriptor fields, used to bind an
    /// activated directory to the signed descriptor that produced it.
    pub fn digest(&self) -> String {
        let bytes = serde_json::to_vec(self).unwrap_or_default();
        crate::validation::sha256_hex(&bytes)
    }
}

/// The signed catalog (`pack-catalog.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackCatalog {
    /// Exactly 1 today. A newer schema is retained, never downgraded.
    pub schema_version: u32,
    pub revision: u32,
    /// Signed HTTPS origins allowed to serve pack downloads.
    pub allowed_origins: Vec<String>,
    pub packs: Vec<PackDescriptor>,
}

impl PackCatalog {
    /// The descriptor for one exact installed version.
    pub fn descriptor(&self, id: PackId, version: &str) -> Option<&PackDescriptor> {
        self.packs
            .iter()
            .find(|pack| pack.id == id && pack.version == version)
    }

    /// The newest offered version of a pack (descriptors are validated to be
    /// unique per id/version; the catalog order is the preference order).
    pub fn newest(&self, id: PackId) -> Option<&PackDescriptor> {
        self.packs.iter().find(|pack| pack.id == id)
    }
}

/// Why a pack row is in the state it is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackStatePhase {
    Absent,
    Downloading,
    Paused,
    Verifying,
    Installing,
    Installed,
    PendingRemove,
    Failed,
}

/// One row in Settings > App storage > Optional packs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackState {
    pub id: PackId,
    pub installed_version: Option<String>,
    pub available_version: Option<String>,
    pub state: PackStatePhase,
    pub bytes_received: u64,
    pub error_code: Option<String>,
    pub installed_unix: Option<u64>,
    pub leased_count: u32,
}

impl PackState {
    /// An untouched pack row before a catalog or download says otherwise.
    pub fn absent(id: PackId) -> Self {
        Self {
            id,
            installed_version: None,
            available_version: None,
            state: PackStatePhase::Absent,
            bytes_received: 0,
            error_code: None,
            installed_unix: None,
            leased_count: 0,
        }
    }
}

/// One owned data category. Every later feature registers one provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageCategory {
    Thumbnails,
    Previews,
    Ocr,
    FilenameIndex,
    ContentIndex,
    FolderSizes,
    StorageScans,
    Versions,
    Clipboard,
    CrashLogs,
    UpdateNotes,
    PackDownloads,
    AiModels,
    AiEmbeddings,
    AiChat,
    AiResults,
    LockedRecovery,
    Recovery,
}

impl StorageCategory {
    /// Every category, in the order Settings > App storage shows them.
    pub const ALL: &'static [StorageCategory] = &[
        StorageCategory::Thumbnails,
        StorageCategory::Previews,
        StorageCategory::Ocr,
        StorageCategory::FilenameIndex,
        StorageCategory::ContentIndex,
        StorageCategory::FolderSizes,
        StorageCategory::StorageScans,
        StorageCategory::Versions,
        StorageCategory::Clipboard,
        StorageCategory::CrashLogs,
        StorageCategory::UpdateNotes,
        StorageCategory::PackDownloads,
        StorageCategory::AiModels,
        StorageCategory::AiEmbeddings,
        StorageCategory::AiChat,
        StorageCategory::AiResults,
        StorageCategory::LockedRecovery,
        StorageCategory::Recovery,
    ];

    /// The literal wire spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            StorageCategory::Thumbnails => "thumbnails",
            StorageCategory::Previews => "previews",
            StorageCategory::Ocr => "ocr",
            StorageCategory::FilenameIndex => "filename_index",
            StorageCategory::ContentIndex => "content_index",
            StorageCategory::FolderSizes => "folder_sizes",
            StorageCategory::StorageScans => "storage_scans",
            StorageCategory::Versions => "versions",
            StorageCategory::Clipboard => "clipboard",
            StorageCategory::CrashLogs => "crash_logs",
            StorageCategory::UpdateNotes => "update_notes",
            StorageCategory::PackDownloads => "pack_downloads",
            StorageCategory::AiModels => "ai_models",
            StorageCategory::AiEmbeddings => "ai_embeddings",
            StorageCategory::AiChat => "ai_chat",
            StorageCategory::AiResults => "ai_results",
            StorageCategory::LockedRecovery => "locked_recovery",
            StorageCategory::Recovery => "recovery",
        }
    }

    /// The translation key that says what clearing this category loses.
    pub fn default_loss_key(self) -> &'static str {
        match self {
            StorageCategory::Versions => "storage.lossVersions",
            StorageCategory::FilenameIndex | StorageCategory::ContentIndex => "storage.lossIndex",
            StorageCategory::Clipboard => "storage.lossClipboard",
            StorageCategory::CrashLogs => "storage.lossLogs",
            StorageCategory::UpdateNotes => "storage.lossNotes",
            StorageCategory::PackDownloads => "storage.lossDownloads",
            StorageCategory::AiModels
            | StorageCategory::AiEmbeddings
            | StorageCategory::AiChat
            | StorageCategory::AiResults => "storage.lossAi",
            StorageCategory::LockedRecovery | StorageCategory::Recovery => "storage.lossRecovery",
            StorageCategory::Thumbnails
            | StorageCategory::Previews
            | StorageCategory::Ocr
            | StorageCategory::FolderSizes
            | StorageCategory::StorageScans => "storage.lossCache",
        }
    }

    /// True when the UI may offer Clear for this category.
    pub fn clearable(self) -> bool {
        !matches!(
            self,
            StorageCategory::AiModels | StorageCategory::LockedRecovery
        )
    }
}

/// What one storage provider reports. Physical bytes include the provider's
/// own index, sidecars, staging and blobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageReport {
    pub category: StorageCategory,
    pub disk_bytes: u64,
    pub memory_bytes: u64,
    pub pending_delete_bytes: u64,
    pub limit_bytes: u64,
    pub clearable: bool,
    pub loss_key: String,
    pub busy: bool,
}

impl StorageReport {
    /// A row for a category whose provider has nothing stored yet.
    pub fn empty(category: StorageCategory) -> Self {
        Self {
            category,
            disk_bytes: 0,
            memory_bytes: 0,
            pending_delete_bytes: 0,
            limit_bytes: 0,
            clearable: category.clearable(),
            loss_key: category.default_loss_key().to_string(),
            busy: false,
        }
    }
}

/// The result of one clear job. Leased data is reported as pending rather
/// than counted as already removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClearStorageResult {
    pub category: StorageCategory,
    pub freed_bytes: u64,
    pub pending_bytes: u64,
    pub complete: bool,
    /// Stable codes such as `storage.busy`; at most 64.
    pub errors: Vec<String>,
}

impl ClearStorageResult {
    /// Nothing to clear, or a clear that removed nothing.
    pub fn empty(category: StorageCategory) -> Self {
        Self {
            category,
            freed_bytes: 0,
            pending_bytes: 0,
            complete: true,
            errors: Vec::new(),
        }
    }
}

/// True when `value` can cross the UI boundary without losing precision.
pub fn is_safe_integer(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}
