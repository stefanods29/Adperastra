//! Exact bounded vector scan (Step 17c D3). One low-priority worker, a cancel
//! check every 256 rows, deterministic file/chunk ordering, no vector library.

use std::collections::HashMap;
use std::sync::atomic::Ordering;

use fs_service::source_stamp::FileIdentityKey;
use fs_service::CancellationToken;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection};

use crate::ai_search_types::{
    AiSearchError, AiSearchResult, SemanticCoverage, SemanticHit, SemanticPage, SemanticQuery,
    SemanticVectorKind,
};
use crate::ai_semantic_sql::{map_db, model_keys};
use crate::ai_semantic_store::SemanticLimits;
use crate::ai_semantic_vectors::{dot_product, vector_from_le_bytes};

pub(crate) fn search(
    conn: &Connection,
    limits: SemanticLimits,
    query: &SemanticQuery,
    query_vector: &[f32],
    cancel: &CancellationToken,
) -> AiSearchResult<SemanticPage> {
    query.validate()?;
    let kind = query.kind.vector_kind();
    let generation = meta_u64(conn, "generation")?;
    let Some((model_id, model_revision)) = current_model(conn, kind)? else {
        // No promoted embedder means the feature is not usable yet. Returning
        // an empty "complete" page here would pretend a search happened.
        return Err(AiSearchError::Unavailable);
    };
    let mut values = vec![Value::Text(kind.as_str().to_string())];
    values.push(Value::Text(model_id.clone()));
    values.push(Value::Text(model_revision.clone()));
    let placeholders = vec!["?"; query.root_ids.len()].join(",");
    for root in &query.root_ids {
        values.push(Value::Text(root.clone()));
    }
    let sql = format!(
        "SELECT v.volume_id, v.file_id, v.path_key, v.stable, v.modified_ticks, v.size_bytes,
                v.kind, v.chunk_index, v.vector, v.dimensions, v.partial,
                f.path, f.name, f.kind, f.size, f.modified_unix, f.hidden, f.system,
                f.is_link, f.online_only, f.file_id, f.file_id_stable
         FROM semantic_vectors v JOIN files f ON f.key = v.file_key
         WHERE v.kind = ?1 AND v.model_id = ?2 AND v.model_revision = ?3
           AND v.modified_ticks = f.modified_ticks AND v.size_bytes = f.size
           AND EXISTS (SELECT 1 FROM semantic_root_members m
                       WHERE m.file_key = v.file_key AND m.kind = v.kind
                         AND m.root_id IN ({placeholders}))"
    );
    let mut statement = conn.prepare(&sql).map_err(map_db)?;
    let mut rows = statement.query(params_from_iter(values)).map_err(map_db)?;
    let mut best: HashMap<String, SemanticHit> = HashMap::new();
    let mut scanned = 0u32;
    let mut skipped = 0u32;
    while let Some(row) = rows.next().map_err(map_db)? {
        if scanned.is_multiple_of(256) && cancel.load(Ordering::Relaxed) {
            return Err(AiSearchError::Changed);
        }
        scanned = scanned.saturating_add(1);
        let dimensions = row
            .get::<_, i64>(9)
            .map_err(map_db)?
            .clamp(0, i64::from(u16::MAX)) as u16;
        let blob: Vec<u8> = row.get(8).map_err(map_db)?;
        let vector = match vector_from_le_bytes(&blob, dimensions) {
            Ok(vector) => vector,
            Err(_) => {
                skipped = skipped.saturating_add(1);
                continue;
            }
        };
        let score = match dot_product(query_vector, &vector) {
            Ok(score) => score,
            Err(_) => {
                skipped = skipped.saturating_add(1);
                continue;
            }
        };
        let chunk_index = row
            .get::<_, i64>(7)
            .map_err(map_db)?
            .clamp(0, i64::from(u16::MAX)) as u16;
        let key = row.get::<_, String>(2).map_err(map_db)?;
        let hit = hit_from_row(row, score, chunk_index, &model_id, &model_revision)?;
        match best.get(&key) {
            Some(existing)
                if existing.score > hit.score
                    || (existing.score == hit.score && existing.chunk_index <= hit.chunk_index) => {}
            _ => {
                best.insert(key, hit);
            }
        }
        if usize::try_from(scanned).unwrap_or(0) * 64 > limits.working_bytes as usize {
            return Err(AiSearchError::TooLarge);
        }
    }
    let eligible = best.len() as u32;
    let mut hits: Vec<SemanticHit> = best.into_values().collect();
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| identity_key(&left.item.key).cmp(&identity_key(&right.item.key)))
            .then_with(|| left.chunk_index.cmp(&right.chunk_index))
    });
    hits.truncate(usize::from(query.limit));
    let pending = pending_for_roots(conn, &query.root_ids)?;
    let unindexed = count_unindexed(conn, &query.root_ids, kind, &model_id, &model_revision)?;
    let complete = pending == 0 && unindexed == 0 && !meta_bool(conn, "paused")?;
    let coverage = if complete {
        SemanticCoverage::Complete
    } else if eligible == 0 {
        SemanticCoverage::Pending
    } else {
        SemanticCoverage::Partial
    };
    Ok(SemanticPage {
        hits,
        request_revision: query.request_revision,
        index_generation: generation,
        scanned,
        eligible,
        skipped,
        complete,
        coverage,
    })
}

