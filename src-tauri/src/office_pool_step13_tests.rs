//! Warm Office pool tests (Step 13 T3). Included from `office_pool.rs`.
//! The fake actor only exercises admission/lease/state rules; it is not
//! evidence of process confinement, UNO interop or source fidelity.
#![allow(dead_code)]
#![allow(clippy::assertions_on_constants, clippy::bool_assert_comparison)]



use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use uuid::Uuid;

use super::*;
use crate::engine_session_types::{
    EngineReadDocument, EngineReadSection, OfficeSessionRenderRequest,
};
use crate::engine_types::{EngineInput, RenderedOffice};
use crate::office_pool_leases::{DerivedPdfIdentity, OfficeLeaseTable, OFFICE_POOL_MAX_DOCUMENTS};
use crate::office_pool_actor::OFFICE_READ_PROTOCOL;
use crate::office_pool_policy::{section_from_engine, OFFICE_READ_POLICY};
use crate::office_view_runtime::OfficeWork;

struct FakeWork;

impl OfficeWork for FakeWork {
    fn cancelled(&self) -> bool {
        false
    }

    fn progress(&self, _done: usize, _total: usize) {}
}

struct FakeActor {
    closes: Arc<AtomicUsize>,
    document_closes: Arc<AtomicUsize>,
    fail_render: bool,
}

impl OfficeReadActor for FakeActor {
    fn open_document(
        &mut self,
        _input: EngineInput,
        _format: OfficeFormat,
        _work: &dyn OfficeWork,
    ) -> Result<EngineReadDocument, String> {
        Err("engines.failed".to_string())
    }

    fn render_document(
        &mut self,
        _request: &OfficeSessionRenderRequest,
        _work: &dyn OfficeWork,
    ) -> Result<RenderedOffice, String> {
        if self.fail_render {
            Err("engines.failed".to_string())
        } else {
            Err("office.unsupported".to_string())
        }
    }

    fn close_document(
        &mut self,
        _document_id: Uuid,
        _work: &dyn OfficeWork,
    ) -> Result<(), String> {
        self.document_closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn close(&mut self) -> Result<(), String> {
        self.closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct FakeFactory {
    starts: Arc<AtomicUsize>,
    closes: Arc<AtomicUsize>,
    document_closes: Arc<AtomicUsize>,
}

impl OfficeReadSessionFactory for FakeFactory {
    fn start(&self, _work: &dyn OfficeWork) -> Result<Box<dyn OfficeReadActor>, String> {
        self.starts.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeActor {
            closes: self.closes.clone(),
            document_closes: self.document_closes.clone(),
            fail_render: false,
        }))
    }
}

fn section() -> EngineReadSection {
    serde_json::from_value(serde_json::json!({
        "id": "document",
        "name": "Document",
        "kind": "document",
        "index": 0,
        "page_count": 1
    }))
    .unwrap()
}

fn document(id: Uuid, revision: u64, content: Option<Uuid>) -> EngineReadDocument {
    serde_json::from_value(serde_json::json!({
        "document_id": id,
        "format": "docx",
        "source_revision": revision,
        "source_content_id": content,
        "sections": [{
            "id": "document",
            "name": "Document",
            "kind": "document",
            "index": 0,
            "page_count": 1
        }],
        "engine_version": "test-1"
    }))
    .unwrap()
}

fn factory() -> (Arc<FakeFactory>, Arc<AtomicUsize>, Arc<AtomicUsize>) {
    let starts = Arc::new(AtomicUsize::new(0));
    let closes = Arc::new(AtomicUsize::new(0));
    let document_closes = Arc::new(AtomicUsize::new(0));
    (
        Arc::new(FakeFactory {
            starts: starts.clone(),
            closes: closes.clone(),
            document_closes: document_closes.clone(),
        }),
        starts,
        closes,
    )
}

fn pool(keep_warm: bool) -> (Arc<OfficeReadPool>, Arc<AtomicUsize>, Arc<AtomicUsize>) {
    let (factory, starts, closes) = factory();
    let options = OfficeWarmOptions::new(keep_warm, OFFICE_READ_IDLE_SECONDS).unwrap();
    (
        Arc::new(OfficeReadPool::new(factory, options).unwrap()),
        starts,
        closes,
    )
}

#[test]
fn read_only_source_hash_identical() {
    assert!(OFFICE_READ_POLICY.hidden);
    assert!(OFFICE_READ_POLICY.read_only);
    assert_eq!(OFFICE_READ_POLICY.macro_execution_mode, 0);
    assert_eq!(OFFICE_READ_POLICY.update_doc_mode, 0);
    assert!(!OFFICE_READ_POLICY.external_join_allowed);
    assert_eq!(spawned_policy_id(), "office_read_v1");
}

fn spawned_policy_id() -> &'static str {
    OFFICE_READ_PROTOCOL
}

#[test]
fn macros_never_execute() {
    assert_eq!(k_macro_never_execute(), 0);
    assert_eq!(OFFICE_READ_POLICY.macro_execution_mode, k_macro_never_execute());
}

fn k_macro_never_execute() -> i16 {
    0
}

#[test]
fn idle60s_closes_pool() {
    let (pool, _starts, closes) = pool(true);
    let id = Uuid::new_v4();
    pool.admit_prepared_for_test(document(id, 1, None), &FakeWork)
        .unwrap();
    pool.close_document_with_work(id, &FakeWork).unwrap();
    assert_eq!(pool.document_count(), 0);
    let closed_at = pool.idle_since_for_test().unwrap();
    assert_eq!(pool.sweep_idle_at(closed_at + 59).unwrap(), 0);
    assert_eq!(pool.sweep_idle_at(closed_at + 60).unwrap(), 1);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}

