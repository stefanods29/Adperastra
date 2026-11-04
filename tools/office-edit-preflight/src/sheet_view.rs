//! Read a bounded cell rectangle from the live model; never evaluate formulas.
use crate::{session::Session, Result, MAX_XML, SHEET};
use roxmltree::Document;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
};
use uuid::Uuid;
use zip::ZipArchive;

pub fn xml(bytes: &[u8], name: &str) -> Result<String> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;
    let mut value = String::new();
    zip.by_name(name)?
        .take(MAX_XML + 1)
        .read_to_string(&mut value)?;
    if value.len() as u64 > MAX_XML {
        return Err("XML limit".into());
    }
    Ok(value)
}

pub fn sheets(bytes: &[u8]) -> Result<Value> {
    let source = xml(bytes, "xl/workbook.xml")?;
    let doc = Document::parse(&source)?;
    if !doc.root_element().has_tag_name((SHEET, "workbook")) {
        return Err("invalid workbook".into());
    }
    let list: Vec<_> = doc
        .root_element()
        .children()
        .filter(|n| n.has_tag_name((SHEET, "sheets")))
        .collect();
    if list.len() != 1 {
        return Err("invalid sheet list".into());
    }
    let mut items = Vec::new();
    for (index, sheet) in list[0]
        .children()
        .filter(|n| n.has_tag_name((SHEET, "sheet")))
        .enumerate()
    {
        let name = sheet.attribute("name").ok_or("missing sheet name")?;
        if name.is_empty()
            || name.chars().count() > 31
            || name.chars().any(char::is_control)
            || items.len() >= 256
        {
            return Err("sheet metadata limit".into());
        }
        items.push(json!({"index":index,"name":name,"hidden":matches!(sheet.attribute("state"),Some("hidden"|"veryHidden"))}));
    }
    if items.is_empty() {
        return Err("no worksheets".into());
    }
    Ok(json!({"items":items}))
}

#[derive(Serialize)]
pub struct Cell {
    row: u32,
    column: u32,
    address: String,
    display: String,
    input: Value,
    format: Value,
    target_id: Option<Uuid>,
}

#[derive(Default)]
pub struct WindowStore {
    current: Option<(Uuid, Vec<Cell>)>,
}

pub fn point(address: &str) -> Option<(u32, u32)> {
    let letters = address.bytes().take_while(u8::is_ascii_uppercase).count();
    let row_text = &address[letters..];
    if !(1..=3).contains(&letters)
        || row_text.starts_with('0')
        || !row_text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let row = row_text.parse::<u32>().ok()?.checked_sub(1)?;
    let column = address[..letters]
        .bytes()
        .fold(0u32, |n, b| n * 26 + u32::from(b - b'A' + 1))
        .checked_sub(1)?;
    (row < 1_048_576 && column < 16_384).then_some((row, column))
}

pub fn address(row: u32, column: u32) -> String {
    let mut c = column + 1;
    let mut letters = Vec::new();
    while c > 0 {
        c -= 1;
        letters.push((b'A' + (c % 26) as u8) as char);
        c /= 26;
    }
    format!(
        "{}{}",
        letters.into_iter().rev().collect::<String>(),
        row + 1
    )
}

