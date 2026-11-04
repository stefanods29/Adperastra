use roxmltree::{Document, Node};
use std::{
    collections::HashSet,
    io::{Cursor, Read},
};
use zip::ZipArchive;

use crate::{tagged, Result, DRAWING, MAX_XML, PRESENTATION, SHEET, WORD};

pub struct EditableText<'a> {
    pub text: &'a str,
    pub range: std::ops::Range<usize>,
}

pub fn editable_text<'a, 'b>(xml: &str, node: Node<'a, 'b>, ns: &str) -> Result<EditableText<'a>> {
    if !node.parent().is_some_and(|n| tagged(n, ns, "r"))
        || !node
            .parent()
            .and_then(|n| n.parent())
            .is_some_and(|n| tagged(n, ns, "p"))
        || node.ancestors().any(|n| {
            [
                "sdt",
                "ins",
                "del",
                "moveFrom",
                "moveTo",
                "AlternateContent",
                "fldSimple",
            ]
            .contains(&n.tag_name().name())
        })
    {
        return Err("unsupported text run".into());
    }
    if ns == WORD {
        let mut fields = 0u32;
        for marker in node
            .document()
            .descendants()
            .take_while(|candidate| *candidate != node)
            .filter(|candidate| tagged(*candidate, WORD, "fldChar"))
        {
            match marker.attribute((WORD, "fldCharType")) {
                Some("begin") => fields = fields.checked_add(1).ok_or("field nesting limit")?,
                Some("separate") if fields > 0 => {}
                Some("end") if fields > 0 => fields -= 1,
                _ => return Err("invalid field markers".into()),
            }
        }
        if fields != 0 {
            return Err("field result is not editable".into());
        }
    }
    let Some(content) = node.first_child() else {
        let span = node.range();
        let raw = &xml[span.clone()];
        let at = raw
            .rfind("</")
            .filter(|offset| raw[..*offset].ends_with('>'))
            .ok_or("unsupported empty text element")?
            + span.start;
        return Ok(EditableText {
            text: "",
            range: at..at,
        });
    };
    if !content.is_text() || content.next_sibling().is_some() {
        return Err("nonliteral text".into());
    }
    if xml[content.range()].contains('<') {
        return Err("unsupported text representation".into());
    }
    Ok(EditableText {
        text: content.text().ok_or("missing text")?,
        range: content.range(),
    })
}

pub fn cells<'a, 'b>(root: Node<'a, 'b>) -> impl Iterator<Item = Node<'a, 'b>> {
    root.children()
        .filter(|n| tagged(*n, SHEET, "sheetData"))
        .flat_map(|n| n.children())
        .filter(|n| tagged(*n, SHEET, "row"))
        .flat_map(|n| n.children())
        .filter(|n| tagged(*n, SHEET, "c"))
}

pub fn editable_cell(xml: &str, cell: Node<'_, '_>) -> Result<()> {
    if cell
        .children()
        .any(|n| n.is_element() && !["v", "is"].contains(&n.tag_name().name()))
        || cell
            .attributes()
            .any(|a| a.namespace().is_some() || !["r", "s", "t"].contains(&a.name()))
        || !matches!(
            cell.attribute("t"),
            None | Some("s" | "n" | "b" | "inlineStr")
        )
        || !xml[cell.range()].starts_with("<c ")
        || cell
            .descendants()
            .any(|n| n.is_element() && !["c", "v", "is", "t"].contains(&n.tag_name().name()))
    {
        return Err("unsupported cell".into());
    }
    let address = cell.attribute("r").ok_or("missing cell address")?;
    if cell
        .attribute("s")
        .is_some_and(|s| s.parse::<u32>().is_err())
    {
        return Err("invalid cell metadata".into());
    }
    let worksheet = cell.document().root_element();
    let point = crate::sheet_view::point(address).ok_or("invalid cell address")?;
    if blocked_ranges(worksheet)?
        .iter()
        .any(|range| range.contains(point))
    {
        return Err("cell has validation or is merged".into());
    }
    Ok(())
}

pub struct CellBounds {
    pub first: (u32, u32),
    pub last: (u32, u32),
}

impl CellBounds {
    pub fn parse(range: &str) -> Result<Self> {
        let (first, last) = range.split_once(':').unwrap_or((range, range));
        let first = crate::sheet_view::point(first).ok_or("invalid worksheet range")?;
        let last = crate::sheet_view::point(last).ok_or("invalid worksheet range")?;
        if first.0 > last.0 || first.1 > last.1 {
            return Err("reversed worksheet range".into());
        }
        Ok(Self { first, last })
    }

