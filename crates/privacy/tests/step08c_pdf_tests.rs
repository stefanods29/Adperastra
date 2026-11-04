//! Step 08c T4: fresh PDF cleaning and independent verification.

use convert::MetadataCategory;
use fs_service::new_cancellation_token;
use lopdf::{dictionary, Document, Object, Stream};
use privacy::{
    clean_bytes, default_registry, effective_categories, inspect::closure_for, inspect_bytes,
    PrivacyContext, PrivacyError,
};

fn context() -> PrivacyContext {
    PrivacyContext::new(new_cancellation_token(), None, 1024 * 1024 * 1024)
}

fn xmp_packet() -> Vec<u8> {
    br#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><rdf:Description dc:creator="Alice" xmp:CreateDate="2024-01-02"/></rdf:RDF>"#.to_vec()
}

fn build_pdf(with_attachment: bool, with_script: bool, with_form: bool) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        b"BT /F1 12 Tf (Hello) Tj ET".to_vec(),
    ));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)],
        "Contents" => content_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page_id)],
            "Count" => 1,
        }),
    );
    let catalog_id = doc.new_object_id();
    let mut catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    };
    let xmp_id = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "Metadata",
            "Subtype" => "XML",
        },
        xmp_packet(),
    ));
    catalog.set("Metadata", xmp_id);
    let info_id = doc.add_object(dictionary! {
        "Author" => Object::string_literal("Alice"),
        "Creator" => Object::string_literal("Synthetic Writer"),
        "Producer" => Object::string_literal("Synthetic Producer"),
        "CreationDate" => Object::string_literal("D:20240102030405Z"),
    });
    doc.trailer.set("Info", info_id);

    let mut annotations = Vec::new();
    let note_id = doc.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Text",
        "Rect" => vec![Object::Integer(0), Object::Integer(0), Object::Integer(10), Object::Integer(10)],
        "Contents" => Object::string_literal("private note"),
    });
    annotations.push(Object::Reference(note_id));
    if with_attachment {
        let embedded_id = doc.add_object(Stream::new(
            dictionary! { "Type" => "EmbeddedFile" },
            b"secret attachment".to_vec(),
        ));
        let filespec_id = doc.add_object(dictionary! {
            "Type" => "Filespec",
            "F" => Object::string_literal("secret.txt"),
            "EF" => dictionary! { "F" => embedded_id },
        });
        let names_id = doc.add_object(dictionary! {
            "Names" => vec![Object::string_literal("secret.txt"), Object::Reference(filespec_id)],
        });
        catalog.set("Names", dictionary! { "EmbeddedFiles" => names_id });
        let attachment_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "FileAttachment",
            "Rect" => vec![Object::Integer(0), Object::Integer(0), Object::Integer(10), Object::Integer(10)],
            "FS" => filespec_id,
        });
        annotations.push(Object::Reference(attachment_id));
    }
    if with_script {
        catalog.set(
            "OpenAction",
            dictionary! {
                "S" => "JavaScript",
                "JS" => Object::string_literal("app.alert('synthetic')"),
            },
        );
        let action_id = doc.add_object(dictionary! {
            "S" => "JavaScript",
            "JS" => Object::string_literal("app.alert('annotation')"),
        });
        let script_note = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => vec![Object::Integer(0), Object::Integer(0), Object::Integer(10), Object::Integer(10)],
            "A" => action_id,
        });
        annotations.push(Object::Reference(script_note));
    }
    if with_form {
        let sig_field = dictionary! {
            "FT" => "Sig",
            "T" => Object::string_literal("Signature1"),
            "V" => dictionary! { "ByteRange" => vec![Object::Integer(0), Object::Integer(10), Object::Integer(20), Object::Integer(30)] },
        };
        catalog.set(
            "AcroForm",
            dictionary! { "Fields" => vec![Object::Dictionary(sig_field)] },
        );
    }
    let page_dict = doc.get_dictionary_mut(page_id).unwrap();
    page_dict.set("Annots", Object::Array(annotations));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", catalog_id);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

fn fields_of(bytes: &[u8]) -> (Vec<privacy::PrivacyField>, bool) {
    let registry = default_registry();
    let adapter = registry.get("pdf").unwrap();
    let fields = inspect_bytes(adapter, bytes, &mut context()).unwrap();
    let (_, signatures) = privacy::pdf_fields::inspect_pdf(bytes, &mut context()).unwrap();
    (fields, signatures)
}

/// Nothing is unreachable except the cross-reference stream the writer may
/// regenerate on the next save.
fn assert_prune_is_only_structure(doc: &Document) {
    let mut probe = doc.clone();
    let pruned = probe.prune_objects();
    assert!(pruned.iter().all(|id| {
        matches!(
            doc.objects.get(id).and_then(|object| object.type_name().ok()),
            Some(name) if name == b"XRef" || name == b"ObjStm"
        )
    }));
}

