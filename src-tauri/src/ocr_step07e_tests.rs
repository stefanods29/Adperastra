//! Native tests for Step 07e (interface `ocr-1`).
//!
//! These are unit/integration tests over the pure parts of the OCR service:
//! language priority, bounds, chunking, cache keys, identity retention and
//! the completion gate. No test starts the Windows recogniser, reads a
//! personal file or writes outside a temporary directory. The coordinator
//! runs them; this file only records what is expected.

use fs_service::SourceStamp;
use tempfile::tempdir;

use crate::ocr_cache;
use crate::ocr_jobs::{complete_recognition, expired, LeaseRelease, RetainedPages};
use crate::ocr_languages::{select_language, LanguageError};
use crate::ocr_pdf::{ensure_identity_unchanged, is_sensitive, may_cache, should_use_native_text};
use crate::ocr_pixels::downscale_target;
use crate::ocr_types::{
    page_chunk, reading_text, validate_ocr_request, OcrInput, OcrLanguage, OcrPage, OcrRequest,
    OcrWord, ERR_BAD_REQUEST, ERR_CANCELLED, ERR_CHANGED, ERR_LANGUAGE_MISSING, OCR_RETAIN_SECONDS,
};
use crate::pdf_types::PdfSourceIdentity;

pub(crate) fn test_stamp() -> SourceStamp {
    SourceStamp {
        path_key: r"c:\test\source.png".to_string(),
        volume_id: "0011aabb".to_string(),
        file_id: "00112233445566aa".to_string(),
        modified_ticks: "133000000000000000".to_string(),
        size_bytes: 1_234,
    }
}

fn language(tag: &str, name: &str) -> OcrLanguage {
    OcrLanguage {
        tag: tag.to_string(),
        name: name.to_string(),
        available: true,
    }
}

fn sample_page() -> OcrPage {
    let words = vec![
        OcrWord {
            text: "Hello".to_string(),
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
            line: 0,
            order: 0,
        },
        OcrWord {
            text: "123".to_string(),
            x: 5.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
            line: 0,
            order: 1,
        },
    ];
    OcrPage {
        source: PdfSourceIdentity::Disk {
            stamp: test_stamp(),
        },
        page: 1,
        language: "en-US".to_string(),
        original_width: 4000,
        original_height: 2000,
        recognized_width: 1000,
        recognized_height: 500,
        words: words.clone(),
        text: reading_text(&words),
        partial: false,
        next_word: None,
        rotation: 0,
        text_angle: None,
    }
}

#[test]
fn language_priority_matches_the_plan() {
    let installed = [
        language("en-US", "English (United States)"),
        language("es-ES", "Spanish (Spain)"),
    ];
    assert_eq!(
        select_language("auto", "es", &installed, None),
        Ok("es-ES".to_string())
    );
    assert_eq!(
        select_language("auto", "en", &installed, None),
        Ok("en-US".to_string())
    );
}

#[test]
fn an_unrelated_installed_language_is_not_chosen() {
    let installed = [language("es-ES", "Spanish (Spain)")];
    assert_eq!(
        select_language("auto", "en", &installed, None),
        Err(LanguageError::Missing)
    );
    assert_eq!(
        select_language("auto", "en", &installed, Some("es-ES")),
        Err(LanguageError::Missing)
    );
    assert_eq!(
        select_language("fr-FR", "en", &installed, None),
        Err(LanguageError::Missing)
    );
    assert_eq!(LanguageError::Missing.code(), ERR_LANGUAGE_MISSING);
}

#[test]
fn invalid_language_tags_are_refused() {
    let installed = [language("en-US", "English")];
    assert_eq!(
        select_language("not a tag!", "en", &installed, None),
        Err(LanguageError::BadRequest)
    );
}

#[test]
fn a_large_image_is_downscaled_to_the_4096_edge() {
    assert_eq!(
        downscale_target(10_000, 5_000, 4_096, 16_777_216),
        Ok((4_096, 2_048))
    );
    assert!(downscale_target(0, 5_000, 4_096, 16_777_216).is_err());
    assert!(downscale_target(10_000, 0, 4_096, 16_777_216).is_err());
}

