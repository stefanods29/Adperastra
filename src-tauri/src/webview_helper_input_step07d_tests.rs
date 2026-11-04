//! Exact input-replacement tests of Step 07d T2 (E7).
//!
//! These tests drive the two state machines the helper host has: the
//! parent's allowlist transaction (`InputRegistry`) and the child's accepted
//! grants (`ChildInputState`). No process, WebView2 or Tauri window is
//! started; the real two-process case is the coordinator's runtime check.

use std::sync::Arc;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::file_grant_backing::GrantedBacking;
use crate::webview_helper_inputs::{ChildGrants, ChildInputState, InputRegistry};
use crate::webview_helper_types::{
    HelperGrantDTO, HelperInputGrant, HelperInputManifest, HelperInputManifestSource,
    HelperInputSource,
};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

fn memory_grant(grant_id: Uuid, bytes: usize, sensitive: bool) -> HelperInputGrant {
    HelperInputGrant {
        grant_id,
        name: format!("page-{grant_id}.png"),
        mime: "image/png".to_string(),
        source: HelperInputSource::Memory {
            data: Arc::new(Zeroizing::new(vec![7u8; bytes])),
            document_id: "doc-1".to_string(),
            revision: 1,
            content_id: Uuid::new_v4(),
            sensitive,
        },
    }
}

fn dto_for(grant: &HelperInputGrant) -> HelperGrantDTO {
    let byte_len = match &grant.source {
        HelperInputSource::Memory { data, .. } => data.len() as u64,
        HelperInputSource::Snapshot { backing, .. } => backing.length(),
        HelperInputSource::Disk { .. } => 0,
    };
    HelperGrantDTO {
        grant_id: grant.grant_id,
        token_url: format!("http://adpfile.localhost/{TOKEN}/{}", grant.name),
        name: grant.name.clone(),
        mime: grant.mime.clone(),
        byte_len,
        sensitive: grant.source.is_sensitive(),
    }
}

fn manifest_for(grant: &HelperInputGrant) -> HelperInputManifest {
    let source = match &grant.source {
        HelperInputSource::Memory {
            document_id,
            revision,
            content_id,
            sensitive,
            data,
        } => HelperInputManifestSource::Memory {
            document_id: document_id.clone(),
            revision: *revision,
            content_id: *content_id,
            sensitive: *sensitive,
            byte_len: data.len() as u64,
        },
        // These tests only build memory grants; a disk manifest needs a real
        // captured SourceStamp and belongs to the runtime check.
        _ => unreachable!("the input tests use memory grants"),
    };
    HelperInputManifest {
        grant_id: grant.grant_id,
        name: grant.name.clone(),
        mime: grant.mime.clone(),
        source,
    }
}

fn seeded() -> (InputRegistry, HelperInputGrant) {
    let mut registry = InputRegistry::new();
    let first = memory_grant(Uuid::new_v4(), 8, false);
    let update = registry
        .begin_update(vec![first.clone()], false, true)
        .expect("the first update starts");
    registry
        .commit(update, vec![dto_for(&first)])
        .expect("the first update commits");
    (registry, first)
}

#[test]
fn update_while_request_active_busy() {
    let (mut registry, _) = seeded();
    let next = memory_grant(Uuid::new_v4(), 8, false);
    assert_eq!(
        registry.begin_update(vec![next], true, true),
        Err("helper.busy".to_string())
    );
    assert!(registry.pending().is_none());
    // A second update while one is unfinished is refused the same way.
    let first = memory_grant(Uuid::new_v4(), 8, false);
    registry
        .begin_update(vec![first], false, true)
        .expect("one update may start");
    let other = memory_grant(Uuid::new_v4(), 8, false);
    assert_eq!(
        registry.begin_update(vec![other], false, true),
        Err("helper.busy".to_string())
    );
}

#[test]
fn complete_update_replaces_allowlist_once() {
    let (mut registry, first) = seeded();
    let before = registry.generation();
    let second = memory_grant(Uuid::new_v4(), 16, false);
    let update = registry
        .begin_update(vec![second.clone()], false, true)
        .expect("the update starts");
    registry
        .commit(update, vec![dto_for(&second)])
        .expect("the update commits");
    assert_eq!(registry.generation(), before + 1);
    assert_eq!(registry.current().len(), 1);
    assert_eq!(registry.current()[0].grant_id, second.grant_id);
    assert!(!registry.current().iter().any(|grant| grant.grant_id == first.grant_id));
    // The same update id is stale now and cannot replace anything again.
    assert_eq!(
        registry.commit(update, vec![dto_for(&second)]).err(),
        Some("helper.failed".to_string())
    );
    assert_eq!(registry.current().len(), 1);
}

