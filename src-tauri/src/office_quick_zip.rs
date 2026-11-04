//! Guarded OOXML/ODF ZIP inspection for structural previews.

use std::io::{Read, Seek};
use std::path::Path;

use zip::ZipArchive;

use crate::office_quick_types::{
    format_name, quick_fallback, quick_supported, QuickEntry, QuickPackage, QuickPart,
    QUICK_MAX_XML_BYTES, QUICK_MAX_XML_ENTRIES, QUICK_MAX_XML_TOTAL, QUICK_MAX_ZIP_ENTRIES,
};
use crate::office_view_types::{
    OfficeFormat, OfficeSection, OfficeSectionKind, OFFICE_MAX_SECTIONS,
};

/// Read one package from disk. The source path is only opened read-only.
pub fn inspect_quick_package(path: &Path, format: OfficeFormat) -> Result<QuickPackage, String> {
    if !path.is_absolute() {
        return Err("office.bad_request".to_string());
    }
    if quick_fallback(format) {
        return Ok(QuickPackage::legacy(format));
    }
    if !quick_supported(format) {
        return Err("office.unsupported".to_string());
    }
    let file = std::fs::File::open(path).map_err(|_| "office.not_found".to_string())?;
    inspect_zip(file, format)
}

pub(crate) fn inspect_zip<R: Read + Seek>(
    reader: R,
    format: OfficeFormat,
) -> Result<QuickPackage, String> {
    let mut archive = ZipArchive::new(reader).map_err(|_| "office.unsupported".to_string())?;
    if archive.len() > QUICK_MAX_ZIP_ENTRIES {
        return Err("office.too_large".to_string());
    }
    let name = format_name(format);
    let family = family_of(&name);
    let mut entries = Vec::new();
    let mut total_xml = 0u64;
    let mut slide_count = 0u32;
    let mut sheet_names: Vec<String> = Vec::new();
    let mut warnings = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|_| "office.unsupported".to_string())?;
        let raw_name = file
            .name()
            .map_err(|_| "office.unsupported".to_string())?
            .to_string();
        let entry_name = raw_name.strip_suffix('/').unwrap_or(&raw_name);
        if !safe_zip_name(entry_name) {
            return Err("office.unsupported".to_string());
        }
        let lower = raw_name.to_ascii_lowercase();
        if lower.contains("vbaproject") || lower.contains("/macros/") || lower.ends_with(".bin") {
            return Err("office.unsupported".to_string());
        }
        if lower.contains("externallink") || lower.contains("external_link") || lower.contains("dde") {
            return Err("office.unsupported".to_string());
        }
        let part = quick_part(&raw_name, family, &mut slide_count);
        let Some(part) = part else { continue };
        if matches!(part, QuickPart::Sheet) && sheet_names.is_empty() {
            sheet_names.push(String::new());
        }
        if file.size() > QUICK_MAX_XML_BYTES {
            return Err("office.too_large".to_string());
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.by_ref()
            .take(QUICK_MAX_XML_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "office.unsupported".to_string())?;
        if bytes.len() as u64 > QUICK_MAX_XML_BYTES {
            return Err("office.too_large".to_string());
        }
        total_xml = total_xml
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "office.too_large".to_string())?;
        if total_xml > QUICK_MAX_XML_TOTAL {
            return Err("office.too_large".to_string());
        }
        if entries.len() >= QUICK_MAX_XML_ENTRIES {
            return Err("office.too_large".to_string());
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| "office.unsupported".to_string())?;
        if text.to_ascii_lowercase().contains("<!doctype")
            || text.to_ascii_lowercase().contains("<!entity")
        {
            return Err("office.unsupported".to_string());
        }
        if matches!(part, QuickPart::Relationships) && has_external_relationship(&raw_name, text) {
            return Err("office.unsupported".to_string());
        }
        if matches!(part, QuickPart::Document) && family == "xlsx" {
            sheet_names = workbook_sheet_names(text);
        }
        if matches!(part, QuickPart::Comments) {
            warnings.push("office.comments_quick".to_string());
        }
        let section_id = section_id_for(part, &raw_name, family);
        let index = entry_index(part, &raw_name, family);
        entries.push(QuickEntry {
            part,
            zip_name: raw_name,
            mime: "text/xml".to_string(),
            section_id,
            index,
            bytes,
        });
    }

    let sections = build_sections(format, family, &sheet_names, slide_count);
    if sections.is_empty() {
        return Err("office.unsupported".to_string());
    }
    let package = QuickPackage {
        format,
        sections,
        entries,
        total_xml_bytes: total_xml,
        fallback: false,
        warnings,
    };
    if !package.is_valid() {
        return Err("office.too_large".to_string());
    }
    Ok(package)
}

