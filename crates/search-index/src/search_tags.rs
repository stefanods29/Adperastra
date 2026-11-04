//! Authoritative tag mirror (Step 11a E6). There is deliberately no IPC
//! command that accepts caller-chosen tag rows: 11b's tag store calls this
//! after its own durable commit, in batches of at most 256 updates.

use crate::store::SearchStore;
use crate::types::TagSearchUpdate;

pub fn apply_tag_search_updates(
    updates: &[TagSearchUpdate],
    index: &mut SearchStore,
) -> Result<(), String> {
    index
        .apply_tag_updates(updates)
        .map_err(|error| error.code().to_string())
}