fn clean(bytes: &[u8], categories: &[MetadataCategory]) -> Result<Vec<u8>, PrivacyError> {
    let registry = default_registry();
    let adapter = registry.get("pdf").unwrap();
    let mut output = Vec::new();
    clean_bytes(adapter, bytes, categories, &mut output, &mut context())?;
    Ok(output)
}

#[test]
fn removed_author_is_not_in_info_xmp_or_unreachable_objects() {
    let source = build_pdf(true, true, true);
    let source_hash = blake3::hash(&source);
    let (before, _) = fields_of(&source);
    assert!(before
        .iter()
        .any(|field| field.category == MetadataCategory::Author));
    let cleaned = clean(&source, &[MetadataCategory::Author]).unwrap();
    assert_eq!(blake3::hash(&source), source_hash, "source bytes untouched");
    let text = String::from_utf8_lossy(&cleaned);
    assert!(!text.contains("Alice"));
    let doc = Document::load_mem(&cleaned).unwrap();
    assert_prune_is_only_structure(&doc);
    let (after, _) = fields_of(&cleaned);
    assert!(!after
        .iter()
        .any(|field| field.category == MetadataCategory::Author));
    assert!(after
        .iter()
        .any(|field| field.category == MetadataCategory::Date));
}

#[test]
fn selected_attachment_is_gone_after_reopen_and_prune() {
    let source = build_pdf(true, false, false);
    let cleaned = clean(&source, &[MetadataCategory::Attachments]).unwrap();
    let (after, _) = fields_of(&cleaned);
    assert!(!after
        .iter()
        .any(|field| field.category == MetadataCategory::Attachments));
    let doc = Document::load_mem(&cleaned).unwrap();
    let text = String::from_utf8_lossy(&cleaned);
    assert!(!text.contains("secret attachment"));
    assert_prune_is_only_structure(&doc);
}

#[test]
fn javascript_and_open_action_are_removed() {
    let source = build_pdf(true, true, false);
    let cleaned = clean(&source, &[MetadataCategory::Scripts]).unwrap();
    let (after, _) = fields_of(&cleaned);
    assert!(!after
        .iter()
        .any(|field| field.category == MetadataCategory::Scripts));
    let text = String::from_utf8_lossy(&cleaned);
    assert!(!text.contains("app.alert('synthetic')"));
    assert!(!text.contains("app.alert('annotation')"));
    let doc = Document::load_mem(&cleaned).unwrap();
    assert!(!doc.trailer.has(b"OpenAction"));
}

#[test]
fn forms_and_annotations_require_content_acknowledgement() {
    let source = build_pdf(false, false, true);
    let (fields, signatures) = fields_of(&source);
    assert!(signatures);
    let forms = closure_for(&fields, signatures, &[MetadataCategory::Forms]).unwrap();
    assert!(forms.content_affecting);
    let annotation = closure_for(&fields, signatures, &[MetadataCategory::Annotations]).unwrap();
    assert!(annotation.content_affecting);
}

#[test]
fn selected_unknown_coverage_publishes_nothing() {
    let mut source = build_pdf(false, false, false);
    let unknown = br#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ext="urn:example"><rdf:Description ext:Secret="x"/></rdf:RDF>"#;
    // Replace the synthetic XMP stream by rebuilding a fixture with an unknown namespace.
    let mut doc = Document::load_mem(&source).unwrap();
    let metadata = doc
        .objects
        .iter()
        .find_map(|(id, object)| {
            object
                .as_stream()
                .ok()
                .filter(|stream| {
                    stream
                        .dict
                        .get(b"Type")
                        .ok()
                        .and_then(|value| value.as_name().ok())
                        == Some(b"Metadata")
                })
                .map(|_| *id)
        })
        .unwrap();
    doc.get_object_mut(metadata)
        .unwrap()
        .as_stream_mut()
        .unwrap()
        .set_plain_content(unknown.to_vec());
    source.clear();
    doc.save_to(&mut source).unwrap();
    let result = clean(&source, &[MetadataCategory::Author]);
    assert!(matches!(result, Err(PrivacyError::Unverified)));
}

#[test]
fn selecting_xmp_discloses_author_and_date() {
    let source = build_pdf(false, false, false);
    let (fields, _) = fields_of(&source);
    let closure = effective_categories(&fields, &[MetadataCategory::Xmp]).unwrap();
    assert!(closure.contains(&MetadataCategory::Author));
    assert!(closure.contains(&MetadataCategory::Date));
}
