use crate::{session::Session, sheet_view::WindowStore, SHEET};
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, ZipWriter};

fn fixture() -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let workbook = format!(
        r#"<workbook xmlns="{SHEET}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="7" r:id="rId1"/><sheet name="Audit" sheetId="8" state="hidden" r:id="rId2"/></sheets></workbook>"#
    );
    let sheet = format!(
        r#"<worksheet xmlns="{SHEET}"><sheetData><row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>"#
    );
    let shared = format!(r#"<sst xmlns="{SHEET}"><si><t>000123</t></si></sst>"#);
    let styles = format!(
        r#"<styleSheet xmlns="{SHEET}"><fonts><font><name val="Calibri"/><sz val="11"/></font><font><b/><name val="Arial"/><sz val="14"/></font></fonts><fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFFFCC00"/></patternFill></fill></fills><cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>"#
    );
    let rels = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet8.xml"/></Relationships>"#;
    for (name, value) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#,
        ),
        ("xl/workbook.xml", workbook.as_str()),
        ("xl/_rels/workbook.xml.rels", rels),
        ("xl/worksheets/sheet7.xml", sheet.as_str()),
        ("xl/sharedStrings.xml", shared.as_str()),
        ("xl/styles.xml", styles.as_str()),
    ] {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(value.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
fn live_grid_retains_styles_cached_formulas_and_safe_targets() {
    let bytes = fixture();
    let meta = crate::sheet_view::sheets(&bytes).unwrap();
    assert_eq!(meta["items"][0]["name"], "Data");
    assert_eq!(meta["items"][1]["hidden"], true);
    let mut session = Session::new("xlsx", bytes.clone()).unwrap();
    let mut store = WindowStore::default();
    let window = store.begin(&mut session, 1, 0, [0, 1, 0, 1]).unwrap();
    let id = serde_json::from_value(window["window_id"].clone()).unwrap();
    let page = store.read(id, 0).unwrap();
    let cells = page["items"].as_array().unwrap();
    assert_eq!(cells.len(), 4);
    assert_eq!(cells[0]["display"], "000123");
    assert_eq!(cells[0]["format"]["text"]["bold"], true);
    assert_eq!(cells[0]["format"]["fill"]["r"], 255);
    assert_eq!(cells[0]["format"]["horizontal"], "center");
    assert!(cells[0]["target_id"].is_string());
    assert_eq!(cells[1]["display"], "3");
    assert_eq!(cells[1]["input"]["canonical"], "=SUM(1,2)");
    assert!(cells[1]["target_id"].is_null());
    assert_eq!(cells[2]["address"], "A2");
    let empty = serde_json::from_value(cells[2]["target_id"].clone()).unwrap();
    assert!(store.begin(&mut session, 2, 0, [0, 1, 0, 1]).is_err());
    assert!(store.begin(&mut session, 1, 0, [0, 500, 0, 1]).is_err());
    assert_eq!(session.capture(1).unwrap().as_ref(), bytes.as_slice());
    session
        .edit(1, empty, crate::Replacement::Text("new & safe"))
        .unwrap();
    let saved = session.capture(2).unwrap();
    let xml = crate::sheet_view::xml(&saved, "xl/worksheets/sheet7.xml").unwrap();
    assert!(xml.contains(r#"<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">new &amp; safe</t></is></c></row>"#));
    assert!(xml.contains("<f>SUM(1,2)</f><v>3</v>"));
    session.undo(2).unwrap();
    assert_eq!(session.capture(3).unwrap().as_ref(), bytes.as_slice());
}

#[test]
fn inserts_in_order_and_updates_only_affected_dimension_and_row_hint() {
    let xml = format!(
        r#"<worksheet xmlns="{SHEET}"><dimension ref="A1:C1"/><sheetData><row r="1" spans="1:3" ht="27"><c r="A1"/><c r="C1" s="2"/></row><row r="3"/></sheetData><dataValidations><dataValidation sqref="B2"/></dataValidations></worksheet>"#
    );
    let inserted = crate::patch(&xml, "xlsx", "B1", crate::Replacement::Number(42.0)).unwrap();
    assert!(
        inserted.contains(r#"ht="27"><c r="A1"/><c r="B1" t="n"><v>42</v></c><c r="C1" s="2"/>"#)
    );
    assert!(inserted.contains(r#"<dimension ref="A1:C1"/>"#));
    assert!(crate::patch(&xml, "xlsx", "B2", crate::Replacement::Number(42.0)).is_err());
    let inserted = crate::patch(&xml, "xlsx", "D3", crate::Replacement::Boolean(true)).unwrap();
    assert!(inserted.contains(r#"<dimension ref="A1:D3"/>"#));
    assert!(inserted.contains(r#"<row r="3"><c r="D3" t="b"><v>1</v></c></row>"#));
}