    pub fn contains(&self, (row, column): (u32, u32)) -> bool {
        (self.first.0..=self.last.0).contains(&row)
            && (self.first.1..=self.last.1).contains(&column)
    }
}

pub fn blocked_ranges(worksheet: Node<'_, '_>) -> Result<Vec<CellBounds>> {
    let mut blocked = Vec::new();
    for group in worksheet.children() {
        let (item, attribute) = match group.tag_name().name() {
            "dataValidations" => ("dataValidation", "sqref"),
            "mergeCells" => ("mergeCell", "ref"),
            _ => continue,
        };
        for rule in group.children().filter(|n| tagged(*n, SHEET, item)) {
            let ranges = rule.attribute(attribute).ok_or("missing worksheet range")?;
            if ranges.trim().is_empty() {
                return Err("empty worksheet range".into());
            }
            for range in ranges.split_ascii_whitespace() {
                blocked.push(CellBounds::parse(range)?);
            }
        }
    }
    Ok(blocked)
}

#[derive(Debug)]
pub struct Target {
    pub ordinal: usize,
    pub key: String,
    pub text: String,
}

pub fn list(kind: &str, bytes: &[u8], part: &str, start: usize) -> Result<Vec<Target>> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;
    let mut read_part = |path| -> Result<String> {
        let mut xml = String::new();
        zip.by_name(path)?
            .take(MAX_XML + 1)
            .read_to_string(&mut xml)?;
        if xml.len() as u64 > MAX_XML {
            return Err("XML part too large".into());
        }
        Ok(xml)
    };
    let xml = read_part(part)?;
    let doc = Document::parse(&xml)?;
    let root = doc.root_element();
    let mut result = Vec::new();
    match kind {
        "docx" | "pptx" => {
            let (root_ns, root_name, ns) = if kind == "docx" {
                (WORD, "document", WORD)
            } else {
                (PRESENTATION, "sld", DRAWING)
            };
            if !tagged(root, root_ns, root_name) {
                return Err("unexpected part type".into());
            }
            for (index, node) in root
                .descendants()
                .filter(|n| tagged(*n, ns, "t"))
                .enumerate()
                .skip(start)
            {
                if let Ok(content) = editable_text(&xml, node, ns) {
                    let text = content.text;
                    if text.len() <= 4096 {
                        result.push(Target {
                            ordinal: index,
                            key: index.to_string(),
                            text: text.to_owned(),
                        });
                    }
                }
                if result.len() == 256 {
                    break;
                }
            }
        }
        "xlsx" => {
            if !tagged(root, SHEET, "worksheet")
                || root.children().any(|n| tagged(n, SHEET, "sheetProtection"))
            {
                return Err("worksheet is protected or invalid".into());
            }
            let mut seen = HashSet::new();
            for cell in cells(root) {
                if let Some(address) = cell.attribute("r") {
                    if !seen.insert(address) {
                        return Err("duplicate cell address".into());
                    }
                }
            }
            let shared = if cells(root).any(|n| n.attribute("t") == Some("s")) {
                Some(read_part("xl/sharedStrings.xml")?)
            } else {
                None
            };
            let parsed = shared.as_deref().map(Document::parse).transpose()?;
            let strings: Vec<_> = parsed
                .as_ref()
                .into_iter()
                .flat_map(|d| d.root_element().children())
                .filter(|n| tagged(*n, SHEET, "si"))
                .collect();
            for (index, cell) in cells(root).enumerate().skip(start) {
                if editable_cell(&xml, cell).is_err() {
                    continue;
                }
                let v = cell
                    .children()
                    .find(|n| tagged(*n, SHEET, "v"))
                    .and_then(|n| n.text());
                let text = match cell.attribute("t") {
                    Some("s") => v
                        .and_then(|s| s.parse::<usize>().ok())
                        .and_then(|i| strings.get(i))
                        .and_then(|n| n.children().find(|c| tagged(*c, SHEET, "t")))
                        .and_then(|n| n.text()),
                    Some("inlineStr") => cell
                        .descendants()
                        .find(|n| tagged(*n, SHEET, "t"))
                        .and_then(|n| n.text()),
                    _ => v.or(Some("")),
                };
                if let Some(text) = text.filter(|text| text.len() <= 4096) {
                    let key = cell.attribute("r").ok_or("missing cell address")?;
                    result.push(Target {
                        ordinal: index,
                        key: key.to_owned(),
                        text: text.to_owned(),
                    });
                }
                if result.len() == 256 {
                    break;
                }
            }
        }
        _ => return Err("unsupported format".into()),
    }
    Ok(result)
}
