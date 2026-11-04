use super::*;

fn request(mime: CaptureMime) -> EncodeRequest {
    EncodeRequest {
        mime,
        width: 4,
        height: 3,
        quality: 90,
        background_rgba: [255, 255, 255, 255],
        metadata_keep: true,
        source_has_icc: false,
        accepted_metadata_loss: false,
    }
}

#[test]
fn snapshot_encoded_not_rgba() {
    let plan = plan_encode(&request(CaptureMime::Png)).unwrap();
    assert_eq!(plan.payload_kind, PayloadKind::Encoded);
    assert_eq!(plan.max_encoded_bytes, 256 * 1024 * 1024);
    let encoded = encode_rgba(&request(CaptureMime::Png), &[255u8; 4 * 3 * 4]).unwrap();
    assert!(encoded.starts_with(&[0x89, b'P', b'N', b'G']));
    assert_ne!(encoded.len(), 4 * 3 * 4);
}

#[test]
fn exceeds_256mib_refused_before_publish() {
    assert_eq!(
        validate_encoded_length(257 * 1024 * 1024).unwrap_err(),
        "snapshots.too_large"
    );
    assert!(validate_encoded_length(256 * 1024 * 1024).is_ok());
}

#[test]
fn jpeg_alpha_background_explicit() {
    let plan = plan_encode(&request(CaptureMime::Jpeg)).unwrap();
    assert!(!plan.alpha_preserved);
    assert_eq!(plan.background, Some([255, 255, 255, 255]));
    let mut rgba = Vec::new();
    for index in 0..(4 * 3) {
        rgba.extend_from_slice(&[255, 0, 0, if index % 2 == 0 { 0 } else { 255 }]);
    }
    let encoded = encode_rgba(&request(CaptureMime::Jpeg), &rgba).unwrap();
    assert!(encoded.starts_with(&[0xff, 0xd8]));
}

#[test]
fn icc_keep_or_lossack() {
    let mut kept = request(CaptureMime::Png);
    kept.source_has_icc = true;
    let plan = plan_encode(&kept).unwrap();
    assert!(plan.icc_preserved);
    assert_eq!(plan.mime.as_str(), "image/png");

    let mut lossy = kept.clone();
    lossy.metadata_keep = false;
    assert_eq!(
        plan_encode(&lossy).unwrap_err(),
        "convert.metadata_loss"
    );
    lossy.accepted_metadata_loss = true;
    let plan = plan_encode(&lossy).unwrap();
    assert!(!plan.icc_preserved);
    assert!(plan.metadata_loss_accepted);
}

#[test]
fn jpeg_source_png_capture_authorized() {
    // The source format is descriptive; a JPEG source may capture PNG.
    let capture = plan_encode(&request(CaptureMime::Png)).unwrap();
    assert_eq!(capture.mime, CaptureMime::Png);
    assert!(capture.alpha_preserved);
}

#[test]
fn unavailable_encoder_mime_refused() {
    assert_eq!(
        CaptureMime::parse("image/avif").unwrap_err(),
        "image_edit.bad_request"
    );
    assert_eq!(
        CaptureMime::parse("image/tiff").unwrap_err(),
        "image_edit.bad_request"
    );
}

#[test]
fn encode_r_edit_rplus1_preserves_capture_r() {
    let policy = commit_policy(SaveMode::Save, 7, 9);
    assert!(policy.marks_clean);
    assert!(!policy.rebinds_source);
}

#[test]
fn savecopy_notclean() {
    let copy = commit_policy(SaveMode::Copy, 7, 9);
    assert!(!copy.marks_clean);
    assert!(!copy.rebinds_source);
    let save = commit_policy(SaveMode::Save, 7, 9);
    assert!(save.marks_clean);
    assert!(!save.rebinds_source);
    let stale = commit_policy(SaveMode::Save, 10, 9);
    assert!(!stale.marks_clean);
}

#[test]
fn native_plan_never_claims_metadata_preservation() {
    let request = ImageEncodePlanRequest {
        mime: "image/png".to_string(),
        width: 4,
        height: 3,
        quality: 90,
        background_rgba: [255, 255, 255, 255],
        source_has_icc: true,
        accepted_metadata_loss: true,
    };
    let policy = native_policy(&request).unwrap();
    assert!(!policy.icc_preserved);
    assert!(policy.metadata_kept.is_empty());
    assert_eq!(policy.metadata_lost, vec!["icc".to_string()]);
    assert!(policy.metadata_loss_accepted);
    assert_eq!(policy.payload_kind, "encoded");
    assert_eq!(policy.max_encoded_bytes, MAX_SNAPSHOT_BYTES);

    let refused = ImageEncodePlanRequest {
        accepted_metadata_loss: false,
        ..request
    };
    assert_eq!(
        native_policy(&refused).unwrap_err(),
        "convert.metadata_loss"
    );
}

#[test]
fn native_plan_without_metadata_keeps_alpha_policy() {
    let request = ImageEncodePlanRequest {
        mime: "image/jpeg".to_string(),
        width: 4,
        height: 3,
        quality: 90,
        background_rgba: [10, 20, 30, 255],
        source_has_icc: false,
        accepted_metadata_loss: false,
    };
    let policy = native_policy(&request).unwrap();
    assert!(!policy.alpha_preserved);
    assert_eq!(policy.background, Some([10, 20, 30, 255]));
    assert!(!policy.icc_preserved);
    assert!(policy.metadata_lost.is_empty());
}

#[test]
fn png_alpha_is_preserved_for_transparent_pixels() {
    let plan = plan_encode(&request(CaptureMime::Png)).unwrap();
    assert!(plan.alpha_preserved);
    assert!(plan.background.is_none());
    let rgba = [10u8, 20, 30, 0].repeat(4 * 3);
    let encoded = encode_rgba(&request(CaptureMime::Png), &rgba).unwrap();
    assert!(encoded.len() > 8);
}