#[test]
fn malformed_update_kills_without_partial_registry() {
    let (mut registry, _first) = seeded();
    let before = registry.current()[0].grant_id;
    let mut child = ChildInputState::new();
    let granted = memory_grant(Uuid::new_v4(), 4, false);
    let update = registry
        .begin_update(vec![granted.clone()], false, true)
        .expect("the update starts");
    child
        .accept_update(update, &[manifest_for(&granted)], true)
        .expect("the child accepts the manifests");
    // A gap in the offsets is malformed: the whole update dies.
    assert!(child.accept_body(granted.grant_id, 2, b"ab").is_err());
    registry.abort();
    assert!(registry.pending().is_none());
    assert_eq!(registry.current().len(), 1);
    assert_eq!(registry.current()[0].grant_id, before);
    assert_eq!(registry.generation(), 1);
    assert_eq!(child.bytes_delivered(), 0);
}

#[test]
fn cancelled_update_releases_old_and_new_owned_inputs() {
    let (mut registry, first) = seeded();
    let next = memory_grant(Uuid::new_v4(), 64, false);
    let update = registry
        .begin_update(vec![next.clone()], false, true)
        .expect("the update starts");
    assert_eq!(registry.aggregate_memory(), 8);
    assert_eq!(
        registry.pending().map(|pending| pending.memory_bytes),
        Some(64)
    );
    registry.abort();
    assert!(registry.pending().is_none());
    // Only the committed allowlist owns bytes now; the new grant is dropped
    // with the pending update.
    assert_eq!(registry.aggregate_memory(), 8);
    assert_eq!(registry.current()[0].grant_id, first.grant_id);
    assert_eq!(
        registry.commit(update, vec![dto_for(&next)]).err(),
        Some("helper.failed".to_string())
    );
}

#[test]
fn in_flight_range_retains_old_arc() {
    let grants = ChildGrants::new();
    let backing = Arc::new(GrantedBacking::Memory {
        bytes: Arc::new(Zeroizing::new(b"page-bytes".to_vec())),
        length: 10,
        sensitive: false,
    });
    let dto = grants
        .install(Uuid::new_v4(), "page.png", "image/png", backing)
        .expect("the child installs the grant");
    let token = dto
        .token_url
        .trim_start_matches("http://adpfile.localhost/")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let in_flight = grants.resolve(&token).expect("the token resolves");
    grants.revoke(&token);
    assert!(grants.resolve(&token).is_none());
    // The response that already holds the Arc still reads the old bytes.
    assert_eq!(in_flight.read_range(0, 10).unwrap(), b"page-bytes");
    assert_eq!(in_flight.read_range(5, 100).unwrap(), b"bytes");
}

#[test]
fn sensitive_update_before_private_proof_sends_zero_bytes() {
    let mut child = ChildInputState::new();
    let grant = memory_grant(Uuid::new_v4(), 32, true);
    assert_eq!(
        child.accept_update(Uuid::new_v4(), &[manifest_for(&grant)], false),
        Err("helper.sensitive_unsupported".to_string())
    );
    // Nothing was accepted, so a body frame has nowhere to go.
    assert!(child.accept_body(grant.grant_id, 0, b"secret").is_err());
    assert_eq!(child.bytes_delivered(), 0);
    assert!(child.grants().is_empty());
}

#[test]
fn stale_update_id_refused() {
    let (mut registry, _) = seeded();
    let next = memory_grant(Uuid::new_v4(), 8, false);
    registry
        .begin_update(vec![next.clone()], false, true)
        .expect("the update starts");
    assert_eq!(
        registry.commit(Uuid::new_v4(), vec![dto_for(&next)]).err(),
        Some("helper.failed".to_string())
    );
    assert!(registry.pending().is_some());
    assert_eq!(registry.current().len(), 1);
}

#[test]
fn reused_grant_id_refused() {
    let (mut registry, first) = seeded();
    let reused = memory_grant(first.grant_id, 8, false);
    assert_eq!(
        registry.begin_update(vec![reused], false, true),
        Err("pdf.bad_request".to_string())
    );
    // A duplicate inside one update is refused too.
    let id = Uuid::new_v4();
    let a = memory_grant(id, 4, false);
    let b = memory_grant(id, 4, false);
    assert_eq!(
        registry.begin_update(vec![a, b], false, true),
        Err("pdf.bad_request".to_string())
    );
}

#[test]
fn aggregate_old_plus_new_memory_cap() {
    let cap = 1024u64;
    let mut registry = InputRegistry::new();
    let old = memory_grant(Uuid::new_v4(), 600, false);
    let update = registry
        .begin_update_with_budget(vec![old.clone()], false, true, cap)
        .expect("600 bytes fit");
    registry
        .commit(update, vec![dto_for(&old)])
        .expect("the first update commits");
    let new = memory_grant(Uuid::new_v4(), 600, false);
    assert_eq!(
        registry.begin_update_with_budget(vec![new], false, true, cap),
        Err("helper.too_large".to_string())
    );
    // A smaller replacement fits and commits.
    let small = memory_grant(Uuid::new_v4(), 400, false);
    let update = registry
        .begin_update_with_budget(vec![small.clone()], false, true, cap)
        .expect("old plus new is inside the cap");
    registry
        .commit(update, vec![dto_for(&small)])
        .expect("the smaller update commits");
}
