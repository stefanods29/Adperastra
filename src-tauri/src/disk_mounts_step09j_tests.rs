//! Lifecycle tests for `disk_mounts` (Step 09j T2). The fake host keeps
//! every Windows call out of the test while exercising the real registry.
#![allow(dead_code)]


use super::{AttachOutcome, DiskHost, DiskMounts, MountHandle};
use crate::disk_image_types::{MountRequest, MountState};
use fs_service::{new_cancellation_token, CancellationToken, SourceStamp};

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

pub(crate) fn stamp(index: u32) -> SourceStamp {
    SourceStamp {
        path_key: format!(r"C:\images\disk-{index}.iso"),
        volume_id: "00112233".to_string(),
        file_id: format!("00112233445566{index:02x}"),
        modified_ticks: format!("{}", 100 + index),
        size_bytes: 4096,
    }
}

enum Script {
    Attached { roots: Vec<String>, cancel: bool },
    External { roots: Vec<String> },
    NeedsElevation,
    Failed(&'static str),
}

struct FakeHandle {
    detaches: Arc<AtomicUsize>,
}

impl MountHandle for FakeHandle {
    fn detach(&mut self) -> Result<(), String> {
        self.detaches.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

struct FakeState {
    stamps: VecDeque<SourceStamp>,
    scripts: VecDeque<Script>,
    attach_calls: usize,
    docs: Vec<String>,
}

struct FakeHost {
    state: Mutex<FakeState>,
    detaches: Arc<AtomicUsize>,
}

impl FakeHost {
    fn new(stamps: Vec<SourceStamp>, scripts: Vec<Script>) -> Arc<Self> {
        Arc::new(FakeHost {
            state: Mutex::new(FakeState {
                stamps: stamps.into(),
                scripts: scripts.into(),
                attach_calls: 0,
                docs: Vec::new(),
            }),
            detaches: Arc::new(AtomicUsize::new(0)),
        })
    }

    fn attach_calls(&self) -> usize {
        self.state.lock().unwrap().attach_calls
    }

    fn detaches(&self) -> usize {
        self.detaches.load(Ordering::Relaxed)
    }

    fn set_docs(&self, docs: Vec<String>) {
        self.state.lock().unwrap().docs = docs;
    }
}

impl DiskHost for FakeHost {
    fn capture_stamp(&self, _path: &Path) -> Result<SourceStamp, String> {
        self.state
            .lock()
            .unwrap()
            .stamps
            .pop_front()
            .ok_or_else(|| "disk.changed".to_string())
    }

    fn classify(&self, _path: &Path) -> Result<crate::disk_image_types::DiskImageKind, String> {
        Ok(crate::disk_image_types::DiskImageKind::Iso)
    }

    fn attach(
        &self,
        _path: &Path,
        _kind: crate::disk_image_types::DiskImageKind,
        _stamp: &SourceStamp,
        _allow_elevation: bool,
        token: &CancellationToken,
        _progress: &mut dyn FnMut(u64),
    ) -> AttachOutcome {
        let mut state = self.state.lock().unwrap();
        state.attach_calls += 1;
        let script = state
            .scripts
            .pop_front()
            .unwrap_or(Script::Failed("disk.unavailable"));
        match script {
            Script::Attached { roots, cancel } => {
                if cancel {
                    token.store(true, Ordering::Relaxed);
                }
                AttachOutcome::Attached {
                    handle: Box::new(FakeHandle {
                        detaches: self.detaches.clone(),
                    }),
                    physical_path: r"\\.\PhysicalDrive9".to_string(),
                    volume_roots: roots,
                    brokered: false,
                }
            }
            Script::External { roots } => AttachOutcome::External {
                physical_path: r"\\.\PhysicalDrive9".to_string(),
                volume_roots: roots,
            },
            Script::NeedsElevation => AttachOutcome::NeedsElevation,
            Script::Failed(code) => AttachOutcome::Failed(code.to_string()),
        }
    }

    fn documents_under(&self, _roots: &[String]) -> Vec<String> {
        self.state.lock().unwrap().docs.clone()
    }
}

fn request(path: &str) -> MountRequest {
    MountRequest {
        path: path.to_string(),
        expected: None,
        readonly: true,
        allow_elevation: false,
    }
}

fn mount(
    mounts: &DiskMounts,
    request: &MountRequest,
) -> Result<crate::disk_image_types::MountResult, String> {
    let token = new_cancellation_token();
    mounts.mount(request, &token, &mut |_| {})
}

#[test]
fn a_changed_source_is_never_mounted() {
    let expected = stamp(1);
    let mut before = expected.clone();
    before.modified_ticks = "999".to_string();
    let host = FakeHost::new(
        vec![before],
        vec![Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: false,
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let mut mount_request = request(r"C:\images\disk-1.iso");
    mount_request.expected = Some(expected);
    let result = mount(&mounts, &mount_request).unwrap();
    assert!(result.mount.is_none());
    assert_eq!(result.error_code.as_deref(), Some("disk.changed"));
    assert_eq!(host.attach_calls(), 0);
}

#[test]
fn a_source_that_changes_during_attach_is_detached() {
    let first = stamp(1);
    let mut second = first.clone();
    second.modified_ticks = "999".to_string();
    let host = FakeHost::new(
        vec![first, second],
        vec![Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: false,
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let result = mount(&mounts, &request(r"C:\images\disk-1.iso")).unwrap();
    assert!(result.mount.is_none());
    assert_eq!(result.error_code.as_deref(), Some("disk.changed"));
    assert_eq!(host.attach_calls(), 1);
    assert_eq!(host.detaches(), 1);
    assert!(mounts.list().unwrap().is_empty());
}

#[test]
fn the_actual_volume_root_is_used() {
    let host = FakeHost::new(
        vec![stamp(1), stamp(1)],
        vec![Script::Attached {
            roots: vec![r"Q:\".to_string()],
            cancel: false,
        }],
    );
    let mounts = DiskMounts::new(host);
    let result = mount(&mounts, &request(r"C:\images\disk-1.iso")).unwrap();
    let image = result.mount.expect("mounted");
    assert_eq!(image.volume_roots, [r"Q:\".to_string()]);
    assert!(image.readonly);
    assert!(image.owned);
}

#[test]
fn ten_app_mounts_at_most() {
    // Each attach reads the source before and after; both reads must
    // describe the same image.
    let mut stamps = Vec::new();
    for index in 0..30 {
        stamps.push(stamp(index));
        stamps.push(stamp(index));
    }
    let scripts = (0..30)
        .map(|_| Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: false,
        })
        .collect();
    let host = FakeHost::new(stamps, scripts);
    let mounts = DiskMounts::new(host.clone());
    for index in 0..10 {
        let request = request(&format!(r"C:\images\disk-{index}.iso"));
        let result = mount(&mounts, &request).unwrap();
        assert!(result.mount.is_some(), "mount {index}");
    }
    let result = mount(&mounts, &request(r"C:\images\disk-29.iso")).unwrap();
    assert!(result.mount.is_none());
    assert_eq!(result.error_code.as_deref(), Some("disk.unavailable"));
    assert_eq!(mounts.owned_mounts().unwrap(), 10);
    assert_eq!(host.attach_calls(), 10);
}

#[test]
fn an_external_mount_is_reported_but_never_detached() {
    let host = FakeHost::new(
        vec![stamp(1)],
        vec![Script::External {
            roots: vec![r"G:\".to_string()],
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let result = mount(&mounts, &request(r"C:\images\disk-1.iso")).unwrap();
    let image = result.mount.expect("external mount is reported");
    assert!(!image.owned);
    assert_eq!(image.volume_roots, [r"G:\".to_string()]);
    let error = mounts.eject(&image.mount_id).unwrap_err();
    assert_eq!(error, "disk.denied");
    assert_eq!(host.detaches(), 0);
    assert_eq!(mounts.list().unwrap().len(), 1);
}

#[test]
fn open_documents_keep_the_mount_listed() {
    let host = FakeHost::new(
        vec![stamp(1), stamp(1), stamp(1), stamp(1)],
        vec![Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: false,
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let image = mount(&mounts, &request(r"C:\images\disk-1.iso"))
        .unwrap()
        .mount
        .unwrap();
    host.set_docs(vec![r"F:\notes.txt".to_string()]);
    assert_eq!(mounts.eject(&image.mount_id).unwrap_err(), "disk.in_use");
    assert_eq!(host.detaches(), 0);
    let listed = mounts.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].state, MountState::InUse);

    host.set_docs(Vec::new());
    assert!(mounts.eject(&image.mount_id).unwrap().ejected);
    assert_eq!(host.detaches(), 1);
    assert!(mounts.list().unwrap().is_empty());
}

#[test]
fn a_cancel_after_attach_leaves_no_orphan_handle() {
    let host = FakeHost::new(
        vec![stamp(1)],
        vec![Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: true,
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let token = new_cancellation_token();
    let result = mounts.mount(
        &request(r"C:\images\disk-1.iso"),
        &token,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(result.error_code.as_deref(), Some("disk.cancelled"));
    assert_eq!(host.detaches(), 1);
    assert!(mounts.list().unwrap().is_empty());
}

#[test]
fn the_same_image_reuses_its_mount() {
    let source = stamp(1);
    let host = FakeHost::new(
        vec![source.clone(), source.clone(), source.clone()],
        vec![Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: false,
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let first = mount(&mounts, &request(r"C:\images\disk-1.iso"))
        .unwrap()
        .mount
        .unwrap();
    let second = mount(&mounts, &request(r"C:\images\disk-1.iso"))
        .unwrap()
        .mount
        .unwrap();
    assert_eq!(first.mount_id, second.mount_id);
    assert_eq!(host.attach_calls(), 1);
}

#[test]
fn eject_refuses_a_changed_source_and_keeps_the_mount() {
    let source = stamp(1);
    let mut changed = source.clone();
    changed.size_bytes += 1;
    let host = FakeHost::new(
        vec![source.clone(), source, changed],
        vec![Script::Attached {
            roots: vec![r"F:\".to_string()],
            cancel: false,
        }],
    );
    let mounts = DiskMounts::new(host.clone());
    let image = mount(&mounts, &request(r"C:\images\disk-1.iso"))
        .unwrap()
        .mount
        .unwrap();
    assert_eq!(mounts.eject(&image.mount_id).unwrap_err(), "disk.changed");
    assert_eq!(host.detaches(), 0);
    assert_eq!(mounts.list().unwrap()[0].state, MountState::Error);
}

#[test]
fn eject_denies_an_unknown_identifier() {
    let host = FakeHost::new(Vec::new(), Vec::new());
    let mounts = DiskMounts::new(host);
    assert_eq!(
        mounts.eject("not-a-uuid").unwrap_err(),
        "disk.denied"
    );
    assert_eq!(
        mounts
            .eject("6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a")
            .unwrap_err(),
        "disk.denied"
    );
}

#[test]
fn a_cancel_before_attach_never_opens_the_image() {
    let host = FakeHost::new(vec![stamp(1)], Vec::new());
    let mounts = DiskMounts::new(host.clone());
    let token = new_cancellation_token();
    token.store(true, Ordering::Relaxed);
    let result = mounts
        .mount(&request(r"C:\images\disk-1.iso"), &token, &mut |_| {})
        .unwrap();
    assert_eq!(result.error_code.as_deref(), Some("disk.cancelled"));
    assert_eq!(host.attach_calls(), 0);
    assert!(mounts.list().unwrap().is_empty());
}
