//! Tables and JSON trees (Step 06f): open sessions, build one row order per
//! sort or filter, and answer pages of cells or children. The parsing itself
//! lives in the `data-views` crate; nothing but pages crosses IPC (P-10).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard};

use data_views::json::{self, JsonDoc, JsonMatch, JsonNodeInfo};
use data_views::table::{self, Table};
use data_views::table_view::{self, SortDirection, TableViewRequest};
use data_views::{decode_text, TextEncodingId};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id, validate_absolute_path};

/// How many tables stay open at once (the least recently used goes).
pub const MAX_TABLE_SESSIONS: usize = 4;
/// How many JSON documents stay open at once.
pub const MAX_JSON_SESSIONS: usize = 4;
/// How many file bytes the open tables may hold together.
pub const MAX_TABLE_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
/// The longest filter text a view request may carry.
pub const MAX_FILTER_CHARS: usize = 200;

/// What a file tab shows about an open table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSummary {
    pub session: String,
    pub columns: u32,
    pub rows: u64,
    pub truncated: bool,
    pub delimiter: String,
    pub encoding: TextEncodingId,
    pub has_header: bool,
    pub headers: Vec<String>,
}

/// One built row order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableViewInfo {
    pub view: u64,
    pub rows: u64,
}

/// What a file tab shows about an open JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonSummary {
    pub session: String,
    pub nodes: u32,
    pub encoding: TextEncodingId,
    pub root: JsonNodeInfo,
}

struct TableSession {
    table: Arc<Table>,
    file_bytes: u64,
    view: u64,
    order: Vec<u32>,
}

struct JsonSession {
    doc: Arc<JsonDoc>,
}

#[derive(Default)]
struct SessionsState {
    tables: HashMap<String, TableSession>,
    /// Least recently used first.
    table_order: Vec<String>,
    table_bytes: u64,
    json: HashMap<String, JsonSession>,
    json_order: Vec<String>,
}

/// The open tables and JSON trees (managed state).
#[derive(Default)]
pub struct DataSessions {
    state: Mutex<SessionsState>,
}

