//! Security tests for the disk broker (Step 09j T3). The real named-pipe
//! fixture is coordinator-run; these tests cover the exact pure rules.
#![allow(clippy::assertions_on_constants, clippy::bool_assert_comparison)]


#[path = "template_copy_test_junction.rs"]
mod junction;

use super::{
    launch_cancelled, privileged_source_allowed, read_frame, run_session, valid_physical_path,
    valid_pipe_name, verify_peer, verify_reply, write_frame, BrokerHost, BrokerMountInfo,
    BrokerReply, BrokerRequest, PeerIdentity,
};
use crate::disk_image_types::MountRequest;
use fs_service::SourceStamp;
use std::io::Cursor;

fn identity(pid: u32, ticks: &str, sid: &str) -> PeerIdentity {
    PeerIdentity {
        pid,
        start_ticks: ticks.to_string(),
        sid: sid.to_string(),
    }
}

#[test]
fn the_wrong_peer_pid_is_denied() {
    let expected = identity(100, "1234", "S-1-5-21-1");
    assert_eq!(verify_peer(&expected, &expected), Ok(()));
    assert_eq!(
        verify_peer(&expected, &identity(101, "1234", "S-1-5-21-1")),
        Err("disk.denied".to_string())
    );
}

#[test]
fn the_wrong_peer_start_time_is_denied() {
    let expected = identity(100, "1234", "S-1-5-21-1");
    assert_eq!(
        verify_peer(&expected, &identity(100, "1235", "S-1-5-21-1")),
        Err("disk.denied".to_string())
    );
}

#[test]
fn the_wrong_peer_sid_is_denied() {
    let expected = identity(100, "1234", "S-1-5-21-1");
    assert_eq!(
        verify_peer(&expected, &identity(100, "1234", "S-1-5-21-2")),
        Err("disk.denied".to_string())
    );
    assert_eq!(
        verify_peer(&expected, &identity(0, "1234", "S-1-5-21-1")),
        Err("disk.denied".to_string())
    );
}

#[test]
fn uac_cancellation_is_a_clean_outcome() {
    assert!(launch_cancelled(1223));
    assert!(!launch_cancelled(5));
}

#[test]
fn malformed_parent_identity_is_denied() {
    let good = identity(100, "1234", "S-1-5-21-1");
    for broken in [
        identity(0, "1234", "S-1-5-21-1"),
        identity(100, "", "S-1-5-21-1"),
        identity(100, "12x4", "S-1-5-21-1"),
        identity(100, "1234", ""),
        identity(100, "1234", r"..\evil"),
    ] {
        assert_eq!(
            verify_peer(&broken, &good),
            Err("disk.denied".to_string())
        );
        assert_eq!(
            verify_peer(&good, &broken),
            Err("disk.denied".to_string())
        );
    }
}

#[test]
fn pipe_names_are_one_safe_component() {
    assert!(valid_pipe_name(
        "adp-disk-6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a"
    ));
    // The trailing UUID is the nonce: a short or fixed name has none.
    assert!(!valid_pipe_name("adp-disk-0f8a4b2c"));
    assert!(!valid_pipe_name("6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a"));
    assert!(!valid_pipe_name(""));
    assert!(!valid_pipe_name(r"..\evil"));
    assert!(!valid_pipe_name("a/b"));
    assert!(!valid_pipe_name(&"x".repeat(129)));
}

#[test]
fn network_sources_are_refused() {
    assert_eq!(
        privileged_source_allowed(std::path::Path::new(r"\\server\share\image.iso")),
        Err("disk.denied".to_string())
    );
}

#[cfg(windows)]
#[test]
fn protected_roots_are_refused() {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let path = std::path::Path::new(&root)
        .join("System32")
        .join("notepad.exe");
    assert_eq!(
        privileged_source_allowed(&path),
        Err("disk.denied".to_string())
    );
}