fn family_of(name: &str) -> &'static str {
    match name {
        "docx" | "doc" | "rtf" => "docx",
        "xlsx" | "xls" => "xlsx",
        "pptx" | "ppt" => "pptx",
        "odt" | "ott" => "odt",
        "ods" | "ots" => "ods",
        "odp" | "otp" => "odp",
        _ => "unknown",
    }
}

fn quick_part(name: &str, family: &str, slide_count: &mut u32) -> Option<QuickPart> {
    let lower = name.to_ascii_lowercase();
    match family {
        "docx" => {
            if lower == "word/document.xml"
                || lower.starts_with("word/header")
                || lower.starts_with("word/footer")
            {
                Some(QuickPart::Document)
            } else if lower == "word/styles.xml" {
                Some(QuickPart::Styles)
            } else if lower == "word/comments.xml" {
                Some(QuickPart::Comments)
            } else if lower.ends_with(".rels") {
                Some(QuickPart::Relationships)
            } else {
                None
            }
        }
        "xlsx" => {
            if lower == "xl/workbook.xml" {
                Some(QuickPart::Document)
            } else if lower == "xl/sharedstrings.xml" {
                Some(QuickPart::SharedStrings)
            } else if lower.starts_with("xl/worksheets/") && lower.ends_with(".xml") {
                Some(QuickPart::Sheet)
            } else if lower.starts_with("xl/comments") && lower.ends_with(".xml") {
                Some(QuickPart::Comments)
            } else if lower.ends_with(".rels") {
                Some(QuickPart::Relationships)
            } else {
                None
            }
        }
        "pptx" => {
            if lower.starts_with("ppt/slides/slide") && lower.ends_with(".xml") {
                *slide_count += 1;
                Some(QuickPart::Slide)
            } else if lower == "ppt/presentation.xml" {
                Some(QuickPart::Document)
            } else if lower.starts_with("ppt/comments/") && lower.ends_with(".xml") {
                Some(QuickPart::Comments)
            } else if lower.starts_with("ppt/notesslides/") && lower.ends_with(".xml") {
                Some(QuickPart::Notes)
            } else if lower.ends_with(".rels") {
                Some(QuickPart::Relationships)
            } else {
                None
            }
        }
        "odt" | "ods" | "odp" => match lower.as_str() {
            "content.xml" => Some(if family == "ods" {
                QuickPart::Sheet
            } else if family == "odp" {
                QuickPart::Slide
            } else {
                QuickPart::Document
            }),
            "styles.xml" | "meta.xml" | "settings.xml" => Some(QuickPart::Styles),
            "meta-inf/manifest.xml" => Some(QuickPart::Relationships),
            _ => None,
        },
        _ => None,
    }
}

fn section_id_for(part: QuickPart, name: &str, family: &str) -> String {
    let lower = name.to_ascii_lowercase();
    match part {
        QuickPart::Slide => format!("slide:{}", entry_index(part, &lower, family)),
        QuickPart::Sheet => format!("sheet:{}", entry_index(part, &lower, family)),
        _ => "document".to_string(),
    }
}

fn entry_index(part: QuickPart, name: &str, family: &str) -> u32 {
    let lower = name.to_ascii_lowercase();
    if family == "pptx" && matches!(part, QuickPart::Slide | QuickPart::Notes) {
        return digits_after(&lower, "slide")
            .or_else(|| digits_after(&lower, "notesslide"))
            .unwrap_or(1)
            .saturating_sub(1);
    }
    if family == "xlsx" && matches!(part, QuickPart::Sheet) {
        return digits_after(&lower, "sheet").unwrap_or(0).saturating_sub(1);
    }
    0
}