fn current_model(conn: &Connection, kind: SemanticVectorKind) -> AiSearchResult<Option<(String, String)>> {
    let (id_key, revision_key) = model_keys(kind);
    let id = meta_string(conn, id_key)?;
    let revision = meta_string(conn, revision_key)?;
    if id.is_empty() || revision.is_empty() {
        Ok(None)
    } else {
        Ok(Some((id, revision)))
    }
}

fn pending_for_roots(conn: &Connection, root_ids: &[String]) -> AiSearchResult<u32> {
    let placeholders = vec!["?"; root_ids.len()].join(",");
    let values: Vec<Value> = root_ids.iter().map(|id| Value::Text(id.clone())).collect();
    let sql = format!(
        "SELECT COUNT(*) FROM semantic_pending p WHERE EXISTS
         (SELECT 1 FROM root_members m WHERE m.file_key = p.file_key AND m.root_id IN ({placeholders}))"
    );
    conn.query_row(&sql, params_from_iter(values), |row| row.get::<_, i64>(0))
        .map(|value| value.max(0) as u32)
        .map_err(map_db)
}

fn meta_string(conn: &Connection, key: &str) -> AiSearchResult<String> {
    conn.query_row(
        "SELECT value FROM semantic_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .map_err(map_db)
}

fn meta_u64(conn: &Connection, key: &str) -> AiSearchResult<u64> {
    meta_string(conn, key)?.parse::<u64>().map_err(|_| AiSearchError::Unavailable)
}

fn meta_bool(conn: &Connection, key: &str) -> AiSearchResult<bool> {
    Ok(meta_u64(conn, key)? != 0)
}

fn hit_from_row(
    row: &rusqlite::Row<'_>,
    score: f64,
    chunk_index: u16,
    model_id: &str,
    model_revision: &str,
) -> AiSearchResult<SemanticHit> {
    let key = FileIdentityKey {
        volume_id: row.get(0).map_err(map_db)?,
        file_id: row.get(1).map_err(map_db)?,
        path_key: row.get(2).map_err(map_db)?,
        stable: row.get::<_, i64>(3).map_err(map_db)? != 0,
    };
    let item = search_index::types::SearchResult {
        item: search_index::types::ExplorerItem {
            path: row.get(11).map_err(map_db)?,
            name: row.get(12).map_err(map_db)?,
            kind: parse_kind(row.get::<_, String>(13).map_err(map_db)?),
            size: row.get::<_, i64>(14).map_err(map_db)?.max(0) as u64,
            modified_unix: row.get::<_, i64>(15).map_err(map_db)?.max(0) as u64,
            hidden: row.get::<_, i64>(16).map_err(map_db)? != 0,
            system: row.get::<_, i64>(17).map_err(map_db)? != 0,
            is_link: row.get::<_, i64>(18).map_err(map_db)? != 0,
            online_only: row.get::<_, i64>(19).map_err(map_db)? != 0,
            file_id: row.get(20).map_err(map_db)?,
            file_id_stable: row.get::<_, i64>(21).map_err(map_db)? != 0,
        },
        key: key.clone(),
        // 11a has no AI SearchMode variant; the relevance UI labels this row.
        found_by: if row.get::<_, String>(6).map_err(map_db)? == "image" {
            search_index::types::SearchMode::Filters
        } else {
            search_index::types::SearchMode::Content
        },
        snippet: None,
        content_truncated: row.get::<_, i64>(10).map_err(map_db)? != 0,
        metadata_available: false,
        created_unix: 0,
        date_taken_unix: None,
    };
    Ok(SemanticHit {
        item,
        score,
        chunk_index,
        source_revision: ticks_to_unix(row.get::<_, String>(4).map_err(map_db)?)?,
        model_id: model_id.to_string(),
        model_revision: model_revision.to_string(),
        snippet: None,
        partial: row.get::<_, i64>(10).map_err(map_db)? != 0,
    })
}

fn ticks_to_unix(ticks: String) -> AiSearchResult<u64> {
    let ticks = ticks.parse::<u128>().map_err(|_| AiSearchError::Invalid)?;
    let seconds = ticks / 10_000_000u128;
    let unix = seconds.saturating_sub(11_644_473_600u128);
    if unix > 9_007_199_254_740_991u128 {
        return Err(AiSearchError::Invalid);
    }
    Ok(unix as u64)
}

/// Files in the queried roots that still have no vector for this exact
/// model/extractor/stamp. Coverage never claims completeness while this is
/// non-zero.
fn count_unindexed(
    conn: &Connection,
    root_ids: &[String],
    kind: SemanticVectorKind,
    model_id: &str,
    model_revision: &str,
) -> AiSearchResult<u32> {
    let placeholders = vec!["?"; root_ids.len()].join(",");
    let content_condition = if kind == SemanticVectorKind::Image {
        "f.ext IN ('jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'avif', 'heic', 'heif')"
    } else {
        "f.content_state IN ('indexed', 'partial')"
    };
    let mut values: Vec<Value> = root_ids.iter().map(|id| Value::Text(id.clone())).collect();
    values.push(Value::Text(kind.as_str().to_string()));
    values.push(Value::Text(model_id.to_string()));
    values.push(Value::Text(model_revision.to_string()));
    let sql = format!(
        "SELECT COUNT(DISTINCT f.key) FROM files f JOIN root_members m ON m.file_key = f.key
         WHERE m.root_id IN ({placeholders}) AND f.online_only = 0 AND {content_condition}
           AND NOT EXISTS (SELECT 1 FROM semantic_vectors v
                           WHERE v.file_key = f.key AND v.kind = ? AND v.model_id = ?
                             AND v.model_revision = ?
                             AND v.modified_ticks = f.modified_ticks AND v.size_bytes = f.size)"
    );
    conn.query_row(&sql, params_from_iter(values), |row| row.get::<_, i64>(0))
        .map(|value| value.max(0).min(i64::from(u32::MAX)) as u32)
        .map_err(map_db)
}

fn parse_kind(value: String) -> fs_service::ItemKind {
    match value.as_str() {
        "folder" => fs_service::ItemKind::Folder,
        "drive" => fs_service::ItemKind::Drive,
        "other" => fs_service::ItemKind::Other,
        _ => fs_service::ItemKind::File,
    }
}

fn identity_key(key: &FileIdentityKey) -> String {
    format!("{}:{}:{}", key.volume_id, key.file_id, key.path_key)
}