impl DataSessions {
    fn lock(&self) -> Result<MutexGuard<'_, SessionsState>, String> {
        self.state
            .lock()
            .map_err(|_| "data.read_failed".to_string())
    }

    fn touch(state: &mut SessionsState, id: &str) {
        state.table_order.retain(|entry| entry != id);
        state.table_order.push(id.to_string());
    }

    fn evict_table(state: &mut SessionsState, id: &str) {
        if let Some(removed) = state.tables.remove(id) {
            state.table_bytes = state.table_bytes.saturating_sub(removed.file_bytes);
        }
    }

    /// Remember a freshly read table as its first view; the oldest makes room.
    pub fn insert_table(
        &self,
        id: &str,
        table: Table,
        file_bytes: u64,
        order: Vec<u32>,
    ) -> Result<u64, String> {
        let mut state = self.lock()?;
        if state.tables.contains_key(id) {
            state.table_order.retain(|entry| entry != id);
            Self::evict_table(&mut state, id);
        }
        state.tables.insert(
            id.to_string(),
            TableSession {
                table: Arc::new(table),
                file_bytes,
                view: 1,
                order,
            },
        );
        state.table_order.push(id.to_string());
        state.table_bytes = state.table_bytes.saturating_add(file_bytes);
        while state.table_order.len() > MAX_TABLE_SESSIONS {
            let oldest = state.table_order.remove(0);
            Self::evict_table(&mut state, &oldest);
        }
        while state.table_bytes > MAX_TABLE_TOTAL_BYTES && state.table_order.len() > 1 {
            let oldest = state.table_order.remove(0);
            Self::evict_table(&mut state, &oldest);
        }
        Ok(1)
    }

    /// The table of an open session, marked as the most recently used.
    pub fn table_for(&self, id: &str) -> Result<Arc<Table>, String> {
        let mut state = self.lock()?;
        let table = state
            .tables
            .get(id)
            .map(|session| Arc::clone(&session.table))
            .ok_or_else(|| "table.no_session".to_string())?;
        Self::touch(&mut state, id);
        Ok(table)
    }

    /// Store a newly built row order; answers for older views are refused.
    pub fn set_view(&self, id: &str, order: Vec<u32>) -> Result<TableViewInfo, String> {
        let mut state = self.lock()?;
        let (view, rows) = {
            let session = state
                .tables
                .get_mut(id)
                .ok_or_else(|| "table.no_session".to_string())?;
            session.view = session.view.saturating_add(1);
            session.order = order;
            (session.view, session.order.len() as u64)
        };
        Self::touch(&mut state, id);
        Ok(TableViewInfo { view, rows })
    }

    /// One page of rows of the current view.
    pub fn rows(
        &self,
        id: &str,
        view: u64,
        start: usize,
        count: usize,
    ) -> Result<Vec<Vec<String>>, String> {
        let (table, order) = {
            let state = self.lock()?;
            let session = state
                .tables
                .get(id)
                .ok_or_else(|| "table.no_session".to_string())?;
            if session.view != view {
                return Err("table.no_session".to_string());
            }
            let end = start
                .saturating_add(count.min(data_views::limits::MAX_PAGE_ROWS))
                .min(session.order.len());
            let order = if start < session.order.len() {
                session.order[start..end].to_vec()
            } else {
                Vec::new()
            };
            (Arc::clone(&session.table), order)
        };
        let count = order.len();
        Ok(table_view::page_rows(&table, &order, 0, count))
    }

    pub fn close_table(&self, id: &str) {
        if let Ok(mut state) = self.lock() {
            state.table_order.retain(|entry| entry != id);
            Self::evict_table(&mut state, id);
        }
    }

    /// Remember a freshly parsed JSON document; the oldest makes room.
    pub fn insert_json(&self, id: &str, doc: JsonDoc) -> Result<(), String> {
        let mut state = self.lock()?;
        if state.json.contains_key(id) {
            state.json_order.retain(|entry| entry != id);
            state.json.remove(id);
        }
        state
            .json
            .insert(id.to_string(), JsonSession { doc: Arc::new(doc) });
        state.json_order.push(id.to_string());
        while state.json_order.len() > MAX_JSON_SESSIONS {
            let oldest = state.json_order.remove(0);
            state.json.remove(&oldest);
        }
        Ok(())
    }

    /// An open JSON document, marked as the most recently used.
    pub fn json_for(&self, id: &str) -> Result<Arc<JsonDoc>, String> {
        let mut state = self.lock()?;
        let doc = state
            .json
            .get(id)
            .map(|session| Arc::clone(&session.doc))
            .ok_or_else(|| "json.no_session".to_string())?;
        state.json_order.retain(|entry| entry != id);
        state.json_order.push(id.to_string());
        Ok(doc)
    }

    pub fn close_json(&self, id: &str) {
        if let Ok(mut state) = self.lock() {
            state.json_order.retain(|entry| entry != id);
            state.json.remove(id);
        }
    }
}

/// A command argument check: the request id, or an area's `bad_request`.
fn validate_request(id: &str, area: &str) -> Result<(), String> {
    valid_request_id(id).map_err(|_| format!("{area}.bad_request"))
}

fn validate_path(path: &str, area: &str) -> Result<(), String> {
    validate_absolute_path(path).map_err(|_| format!("{area}.bad_request"))
}

/// Read a file only up to `max` bytes; a bigger one is `data.too_large`.
fn read_limited(path: &str, max: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(path).map_err(|_| "data.read_failed".to_string())?;
    if metadata.len() > max {
        return Err("data.too_large".to_string());
    }
    let file = std::fs::File::open(path).map_err(|_| "data.read_failed".to_string())?;
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "data.read_failed".to_string())?;
    if bytes.len() as u64 > max {
        return Err("data.too_large".to_string());
    }
    Ok(bytes)
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn data_code(error: data_views::DataError) -> String {
    error.code().to_string()
}

fn json_code(error: data_views::DataError) -> String {
    match error {
        data_views::DataError::Invalid { line, column } => format!("data.invalid:{line}:{column}"),
        other => other.code().to_string(),
    }
}

