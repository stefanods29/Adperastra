//! Step 08c T3: selective, verified image cleaning with fixed fixtures.

use convert::MetadataCategory;
use fs_service::new_cancellation_token;
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::metadata::Metadata;
use little_exif::rational::uR64;
use privacy::image_fields::{extract_image, image_payload_hash, write_png_chunk};
use privacy::{clean_bytes, default_registry, effective_categories, inspect_bytes, PrivacyContext};

const ONE_PIXEL_PNG: &str = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636460f85f0f0002870180eb47ba920000000049454e44ae426082";

fn png_1x1() -> Vec<u8> {
    (0..ONE_PIXEL_PNG.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&ONE_PIXEL_PNG[index..index + 2], 16).unwrap())
        .collect()
}

fn add_xmp(png: &mut Vec<u8>) {
    let packet = br#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><rdf:Description dc:creator="Synthetic Author" xmp:CreateDate="2024-01-02"><dc:subject><rdf:Bag><rdf:li>keep-me</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF>"#;
    let mut body = b"XML:com.adobe.xmp\0\0\0\0\0".to_vec();
    body.extend_from_slice(packet);
    let mut chunks = Vec::new();
    let mut rebuilt = png.clone();
    write_png_chunk(&mut chunks, b"iTXt", &body);
    // Insert before IEND.
    let iend = rebuilt.len() - 12;
    let tail = rebuilt.split_off(iend);
    rebuilt.extend_from_slice(&chunks);
    rebuilt.extend_from_slice(&tail);
    *png = rebuilt;
}

fn add_icc(png: &mut Vec<u8>) {
    let mut chunk = Vec::new();
    write_png_chunk(&mut chunk, b"iCCP", b"synthetic\0\0profile");
    let iend = png.len() - 12;
    let tail = png.split_off(iend);
    png.extend_from_slice(&chunk);
    png.extend_from_slice(&tail);
}

fn with_exif(mut png: Vec<u8>, maker_note: bool) -> Vec<u8> {
    let mut metadata = Metadata::new();
    metadata.set_tag(ExifTag::Make("SyntheticCam".into()));
    metadata.set_tag(ExifTag::DateTimeOriginal("2024:01:02 03:04:05".into()));
    metadata.set_tag(ExifTag::Artist("Synthetic Author".into()));
    metadata.set_tag(ExifTag::Copyright("2024 Synthetic".into()));
    metadata.set_tag(ExifTag::ImageDescription("Synthetic place".into()));
    metadata.set_tag(ExifTag::GPSLatitudeRef("N".into()));
    metadata.set_tag(ExifTag::GPSLatitude(vec![uR64 {
        nominator: 51,
        denominator: 1,
    }]));
    if maker_note {
        metadata.set_tag(ExifTag::MakerNote(vec![1, 2, 3, 4]));
    }
    metadata
        .write_to_vec(
            &mut png,
            FileExtension::PNG {
                as_zTXt_chunk: false,
            },
        )
        .expect("synthetic png metadata");
    png
}

fn context() -> PrivacyContext {
    PrivacyContext::new(new_cancellation_token(), None, 1024 * 1024 * 1024)
}

fn fields_of(png: &[u8]) -> Vec<privacy::PrivacyField> {
    let registry = default_registry();
    let adapter = registry.get("image").unwrap();
    inspect_bytes(adapter, png, &mut context()).unwrap()
}

fn clean(
    png: &[u8],
    categories: &[MetadataCategory],
) -> Result<(Vec<u8>, privacy::PrivacyCleanSummary), privacy::PrivacyError> {
    let registry = default_registry();
    let adapter = registry.get("image").unwrap();
    let mut output = Vec::new();
    let summary = clean_bytes(adapter, png, categories, &mut output, &mut context())?;
    Ok((output, summary))
}

fn preview(fields: &[privacy::PrivacyField], category: MetadataCategory) -> Option<String> {
    fields
        .iter()
        .find(|field| field.category == category && !field.preview.is_empty())
        .map(|field| field.preview.clone())
}

#[test]
fn remove_gps_keeps_date_and_camera_exact_values() {
    let png = with_exif(png_1x1(), false);
    let before = fields_of(&png);
    let date = preview(&before, MetadataCategory::Date).expect("date");
    let camera = preview(&before, MetadataCategory::Camera).expect("camera");
    assert!(before
        .iter()
        .any(|field| field.category == MetadataCategory::Gps));
    let (cleaned, summary) = clean(&png, &[MetadataCategory::Gps]).unwrap();
    let after = fields_of(&cleaned);
    assert!(!after
        .iter()
        .any(|field| field.category == MetadataCategory::Gps));
    assert_eq!(preview(&after, MetadataCategory::Date), Some(date));
    assert_eq!(preview(&after, MetadataCategory::Camera), Some(camera));
    assert_eq!(
        image_payload_hash(privacy::image_fields::ImageFormat::Png, &png).unwrap(),
        image_payload_hash(privacy::image_fields::ImageFormat::Png, &cleaned).unwrap()
    );
    assert_eq!(summary.coverage, privacy::Coverage::Complete);
}

#[test]
fn remove_author_preserves_icc_and_pixels() {
    let mut png = with_exif(png_1x1(), false);
    add_xmp(&mut png);
    add_icc(&mut png);
    assert!(extract_image(&png).unwrap().icc.is_some());
    let (cleaned, _) = clean(&png, &[MetadataCategory::Author]).unwrap();
    assert!(extract_image(&cleaned).unwrap().icc.is_some());
    let after = fields_of(&cleaned);
    assert!(!after
        .iter()
        .any(|field| field.category == MetadataCategory::Author));
    assert!(after
        .iter()
        .any(|field| field.category == MetadataCategory::Date));
    assert_eq!(
        image_payload_hash(privacy::image_fields::ImageFormat::Png, &png).unwrap(),
        image_payload_hash(privacy::image_fields::ImageFormat::Png, &cleaned).unwrap()
    );
}

#[test]
fn unknown_maker_note_selected_fails_unverified() {
    let png = with_exif(png_1x1(), true);
    let before = fields_of(&png);
    let fields = before
        .iter()
        .map(|field| field.field_id.clone())
        .collect::<Vec<_>>();
    assert!(fields.iter().any(|id| id == "exif.927c"));
    let result = clean(&png, &[MetadataCategory::Camera]);
    assert!(matches!(result, Err(privacy::PrivacyError::Unverified)));
}

#[test]
fn whole_xmp_with_gps_and_author_discloses_both() {
    let mut png = with_exif(png_1x1(), false);
    add_xmp(&mut png);
    let before = fields_of(&png);
    let closure = effective_categories(&before, &[MetadataCategory::Xmp]).unwrap();
    assert!(closure.contains(&MetadataCategory::Author));
    assert!(closure.contains(&MetadataCategory::Comments));
    let (cleaned, _) = clean(&png, &[MetadataCategory::Xmp]).unwrap();
    assert!(extract_image(&cleaned).unwrap().xmp.is_none());
}