#[test]
fn the_character_limit_is_explicit_partial() {
    let payload = crate::ocr_windows::assemble_payload(
        &[crate::ocr_windows::RawLine {
            words: (0..250)
                .map(|_| crate::ocr_windows::RawWord {
                    text: "x".repeat(2_500),
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 5.0,
                })
                .collect(),
        }],
        "en-US",
        100,
        50,
        None,
    );
    assert!(payload.partial);
    assert!(payload.text.chars().count() <= crate::ocr_types::MAX_OCR_TEXT_CHARS);
}

#[test]
fn page_chunks_are_bounded_and_concatenate() {
    let words: Vec<OcrWord> = (0..20_000)
        .map(|index| OcrWord {
            text: format!("w{index}"),
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            line: index / 9,
            order: index,
        })
        .collect();
    let mut page = sample_page();
    page.words = words.clone();
    page.text = reading_text(&words);
    let mut collected = String::new();
    let mut cursor = None;
    loop {
        let chunk = page_chunk(&page, cursor).expect("chunk");
        assert!(serde_json::to_vec(&chunk).unwrap().len() <= crate::ocr_types::MAX_OCR_CHUNK_BYTES);
        collected.push_str(&chunk.text);
        match chunk.next_word {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    assert_eq!(collected, page.text);
}

#[test]
fn cache_keys_differ_by_language_and_page() {
    assert_ne!(
        ocr_cache::options_key("en-US", 0, 1, 4_096, "raster"),
        ocr_cache::options_key("es-ES", 0, 1, 4_096, "raster")
    );
    assert_ne!(
        ocr_cache::options_key("en-US", 0, 1, 4_096, "raster"),
        ocr_cache::options_key("en-US", 0, 2, 4_096, "raster")
    );
}

#[test]
fn a_rendered_cache_round_trip_is_a_valid_page() {
    let directory = tempdir().unwrap();
    let grants = std::sync::Arc::new(crate::files::FileGrants::default());
    let cache = crate::cache::CacheService::new(directory.path().to_path_buf(), grants);
    let key = ocr_cache::cache_key(&test_stamp(), "en-US", 0, 1, 4_096, "raster");
    let page = sample_page();
    ocr_cache::publish(&cache, &key, &page).unwrap();
    let hit = ocr_cache::lookup(&cache, &key).unwrap();
    assert_eq!(hit.text, "Hello 123");
    assert_eq!(hit.source, page.source);

    // A malformed blob is a miss, never a UI result.
    let record = cache.lookup(&key).unwrap().unwrap();
    let blob = directory
        .path()
        .join("cache")
        .join("blobs")
        .join(format!("{}.png", record.blob_id));
    let broken = vec![b'{'; record.byte_len as usize];
    std::fs::write(&blob, broken).unwrap();
    assert!(ocr_cache::lookup(&cache, &key).is_none());
}

#[test]
fn native_text_present_avoids_automatic_ocr() {
    assert!(should_use_native_text(Some("Selectable")));
    assert!(!should_use_native_text(Some("  ")));
    assert!(!should_use_native_text(None));
}

#[test]
fn a_released_session_cannot_open_a_foreign_page() {
    let retained = RetainedPages::default();
    retained
        .insert("11111111-1111-4111-8111-111111111111", sample_page())
        .unwrap();
    assert!(retained
        .page("11111111-1111-4111-8111-111111111111", None)
        .is_ok());
    retained.release("11111111-1111-4111-8111-111111111111");
    assert!(retained
        .page("11111111-1111-4111-8111-111111111111", None)
        .is_err());
    assert!(retained
        .page("22222222-2222-4222-8222-222222222222", None)
        .is_err());
}

#[test]
fn cancelling_releases_the_pdf_image_lease() {
    let released = std::cell::RefCell::new(Vec::new());
    {
        let mut lease = LeaseRelease::new("lease-7".to_string(), |id: &str| {
            released.borrow_mut().push(id.to_string());
        });
        // Simulate cancellation after reading the page image.
        lease.release_now();
    }
    assert_eq!(released.borrow().as_slice(), ["lease-7"]);
}

#[test]
fn snapshot_identity_passes_unchanged() {
    let identity = PdfSourceIdentity::Snapshot {
        document_id: "draft-1".to_string(),
        revision: 4,
        content_id: uuid::Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap(),
        sensitive: true,
    };
    assert!(ensure_identity_unchanged(&identity, &identity).is_ok());
    let mut changed = identity.clone();
    if let PdfSourceIdentity::Snapshot { revision, .. } = &mut changed {
        *revision += 1;
    }
    assert_eq!(
        ensure_identity_unchanged(&identity, &changed),
        Err(ERR_CHANGED.to_string())
    );
    assert!(is_sensitive(&identity));
    assert!(!may_cache(&identity));
}

#[test]
fn a_timeout_publishes_nothing_and_keeps_the_source() {
    let mut published = 0;
    let outcome = complete_recognition(
        Err(ERR_CANCELLED.to_string()),
        || Ok(()),
        |_| {
            published += 1;
            Ok(())
        },
    );
    assert_eq!(outcome.err().as_deref(), Some(ERR_CANCELLED));
    assert_eq!(published, 0);
}

#[test]
fn a_changed_source_is_rejected_before_publication() {
    let mut published = 0;
    let outcome = complete_recognition(
        Ok(sample_page()),
        || Err(ERR_CHANGED.to_string()),
        |_| {
            published += 1;
            Ok(())
        },
    );
    assert_eq!(outcome.err().as_deref(), Some(ERR_CHANGED));
    assert_eq!(published, 0);
}

#[test]
fn malformed_requests_are_refused() {
    let base = OcrRequest {
        input: OcrInput::Image {
            path: r"C:\Pictures\a.png".to_string(),
        },
        language: "auto".to_string(),
        consumer_id: "44444444-4444-4444-8444-444444444444".to_string(),
        rotation: 0,
        request_revision: 1,
    };
    assert!(validate_ocr_request(&base).is_ok());
    let mut bad_path = base.clone();
    bad_path.input = OcrInput::Image {
        path: r"Pictures\a.png".to_string(),
    };
    assert_eq!(
        validate_ocr_request(&bad_path),
        Err(ERR_BAD_REQUEST.to_string())
    );
    let mut bad_page = base.clone();
    bad_page.input = OcrInput::Pdf {
        session_id: "55555555-5555-4555-8555-555555555555".to_string(),
        page: 0,
    };
    assert_eq!(
        validate_ocr_request(&bad_page),
        Err(ERR_BAD_REQUEST.to_string())
    );
    let mut bad_rotation = base.clone();
    bad_rotation.rotation = 45;
    assert_eq!(
        validate_ocr_request(&bad_rotation),
        Err(ERR_BAD_REQUEST.to_string())
    );
}

#[test]
fn cloud_placeholders_are_never_read() {
    assert!(!crate::ocr_helper::file_is_local(true));
    assert!(crate::ocr_helper::file_is_local(false));
}

#[test]
fn retained_pages_expire_after_the_window() {
    let now = std::time::Instant::now();
    assert!(!expired(now, now));
    assert!(expired(
        now - std::time::Duration::from_secs(OCR_RETAIN_SECONDS + 1),
        now
    ));
}

#[test]
fn schema13_keeps_gallery_and_background_and_adds_auto_true() {
    let input = serde_json::json!({
        "schema_version": 13,
        "language": "es",
        "theme": { "mode": "dark" },
        "appearance": { "ui_scale": 125 },
        "gallery": {
            "sources": [{ "id": "66666666-6666-4666-8666-666666666666", "path": "C:\\Pictures", "include_subfolders": true }],
            "date_source": "taken"
        },
        "background": { "enabled": true, "only_idle": true, "paused": false },
        "cache": { "max_mb": 512 }
    });
    let migrated = crate::migrate(input).expect("schema 13 migrates");
    assert_eq!(migrated.language, "es");
    assert_eq!(migrated.theme.mode, "dark");
    let value = serde_json::to_value(&migrated).unwrap();
    assert!(value.get("gallery").is_some());
    assert!(value.get("background").is_some());
    assert!(value.get("cache").is_some());
    assert_eq!(value["ocr"]["language"], "auto");
    assert_eq!(value["ocr"]["enabled"], true);
    assert_eq!(migrated.schema_version, crate::CURRENT_SCHEMA);
}
