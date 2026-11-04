//! Local destination choice history for Step 17c D8.
//!
//! Counts come only from successful, explicit ordinary move receipts. They
//! never contain a filename, content, source URL or sensitive move. The file
//! is atomic app state, at most 256 KiB, with a revision for reset conflict
//! handling.
#![allow(dead_code)]


use std::path::Path;

use crate::ai_search_types::{
    canonical_extension, is_canonical_uuid, AiSearchError, AiSearchResult, SortCount, SortHistory,
    MAX_SORT_COUNTS, MAX_SORT_HISTORY_BYTES,
};

pub const MIN_SORT_EXAMPLES: u32 = 3;
pub const MIN_SORT_SCORE: f64 = 0.6;

/// Laplace score: (count + 1) / (all matching counts + destination count).
/// A has 4 examples among 2 destinations and B has 0: A = 5/6, B = 1/6.
pub fn destination_score(
    history: &SortHistory,
    extension: &str,
    destination_id: &str,
    destination_count: usize,
) -> Option<f64> {
    let extension = canonical_extension(extension)?;
    if !is_canonical_uuid(destination_id) || destination_count == 0 {
        return None;
    }
    let matching: Vec<&SortCount> = history
        .counts
        .iter()
        .filter(|row| row.extension == extension)
        .collect();
    let total: u64 = matching.iter().map(|row| u64::from(row.count)).sum();
    if total < u64::from(MIN_SORT_EXAMPLES) {
        return None;
    }
    let count = matching
        .iter()
        .find(|row| row.destination_id == destination_id)
        .map(|row| u64::from(row.count))
        .unwrap_or(0);
    Some((count as f64 + 1.0) / (total as f64 + destination_count as f64))
}

/// Eligible destinations ordered by score descending, then destination id.
/// A destination not present in the approved list can never win.
pub fn ranked_destinations(
    history: &SortHistory,
    extension: &str,
    destination_ids: &[String],
) -> Vec<(String, f64)> {
    let canonical = match canonical_extension(extension) {
        Some(value) => value,
        None => return Vec::new(),
    };
    if history.disabled.iter().any(|disabled| disabled == &canonical) {
        return Vec::new();
    }
    let mut ranked: Vec<(String, f64)> = destination_ids
        .iter()
        .filter_map(|id| {
            destination_score(history, &canonical, id, destination_ids.len()).map(|score| (id.clone(), score))
        })
        .filter(|(_, score)| *score >= MIN_SORT_SCORE)
        .collect();
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked
}

/// Record one successful ordinary move receipt. A sensitive move, a failed
/// move or an assistant proposal never reaches this function.
pub fn record_move(
    history: &SortHistory,
    extension: &str,
    destination_id: &str,
    sensitive: bool,
    failed: bool,
) -> SortHistory {
    if sensitive || failed {
        return history.clone();
    }
    let Some(extension) = canonical_extension(extension) else {
        return history.clone();
    };
    if !is_canonical_uuid(destination_id) {
        return history.clone();
    }
    let mut next = history.clone();
    if let Some(row) = next
        .counts
        .iter_mut()
        .find(|row| row.extension == extension && row.destination_id == destination_id)
    {
        row.count = row.count.saturating_add(1).min(100_000);
    } else if next.counts.len() < MAX_SORT_COUNTS {
        next.counts.push(SortCount {
            extension,
            destination_id: destination_id.to_string(),
            count: 1,
        });
    }
    next.revision = next.revision.saturating_add(1);
    next
}

/// Never for this kind disables one extension for this profile. Other
/// extensions stay eligible.
pub fn never_for_kind(history: &SortHistory, extension: &str) -> SortHistory {
    let Some(extension) = canonical_extension(extension) else {
        return history.clone();
    };
    let mut next = history.clone();
    if !next.disabled.iter().any(|entry| entry == &extension) {
        if next.disabled.len() < 100 {
            next.disabled.push(extension);
        } else {
            return history.clone();
        }
    }
    next.revision = next.revision.saturating_add(1);
    next
}

/// Reset is explicit app state and its result is itself undoable through the
/// ordinary UI-history adapter. It clears counts and opt-outs.
pub fn reset_history(history: &SortHistory, expected_revision: u64) -> AiSearchResult<SortHistory> {
    if history.revision != expected_revision {
        return Err(AiSearchError::Changed);
    }
    Ok(SortHistory {
        schema_version: 1,
        revision: history.revision.saturating_add(1),
        counts: Vec::new(),
        disabled: Vec::new(),
    })
}

pub fn load_history(data_dir: &Path) -> SortHistory {
    let path = data_dir.join("ai-search-sort-history.json");
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SortHistory>(&bytes).ok())
        .filter(|history| history.validate().is_ok())
        .unwrap_or_default()
}

pub fn save_history(data_dir: &Path, history: &SortHistory) -> AiSearchResult<()> {
    history.validate()?;
    let json = serde_json::to_vec(history).map_err(|_| AiSearchError::Failed)?;
    if json.len() > MAX_SORT_HISTORY_BYTES {
        return Err(AiSearchError::TooLarge);
    }
    std::fs::create_dir_all(data_dir).map_err(|_| AiSearchError::Failed)?;
    fs_service::atomic_write(&data_dir.join("ai-search-sort-history.json"), &json)
        .map_err(|_| AiSearchError::Failed)
}

#[cfg(test)]
mod tests {
    use super::{destination_score, never_for_kind, ranked_destinations, record_move};
    use crate::ai_search_types::{SortCount, SortHistory};

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";

    fn history() -> SortHistory {
        SortHistory {
            schema_version: 1,
            revision: 1,
            counts: vec![SortCount {
                extension: "jpg".into(),
                destination_id: A.into(),
                count: 4,
            }],
            disabled: vec![],
        }
    }

    #[test]
    fn laplace_score_is_five_sixths_and_a_wins() {
        let score = destination_score(&history(), "jpg", A, 2).unwrap();
        assert!((score - 5.0 / 6.0).abs() < 1e-9);
        let ranked = ranked_destinations(&history(), "jpg", &[A.to_string(), B.to_string()]);
        assert_eq!(ranked[0].0, A);
    }

    #[test]
    fn two_receipts_are_not_enough() {
        let mut short = history();
        short.counts = vec![SortCount {
            extension: "png".into(),
            destination_id: A.into(),
            count: 2,
        }];
        assert!(destination_score(&short, "png", A, 2).is_none());
        let third = record_move(&short, "png", A, false, false);
        assert!(destination_score(&third, "png", A, 2).is_some());
    }

    #[test]
    fn never_kind_only_disables_that_extension() {
        let next = never_for_kind(&history(), "pdf");
        assert!(ranked_destinations(&next, "pdf", &[A.to_string()]).is_empty());
        assert!(!ranked_destinations(&next, "jpg", &[A.to_string()]).is_empty());
    }

    #[test]
    fn sensitive_and_failed_moves_are_not_learned() {
        let next = record_move(&history(), "jpg", B, true, false);
        let next = record_move(&next, "jpg", B, false, true);
        assert_eq!(next.counts.len(), 1);
        assert_eq!(next.counts[0].destination_id, A);
    }
}
