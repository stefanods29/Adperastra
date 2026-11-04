use fs_service::new_cancellation_token;
use fs_service::source_stamp::{FileIdentityKey, SourceStamp};
use rusqlite::Connection;
use tempfile::TempDir;

use super::{SemanticLimits, SemanticStore};
use crate::ai_search_types::{
    AiSemanticRoot, SemanticQuery, SemanticQueryKind, SemanticVectorKind, SemanticVectorRecord,
    IMAGE_EMBEDDING_DIMENSIONS, TEXT_EMBEDDING_DIMENSIONS,
};

const ROOT_A: &str = "11111111-1111-4111-8111-111111111111";
const ROOT_B: &str = "22222222-2222-4222-8222-222222222222";

fn fixture(limits: SemanticLimits) -> (TempDir, SemanticStore) {
    let directory = tempfile::tempdir().unwrap();
    let db = directory.path().join("index.sqlite3");
    let connection = Connection::open(&db).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE files (
                id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, volume_id TEXT NOT NULL,
                file_id TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
                name TEXT NOT NULL, normalized_name TEXT NOT NULL, ext TEXT NOT NULL,
                kind TEXT NOT NULL, size INTEGER NOT NULL, modified_unix INTEGER NOT NULL,
                created_unix INTEGER NOT NULL, date_taken_unix INTEGER, width INTEGER,
                height INTEGER, duration_ms INTEGER, pages INTEGER, author TEXT,
                hidden INTEGER NOT NULL DEFAULT 0, system INTEGER NOT NULL DEFAULT 0,
                is_link INTEGER NOT NULL DEFAULT 0, online_only INTEGER NOT NULL DEFAULT 0,
                file_id_stable INTEGER NOT NULL DEFAULT 0, modified_ticks TEXT NOT NULL,
                content_state TEXT NOT NULL DEFAULT 'indexed', content_truncated INTEGER NOT NULL DEFAULT 0,
                metadata_available INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE root_members (
                root_id TEXT NOT NULL, file_key TEXT NOT NULL, PRIMARY KEY (root_id, file_key)
            );",
        )
        .unwrap();
    drop(connection);
    let store = SemanticStore::open_at(&db, limits).unwrap();
    (directory, store)
}

fn identity(index: u64) -> FileIdentityKey {
    FileIdentityKey {
        volume_id: "00000001".into(),
        file_id: format!("{index:016x}"),
        path_key: format!("c:\\fixture\\file{index}.txt"),
        stable: true,
    }
}

fn stamp(identity: &FileIdentityKey) -> SourceStamp {
    SourceStamp {
        path_key: identity.path_key.clone(),
        volume_id: identity.volume_id.clone(),
        file_id: identity.file_id.clone(),
        modified_ticks: "133000000000000000".into(),
        size_bytes: 10,
    }
}

fn vector(dimensions: u16) -> Vec<f32> {
    let mut vector = vec![0.0f32; usize::from(dimensions)];
    vector[0] = 1.0;
    vector
}

fn record(
    index: u64,
    kind: SemanticVectorKind,
    revision: &str,
    roots: &[&str],
    dimensions: u16,
) -> SemanticVectorRecord {
    let identity = identity(index);
    SemanticVectorRecord {
        source: stamp(&identity),
        identity,
        root_ids: roots.iter().map(|root| (*root).to_string()).collect(),
        model_id: if kind == SemanticVectorKind::Text {
            "multilingual-e5-small".into()
        } else {
            "siglip2-base".into()
        },
        model_revision: revision.into(),
        extractor_revision: 1,
        kind,
        chunk_index: 0,
        start: if kind == SemanticVectorKind::Text { Some(0) } else { None },
        end: if kind == SemanticVectorKind::Text { Some(10) } else { None },
        dimensions,
        vector: vector(dimensions),
        partial: false,
    }
}

fn seed(store: &SemanticStore, index: u64, roots: &[&str]) {
    let identity = identity(index);
    store.seed_file_row(
        &super::file_key(&identity),
        &identity.path_key,
        &format!("file{index}.txt"),
    );
    for root in roots {
        store
            .conn
            .execute(
                "INSERT OR IGNORE INTO root_members (root_id, file_key) VALUES (?1, ?2)",
                rusqlite::params![root, super::file_key(&identity)],
            )
            .unwrap();
    }
}

fn query(kind: SemanticQueryKind, roots: &[&str]) -> SemanticQuery {
    SemanticQuery {
        kind,
        text: if kind.is_similar() { None } else { Some("anything".into()) },
        input: None,
        root_ids: roots.iter().map(|root| (*root).to_string()).collect(),
        limit: 50,
        request_revision: 1,
        sensitive_consent_id: None,
    }
}

#[test]
fn semantic_vector_dimensions() {
    let (_directory, mut store) = fixture(SemanticLimits::default());
    seed(&store, 1, &[ROOT_A]);
    store
        .set_roots(&[AiSemanticRoot {
            root_id: ROOT_A.into(),
            text: true,
            photos: false,
        }])
        .unwrap();
    store
        .promote_model(SemanticVectorKind::Text, "multilingual-e5-small", "rev1")
        .unwrap();
    let mut bad = record(1, SemanticVectorKind::Text, "rev1", &[ROOT_A], TEXT_EMBEDDING_DIMENSIONS);
    bad.vector.pop();
    assert!(store.insert_vector(&bad).is_err());
}

