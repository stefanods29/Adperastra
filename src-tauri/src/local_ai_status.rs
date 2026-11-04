//! Capability status reporting (split from `local_ai.rs`).

use ai_runtime::types::AiTaskKind;
use ai_runtime::types_ui::{AiCapabilityStatus, AiUnavailableReason, LocalAiSettings};

use crate::local_ai::AiPackProbe;

pub(crate) const DISABLED: &str = "ai.disabled";
const PACK_MISSING: &str = "ai.pack_missing";

pub fn capabilities(
    settings: &LocalAiSettings,
    packs: &dyn AiPackProbe,
) -> Vec<AiCapabilityStatus> {
    AiTaskKind::ALL
        .iter()
        .map(|task| capability(settings, packs, *task))
        .collect()
}

pub fn capability(
    settings: &LocalAiSettings,
    packs: &dyn AiPackProbe,
    task: AiTaskKind,
) -> AiCapabilityStatus {
    if !settings.enabled || !settings.tasks.get(&task).copied().unwrap_or(false) {
        return unavailable(task, AiUnavailableReason::Disabled);
    }
    if task != AiTaskKind::Upscale {
        return unavailable(task, AiUnavailableReason::Unsupported);
    }
    match packs.probe_upscale() {
        Ok(pack) => AiCapabilityStatus {
            task,
            available: true,
            pack_id: Some(pack.pack_id),
            model_id: Some(pack.model_id),
            reason: None,
        },
        Err(error) => unavailable(task, reason_for(&error)),
    }
}

pub fn unavailable(task: AiTaskKind, reason: AiUnavailableReason) -> AiCapabilityStatus {
    AiCapabilityStatus {
        task,
        available: false,
        pack_id: None,
        model_id: None,
        reason: Some(reason),
    }
}

pub fn reason_for(error: &str) -> AiUnavailableReason {
    match error {
        DISABLED => AiUnavailableReason::Disabled,
        PACK_MISSING => AiUnavailableReason::PackMissing,
        "ai.unverified" => AiUnavailableReason::Unverified,
        "ai.memory_limit" => AiUnavailableReason::MemoryLimit,
        "ai.sandbox_failed" => AiUnavailableReason::SandboxFailed,
        _ => AiUnavailableReason::Unsupported,
    }
}
