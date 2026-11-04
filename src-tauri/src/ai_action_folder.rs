//! Folder summary scope (D11, `ai-actions-1` T6).
//!
//! The user approves an exact displayed list. Names alone never establish
//! content; `Include file contents` needs a separate native content scope and
//! an API outbound review. Denied or online-only files are skipped and
//! reported, never silently read.
#![allow(dead_code)]


use uuid::Uuid;

use crate::ai_action_sources::ERR_TOO_LARGE;
use crate::ai_action_types::ERR_NO_SOURCES;

pub const MAX_FOLDER_FILES: usize = 100;
pub const MAX_SKIPPED: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderCandidate {
    pub input_id: Uuid,
    pub label: String,
    pub readable: bool,
    pub denied: bool,
    pub online_only: bool,
    pub is_folder: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedEntry {
    pub label: String,
    pub reason_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPlan {
    pub included: Vec<Uuid>,
    pub skipped: Vec<SkippedEntry>,
    pub partial: bool,
    pub names_only: bool,
    pub recursive: bool,
}

/// Builds the exact scope from the shown list; never walks the disk itself.
pub fn build_plan(
    candidates: &[FolderCandidate],
    recursive: bool,
    include_contents: bool,
) -> Result<FolderPlan, String> {
    if candidates.len() > MAX_FOLDER_FILES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    if !recursive && candidates.iter().any(|candidate| candidate.is_folder) {
        // A subfolder in a non-recursive plan is skipped, not read.
    }
    let mut included = Vec::new();
    let mut skipped = Vec::new();
    for candidate in candidates {
        if candidate.denied {
            skipped.push(SkippedEntry {
                label: candidate.label.clone(),
                reason_code: "scope_denied".to_string(),
            });
            continue;
        }
        if candidate.online_only {
            skipped.push(SkippedEntry {
                label: candidate.label.clone(),
                reason_code: "online_only".to_string(),
            });
            continue;
        }
        if !recursive && candidate.is_folder {
            skipped.push(SkippedEntry {
                label: candidate.label.clone(),
                reason_code: "subfolder".to_string(),
            });
            continue;
        }
        if include_contents && !candidate.readable {
            skipped.push(SkippedEntry {
                label: candidate.label.clone(),
                reason_code: "unreadable".to_string(),
            });
            continue;
        }
        included.push(candidate.input_id);
    }
    if included.is_empty() {
        return Err(ERR_NO_SOURCES.to_string());
    }
    Ok(FolderPlan {
        included,
        partial: !skipped.is_empty(),
        names_only: !include_contents,
        recursive,
        skipped,
    })
}

/// A names-only plan must not produce claims about file contents.
pub fn names_only_claims_content(plan: &FolderPlan, text: &str) -> bool {
    if !plan.names_only {
        return false;
    }
    let lowered = text.to_lowercase();
    ["according to", "the file says", "contains", "states that"]
        .iter()
        .any(|marker| lowered.contains(marker))
}

/// Recursive reading requires the explicit subfolder choice.
pub fn requires_recursive_choice(recursive: bool) -> bool {
    !recursive
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(label: &str) -> FolderCandidate {
        FolderCandidate {
            input_id: Uuid::new_v4(),
            label: label.to_string(),
            readable: true,
            denied: false,
            online_only: false,
            is_folder: false,
        }
    }

    #[test]
    fn names_only_plan_has_no_content() {
        let plan = build_plan(&[candidate("notes.txt")], false, false).unwrap();
        assert!(plan.names_only);
        assert!(!plan.partial);
    }

    #[test]
    fn denied_file_is_skipped_and_reported() {
        let mut denied = candidate("private.txt");
        denied.denied = true;
        let plan = build_plan(&[candidate("notes.txt"), denied], false, true).unwrap();
        assert!(plan.partial);
        assert_eq!(plan.skipped[0].reason_code, "scope_denied");
        assert_eq!(plan.included.len(), 1);
    }
}
