use super::*;
use crate::metadata_types::{MetadataFieldId, MetadataValue};
use fs_service::new_cancellation_token;
use std::cell::Cell;

struct FakeSource {
    width: Option<MetadataValue>,
    height: Option<MetadataValue>,
}

impl PropertySource for FakeSource {
    fn read(&self, field: MetadataFieldId) -> Option<MetadataValue> {
        match field {
            MetadataFieldId::Width => self.width.clone(),
            MetadataFieldId::Height => self.height.clone(),
            _ => None,
        }
    }
}

fn fixture(name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let path = dir.path().join(name);
    std::fs::write(&path, b"metadata test").expect("the fixture is written");
    (dir, path)
}

fn stamp_of(path: &Path) -> SourceStamp {
    fs_service::capture_source_stamp(path).expect("the fixture has a stamp")
}

#[test]
fn an_online_only_source_never_opens_the_store() {
    let (_dir, path) = fixture("cloud.jpg");
    let expected = stamp_of(&path);
    let opened = Cell::new(0);
    let result = read_metadata_with(
        &path,
        &expected,
        ONLINE_ONLY_MASK,
        |_| {
            opened.set(opened.get() + 1);
            Ok(FakeSource {
                width: Some(MetadataValue::Integer { value: 400 }),
                height: None,
            })
        },
        &new_cancellation_token(),
    );
    assert_eq!(result.err().as_deref(), Some("metadata.online_only"));
    assert_eq!(opened.get(), 0);
}

#[test]
fn a_reparse_source_is_refused_without_opening_it() {
    let (_dir, path) = fixture("link.jpg");
    let expected = stamp_of(&path);
    let opened = Cell::new(0);
    let result = read_metadata_with(
        &path,
        &expected,
        REPARSE_POINT,
        |_| {
            opened.set(opened.get() + 1);
            Ok(FakeSource {
                width: None,
                height: None,
            })
        },
        &new_cancellation_token(),
    );
    assert_eq!(result.err().as_deref(), Some("metadata.failed"));
    assert_eq!(opened.get(), 0);
}

#[test]
fn a_changed_source_is_refused_before_the_store_opens() {
    let (_dir, path) = fixture("changed.jpg");
    let mut expected = stamp_of(&path);
    expected.modified_ticks = "1".to_string();
    let opened = Cell::new(0);
    let result = read_metadata_with(
        &path,
        &expected,
        0,
        |_| {
            opened.set(opened.get() + 1);
            Ok(FakeSource {
                width: None,
                height: None,
            })
        },
        &new_cancellation_token(),
    );
    assert_eq!(result.err().as_deref(), Some("metadata.changed"));
    assert_eq!(opened.get(), 0);
}

#[test]
fn a_failed_property_keeps_the_available_fields() {
    let (_dir, path) = fixture("facts.jpg");
    let expected = stamp_of(&path);
    let info = read_metadata_with(
        &path,
        &expected,
        0,
        |_| {
            Ok(FakeSource {
                width: Some(MetadataValue::Integer { value: 400 }),
                // A present but invalid height must not become zero.
                height: Some(MetadataValue::Integer { value: 0 }),
            })
        },
        &new_cancellation_token(),
    )
    .expect("the read succeeds");
    assert_eq!(info.fields.len(), 1);
    assert_eq!(info.fields[0].id, MetadataFieldId::Width);
    assert_eq!(info.fields[0].value, MetadataValue::Integer { value: 400 });
    assert!(info.partial);
    assert_eq!(info.missing, vec![MetadataFieldId::Height]);
    assert!(crate::metadata_types::same_stamp(&info.source, &expected));
}

#[test]
fn a_cancelled_read_stops_between_fields() {
    let (_dir, path) = fixture("cancel.jpg");
    let expected = stamp_of(&path);
    let token = new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);
    let result = read_metadata_with(
        &path,
        &expected,
        0,
        |_| {
            Ok(FakeSource {
                width: Some(MetadataValue::Integer { value: 400 }),
                height: None,
            })
        },
        &token,
    );
    assert_eq!(result.err().as_deref(), Some("background.cancelled"));
}

#[cfg(windows)]
#[test]
fn a_source_cannot_be_swapped_or_written_while_the_store_opens() {
    let (_dir, path) = fixture("pinned.jpg");
    let expected = stamp_of(&path);
    let info = read_metadata_with(
        &path,
        &expected,
        0,
        |source| {
            assert!(std::fs::rename(source, source.with_extension("swapped")).is_err());
            assert!(std::fs::OpenOptions::new()
                .write(true)
                .open(source)
                .is_err());
            Ok(FakeSource {
                width: Some(MetadataValue::Integer { value: 200 }),
                height: None,
            })
        },
        &new_cancellation_token(),
    )
    .unwrap();
    assert_eq!(info.fields.len(), 1);
    assert_eq!(std::fs::read(path).unwrap(), b"metadata test");
}
