//! Step 12b T6: selective Office, media and archive cleaning.
//!
//! Every fixture is synthetic and built in memory. The tests assert that an
//! unselected category survives, that a content change is disclosed before it
//! is accepted, and that an unverifiable structure publishes nothing.

use std::io::{Cursor, Read, Write};

use convert::MetadataCategory;
use privacy::office::OfficePrivacyAdapter;
use privacy::registry::PrivacyAdapter;
use privacy::{Coverage, MetadataCount, PrivacyContext};

fn stored() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)
}

/// A DOCX with an author, a company, one comment and one tracked change pair.
fn fixture_docx() -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer.start_file("[Content_Types].xml", stored()).unwrap();
    writer
        .write_all(br#"<?xml version="1.0"?><Types/>"#)
        .unwrap();
    writer.start_file("docProps/core.xml", stored()).unwrap();
    writer
        .write_all(
            br#"<?xml version="1.0"?><cp:coreProperties
                 xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                 xmlns:dc="http://purl.org/dc/elements/1.1/"
                 xmlns:dcterms="http://purl.org/dc/terms/">
                 <dc:creator>Ada</dc:creator>
                 <cp:lastModifiedBy>Grace</cp:lastModifiedBy>
                 <dcterms:created>2024-01-02T03:04:05Z</dcterms:created>
               </cp:coreProperties>"#,
        )
        .unwrap();
    writer.start_file("docProps/app.xml", stored()).unwrap();
    writer
        .write_all(
            br#"<?xml version="1.0"?><Properties><Company>Example Inc</Company></Properties>"#,
        )
        .unwrap();
    writer.start_file("word/comments.xml", stored()).unwrap();
    writer
        .write_all(
            br#"<?xml version="1.0"?><w:comments><w:comment w:id="1"><w:p><w:r><w:t>Private</w:t></w:r></w:p></w:comment></w:comments>"#,
        )
        .unwrap();
    writer.start_file("word/document.xml", stored()).unwrap();
    writer
        .write_all(
            br#"<?xml version="1.0"?><w:document><w:body><w:p>
                 <w:ins w:id="1"><w:r><w:t>kept</w:t></w:r></w:ins>
                 <w:del w:id="2"><w:r><w:delText>removed</w:delText></w:r></w:del>
               </w:p></w:body></w:document>"#,
        )
        .unwrap();
    writer.finish().unwrap().into_inner()
}

fn context() -> PrivacyContext {
    PrivacyContext::for_test(64 * 1024 * 1024)
}

fn inspect(bytes: &[u8]) -> Vec<privacy::types::PrivacyField> {
    let mut cursor = Cursor::new(bytes.to_vec());
    let mut context = context();
    OfficePrivacyAdapter::new()
        .inspect(&mut cursor, &mut context)
        .expect("inspection succeeds")
}

fn clean(
    bytes: &[u8],
    categories: &[MetadataCategory],
) -> (Vec<u8>, privacy::types::PrivacyCleanSummary) {
    let mut cursor = Cursor::new(bytes.to_vec());
    let mut context = context();
    let mut output: Vec<u8> = Vec::new();
    let summary = OfficePrivacyAdapter::new()
        .clean(&mut cursor, categories, &mut output, &mut context)
        .expect("cleaning succeeds");
    (output, summary)
}

fn part(bytes: &[u8], name: &str) -> String {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
    let mut entry = archive.by_name(name).unwrap();
    let mut text = String::new();
    entry.read_to_string(&mut text).unwrap();
    text
}

/// `comments_need_content_ack`: removing comments changes the document, so the
/// inspection reports the category as content affecting.
#[test]
fn comments_need_content_ack() {
    let fields = inspect(&fixture_docx());
    let comments = fields
        .iter()
        .find(|field| field.category == MetadataCategory::Comments)
        .expect("the comment is reported");
    assert!(comments.content_affecting);
    assert_eq!(comments.preview, "comments");
    // The author and company fields are not content affecting.
    let author = fields
        .iter()
        .find(|field| field.category == MetadataCategory::Author)
        .expect("the author is reported");
    assert!(!author.content_affecting);
    assert_eq!(author.preview, "Ada");
}

/// `tracked_insert_kept_deleted_text_removed`: accepting the visible content
/// keeps insertions and drops deletions, then removes the change markup.
#[test]
fn tracked_insert_kept_deleted_text_removed() {
    let (cleaned, summary) = clean(&fixture_docx(), &[MetadataCategory::TrackedChanges]);
    let document = part(&cleaned, "word/document.xml");
    assert!(document.contains("kept"), "an insertion stays visible");
    assert!(!document.contains("removed"), "a deletion is gone");
    assert!(!document.contains("<w:ins"), "change markup is removed");
    assert!(!document.contains("<w:del"), "change markup is removed");
    assert_eq!(
        summary.removed_category_counts,
        vec![MetadataCount {
            category: MetadataCategory::TrackedChanges,
            count: 2,
            coverage: Coverage::Complete,
        }]
    );
}

/// `keep_unselected_author`: cleaning the company leaves the author alone.
#[test]
fn keep_unselected_author() {
    let (cleaned, _summary) = clean(&fixture_docx(), &[MetadataCategory::Company]);
    let core = part(&cleaned, "docProps/core.xml");
    assert!(core.contains("Ada"), "the unselected author is kept");
    let app = part(&cleaned, "docProps/app.xml");
    assert!(!app.contains("Example Inc"), "the company is removed");
}

/// `unverified_vendor_tag_no_clean_claim`: a structure this adapter cannot
/// verify publishes nothing at all.
#[test]
fn unverified_vendor_tag_no_clean_claim() {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer.start_file("docProps/core.xml", stored()).unwrap();
    writer
        .write_all(b"<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e \"boom\">]><x>&e;</x>")
        .unwrap();
    let bytes = writer.finish().unwrap().into_inner();

    let mut cursor = Cursor::new(bytes.clone());
    let mut first_context = context();
    let outcome = OfficePrivacyAdapter::new().inspect(&mut cursor, &mut first_context);
    assert!(outcome.is_err(), "an entity declaration is refused");

    let mut cursor = Cursor::new(bytes);
    let mut context = context();
    let mut output: Vec<u8> = Vec::new();
    let cleaned = OfficePrivacyAdapter::new().clean(
        &mut cursor,
        &[MetadataCategory::Author],
        &mut output,
        &mut context,
    );
    assert!(cleaned.is_err());
    assert!(output.is_empty(), "no cleaned copy is written");
}

/// Hidden text is inspected but never cleaned by this adapter: deleting the
/// runs that carry it is a content change this step cannot verify.
#[test]
fn hidden_text_is_not_claimed_as_removed() {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer.start_file("word/document.xml", stored()).unwrap();
    writer
        .write_all(
            br#"<?xml version="1.0"?><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
        )
        .unwrap();
    let bytes = writer.finish().unwrap().into_inner();
    let fields = inspect(&bytes);
    assert!(fields
        .iter()
        .any(|field| field.category == MetadataCategory::HiddenText));

    let mut cursor = Cursor::new(bytes);
    let mut context = context();
    let mut output: Vec<u8> = Vec::new();
    let outcome = OfficePrivacyAdapter::new().clean(
        &mut cursor,
        &[MetadataCategory::HiddenText],
        &mut output,
        &mut context,
    );
    assert!(outcome.is_err());
    assert!(output.is_empty());
}
