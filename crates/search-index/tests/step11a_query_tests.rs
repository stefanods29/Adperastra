//! Step 11a T4: name/content/regex evaluation, AST bounds and cursor pages.

use std::path::Path;
use std::time::{Duration, Instant};

use fs_service::new_cancellation_token;
use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use fs_service::ItemKind;
use search_index::limits::{PAGE_MAX_BYTES, PAGE_SIZE};
use search_index::paging::{validate_cursor, CursorStore};
use search_index::store::SearchStore;
use search_index::types::{
    DateField, IndexRoot, ScannedFile, SearchFilter, SearchMode, SearchQuery, StringField, StringOp,
};
use search_index::{SearchError, SearchOutcome};

fn scanned(path: &Path, index: u64) -> ScannedFile {
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let file_id = format!("{index:016x}");
    ScannedFile {
        identity: FileIdentityKey {
            volume_id: "00000001".to_string(),
            file_id: file_id.clone(),
            path_key: path.to_string_lossy().to_lowercase(),
            stable: true,
        },
        stamp: SourceStamp {
            path_key: path.to_string_lossy().to_lowercase(),
            volume_id: "00000001".to_string(),
            file_id,
            modified_ticks: "1".to_string(),
            size_bytes: 10,
        },
        path: path.to_path_buf(),
        name,
        extension: "txt".to_string(),
        kind: ItemKind::File,
        size: 10,
        modified_unix: 1_700_000_000,
        created_unix: 1_600_000_000,
        date_taken_unix: None,
        width: None,
        height: None,
        duration_ms: None,
        pages: None,
        author: None,
        hidden: false,
        system: false,
        is_link: false,
        online_only: false,
    }
}

fn setup(names: &[&str]) -> (tempfile::TempDir, SearchStore, IndexRoot) {
    let directory = tempfile::tempdir().unwrap();
    let mut store =
        SearchStore::open(&directory.path().join("index.sqlite3"), 64 * 1024 * 1024).unwrap();
    let root = IndexRoot::new(directory.path().to_string_lossy().to_string());
    store.set_roots(std::slice::from_ref(&root)).unwrap();
    let entries: Vec<_> = names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            (
                scanned(&directory.path().join(name), index as u64 + 1),
                None,
            )
        })
        .collect();
    for batch in entries.chunks(256) {
        store.apply_batch(&root.id, batch).unwrap();
    }
    (directory, store, root)
}

fn page(
    store: &SearchStore,
    query: &SearchQuery,
    offset: usize,
    limit: usize,
) -> SearchOutcome<search_index::types::SearchPage> {
    store.search(
        query,
        offset,
        limit,
        Instant::now() + Duration::from_secs(2),
        &new_cancellation_token(),
    )
}

#[test]
fn report_contains_port_at_three_characters() {
    let (_directory, store, _root) = setup(&["report.txt", "other.txt"]);
    let query = SearchQuery {
        mode: SearchMode::Name,
        text: "port".to_string(),
        ..SearchQuery::default()
    };
    let page = page(&store, &query, 0, 50).unwrap();
    assert_eq!(page.results.len(), 1);
    assert_eq!(page.results[0].item.name, "report.txt");
}

#[test]
fn one_and_two_character_queries_are_prefixes() {
    let (_directory, store, _root) = setup(&["a.txt", "beta.txt"]);
    let one = SearchQuery {
        mode: SearchMode::Name,
        text: "a".to_string(),
        ..SearchQuery::default()
    };
    assert_eq!(page(&store, &one, 0, 50).unwrap().results.len(), 1);
    let two = SearchQuery {
        mode: SearchMode::Name,
        text: "et".to_string(),
        ..SearchQuery::default()
    };
    assert_eq!(page(&store, &two, 0, 50).unwrap().results.len(), 0);
}

#[test]
fn fts_operators_are_literal_text() {
    let (_directory, store, _root) = setup(&["report OR.txt", "report and.txt"]);
    let query = SearchQuery {
        mode: SearchMode::Name,
        text: "report OR".to_string(),
        ..SearchQuery::default()
    };
    let page = page(&store, &query, 0, 50).unwrap();
    assert_eq!(page.results.len(), 1);
    assert_eq!(page.results[0].item.name, "report OR.txt");
}

#[test]
fn a_regex_backreference_is_refused() {
    let (_directory, store, _root) = setup(&["a.txt"]);
    let query = SearchQuery {
        mode: SearchMode::Regex,
        text: r"(a)\1".to_string(),
        ..SearchQuery::default()
    };
    assert_eq!(page(&store, &query, 0, 50).unwrap_err(), SearchError::Regex);
}

#[test]
fn a_filter_deeper_than_four_is_refused() {
    let mut filter = SearchFilter::String {
        field: StringField::Ext,
        op: StringOp::Eq,
        value: "txt".to_string(),
    };
    for _ in 0..5 {
        filter = SearchFilter::Not {
            clause: Box::new(filter),
        };
    }
    assert_eq!(filter.validate().unwrap_err(), SearchError::Invalid);
    let (_directory, store, _root) = setup(&["a.txt"]);
    let query = SearchQuery {
        mode: SearchMode::Filters,
        filter: Some(filter),
        ..SearchQuery::default()
    };
    assert_eq!(
        page(&store, &query, 0, 50).unwrap_err(),
        SearchError::Invalid
    );
}

#[test]
fn a_cursor_from_a_changed_generation_is_invalid() {
    let (_directory, mut store, _root) = setup(&["a.txt"]);
    let query = SearchQuery {
        mode: SearchMode::Name,
        text: "a".to_string(),
        ..SearchQuery::default()
    };
    let mut cursors = CursorStore::default();
    let id = cursors
        .insert(&query, store.generation().unwrap(), 50)
        .unwrap();
    let cursor = cursors.take(&id).unwrap();
    store.begin_rebuild().unwrap();
    assert_eq!(
        validate_cursor(&cursor, &query, store.generation().unwrap()).unwrap_err(),
        SearchError::Changed
    );
}

#[test]
fn pages_cap_at_256_results_and_768_kib() {
    let names: Vec<String> = (0..400)
        .map(|index| format!("file{index:04}.txt"))
        .collect();
    let borrowed: Vec<&str> = names.iter().map(String::as_str).collect();
    let (_directory, store, _root) = setup(&borrowed);
    let query = SearchQuery {
        mode: SearchMode::Name,
        text: "file".to_string(),
        ..SearchQuery::default()
    };
    let first = page(&store, &query, 0, 50).unwrap();
    assert_eq!(first.results.len(), 50);
    let second = page(&store, &query, 50, PAGE_SIZE).unwrap();
    assert_eq!(second.results.len(), 256);
    assert!(serde_json::to_vec(&second).unwrap().len() <= PAGE_MAX_BYTES);
    let third = page(&store, &query, 306, PAGE_SIZE).unwrap();
    assert_eq!(third.results.len(), 94);
}

#[test]
fn date_filters_resolve_to_fixed_bounds() {
    let (_directory, store, _root) = setup(&["a.txt"]);
    let filter = SearchFilter::Date {
        field: DateField::Modified,
        from_unix: Some(1_600_000_000),
        to_unix: Some(1_800_000_000),
    };
    let query = SearchQuery {
        mode: SearchMode::Filters,
        filter: Some(filter),
        ..SearchQuery::default()
    };
    assert_eq!(page(&store, &query, 0, 50).unwrap().results.len(), 1);
}
