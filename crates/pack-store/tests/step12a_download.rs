use std::io::{Cursor, Write};
use std::sync::Mutex;

use fs_service::new_cancellation_token;
use pack_store::download::{
    run_download, DownloadBody, DownloadClient, DownloadControl, DownloadOutcome, DownloadSpec,
    OwnedDownload,
};
use pack_store::download_state::{DownloadPhase, DownloadRecord, DownloadStateStore, RemoteMeta};
use pack_store::types::PackId;
use pack_store::validation::sha256_hex;
use pack_store::PackError;

struct FakeClient {
    meta: RemoteMeta,
    body: Vec<u8>,
    status: u16,
    content_range_start: Option<u64>,
    etag: Option<String>,
    requests: Mutex<Vec<Option<(u64, String)>>>,
}

impl FakeClient {
    fn fresh(body: Vec<u8>, etag: Option<&str>) -> Self {
        Self {
            meta: RemoteMeta::new(etag.map(str::to_string), Some(body.len() as u64)),
            body,
            status: 200,
            content_range_start: None,
            etag: etag.map(str::to_string),
            requests: Mutex::new(Vec::new()),
        }
    }
}

impl DownloadClient for FakeClient {
    fn meta(&self, _url: &str) -> Result<RemoteMeta, PackError> {
        Ok(self.meta.clone())
    }

    fn get(&self, _url: &str, range: Option<(u64, String)>) -> Result<DownloadBody, PackError> {
        self.requests.lock().unwrap().push(range.clone());
        let (body, start) = match &range {
            Some((offset, _)) if *offset > 0 => {
                let offset = *offset as usize;
                (
                    self.body[offset.min(self.body.len())..].to_vec(),
                    Some(offset as u64),
                )
            }
            _ => (self.body.clone(), self.content_range_start),
        };
        Ok(DownloadBody {
            reader: Box::new(Cursor::new(body)),
            status: if range.is_some() { self.status } else { 200 },
            content_range_start: start,
            etag: self.etag.clone(),
            total_bytes: Some(self.body.len() as u64),
        })
    }
}

fn spec(bytes: &[u8]) -> DownloadSpec {
    DownloadSpec {
        pack_id: PackId::Media,
        version: "1.0.0".to_string(),
        url: "https://packs.example.com/media-1.0.0.zip".to_string(),
        expected_bytes: bytes.len() as u64,
        sha256: sha256_hex(bytes),
    }
}

fn control() -> DownloadControl {
    DownloadControl::new(new_cancellation_token())
}

#[test]
fn resume_wrong_etag_restarts_owned_copy() {
    let temporary = tempfile::tempdir().unwrap();
    let store = DownloadStateStore::new(temporary.path());
    let bytes = vec![7u8; 128];
    let model = spec(&bytes);

    let mut owned = OwnedDownload::create(&store, &model, Some("\"A\"".to_string()), 1).unwrap();
    let old_part = owned.part_path().to_path_buf();
    let old_id = owned.record().download_id.clone();
    {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&old_part)
            .unwrap();
        file.write_all(&bytes[..64]).unwrap();
        file.sync_all().unwrap();
    }
    owned.pause(&store, 2).unwrap();
    drop(owned);
    let record = store.read(&old_id).unwrap();
    assert_eq!(record.bytes_received, 64);
    assert_eq!(record.state, DownloadPhase::Paused);

    let client = FakeClient::fresh(bytes.clone(), Some("\"B\""));
    let outcome = run_download(
        &client,
        &store,
        &model,
        Some(record),
        &control(),
        3,
        |_, _| {},
    )
    .unwrap();
    let DownloadOutcome::Completed(completed) = outcome else {
        panic!("expected a completed fresh download");
    };
    assert_ne!(completed.record.download_id, old_id);
    assert_eq!(std::fs::metadata(&old_part).unwrap().len(), 64);
    assert_eq!(std::fs::metadata(&completed.part_path).unwrap().len(), 128);
    assert_eq!(
        std::fs::metadata(&completed.part_path).unwrap().len(),
        bytes.len() as u64
    );
}

#[test]
fn cancel_keeps_foreign_partial() {
    let temporary = tempfile::tempdir().unwrap();
    let store = DownloadStateStore::new(temporary.path());
    let bytes = vec![9u8; 32];
    let mut owned = OwnedDownload::create(&store, &spec(&bytes), Some("\"A\"".into()), 1).unwrap();
    let part = owned.part_path().to_path_buf();
    owned.pause(&store, 2).unwrap();
    std::fs::remove_file(&part).unwrap();
    std::fs::write(&part, b"foreign contents").unwrap();

    owned.cancel(&store).unwrap();
    assert_eq!(std::fs::read(&part).unwrap(), b"foreign contents");
}

#[test]
fn hash_failure_never_installs() {
    let temporary = tempfile::tempdir().unwrap();
    let store = DownloadStateStore::new(temporary.path());
    let expected = vec![1u8; 64];
    let mut changed = expected.clone();
    changed[17] = 2;
    let client = FakeClient::fresh(changed, Some("\"A\""));
    // `run_download` has no installer callback: a BadHash can only return
    // before any activation could be called.
    let error = run_download(
        &client,
        &store,
        &spec(&expected),
        None,
        &control(),
        1,
        |_, _| {},
    )
    .err()
    .expect("must fail");
    assert_eq!(error, PackError::BadHash);
    let part_files = std::fs::read_dir(store.directory())
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("part"))
        .count();
    assert_eq!(part_files, 0);
}

#[test]
fn paused_record_requires_strong_etag() {
    let record = DownloadRecord::new(
        uuid::Uuid::new_v4().to_string(),
        PackId::Media,
        "1.0.0".to_string(),
        "https://packs.example.com/media.zip".to_string(),
        100,
        sha256_hex(b"x"),
        Some("W/\"weak\"".to_string()),
        1,
    )
    .unwrap();
    assert!(record.etag.is_none());
    assert_eq!(record.state, DownloadPhase::Downloading);
}