impl WindowStore {
    pub fn begin(
        &mut self,
        session: &mut Session<'_>,
        expected: u64,
        section: usize,
        rect: [u32; 4],
    ) -> Result<Value> {
        let [r1, r2, c1, c2] = rect;
        if session.kind() != "xlsx"
            || r2 < r1
            || c2 < c1
            || r2 >= 1_048_576
            || c2 >= 16_384
            || r2 - r1 >= 500
            || u64::from(r2 - r1 + 1) * u64::from(c2 - c1 + 1) > 2000
        {
            return Err("window limit".into());
        }
        let bytes = session.capture(expected)?;
        let part = crate::parts::resolve_part("xlsx", &bytes, section)?;
        let source = xml(&bytes, &part)?;
        let doc = Document::parse(&source)?;
        let root = doc.root_element();
        if !root.has_tag_name((SHEET, "worksheet")) {
            return Err("invalid worksheet".into());
        }
        let protected = root
            .children()
            .any(|n| n.has_tag_name((SHEET, "sheetProtection")));
        let insertion = crate::sheet_insert::Insertion::prepare(root).ok();
        let shared = match xml(&bytes, "xl/sharedStrings.xml") {
            Ok(source) => {
                let parsed = Document::parse(&source)?;
                parsed
                    .root_element()
                    .children()
                    .filter(|n| n.has_tag_name((SHEET, "si")))
                    .map(|n| {
                        let text: String = n
                            .descendants()
                            .filter(|n| n.has_tag_name((SHEET, "t")))
                            .filter_map(|n| n.text())
                            .collect();
                        let plain = !n.children().any(|n| n.has_tag_name((SHEET, "r")));
                        (text, plain)
                    })
                    .collect::<Vec<_>>()
            }
            Err(_) => Vec::new(),
        };
        let styles = crate::sheet_styles::Styles::read(&bytes)?;
        let mut found = HashMap::new();
        for cell in crate::targets::cells(root) {
            let name = cell.attribute("r").ok_or("missing cell address")?;
            let (r, c) = point(name).ok_or("invalid cell address")?;
            if found.contains_key(&(r, c)) {
                return Err("duplicate cell".into());
            }
            if r < r1 || r > r2 || c < c1 || c > c2 {
                continue;
            }
            let value = cell
                .children()
                .find(|n| n.has_tag_name((SHEET, "v")))
                .and_then(|n| n.text())
                .unwrap_or("");
            let formula = cell.children().find(|n| n.has_tag_name((SHEET, "f")));
            let mut plain = true;
            let (display, input) = match cell.attribute("t") {
                Some("s") => {
                    let (text, simple) = shared
                        .get(value.parse::<usize>()?)
                        .ok_or("unknown shared string")?;
                    plain = *simple;
                    (text.clone(), json!({"kind":"text","text":text}))
                }
                Some("inlineStr") => {
                    let text: String = cell
                        .descendants()
                        .filter(|n| n.has_tag_name((SHEET, "t")))
                        .filter_map(|n| n.text())
                        .collect();
                    (text.clone(), json!({"kind":"text","text":text}))
                }
                Some("b") => (
                    if value == "1" { "TRUE" } else { "FALSE" }.to_owned(),
                    json!({"kind":"boolean","value":value=="1"}),
                ),
                Some("str" | "e" | "d") => {
                    plain = false;
                    (value.to_owned(), json!({"kind":"text","text":value}))
                }
                _ if value.is_empty() => (String::new(), json!({"kind":"blank"})),
                _ => {
                    let number = value.parse::<f64>()?;
                    if !number.is_finite() {
                        return Err("nonfinite cell".into());
                    }
                    (value.to_owned(), json!({"kind":"number","value":number}))
                }
            };
            let input = if let Some(formula) = formula {
                let text = formula.text().unwrap_or("");
                if text.len() > 8191 {
                    return Err("formula limit".into());
                }
                json!({"kind":"formula","canonical":format!("={text}")})
            } else {
                input
            };
            if display.len() > 4096 {
                return Err("cell text limit".into());
            }
            let editable =
                !protected && plain && crate::targets::editable_cell(&source, cell).is_ok();
            let format = styles.cell(cell.attribute("s").unwrap_or("0").parse()?)?;
            found.insert((r, c), (display, input, format, editable));
        }
        let mut cells = Vec::new();
        let mut keys = Vec::new();
        for row in r1..=r2 {
            for column in c1..=c2 {
                let name = address(row, column);
                let (display, input, format, editable) =
                    found.remove(&(row, column)).unwrap_or_else(|| {
                        (
                            String::new(),
                            json!({"kind":"blank"}),
                            json!({}),
                            insertion
                                .as_ref()
                                .is_some_and(|policy| policy.allows((row, column))),
                        )
                    });
                if editable {
                    keys.push(name.clone());
                }
                cells.push(Cell {
                    row,
                    column,
                    address: name,
                    display,
                    input,
                    format,
                    target_id: None,
                });
            }
        }
        let targets = session.sheet_targets(expected, section, &keys)?;
        for cell in &mut cells {
            cell.target_id = targets.get(&cell.address).copied();
        }
        let id = Uuid::new_v4();
        let count = cells.len();
        self.current = Some((id, cells));
        Ok(json!({"window_id":id,"cell_count":count}))
    }

    pub fn read(&self, id: Uuid, start: usize) -> Result<Value> {
        let (_, cells) = self
            .current
            .as_ref()
            .filter(|(known, _)| *known == id)
            .ok_or("unknown window")?;
        if start >= cells.len() {
            return Err("invalid cell cursor".into());
        }
        let mut size = 1024;
        let mut end = start;
        for cell in cells.iter().skip(start).take(8) {
            size += serde_json::to_vec(cell)?.len() + 1;
            if size >= 64 * 1024 {
                break;
            }
            end += 1;
        }
        if end == start {
            return Err("cell frame limit".into());
        }
        Ok(
            json!({"window_id":id,"start":start,"items":&cells[start..end],"next_start":(end<cells.len()).then_some(end)}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addresses_use_excel_coordinates() {
        assert_eq!(address(0, 0), "A1");
        assert_eq!(address(1_048_575, 16_383), "XFD1048576");
        assert_eq!(point("XFD1048576"), Some((1_048_575, 16_383)));
        assert_eq!(point("A01"), None);
        assert_eq!(point("XFE1"), None);
    }
}
