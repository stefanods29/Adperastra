//! Payload validation tests (Step 09j T4/T5).

use super::{
    any_file_missing, build_item, hash_files, normalized_file, png_dimensions, preview_text,
    validate_files, validate_image, validate_text,
};
use crate::clipboard_history_types::{
    CapturedPayload, ClipboardHistorySource, MAX_FILE_PATHS, MAX_IMAGE_BYTES, MAX_TEXT_SCALARS,
};
use uuid::Uuid;

#[test]
fn text_is_bounded_by_scalars_and_bytes() {
    assert!(validate_text("hello").is_ok());
    assert_eq!(
        validate_text(&"a".repeat(MAX_TEXT_SCALARS + 1)),
        Err("clipboard_history.too_large".to_string())
    );
    // Four-byte scalars at the scalar cap are exactly the byte cap.
    assert!(validate_text(&"😀".repeat(MAX_TEXT_SCALARS)).is_ok());
    assert_eq!(
        validate_text(&"😀".repeat(MAX_TEXT_SCALARS + 1)),
        Err("clipboard_history.too_large".to_string())
    );
    assert_eq!(
        validate_text("bad\u{0}text"),
        Err("clipboard_history.invalid".to_string())
    );
}

#[test]
fn files_are_absolute_deduplicated_and_bounded() {
    let paths = vec![
        r"C:\Users\me\a.txt".to_string(),
        r"c:\users\me\A.TXT".to_string(),
        r"D:\b.txt".to_string(),
    ];
    let validated = validate_files(paths).unwrap();
    assert_eq!(validated.len(), 2);
    assert_eq!(normalized_file(r"\\?\C:\Users\Me\A.TXT"), r"c:\users\me\a.txt");

    assert_eq!(
        validate_files(vec!["relative.txt".to_string()]),
        Err("clipboard_history.invalid".to_string())
    );
    assert_eq!(
        validate_files(vec![r"C:\a\..\b.txt".to_string()]),
        Err("clipboard_history.invalid".to_string())
    );
    assert_eq!(
        validate_files((0..=MAX_FILE_PATHS).map(|i| format!(r"C:\f{i}.txt")).collect()),
        Err("clipboard_history.too_large".to_string())
    );
}

#[test]
fn images_are_bounded_by_pixels_and_bytes() {
    assert!(validate_image("image/png", 4000, 4000, &[1]).is_ok());
    assert_eq!(
        validate_image("image/png", 4000, 4001, &[1]),
        Err("clipboard_history.too_large".to_string())
    );
    assert_eq!(
        validate_image("image/png", 2, 2, &vec![0u8; MAX_IMAGE_BYTES + 1]),
        Err("clipboard_history.too_large".to_string())
    );
    assert_eq!(
        validate_image("text/plain", 2, 2, &[1]),
        Err("clipboard_history.invalid".to_string())
    );
    assert_eq!(
        validate_image("image/png", 0, 2, &[1]),
        Err("clipboard_history.invalid".to_string())
    );
}

#[test]
fn a_preview_is_escaped_and_two_lines_long() {
    let preview = preview_text("first line\r\nsecond\u{1} line\nthird");
    assert_eq!(preview, "first line\nsecond  line");
    let long = preview_text(&"x".repeat(2000));
    assert_eq!(long.chars().count(), 512);
}

#[test]
fn file_deduplication_ignores_order_and_case() {
    let first = vec![r"C:\a.txt".to_string(), r"D:\B.txt".to_string()];
    let second = vec![r"d:\b.txt".to_string(), r"c:\A.TXT".to_string()];
    assert_eq!(hash_files(&first), hash_files(&second));
    assert_ne!(hash_files(&first), hash_files(&first[..1]));
}

#[test]
fn building_an_item_keeps_bytes_out_of_the_wire() {
    let item = build_item(
        Uuid::new_v4(),
        CapturedPayload::Text("hello\nworld".to_string()),
        ClipboardHistorySource::App,
        None,
        123,
    )
    .unwrap();
    assert_eq!(item.preview, "hello\nworld");
    assert_eq!(item.byte_len, 11);
    assert_eq!(item.kind, crate::clipboard_history_types::ClipboardHistoryKind::Text);
    let wire = serde_json::to_value(item.to_wire()).unwrap();
    assert!(wire.get("payload").is_none());
}

#[test]
fn missing_files_are_detected_without_network_checks() {
    let dir = tempfile::tempdir().unwrap();
    let present = dir.path().join("present.txt");
    std::fs::write(&present, b"x").unwrap();
    assert!(!any_file_missing(&[present.to_string_lossy().into_owned()]));
    assert!(any_file_missing(&[
        dir.path().join("missing.txt").to_string_lossy().into_owned()
    ]));
    // UNC paths are never probed.
    assert!(!any_file_missing(&[r"\\server\share\a.txt".to_string()]));
}

#[test]
fn png_dimensions_are_read_without_decoding() {
    let mut bytes = vec![0u8; 33];
    bytes[..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes[12..16].copy_from_slice(b"IHDR");
    bytes[16..20].copy_from_slice(&640u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&480u32.to_be_bytes());
    assert_eq!(png_dimensions(&bytes), Some((640, 480)));
    assert_eq!(png_dimensions(&bytes[..10]), None);
    bytes[0] = 0;
    assert_eq!(png_dimensions(&bytes), None);
}
