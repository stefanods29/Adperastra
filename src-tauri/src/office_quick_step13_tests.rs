//! Structural preview tests (Step 13 T2). Included from `office_quick.rs`.
//! They use tiny synthetic ZIPs only and never launch the helper, the engine
//! or a spreadsheet parser.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;

use super::*;
use crate::office_quick_zip::inspect_zip;
use crate::office_sheet::{cell_from_saved, legacy_sheet_fallback};
use crate::office_view_types::{OfficeCellValueKind, OfficeFormat};

fn format(name: &str) -> OfficeFormat {
    serde_json::from_str(&format!("\"{name}\"")).unwrap()
}

fn zip(parts: &[(&str, &str)]) -> Cursor<Vec<u8>> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        for (name, contents) in parts {
            if name.ends_with('/') {
                writer.add_directory(*name, SimpleFileOptions::default()).unwrap();
                continue;
            }
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }
    buffer
}

#[test]
fn normal_package_directories_and_internal_relationships_preview() {
    let input = zip(&[
        ("ppt/slides/", ""),
        ("ppt/slides/slide1.xml", "<slide/>"),
        ("ppt/slides/_rels/slide1.xml.rels", r#"<Relationships><Relationship Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#),
    ]);
    assert_eq!(inspect_zip(input, format("pptx")).unwrap().sections.len(), 1);
}

#[test]
fn relationship_cannot_escape_package_root() {
    for target in ["../../outside.xml", "%2e%2e/outside.xml", "//host/file", "https://example.test/"] {
        let rel = format!(r#"<Relationships><Relationship Target = "{target}"/></Relationships>"#);
        let input = zip(&[("word/document.xml", "<document/>"), ("word/_rels/document.xml.rels", &rel)]);
        assert_eq!(inspect_zip(input, format("docx")).unwrap_err(), "office.unsupported");
    }
}

#[test]
fn external_rel_refused() {
    let input = zip(&[
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Type="hyperlink" Target="https://example.test/" TargetMode="External"/></Relationships>"#,
        ),
        ("word/document.xml", "<document/>"),
    ]);
    assert_eq!(
        inspect_zip(input, format("docx")).unwrap_err(),
        "office.unsupported".to_string()
    );
}

#[test]
fn formula_not_executed() {
    let cell = cell_from_saved(None, Some("=SUM(1,2)"));
    assert_eq!(cell.value_kind, OfficeCellValueKind::Formula);
    assert_eq!(cell.formula.as_deref(), Some("=SUM(1,2)"));
    assert_eq!(cell.text, "");
    assert!(cell.cached);
}

#[test]
fn one_hundred_thousand_rows_virtualized() {
    let window = visible_cell_window(100_000, 512, 50_000, 7, 0, 20, QUICK_OVERSCAN);
    assert!(window.visible_cells() <= QUICK_MAX_VISIBLE_CELLS);
    assert!(window.row_end - window.row_start <= 7);
    assert!(window.column_end - window.column_start <= 20);
    assert_eq!(window.overscan_rows, 2);
    assert_eq!(window.overscan_columns, 2);
}

#[test]
fn legacy_missing_pack_fallback() {
    assert!(quick_fallback(format("doc")));
    assert!(quick_fallback(format("xls")));
    assert!(quick_fallback(format("ppt")));
    assert!(quick_fallback(format("rtf")));
    assert!(legacy_sheet_fallback("xls"));
    let fallback = QuickPackage::legacy(format("doc"));
    assert!(fallback.fallback);
    assert!(fallback.entries.is_empty());
    assert_eq!(fallback.warnings, vec!["office.no_preview".to_string()]);
    assert!(fallback.is_valid());
}
