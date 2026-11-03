use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use data_views::sqlite::{quote_identifier, SqliteCell, SqliteReader, SqliteSort};
use rusqlite::Connection;

fn fixture(path: &Path) {
    let connection = Connection::open(path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT, amount INTEGER, data BLOB);
             INSERT INTO notes (text, amount, data) VALUES ('héllo', 9007199254740993, X'00010203');",
        )
        .unwrap();
}

fn bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

fn sidecars(path: &Path) -> Vec<String> {
    let directory = path.parent().unwrap();
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    std::fs::read_dir(directory)
        .unwrap()
        .flatten()
        .filter_map(|entry| {
            let value = entry.file_name().to_string_lossy().to_string();
            if value.starts_with(&name) && value != name {
                Some(value)
            } else {
                None
            }
        })
        .collect()
}

#[test]
fn sqlite_preview_never_writes_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("notes.sqlite");
    fixture(&path);
    let before = bytes(&path);
    let before_sidecars = sidecars(&path);
    {
        let mut reader = SqliteReader::open(&path).unwrap();
        assert_eq!(reader.tables().len(), 1);
        let page = reader
            .page(
                "notes",
                None,
                SqliteSort::Asc,
                0,
                10,
                &Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        assert_eq!(page.rows.len(), 1);
    }
    assert_eq!(bytes(&path), before);
    assert_eq!(sidecars(&path), before_sidecars);
}

#[test]
fn malicious_table_name_is_quote_escaped() {
    assert_eq!(quote_identifier("x\" OR 1=1 --"), "\"x\"\" OR 1=1 --\"");
}

#[test]
fn integer_9007199254740993_remains_exact_string() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("notes.sqlite");
    fixture(&path);
    let mut reader = SqliteReader::open(&path).unwrap();
    let page = reader
        .page(
            "notes",
            None,
            SqliteSort::Asc,
            0,
            10,
            &Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
    assert_eq!(
        page.rows[0][2],
        SqliteCell::Integer {
            value: "9007199254740993".to_string()
        }
    );
}

#[test]
fn an_invalid_table_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("notes.sqlite");
    fixture(&path);
    let mut reader = SqliteReader::open(&path).unwrap();
    assert_eq!(
        reader
            .page(
                "missing",
                None,
                SqliteSort::Asc,
                0,
                10,
                &Arc::new(AtomicBool::new(false)),
            )
            .unwrap_err(),
        data_views::viewer_error::ViewerError::BadRequest
    );
}