/// Read a CSV or TSV file in the background and remember it for browsing.
#[tauri::command]
pub fn table_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_request(&request_id, "table")?;
    validate_path(&path, "table")?;
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| "table.bad_request".to_string())?;
    let work_app = app.clone();
    spawn_job(app, request_id.clone(), token, move |ctx| {
        let bytes = read_limited(&path, data_views::limits::MAX_TABLE_FILE)?;
        let (text, encoding) = decode_text(&bytes);
        let delimiter = table::detect_delimiter(&text, &extension_of(&path));
        let table = table::parse_table(&text, delimiter, ctx.token()).map_err(data_code)?;
        let has_header = table::first_row_is_header(&table);
        let headers: Vec<String> = if table.rows() == 0 {
            Vec::new()
        } else {
            (0..table.columns())
                .map(|column| table_view::cut_cell(table.cell(0, column)))
                .collect()
        };
        let request = TableViewRequest {
            sort_column: None,
            direction: SortDirection::Ascending,
            has_header,
            filter: String::new(),
        };
        let order = table_view::build_order(&table, &request, ctx.token()).map_err(data_code)?;
        let summary = TableSummary {
            session: request_id.clone(),
            columns: table.columns() as u32,
            rows: table.rows() as u64,
            truncated: table.truncated(),
            delimiter: char::from(delimiter).to_string(),
            encoding,
            has_header,
            headers,
        };
        work_app.state::<DataSessions>().insert_table(
            &request_id,
            table,
            bytes.len() as u64,
            order,
        )?;
        serde_json::to_value(summary).map_err(|_| "data.read_failed".to_string())
    });
    Ok(())
}

