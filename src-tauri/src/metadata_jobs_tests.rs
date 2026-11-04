use super::*;
use crate::metadata_cache::parse_cached;
use crate::metadata_types::{MetadataField, MetadataFieldId, MetadataValue};
fn stamp() -> SourceStamp {
    SourceStamp {
        path_key: r"c:\pictures\a.jpg".into(),
        volume_id: "00112233".into(),
        file_id: "8899aabbccddeeff".into(),
        modified_ticks: "133000000000000000".into(),
        size_bytes: 400,
    }
}
fn info_for(source: &SourceStamp) -> MetadataInfo {
    let mut info = MetadataInfo::new(source.clone());
    info.push(MetadataField {
        id: MetadataFieldId::Width,
        value: MetadataValue::Integer { value: 400 },
    });
    info.finalize()
}
fn joined() -> (
    consumers::Consumers,
    Arc<Group>,
    Arc<consumers::Consumer>,
    Arc<consumers::Consumer>,
) {
    let consumers = consumers::Consumers::default();
    let first = consumers.register(Uuid::from_u128(1)).unwrap();
    let second = consumers.register(Uuid::from_u128(2)).unwrap();
    let group = Arc::new(Group::new());
    group.state.lock().unwrap().waiters = vec![
        Waiter {
            id: "metadata-first".into(),
            consumer: first.clone(),
            job_token: None,
        },
        Waiter {
            id: "metadata-second".into(),
            consumer: second.clone(),
            job_token: None,
        },
    ];
    (consumers, group, first, second)
}
#[test]
fn two_same_consumers_share_one_helper() {
    let (_, group, first, second) = joined();
    let jobs = Jobs::default();
    assert_eq!(group.state.lock().unwrap().waiters.len(), 2);
    group.state.lock().unwrap().admitted = true;
    assert!(group
        .admit_waiter(&jobs, "metadata-first", &first)
        .unwrap()
        .is_none());
    assert!(group
        .admit_waiter(&jobs, "metadata-second", &second)
        .unwrap()
        .is_none());
    assert!(!jobs.poll("metadata-first").unwrap().done);
    assert!(!jobs.poll("metadata-second").unwrap().done);
    // Neither consumer owns the provider cancellation token.
    jobs.cancel("metadata-first");
    assert!(!group.all_cancelled());
    assert!(!group.token.load(Ordering::Relaxed));
    jobs.cancel("metadata-second");
    assert!(group.all_cancelled());
}
#[test]
fn a_stale_revision_is_rejected_and_not_cached() {
    let expected = stamp();
    let mut newer = expected.clone();
    newer.modified_ticks = "133000000000000001".into();
    let bytes = serde_json::to_vec(&info_for(&newer)).unwrap();
    assert!(parse_cached(&bytes, &expected).is_none());
}
#[test]
fn a_paused_policy_never_reads() {
    let (_, group, first, _) = joined();
    let jobs = Jobs::default();
    group.state.lock().unwrap().outcome = Some(Err("background.paused".into()));
    assert!(
        matches!(group.admit_waiter(&jobs,"metadata-first",&first),Err(code) if code=="background.paused")
    );
    assert!(jobs.poll("metadata-first").is_err());
    // A queued metadata waiter never occupies a foreground Jobs slot.
    assert!(jobs.begin("foreground-operation", 1).is_ok());
}
#[test]
fn a_cache_hit_returns_the_same_normalized_fields() {
    let source = stamp();
    let bytes = serde_json::to_vec(&info_for(&source)).unwrap();
    let info = parse_cached(&bytes, &source).unwrap();
    assert_eq!(info.fields, info_for(&source).fields);
    assert!(!info.partial);
}
#[test]
fn malformed_or_stale_cache_never_reaches_the_ui() {
    let source = stamp();
    assert!(parse_cached(b"{not json", &source).is_none());
    assert!(parse_cached(&vec![b'x'; MAX_CACHED_BYTES as usize + 1], &source).is_none());
    let unknown=serde_json::to_vec(&serde_json::json!({"source":source,"fields":[{"id":"not_a_fact","value":{"kind":"text","value":"x"}}]})).unwrap();
    assert!(parse_cached(&unknown, &source).is_none());
}
#[test]
fn releasing_the_last_consumer_cancels_the_group() {
    let (consumers, group, _, _) = joined();
    consumers.release(Uuid::from_u128(1));
    assert!(!group.all_cancelled());
    consumers.release(Uuid::from_u128(2));
    assert!(group.all_cancelled());
}
#[test]
fn an_unknown_consumer_release_is_idempotent() {
    let consumers = consumers::Consumers::default();
    let id = Uuid::new_v4();
    consumers.release(id);
    consumers.release(id);
    assert!(matches!(consumers.register(id),Err(code)if code=="background.cancelled"));
}
#[test]
fn late_registration_receives_the_completed_outcome() {
    let (_, group, first, _) = joined();
    let jobs = Jobs::default();
    {
        let mut state = group.state.lock().unwrap();
        state.admitted = true;
        state.outcome = Some(Ok(info_for(&stamp())));
    }
    let result = group
        .admit_waiter(&jobs, "metadata-first", &first)
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(result.fields.len(), 1);
}
#[test]
fn a_released_follower_does_not_cancel_the_live_leader() {
    let (consumers, group, _, _) = joined();
    consumers.release(Uuid::from_u128(2));
    assert!(!group.all_cancelled());
}
