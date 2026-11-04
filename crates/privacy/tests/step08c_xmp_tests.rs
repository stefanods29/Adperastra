//! Step 08c T2/T3: namespace-aware XMP rules.

use convert::MetadataCategory;
use privacy::inspect::effective_categories;
use privacy::xmp_rules::{inspect_fields, remove_categories, set_keywords};

fn gps_xml() -> String {
    r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:ex="http://ns.adobe.com/exif/1.0/"
           xmlns:dc="http://purl.org/dc/elements/1.1/">
    <rdf:Description ex:GPSLatitude="51,30.0N" ex:GPSLongitude="0,7.0W"
                     ex:DateTimeOriginal="2024:01:02 03:04:05"
                     dc:creator="Synthetic Author"/>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#
        .to_string()
}

#[test]
fn prefix_renaming_does_not_bypass_gps_removal() {
    let edited = remove_categories(gps_xml().as_bytes(), &[MetadataCategory::Gps])
        .unwrap()
        .expect("packet remains");
    let text = String::from_utf8(edited).unwrap();
    assert!(!text.contains("GPSLatitude"));
    assert!(!text.contains("GPSLongitude"));
    assert!(text.contains("DateTimeOriginal"));
    assert!(text.contains("Synthetic Author"));
}

#[test]
fn dtd_and_entity_declarations_are_refused() {
    let source = br#"<!DOCTYPE x [<!ENTITY y "z">]><x>&y;</x>"#;
    assert!(inspect_fields(source).is_err());
    assert!(remove_categories(source, &[MetadataCategory::Gps]).is_err());
}

#[test]
fn unknown_namespaces_are_preserved_when_not_selected() {
    let source = br#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:ext="urn:example"><rdf:Description ext:Keep="yes"><dc:subject><rdf:Bag/></dc:subject></rdf:Description></rdf:RDF>"#;
    let fields = inspect_fields(source).unwrap();
    assert!(fields
        .iter()
        .any(|field| field.coverage == privacy::Coverage::Unknown));
    let edited = set_keywords(source, &["kept".into()]).unwrap();
    assert!(String::from_utf8(edited)
        .unwrap()
        .contains("ext:Keep=\"yes\""));
    assert!(remove_categories(source, &[MetadataCategory::Gps]).is_err());
}

#[test]
fn keywords_replace_only_the_subject_bag() {
    let source = r#"<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:ex="http://ns.adobe.com/exif/1.0/"><rdf:Description ex:Make="Keep"><dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF>"#;
    let first = set_keywords(
        source.as_bytes(),
        &["one".into(), "two".into(), "one".into()],
    )
    .unwrap();
    let text = String::from_utf8(first.clone()).unwrap();
    assert_eq!(text.matches("<rdf:li>one</rdf:li>").count(), 1);
    assert!(text.find("one").unwrap() < text.find("two").unwrap());
    assert!(text.contains("Make=\"Keep\""));
    let second = set_keywords(&first, &["one".into(), "two".into(), "one".into()]).unwrap();
    assert_eq!(first, second);
}

#[test]
fn xml_bomb_is_capped_before_parsing() {
    let mut source = vec![b'<'];
    source.extend(std::iter::repeat_n(
        b'a',
        privacy::xmp_rules::MAX_XMP_BYTES + 1,
    ));
    source.push(b'>');
    assert!(inspect_fields(&source).is_err());
}

#[test]
fn whole_xmp_removal_discloses_gps_and_author() {
    let fields = inspect_fields(gps_xml().as_bytes()).unwrap();
    let closure = effective_categories(&fields, &[MetadataCategory::Xmp]).unwrap();
    assert!(closure.contains(&MetadataCategory::Gps));
    assert!(closure.contains(&MetadataCategory::Author));
    assert!(closure.contains(&MetadataCategory::Date));
    assert!(
        remove_categories(gps_xml().as_bytes(), &[MetadataCategory::Xmp])
            .unwrap()
            .is_none()
    );
}