fn digits_after(value: &str, marker: &str) -> Option<u32> {
    let start = value.rfind(marker)? + marker.len();
    let digits: String = value[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

fn build_sections(
    format: OfficeFormat,
    family: &str,
    sheet_names: &[String],
    slide_count: u32,
) -> Vec<OfficeSection> {
    if family == "pptx" && slide_count > 0 {
        return (0..slide_count.min(OFFICE_MAX_SECTIONS as u32))
            .map(|index| OfficeSection {
                id: format!("slide:{index}"),
                name: String::new(),
                kind: OfficeSectionKind::Slide,
                index,
                page_count: 1,
                rows: None,
                columns: None,
            })
            .collect();
    }
    if family == "xlsx" {
        let count = sheet_names.len().clamp(1, OFFICE_MAX_SECTIONS);
        return (0..count)
            .map(|index| OfficeSection {
                id: format!("sheet:{index}"),
                name: sheet_names.get(index).cloned().unwrap_or_default(),
                kind: OfficeSectionKind::Sheet,
                index: index as u32,
                page_count: 1,
                rows: None,
                columns: None,
            })
            .collect();
    }
    if family == "ods" {
        return vec![OfficeSection {
            id: "sheet:0".to_string(),
            name: String::new(),
            kind: OfficeSectionKind::Sheet,
            index: 0,
            page_count: 1,
            rows: None,
            columns: None,
        }];
    }
    if family == "odp" {
        return vec![OfficeSection {
            id: "slide:0".to_string(),
            name: String::new(),
            kind: OfficeSectionKind::Slide,
            index: 0,
            page_count: 1,
            rows: None,
            columns: None,
        }];
    }
    let _ = format;
    vec![OfficeSection {
        id: "document".to_string(),
        name: String::new(),
        kind: OfficeSectionKind::Document,
        index: 0,
        page_count: 1,
        rows: None,
        columns: None,
    }]
}

fn workbook_sheet_names(xml: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<sheet") {
        let tag = &rest[start..];
        let end = tag.find('>').map(|index| index + 1).unwrap_or(tag.len());
        let tag = &tag[..end];
        if let Some(name) = attribute(tag, "name") {
            names.push(decode_xml_text(name).chars().take(255).collect());
        }
        rest = &rest[start + end..];
    }
    names
}

/// Decode the five predefined XML entities in an attribute value. The section
/// name is displayed as plain text; `R&amp;D` must read `R&D`, not the source
/// escape. `&amp;` is replaced last so `&amp;lt;` stays the literal `&lt;`.
fn decode_xml_text(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    for (start, _) in tag.match_indices(name) {
        if !tag[..start].ends_with(char::is_whitespace) {
            continue;
        }
        let Some(value) = tag[start + name.len()..].trim_start().strip_prefix('=') else {
            continue;
        };
        let value = value.trim_start();
        let quote = value.chars().next()?;
        if quote == '"' || quote == '\'' {
            return value[1..].split_once(quote).map(|(value, _)| value);
        }
    }
    None
}

fn has_external_relationship(part: &str, xml: &str) -> bool {
    let lower = xml.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("<relationship") {
        let tag = &rest[start..];
        let end = tag.find('>').map(|index| index + 1).unwrap_or(tag.len());
        let tag = &tag[..end];
        if attribute(tag, "targetmode")
            .map(|value| value.eq_ignore_ascii_case("external"))
            .unwrap_or(false)
        {
            return true;
        }
        if let Some(target) = attribute(tag, "target") {
            if !package_relationship_target(part, &decode_xml_text(target)) {
                return true;
            }
        }
        rest = &rest[start + end..];
    }
    false
}

/// Internal targets are relative to the source part, one directory above its
/// `_rels` folder. The preview checks these paths without opening any target.
fn package_relationship_target(part: &str, target: &str) -> bool {
    let target = target.trim().split('#').next().unwrap_or_default();
    if target.starts_with("//") || target.contains(['\\', ':', '%', '?']) {
        return false;
    }
    let (target, mut depth) = if let Some(root_relative) = target.strip_prefix('/') {
        (root_relative, 0)
    } else {
        let depth = part
            .rsplit_once("/_rels/")
            .map_or(0, |(parent, _)| parent.split('/').count());
        (target, depth)
    };
    for segment in target.split('/') {
        match segment {
            "" => return false,
            "." => (),
            ".." if depth == 0 => return false,
            ".." => depth -= 1,
            _ => depth += 1,
        }
    }
    depth > 0
}

fn safe_zip_name(name: &str) -> bool {
    name.len() <= 1_024
        && !name.starts_with('/')
        && !name.starts_with('\\')
        && !name.contains('\\')
        && !name.contains(':')
        && !name.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        && !name.contains('\0')
}
