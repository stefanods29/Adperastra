use crate::operations::RenameResult;
use crate::types::{RenamePreviewRow, RenameStatus};

/// Native caller supplies Windows ordinal-insensitive equality, not lowercase.
/// Parent keys come from native pinned/canonical directory identities.
pub fn mark_collisions(
    rows: &mut [RenamePreviewRow],
    parent_keys: &[String],
    existing: &[(String, String)],
    same_name: impl Fn(&str, &str) -> RenameResult<bool>,
) -> RenameResult<()> {
    if rows.len() != parent_keys.len() {
        return Err("rename.bad_request".into());
    }
    let participates = |status: RenameStatus| {
        matches!(
            status,
            RenameStatus::Ready | RenameStatus::Unchanged | RenameStatus::Conflict
        )
    };
    let mut conflicts = vec![false; rows.len()];
    for (index, row) in rows.iter().enumerate() {
        if !participates(row.status) {
            continue;
        }
        for other in index + 1..rows.len() {
            if participates(rows[other].status)
                && parent_keys[index] == parent_keys[other]
                && same_name(&row.new_name, &rows[other].new_name)?
            {
                conflicts[index] = true;
                conflicts[other] = true;
            }
        }
        for (parent, name) in existing {
            if *parent != parent_keys[index] || !same_name(&row.new_name, name)? {
                continue;
            }
            // An unchanged row still holds its own current name.
            if row.status == RenameStatus::Unchanged && same_name(&row.old_name, name)? {
                continue;
            }
            // Only a row that will actually move away vacates its old name.
            // Unchanged, excluded and already-conflicting rows stay in place.
            let mut vacated = false;
            for (other, source) in rows.iter().enumerate() {
                if parent_keys[other] != *parent || !same_name(&source.old_name, name)? {
                    continue;
                }
                // The row itself may keep this name with a case-only change.
                if other == index {
                    vacated = true;
                    break;
                }
                // Another row vacates the name only when it truly moves away.
                if source.status == RenameStatus::Ready && !same_name(&source.new_name, name)? {
                    vacated = true;
                    break;
                }
            }
            if !vacated {
                conflicts[index] = true;
            }
        }
    }
    for (row, conflict) in rows.iter_mut().zip(conflicts) {
        if conflict {
            row.status = RenameStatus::Conflict;
            row.reason = Some("rename.conflict".into());
        }
    }
    Ok(())
}