#[test]
fn semantic_nonfinite_rejected() {
    let (_directory, mut store) = fixture(SemanticLimits::default());
    seed(&store, 1, &[ROOT_A]);
    store
        .set_roots(&[AiSemanticRoot {
            root_id: ROOT_A.into(),
            text: true,
            photos: false,
        }])
        .unwrap();
    store
        .promote_model(SemanticVectorKind::Text, "multilingual-e5-small", "rev1")
        .unwrap();
    let mut bad = record(1, SemanticVectorKind::Text, "rev1", &[ROOT_A], TEXT_EMBEDDING_DIMENSIONS);
    bad.vector[0] = f32::NAN;
    assert!(store.insert_vector(&bad).is_err());
    bad.vector[0] = f32::INFINITY;
    assert!(store.insert_vector(&bad).is_err());
}

#[test]
fn semantic_root_membership() {
    let (_directory, mut store) = fixture(SemanticLimits::default());
    seed(&store, 1, &[ROOT_A, ROOT_B]);
    store
        .set_roots(&[
            AiSemanticRoot {
                root_id: ROOT_A.into(),
                text: true,
                photos: false,
            },
            AiSemanticRoot {
                root_id: ROOT_B.into(),
                text: true,
                photos: false,
            },
        ])
        .unwrap();
    store
        .promote_model(SemanticVectorKind::Text, "multilingual-e5-small", "rev1")
        .unwrap();
    store
        .insert_vector(&record(
            1,
            SemanticVectorKind::Text,
            "rev1",
            &[ROOT_A, ROOT_B],
            TEXT_EMBEDDING_DIMENSIONS,
        ))
        .unwrap();
    store.remove_root(ROOT_A).unwrap();
    assert_eq!(store.status().unwrap().text_chunks, 1);
    let token = new_cancellation_token();
    let page = store
        .search(&query(SemanticQueryKind::Text, &[ROOT_B]), &vector(TEXT_EMBEDDING_DIMENSIONS), &token)
        .unwrap();
    assert_eq!(page.hits.len(), 1);
    let removed = store
        .search(&query(SemanticQueryKind::Text, &[ROOT_A]), &vector(TEXT_EMBEDDING_DIMENSIONS), &token)
        .unwrap();
    assert_eq!(removed.hits.len(), 0);
}

#[test]
fn semantic_quota_pauses() {
    assert_eq!(SemanticLimits::default().images, 25_000);
    let (_directory, mut store) = fixture(SemanticLimits {
        text_chunks: 10,
        images: 2,
        bytes: 1024 * 1024,
        working_bytes: 64 * 1024 * 1024,
    });
    store
        .set_roots(&[AiSemanticRoot {
            root_id: ROOT_A.into(),
            text: false,
            photos: true,
        }])
        .unwrap();
    store
        .promote_model(SemanticVectorKind::Image, "siglip2-base", "rev1")
        .unwrap();
    for index in 1..=2 {
        seed(&store, index, &[ROOT_A]);
        store
            .insert_vector(&record(
                index,
                SemanticVectorKind::Image,
                "rev1",
                &[ROOT_A],
                IMAGE_EMBEDDING_DIMENSIONS,
            ))
            .unwrap();
    }
    seed(&store, 3, &[ROOT_A]);
    let third = store.insert_vector(&record(
        3,
        SemanticVectorKind::Image,
        "rev1",
        &[ROOT_A],
        IMAGE_EMBEDDING_DIMENSIONS,
    ));
    assert_eq!(third, Err(crate::ai_search_types::AiSearchError::TooLarge));
    assert_eq!(store.status().unwrap().images, 2);
}

#[test]
fn semantic_model_revision_isolation() {
    let (_directory, mut store) = fixture(SemanticLimits::default());
    seed(&store, 1, &[ROOT_A]);
    store
        .set_roots(&[AiSemanticRoot {
            root_id: ROOT_A.into(),
            text: true,
            photos: false,
        }])
        .unwrap();
    store
        .promote_model(SemanticVectorKind::Text, "multilingual-e5-small", "rev1")
        .unwrap();
    store
        .insert_vector(&record(1, SemanticVectorKind::Text, "rev1", &[ROOT_A], TEXT_EMBEDDING_DIMENSIONS))
        .unwrap();
    store
        .promote_model(SemanticVectorKind::Text, "multilingual-e5-small", "rev2")
        .unwrap();
    assert_eq!(store.status().unwrap().text_chunks, 0);
    store
        .insert_vector(&record(1, SemanticVectorKind::Text, "rev2", &[ROOT_A], TEXT_EMBEDDING_DIMENSIONS))
        .unwrap();
    let token = new_cancellation_token();
    let page = store
        .search(&query(SemanticQueryKind::Text, &[ROOT_A]), &vector(TEXT_EMBEDDING_DIMENSIONS), &token)
        .unwrap();
    assert_eq!(page.hits.len(), 1);
    assert_eq!(page.hits[0].model_revision, "rev2");
}
