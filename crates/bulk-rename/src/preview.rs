use crate::operations::{
    transform_candidate, validate_request, validate_source_stamp, RenameResult, TemplateValues,
};
use crate::types::*;
use fs_service::SourceStamp;
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

/// Native-derived data only; not a deserializable IPC request.
pub struct PreviewInput {
    pub source: SourceStamp,
    pub old_name: String,
    pub is_directory: bool,
    pub templates: TemplateValues,
}

pub fn compute_rows(
    request: &RenameRequest,
    inputs: &[PreviewInput],
    cancelled: impl Fn() -> bool,
) -> RenameResult<Vec<RenamePreviewRow>> {
    validate_request(request)?;
    if inputs.len() != request.paths.len() {
        return Err("rename.bad_request".into());
    }
    let mut rows = Vec::with_capacity(inputs.len());
    let mut identities = HashSet::with_capacity(inputs.len());
    for (index, input) in inputs.iter().enumerate() {
        if cancelled() {
            return Err("rename.cancelled".into());
        }
        let source_path = &request.paths[index];
        validate_source_stamp(&input.source, source_path)?;
        if !identities.insert((input.source.volume_id.clone(), input.source.file_id.clone())) {
            return Err("rename.bad_request".into());
        }
        if Path::new(source_path)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(input.old_name.as_str())
        {
            return Err("rename.bad_request".into());
        }
        let result = transform_candidate(
            request,
            index as u32,
            &input.old_name,
            input.is_directory,
            &input.templates,
        );
        let (new_name, status, reason) = match result {
            Ok(name) => {
                if !request.excluded_indices.contains(&(index as u32))
                    && fs_service::validate_new_name(&name).is_err()
                {
                    rows.push(RenamePreviewRow {
                        input_index: index as u32,
                        source_path: request.paths[index].clone(),
                        source: input.source.clone(),
                        old_name: input.old_name.clone(),
                        new_name: name,
                        status: RenameStatus::Invalid,
                        reason: Some("rename.invalid_name".into()),
                    });
                    continue;
                }
                let status = if request.excluded_indices.contains(&(index as u32)) {
                    RenameStatus::Excluded
                } else if name == input.old_name {
                    RenameStatus::Unchanged
                } else {
                    RenameStatus::Ready
                };
                (name, status, None)
            }
            Err(error) => (input.old_name.clone(), RenameStatus::Invalid, Some(error)),
        };
        rows.push(RenamePreviewRow {
            input_index: index as u32,
            source_path: request.paths[index].clone(),
            source: input.source.clone(),
            old_name: input.old_name.clone(),
            new_name,
            status,
            reason,
        });
    }
    if serde_json::to_vec(&rows)
        .map_err(|_| "rename.failed")?
        .len()
        > MAX_PLAN_BYTES
    {
        return Err("rename.too_large".into());
    }
    Ok(rows)
}

/// Caller owns opaque cursor -> offset association and the five-minute plan lease.
/// It must run `collisions::mark_collisions` over the full row set first; counts
/// always cover the complete plan, including subsequent pages.
pub fn plan_page(
    plan_id: Uuid,
    request_revision: u32,
    rows: &[RenamePreviewRow],
    offset: usize,
    expires_unix: u64,
    cursor: Uuid,
) -> RenameResult<RenamePlanPage> {
    if offset > rows.len() || rows.len() > MAX_SOURCES || expires_unix > 9_007_199_254_740_991 {
        return Err("rename.bad_request".into());
    }
    let count = |status| rows.iter().filter(|row| row.status == status).count() as u32;
    let mut page = RenamePlanPage {
        plan_id,
        request_revision,
        rows: vec![],
        next_cursor: None,
        total: rows.len() as u32,
        ready: count(RenameStatus::Ready),
        invalid: count(RenameStatus::Invalid),
        conflicts: count(RenameStatus::Conflict),
        expires_unix,
        all_rows_valid: count(RenameStatus::Invalid) == 0 && count(RenameStatus::Conflict) == 0,
    };
    for row in rows.iter().skip(offset).take(MAX_PAGE_ROWS) {
        page.rows.push(row.clone());
        page.next_cursor = (offset + page.rows.len() < rows.len()).then_some(cursor);
        if serde_json::to_vec(&page)
            .map_err(|_| "rename.failed")?
            .len()
            > MAX_PAGE_BYTES
        {
            page.rows.pop();
            if page.rows.is_empty() {
                return Err("rename.too_large".into());
            }
            page.next_cursor = Some(cursor);
            break;
        }
    }
    Ok(page)
}