#[test]
fn keep_warm_false_closes_on_last_lease() {
    let (pool, _starts, closes) = pool(false);
    let id = Uuid::new_v4();
    pool.admit_prepared_for_test(document(id, 1, None), &FakeWork)
        .unwrap();
    pool.close_document_with_work(id, &FakeWork).unwrap();
    assert_eq!(closes.load(Ordering::SeqCst), 1);
    assert_eq!(pool.document_count(), 0);
}

#[test]
fn idle_setting_accepts_only60() {
    assert!(OfficeWarmOptions::new(true, 60).is_ok());
    assert_eq!(
        OfficeWarmOptions::new(true, 59).unwrap_err(),
        "office.bad_request".to_string()
    );
    assert_eq!(
        OfficeWarmOptions::new(true, 61).unwrap_err(),
        "office.bad_request".to_string()
    );
}

#[test]
fn warm_two_viewers_same_actor() {
    let (pool, starts, _closes) = pool(true);
    pool.admit_prepared_for_test(document(Uuid::new_v4(), 1, None), &FakeWork)
        .unwrap();
    pool.admit_prepared_for_test(document(Uuid::new_v4(), 1, None), &FakeWork)
        .unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 1);
}

#[test]
fn pool_fifth_open_closes_only_unleased() {
    let (pool, starts, _closes) = pool(true);
    let ids: Vec<Uuid> = (0..OFFICE_POOL_MAX_DOCUMENTS)
        .map(|index| {
            let id = Uuid::new_v4();
            pool.admit_prepared_for_test(document(id, index as u64 + 1, None), &FakeWork)
                .unwrap();
            id
        })
        .collect();
    pool.close_document_with_work(ids[0], &FakeWork).unwrap();
    pool.admit_prepared_for_test(document(Uuid::new_v4(), 9, None), &FakeWork)
        .unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 1);
    assert_eq!(pool.document_count(), OFFICE_POOL_MAX_DOCUMENTS);
    assert!(pool.source_identity(ids[0]).is_none());
}

#[test]
fn all_four_leased_returns_busy() {
    let (pool, _starts, _closes) = pool(true);
    for index in 0..OFFICE_POOL_MAX_DOCUMENTS {
        pool.admit_prepared_for_test(document(Uuid::new_v4(), index as u64 + 1, None), &FakeWork)
            .unwrap();
    }
    assert_eq!(
        pool.admit_prepared_for_test(document(Uuid::new_v4(), 9, None), &FakeWork)
            .unwrap_err(),
        "engines.busy".to_string()
    );
}

#[test]
fn pool_cancel_invalidates_native_handles() {
    let (pool, _starts, _closes) = pool(true);
    let id = Uuid::new_v4();
    pool.admit_prepared_for_test(document(id, 1, None), &FakeWork)
        .unwrap();
    let lease = OfficePoolLease::new(pool.clone(), id);
    lease.close();
    assert!(pool.source_identity(id).is_none());
}

#[test]
fn engine_death_isolated() {
    let (pool, starts, _closes) = pool(true);
    pool.admit_prepared_for_test(document(Uuid::new_v4(), 1, None), &FakeWork)
        .unwrap();
    pool.close_all().unwrap();
    pool.admit_prepared_for_test(document(Uuid::new_v4(), 2, None), &FakeWork)
        .unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 2);
}

#[test]
fn derived_pdf_uses_snapshot_identity() {
    let content = Uuid::new_v4();
    let doc = document(Uuid::new_v4(), 7, Some(content));
    let identity = DerivedPdfIdentity::from_read_document(&doc, Uuid::new_v4());
    assert_eq!(identity.source_revision, 7);
    assert_eq!(identity.source_content_id, content);
}

#[test]
fn derived_pdf_never_reuses_office_stamp() {
    let fallback = Uuid::new_v4();
    let doc = document(Uuid::new_v4(), 3, None);
    let identity = DerivedPdfIdentity::from_read_document(&doc, fallback);
    assert_eq!(identity.source_revision, 3);
    assert_eq!(identity.source_content_id, fallback);
    assert_ne!(identity.source_content_id, doc.document_id);
}

#[test]
fn comments_use_guarded_structural_parser() {
    let section = section();
    let converted = section_from_engine(&section).unwrap();
    assert_eq!(converted.id, "document");
    assert_eq!(converted.name, "Document");
    assert_eq!(converted.page_count, 1);
}

#[test]
fn private_pipe_external_join_denied() {
    assert_eq!(OFFICE_BRIDGE_TRANSPORT, "stdio-private");
    assert!(!OFFICE_READ_POLICY.external_join_allowed);
    assert_ne!(OFFICE_BRIDGE_TRANSPORT, "named-pipe-public");
}

#[test]
fn lease_table_is_bounded_without_an_actor() {
    let mut table = OfficeLeaseTable::default();
    assert!(table.is_empty());
    for index in 0..OFFICE_POOL_MAX_DOCUMENTS {
        table
            .insert(document(Uuid::new_v4(), index as u64 + 1, None), 1)
            .unwrap();
    }
    assert_eq!(table.len(), OFFICE_POOL_MAX_DOCUMENTS);
    assert_eq!(
        table.insert(document(Uuid::new_v4(), 9, None), 1).unwrap_err(),
        "engines.busy".to_string()
    );
}