#[cfg(windows)]
#[test]
fn a_junction_source_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target");
    std::fs::create_dir(&target).unwrap();
    let link = dir.path().join("image.iso");
    junction::create(&link, &target).unwrap();
    assert_eq!(
        privileged_source_allowed(&link),
        Err("disk.denied".to_string())
    );
}

struct FakeHost {
    opens: usize,
    detaches: usize,
    result: Result<BrokerMountInfo, String>,
}

impl FakeHost {
    fn ok() -> Self {
        FakeHost {
            opens: 0,
            detaches: 0,
            result: Ok(BrokerMountInfo {
                physical_path: r"\\.\PhysicalDrive4".to_string(),
                volume_roots: vec![r"F:\".to_string()],
                readonly: true,
            }),
        }
    }
}

const MOUNT_ID: &str = "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a";

fn good_info() -> BrokerMountInfo {
    BrokerMountInfo {
        physical_path: r"\\.\PhysicalDrive4".to_string(),
        volume_roots: vec![r"F:\".to_string(), r"G:\".to_string()],
        readonly: true,
    }
}

fn reply(
    ok: bool,
    mount_id: Option<&str>,
    error: Option<&str>,
    mount: Option<BrokerMountInfo>,
) -> BrokerReply {
    BrokerReply {
        ok,
        mount_id: mount_id.map(str::to_string),
        error: error.map(str::to_string),
        mount,
    }
}

impl BrokerHost for FakeHost {
    fn open_readonly(
        &mut self,
        _mount_id: &str,
        _request: &MountRequest,
    ) -> Result<BrokerMountInfo, String> {
        self.opens += 1;
        self.result.clone()
    }

    fn detach(&mut self) -> Result<(), String> {
        self.detaches += 1;
        Ok(())
    }
}

fn image() -> tempfile::NamedTempFile {
    let file = tempfile::Builder::new().suffix(".iso").tempfile().unwrap();
    std::fs::write(file.path(), [0u8; 16]).unwrap();
    file
}

fn request(path: &std::path::Path) -> MountRequest {
    MountRequest {
        path: path.to_string_lossy().into_owned(),
        expected: Some(SourceStamp {
            path_key: path.to_string_lossy().to_ascii_lowercase().replace('/', "\\"),
            volume_id: "00112233".to_string(),
            file_id: "0011223344556677".to_string(),
            modified_ticks: "100".to_string(),
            size_bytes: 16,
        }),
        readonly: true,
        allow_elevation: false,
    }
}

fn frames(requests: &[BrokerRequest]) -> Cursor<Vec<u8>> {
    let mut bytes = Vec::new();
    for request in requests {
        write_frame(&mut bytes, &serde_json::to_vec(request).unwrap()).unwrap();
    }
    Cursor::new(bytes)
}

fn replies(writer: &[u8]) -> Vec<BrokerReply> {
    let mut reader = Cursor::new(writer.to_vec());
    let mut out = Vec::new();
    while let Ok(Some(frame)) = read_frame(&mut reader) {
        out.push(serde_json::from_slice(&frame).unwrap());
    }
    out
}

#[test]
fn a_second_mount_in_the_same_session_is_denied() {
    let first = image();
    let second = image();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[
        BrokerRequest::Mount {
            mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
            request: request(first.path()),
        },
        BrokerRequest::Mount {
            mount_id: "2b1c3d4e-5f60-4712-8a9b-0c1d2e3f4a5b".to_string(),
            request: request(second.path()),
        },
    ]);
    let mut writer = Vec::new();
    let error = run_session(&mut host, &mut reader, &mut writer).unwrap_err();
    assert_eq!(error, "disk.denied");
    assert_eq!(host.opens, 1);
    assert_eq!(host.detaches, 1);
    assert_eq!(replies(&writer)[0].ok, true);
    assert_eq!(replies(&writer)[1].ok, false);
}

#[test]
fn a_second_path_after_bind_is_denied() {
    let first = image();
    let other = image();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[
        BrokerRequest::Mount {
            mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
            request: request(first.path()),
        },
        BrokerRequest::Mount {
            mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
            request: request(other.path()),
        },
    ]);
    let mut writer = Vec::new();
    assert_eq!(
        run_session(&mut host, &mut reader, &mut writer),
        Err("disk.denied".to_string())
    );
    assert_eq!(host.opens, 1);
    assert_eq!(host.detaches, 1);
}

