use roxmltree::Document;
use std::io::{Cursor, Read};
use zip::ZipArchive;

use crate::{number_part, Result, MAX_ARCHIVE, MAX_XML};

const OPC: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SHEET: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PRESENTATION: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";

pub fn resolve_part(kind: &str, bytes: &[u8], selected_index: usize) -> Result<String> {
    if bytes.len() > MAX_ARCHIVE {
        return Err("archive too large".into());
    }
    let (main, rels, ns, root, container, element, expected_type, folder, prefix) = match kind {
        "xlsx" => (
            "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels",
            SHEET,
            "workbook",
            "sheets",
            "sheet",
            "worksheet",
            "xl",
            "xl/worksheets/sheet",
        ),
        "pptx" => (
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION,
            "presentation",
            "sldIdLst",
            "sldId",
            "slide",
            "ppt",
            "ppt/slides/slide",
        ),
        "docx" if selected_index == 0 => return Ok("word/document.xml".into()),
        _ => return Err("unsupported selection".into()),
    };
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    if archive.len() > 4096 {
        return Err("too many entries".into());
    }
    let mut read_xml = |name| -> Result<String> {
        let mut xml = String::new();
        archive
            .by_name(name)?
            .take(MAX_XML + 1)
            .read_to_string(&mut xml)?;
        if xml.len() as u64 > MAX_XML {
            return Err("XML part too large".into());
        }
        Ok(xml)
    };
    let manifest = read_xml(main)?;
    let doc = Document::parse(&manifest)?;
    let document_root = doc.root_element();
    if !document_root.has_tag_name((ns, root)) {
        return Err("wrong manifest root".into());
    }
    let mut collections = document_root
        .children()
        .filter(|n| n.has_tag_name((ns, container)));
    let collection = collections.next().ok_or("missing section list")?;
    if collections.next().is_some() {
        return Err("duplicate section list".into());
    }
    let node = collection
        .children()
        .filter(|n| n.has_tag_name((ns, element)))
        .nth(selected_index)
        .ok_or("unknown section")?;
    let id = node
        .attribute((OFFICE, "id"))
        .ok_or("missing section relationship")?;
    if collection
        .children()
        .filter(|n| n.attribute((OFFICE, "id")) == Some(id))
        .count()
        != 1
    {
        return Err("duplicate section relationship".into());
    }

    let rel_xml = read_xml(rels)?;
    let doc = Document::parse(&rel_xml)?;
    if !doc.root_element().has_tag_name((OPC, "Relationships")) {
        return Err("wrong relationships root".into());
    }
    let mut candidates = doc
        .root_element()
        .children()
        .filter(|n| n.has_tag_name((OPC, "Relationship")) && n.attribute("Id") == Some(id));
    let relation = candidates.next().ok_or("unknown relationship")?;
    if candidates.next().is_some()
        || relation.attribute("Type") != Some(&format!("{OFFICE}/{expected_type}"))
        || !matches!(relation.attribute("TargetMode"), None | Some("Internal"))
    {
        return Err("ambiguous or unsupported relationship".into());
    }
    let target = relation
        .attribute("Target")
        .ok_or("missing relationship target")?;
    let path = if let Some(absolute) = target.strip_prefix('/') {
        absolute.to_owned()
    } else {
        format!("{folder}/{target}")
    };
    if !number_part(&path, prefix) {
        return Err("unsupported section target".into());
    }
    Ok(path)
}
