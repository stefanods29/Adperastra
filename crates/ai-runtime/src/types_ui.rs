//! Capability, hardware, artifact, text-page and settings types.
//!
//! Split from `types.rs` only to keep every source file under the repository's
//! 400-line rule; the canonical re-export remains `ai_runtime::*`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::types::{
    AiDevice, AiTaskKind, AiTier, DEFAULT_IDLE_UNLOAD_SECONDS, DEFAULT_MEMORY_LIMIT_MB,
    MAX_IDLE_UNLOAD_SECONDS, MAX_MEMORY_LIMIT_MB, MIN_IDLE_UNLOAD_SECONDS, MIN_MEMORY_LIMIT_MB,
};

/// The reason a capability is unavailable. Never raw stderr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiUnavailableReason {
    Disabled,
    PackMissing,
    Unverified,
    Unsupported,
    MemoryLimit,
    SandboxFailed,
}

/// One independently registered capability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiCapabilityStatus {
    pub task: AiTaskKind,
    pub available: bool,
    pub pack_id: Option<String>,
    pub model_id: Option<String>,
    pub reason: Option<AiUnavailableReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpuBackend {
    Vulkan,
    Directml,
}

/// Hardware as actually queried. Missing GPU facts stay `None`; nothing is guessed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiHardwareInfo {
    pub ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub logical_cores: u16,
    pub gpu_name: Option<String>,
    pub dedicated_vram_bytes: Option<u64>,
    pub gpu_backend: Option<GpuBackend>,
    pub recommended_tier: AiTier,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiTextChunk {
    pub sequence: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiTextPage {
    pub chunks: Vec<AiTextChunk>,
    pub after_sequence: u64,
    pub done: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiArtifactKind {
    Image,
    Mask,
    Embeddings,
    Transcript,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiArtifactInfo {
    pub id: Uuid,
    pub kind: AiArtifactKind,
    pub byte_len: u64,
    pub expires_unix: u64,
    pub sensitive: bool,
}

/// Settings section `local_ai` (schema 41). Every task is opt-in.
/// Unknown additive fields are ignored here so a newer file is not reset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalAiSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_device")]
    pub device: AiDevice,
    #[serde(default = "default_tier")]
    pub tier: AiTier,
    #[serde(default = "default_idle")]
    pub idle_unload_seconds: u32,
    #[serde(default = "default_memory_limit")]
    pub memory_limit_mb: u32,
    #[serde(
        default = "default_task_map",
        deserialize_with = "deserialize_task_map"
    )]
    pub tasks: BTreeMap<AiTaskKind, bool>,
}

/// Forward-compatible task map: a newer settings file may name a task this
/// build does not know yet. Unknown keys are ignored instead of failing the
/// whole `local_ai` section, and missing known keys stay off.
fn deserialize_task_map<'de, D>(deserializer: D) -> Result<BTreeMap<AiTaskKind, bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = BTreeMap::<String, bool>::deserialize(deserializer)?;
    let mut tasks = default_task_map();
    for (key, enabled) in raw {
        if let Some(kind) = AiTaskKind::ALL
            .into_iter()
            .find(|kind| kind.as_str() == key.as_str())
        {
            tasks.insert(kind, enabled);
        }
    }
    Ok(tasks)
}

fn default_device() -> AiDevice {
    AiDevice::Auto
}
fn default_tier() -> AiTier {
    AiTier::Auto
}
fn default_idle() -> u32 {
    DEFAULT_IDLE_UNLOAD_SECONDS
}
fn default_memory_limit() -> u32 {
    DEFAULT_MEMORY_LIMIT_MB
}
fn default_task_map() -> BTreeMap<AiTaskKind, bool> {
    let mut map = BTreeMap::new();
    for kind in AiTaskKind::ALL {
        map.insert(kind, false);
    }
    map
}

impl Default for LocalAiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            device: AiDevice::Auto,
            tier: AiTier::Auto,
            idle_unload_seconds: DEFAULT_IDLE_UNLOAD_SECONDS,
            memory_limit_mb: DEFAULT_MEMORY_LIMIT_MB,
            tasks: default_task_map(),
        }
    }
}

impl LocalAiSettings {
    /// Validation used by the settings loader; out-of-range values are refused
    /// instead of silently changed.
    pub fn validate(&self) -> Result<(), String> {
        if !(MIN_IDLE_UNLOAD_SECONDS..=MAX_IDLE_UNLOAD_SECONDS).contains(&self.idle_unload_seconds)
            || !(MIN_MEMORY_LIMIT_MB..=MAX_MEMORY_LIMIT_MB).contains(&self.memory_limit_mb)
        {
            return Err("settings.local_ai".into());
        }
        Ok(())
    }

    /// Additive migration: add missing task keys, keep every other field.
    pub fn normalized(mut self) -> Self {
        for kind in AiTaskKind::ALL {
            self.tasks.entry(kind).or_insert(false);
        }
        self.idle_unload_seconds = self
            .idle_unload_seconds
            .clamp(MIN_IDLE_UNLOAD_SECONDS, MAX_IDLE_UNLOAD_SECONDS);
        self.memory_limit_mb = self
            .memory_limit_mb
            .clamp(MIN_MEMORY_LIMIT_MB, MAX_MEMORY_LIMIT_MB);
        self
    }
}