/// Build the row order for a sort, a direction, the header choice or a filter.
#[tauri::command]
pub fn table_view_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session: String,
    request: TableViewRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_request(&request_id, "table")?;
    validate_request(&session, "table")?;
    if request.filter.chars().count() > MAX_FILTER_CHARS {
        return Err("table.bad_request".to_string());
    }
    let table = app.state::<DataSessions>().table_for(&session)?;
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| "table.bad_request".to_string())?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |ctx| {
        let order = table_view::build_order(&table, &request, ctx.token()).map_err(data_code)?;
        let info = work_app.state::<DataSessions>().set_view(&session, order)?;
        serde_json::to_value(info).map_err(|_| "table.bad_request".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn table_rows(
    window: WebviewWindow,
    sessions: State<'_, DataSessions>,
    session: String,
    view: u64,
    start: usize,
    count: usize,
) -> Result<Vec<Vec<String>>, String> {
    ensure_main(window.label())?;
    validate_request(&session, "table")?;
    sessions.rows(&session, view, start, count)
}

#[tauri::command]
pub fn table_close(
    window: WebviewWindow,
    sessions: State<'_, DataSessions>,
    session: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if validate_request(&session, "table").is_ok() {
        sessions.close_table(&session);
    }
    Ok(())
}

/// Read a JSON file in the background and remember its tree.
#[tauri::command]
pub fn json_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_request(&request_id, "json")?;
    validate_path(&path, "json")?;
    let token = jobs
        .begin(&request_id, 0)
        .map_err(|_| "json.bad_request".to_string())?;
    let work_app = app.clone();
    spawn_job(app, request_id.clone(), token, move |ctx| {
        if ctx.token().load(Ordering::Relaxed) {
            return Err("data.cancelled".to_string());
        }
        let bytes = read_limited(&path, data_views::limits::MAX_JSON_FILE)?;
        let (text, encoding) = decode_text(&bytes);
        let doc = json::parse_json(&text).map_err(json_code)?;
        let summary = JsonSummary {
            session: request_id.clone(),
            nodes: doc.node_count(),
            encoding,
            root: doc.node_info(doc.root()),
        };
        work_app
            .state::<DataSessions>()
            .insert_json(&request_id, doc)?;
        serde_json::to_value(summary).map_err(|_| "data.read_failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn json_children(
    window: WebviewWindow,
    sessions: State<'_, DataSessions>,
    session: String,
    node: u32,
    start: usize,
    count: usize,
) -> Result<Vec<JsonNodeInfo>, String> {
    ensure_main(window.label())?;
    validate_request(&session, "json")?;
    let doc = sessions.json_for(&session)?;
    if node >= doc.node_count() {
        return Err("json.bad_request".to_string());
    }
    Ok(json::children(&doc, node, start, count))
}

#[tauri::command]
pub fn json_find(
    window: WebviewWindow,
    sessions: State<'_, DataSessions>,
    session: String,
    text: String,
    case_sensitive: bool,
    after: Option<u32>,
    backwards: bool,
) -> Result<Option<JsonMatch>, String> {
    ensure_main(window.label())?;
    validate_request(&session, "json")?;
    if text.chars().count() > data_views::limits::MAX_SEARCH_CHARS {
        return Err("json.bad_request".to_string());
    }
    let doc = sessions.json_for(&session)?;
    if after.is_some_and(|id| id >= doc.node_count()) {
        return Err("json.bad_request".to_string());
    }
    Ok(json::find_next(
        &doc,
        &text,
        case_sensitive,
        after,
        backwards,
    ))
}

#[tauri::command]
pub fn json_copy(
    window: WebviewWindow,
    sessions: State<'_, DataSessions>,
    session: String,
    node: u32,
) -> Result<String, String> {
    ensure_main(window.label())?;
    validate_request(&session, "json")?;
    let doc = sessions.json_for(&session)?;
    if node >= doc.node_count() {
        return Err("json.bad_request".to_string());
    }
    json::copy_text(&doc, node).map_err(data_code)
}

#[tauri::command]
pub fn json_close(
    window: WebviewWindow,
    sessions: State<'_, DataSessions>,
    session: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if validate_request(&session, "json").is_ok() {
        sessions.close_json(&session);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::new_cancellation_token;

    fn table(text: &str) -> Table {
        table::parse_table(text, b',', &new_cancellation_token()).unwrap()
    }

    #[test]
    fn sessions_evict_the_oldest() {
        let sessions = DataSessions::default();
        for index in 0..5 {
            sessions
                .insert_table(&format!("table-{index}"), table("a\nb\n"), 10, vec![1])
                .unwrap();
        }
        assert_eq!(
            sessions.table_for("table-0").err().as_deref(),
            Some("table.no_session")
        );
        assert!(sessions.table_for("table-4").is_ok());
    }

    #[test]
    fn total_bytes_evict_too() {
        let sessions = DataSessions::default();
        let big = 100 * 1024 * 1024;
        for index in 0..3 {
            sessions
                .insert_table(&format!("t{index}"), table("a\n"), big, vec![0])
                .unwrap();
        }
        assert_eq!(
            sessions.table_for("t0").err().as_deref(),
            Some("table.no_session")
        );
        assert!(sessions.table_for("t1").is_ok());
        assert!(sessions.table_for("t2").is_ok());
    }

    #[test]
    fn old_view_is_refused() {
        let sessions = DataSessions::default();
        sessions
            .insert_table("t", table("a\nb\n"), 3, vec![1])
            .unwrap();
        assert_eq!(sessions.rows("t", 1, 0, 10).unwrap(), vec![vec!["b"]]);
        let info = sessions.set_view("t", vec![0]).unwrap();
        assert_eq!(info.view, 2);
        assert_eq!(
            sessions.rows("t", 1, 0, 10).err().as_deref(),
            Some("table.no_session")
        );
        assert_eq!(sessions.rows("t", 2, 0, 10).unwrap(), vec![vec!["a"]]);
    }

    #[test]
    fn bad_ids_and_paths_are_refused() {
        assert_eq!(
            validate_request("bad id", "table").err().as_deref(),
            Some("table.bad_request")
        );
        assert_eq!(validate_request("tbl-a-1", "table"), Ok(()));
        assert_eq!(
            validate_path("relative\\path.csv", "table")
                .err()
                .as_deref(),
            Some("table.bad_request")
        );
        assert_eq!(validate_path("C:\\data\\a.csv", "table"), Ok(()));
    }
}