#[test]
fn eject_of_another_mount_is_denied() {
    let first = image();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[
        BrokerRequest::Mount {
            mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
            request: request(first.path()),
        },
        BrokerRequest::Eject {
            mount_id: "2b1c3d4e-5f60-4712-8a9b-0c1d2e3f4a5b".to_string(),
        },
    ]);
    let mut writer = Vec::new();
    assert_eq!(
        run_session(&mut host, &mut reader, &mut writer),
        Err("disk.denied".to_string())
    );
    assert_eq!(host.detaches, 1);
}

#[test]
fn eject_of_the_bound_mount_detaches_and_ends() {
    let first = image();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[
        BrokerRequest::Mount {
            mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
            request: request(first.path()),
        },
        BrokerRequest::Eject {
            mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        },
    ]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    assert_eq!(host.detaches, 1);
    assert_eq!(replies(&writer).len(), 2);
    assert!(replies(&writer)[1].ok);
}

#[test]
fn parent_disconnect_detaches_the_mount() {
    let first = image();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[BrokerRequest::Mount {
        mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        request: request(first.path()),
    }]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    assert_eq!(host.opens, 1);
    assert_eq!(host.detaches, 1);
}

#[test]
fn a_nonreadonly_request_never_reaches_the_host() {
    let first = image();
    let mut host = FakeHost::ok();
    let mut broken = request(first.path());
    broken.readonly = false;
    let mut reader = frames(&[BrokerRequest::Mount {
        mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        request: broken,
    }]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    assert_eq!(host.opens, 0);
    assert!(!replies(&writer)[0].ok);
}

#[test]
fn a_request_without_a_source_stamp_is_denied() {
    let first = image();
    let mut host = FakeHost::ok();
    let mut unstamped = request(first.path());
    unstamped.expected = None;
    let mut reader = frames(&[BrokerRequest::Mount {
        mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        request: unstamped,
    }]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    assert_eq!(host.opens, 0);
    assert!(!replies(&writer)[0].ok);
}

#[test]
fn a_request_outside_the_contract_never_reaches_the_host() {
    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("image.zip");
    std::fs::write(&zip, [0u8; 16]).unwrap();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[BrokerRequest::Mount {
        mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        request: request(&zip),
    }]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    assert_eq!(host.opens, 0);
    assert!(!replies(&writer)[0].ok);
}

#[test]
fn a_malformed_source_stamp_never_reaches_the_host() {
    let first = image();
    let mut stamp = request(first.path()).expected.unwrap();
    stamp.file_id = "00112233445566AA".to_string();
    let mut broken = request(first.path());
    broken.expected = Some(stamp);
    let mut host = FakeHost::ok();
    let mut reader = frames(&[BrokerRequest::Mount {
        mount_id: "6f7a4e59-6c1f-4f4f-9b0b-4b8f7f1d2e3a".to_string(),
        request: broken,
    }]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    assert_eq!(host.opens, 0);
    assert_eq!(replies(&writer)[0].error.as_deref(), Some("disk.changed"));
}

#[test]
fn out_of_bounds_broker_mount_info_is_refused() {
    for info in [
        BrokerMountInfo {
            physical_path: String::new(),
            volume_roots: vec![r"F:\".to_string()],
            readonly: true,
        },
        BrokerMountInfo {
            physical_path: r"\\.\PhysicalDrive4".to_string(),
            volume_roots: Vec::new(),
            readonly: true,
        },
        BrokerMountInfo {
            physical_path: r"\\.\PhysicalDrive4".to_string(),
            volume_roots: vec![r"F:\".to_string(); 17],
            readonly: true,
        },
        BrokerMountInfo {
            physical_path: r"\\.\PhysicalDrive4".to_string(),
            volume_roots: vec![r"F:".to_string()],
            readonly: true,
        },
        BrokerMountInfo {
            physical_path: r"C:\Users\stefa\image.iso".to_string(),
            volume_roots: vec![r"F:\".to_string()],
            readonly: true,
        },
        BrokerMountInfo {
            physical_path: "x".repeat(32_769),
            volume_roots: vec![r"F:\".to_string()],
            readonly: true,
        },
        BrokerMountInfo {
            physical_path: r"\\.\PhysicalDrive4".to_string(),
            volume_roots: vec![r"F:\".to_string()],
            readonly: false,
        },
    ] {
        let first = image();
        let mut host = FakeHost::ok();
        host.result = Ok(info);
        let mut reader = frames(&[BrokerRequest::Mount {
            mount_id: MOUNT_ID.to_string(),
            request: request(first.path()),
        }]);
        let mut writer = Vec::new();
        assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
        assert_eq!(host.opens, 1);
        let answers = replies(&writer);
        let answer = &answers[0];
        assert!(!answer.ok);
        assert_eq!(answer.mount_id.as_deref(), Some(MOUNT_ID));
    }
}

#[test]
fn broker_replies_echo_the_request_mount_id() {
    let first = image();
    let mut host = FakeHost::ok();
    let mut reader = frames(&[
        BrokerRequest::Mount {
            mount_id: MOUNT_ID.to_string(),
            request: request(first.path()),
        },
        BrokerRequest::Eject {
            mount_id: MOUNT_ID.to_string(),
        },
    ]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    let answers = replies(&writer);
    assert_eq!(answers.len(), 2);
    for answer in answers {
        assert!(answer.ok);
        assert!(answer.error.is_none());
        assert_eq!(answer.mount_id.as_deref(), Some(MOUNT_ID));
    }
    assert!(replies(&writer)[0].mount.is_some());
    assert!(replies(&writer)[1].mount.is_none());
}

#[test]
fn broker_error_replies_echo_the_request_mount_id() {
    let first = image();
    let mut broken = request(first.path());
    broken.readonly = false;
    let mut host = FakeHost::ok();
    let mut reader = frames(&[BrokerRequest::Mount {
        mount_id: MOUNT_ID.to_string(),
        request: broken,
    }]);
    let mut writer = Vec::new();
    assert_eq!(run_session(&mut host, &mut reader, &mut writer), Ok(()));
    let answers = replies(&writer);
    let answer = &answers[0];
    assert!(!answer.ok);
    assert_eq!(answer.mount_id.as_deref(), Some(MOUNT_ID));
    assert_eq!(answer.error.as_deref(), Some("disk.unsupported"));
    assert!(answer.mount.is_none());
}

#[test]
fn a_reply_for_another_request_is_refused() {
    assert_eq!(
        verify_reply(
            &BrokerReply::with_mount("2b1c3d4e-5f60-4712-8a9b-0c1d2e3f4a5b", good_info()),
            MOUNT_ID,
            true
        ),
        Err("disk.denied".to_string())
    );
    assert_eq!(
        verify_reply(&reply(true, None, None, Some(good_info())), MOUNT_ID, true),
        Err("disk.denied".to_string())
    );
    assert_eq!(
        verify_reply(&BrokerReply::with_mount("not-a-uuid", good_info()), "not-a-uuid", true),
        Err("disk.denied".to_string())
    );
    assert_eq!(
        verify_reply(&BrokerReply::with_mount(MOUNT_ID, good_info()), MOUNT_ID, true),
        Ok(())
    );
}

#[test]
fn a_reply_with_inconsistent_ok_and_error_is_refused() {
    let info = good_info();
    let long_code = "x".repeat(64);
    for answer in [
        // Success never carries an error, and an expected mount answer
        // always carries the mount.
        reply(true, Some(MOUNT_ID), Some("disk.denied"), Some(info.clone())),
        reply(true, Some(MOUNT_ID), None, None),
        // A failure carries one bounded disk.* code and never a mount.
        reply(false, Some(MOUNT_ID), None, None),
        reply(false, Some(MOUNT_ID), Some("disk.denied"), Some(info.clone())),
        reply(false, Some(MOUNT_ID), Some("i am not a code"), None),
        reply(false, Some(MOUNT_ID), Some(long_code.as_str()), None),
    ] {
        assert_eq!(
            verify_reply(&answer, MOUNT_ID, true),
            Err("disk.denied".to_string())
        );
    }
    assert_eq!(
        verify_reply(&BrokerReply::err(Some(MOUNT_ID), "disk.denied"), MOUNT_ID, true),
        Ok(())
    );
    assert_eq!(
        verify_reply(&BrokerReply::err(Some(MOUNT_ID), "disk.in_use"), MOUNT_ID, false),
        Ok(())
    );
    // An eject answer is a success without a mount and only for that id;
    // a replayed mount answer is never taken as an eject success.
    assert_eq!(
        verify_reply(&BrokerReply::ok(Some(MOUNT_ID)), MOUNT_ID, false),
        Ok(())
    );
    assert_eq!(
        verify_reply(&BrokerReply::with_mount(MOUNT_ID, good_info()), MOUNT_ID, false),
        Err("disk.denied".to_string())
    );
}

#[test]
fn a_mount_reply_must_be_readonly_with_bounded_roots() {
    let mut wrong = good_info();
    wrong.readonly = false;
    let mut empty = good_info();
    empty.volume_roots.clear();
    let mut many = good_info();
    many.volume_roots = vec![r"F:\".to_string(); 17];
    let mut bad_root = good_info();
    bad_root.volume_roots = vec![r"\\server\share".to_string()];
    for info in [wrong, empty, many, bad_root] {
        assert_eq!(
            verify_reply(&BrokerReply::with_mount(MOUNT_ID, info), MOUNT_ID, true),
            Err("disk.denied".to_string())
        );
    }
    assert_eq!(
        verify_reply(&BrokerReply::with_mount(MOUNT_ID, good_info()), MOUNT_ID, true),
        Ok(())
    );
}

#[test]
fn physical_paths_are_windows_device_paths() {
    for good in [
        r"\\.\PhysicalDrive0",
        r"\\.\CdRom3",
        r"\\?\PhysicalDrive12",
        r"\\.\physicaldrive7",
    ] {
        assert!(valid_physical_path(good), "{good}");
    }
    for bad in [
        "",
        r"C:\Users\stefa\image.iso",
        r"\\.\PhysicalDrive",
        r"\\.\PhysicalDrive4\extra",
        r"\\.\HarddiskVolume1",
        r"\\server\share",
        r"\\.\PhysicalDrive12345678901",
        r"\\.\CdRom3\",
    ] {
        assert!(!valid_physical_path(bad), "{bad}");
    }
}

#[test]
fn frames_are_bounded_and_reject_truncation() {
    let mut bytes = Vec::new();
    write_frame(&mut bytes, b"hello").unwrap();
    assert_eq!(
        read_frame(&mut Cursor::new(bytes)).unwrap(),
        Some(b"hello".to_vec())
    );

    let mut oversized = Vec::new();
    oversized.extend_from_slice(&(64 * 1024 + 1u32).to_le_bytes());
    assert_eq!(
        read_frame(&mut Cursor::new(oversized)).unwrap_err(),
        "disk.denied"
    );

    let mut zero = Vec::new();
    zero.extend_from_slice(&0u32.to_le_bytes());
    assert_eq!(read_frame(&mut Cursor::new(zero)).unwrap_err(), "disk.denied");

    let mut truncated = Vec::new();
    truncated.extend_from_slice(&4u32.to_le_bytes());
    truncated.extend_from_slice(b"ab");
    assert_eq!(
        read_frame(&mut Cursor::new(truncated)).unwrap_err(),
        "disk.denied"
    );

    let mut empty = Cursor::new(Vec::new());
    assert_eq!(read_frame(&mut empty).unwrap(), None);
}
