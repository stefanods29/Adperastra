//! Semantic schema 1 tables in the existing 11a search database.

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS semantic_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semantic_roots (
    root_id TEXT PRIMARY KEY,
    text INTEGER NOT NULL DEFAULT 0,
    photos INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS semantic_vectors (
    file_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    extractor_revision INTEGER NOT NULL,
    volume_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    path_key TEXT NOT NULL,
    stable INTEGER NOT NULL,
    modified_ticks TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    dimensions INTEGER NOT NULL,
    vector BLOB NOT NULL,
    start_scalar INTEGER,
    end_scalar INTEGER,
    partial INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (file_key, kind, chunk_index, model_id, model_revision)
);
CREATE INDEX IF NOT EXISTS semantic_vectors_model ON semantic_vectors(kind, model_id, model_revision);
CREATE INDEX IF NOT EXISTS semantic_vectors_file ON semantic_vectors(file_key);
CREATE TABLE IF NOT EXISTS semantic_root_members (
    file_key TEXT NOT NULL,
    root_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (file_key, root_id, kind)
);
CREATE INDEX IF NOT EXISTS semantic_members_file ON semantic_root_members(file_key, kind);
CREATE TABLE IF NOT EXISTS semantic_pending (
    file_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_unix INTEGER NOT NULL,
    PRIMARY KEY (file_key, kind)
);
"#;
