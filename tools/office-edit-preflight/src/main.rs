use roxmltree::{Document, Node};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

#[cfg(test)]
mod sheet_view_tests;

const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAWING: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PRESENTATION: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const SHEET: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const CONTENT: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
const MAX_XML: u64 = 4 * 1024 * 1024;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn tagged(node: Node<'_, '_>, ns: &str, name: &str) -> bool {
    node.has_tag_name((ns, name))
}

fn escape_text(value: &str) -> Result<String> {
    if value.len() > 4096
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '\u{fffe}' | '\u{ffff}'))
    {
        return Err("unsupported replacement text".into());
    }
    Ok(value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;"))
}

fn utf16_boundary(text: &str, wanted: usize) -> Result<usize> {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        if units == wanted {
            return Ok(index);
        }
        units += ch.len_utf16();
    }
    if units == wanted {
        Ok(text.len())
    } else {
        Err("invalid UTF-16 boundary".into())
    }
}

#[derive(Clone, Copy)]
enum Replacement<'a> {
    Text(&'a str),
    Number(f64),
    Boolean(bool),
    Blank,
}

fn patch(xml: &str, kind: &str, target: &str, value: Replacement<'_>) -> Result<String> {
    let doc = Document::parse(xml)?;
    let root = doc.root_element();
    let (range, replacement) = match kind {
        "docx" | "pptx" => {
            let Replacement::Text(value) = value else {
                return Err("document and slide edits require text".into());
            };
            let text = escape_text(value)?;
            let (root_ns, root_name, ns) = if kind == "docx" {
                (WORD, "document", WORD)
            } else {
                (PRESENTATION, "sld", DRAWING)
            };
            if !tagged(root, root_ns, root_name) {
                return Err("unexpected part type".into());
            }
            let mut segments = target.split(':');
            let ordinal = segments.next().ok_or("missing run")?.parse::<usize>()?;
            let span = match (segments.next(), segments.next(), segments.next()) {
                (None, None, None) => None,
                (Some(start), Some(end), None) => {
                    Some((start.parse::<usize>()?, end.parse::<usize>()?))
                }
                _ => return Err("invalid text target".into()),
            };
            let node = root
                .descendants()
                .filter(|n| tagged(*n, ns, "t"))
                .nth(ordinal)
                .ok_or("unknown text run")?;
            let content = targets::editable_text(xml, node, ns)?;
            let (range, replacement) = if let Some((start, end)) = span {
                let range = content.range.clone();
                let raw = &xml[range.clone()];
                let decoded = content.text;
                if start == 0 && end == decoded.encode_utf16().count() {
                    (range, text)
                } else {
                    if raw != decoded || start > end {
                        return Err("unsupported partial text representation".into());
                    }
                    let start = utf16_boundary(raw, start)?;
                    let end = utf16_boundary(raw, end)?;
                    (range.start + start..range.start + end, text)
                }
            } else {
                (content.range.clone(), text)
            };
            if ns == WORD && value.trim() != value {
                let content_start = content.range.start;
                let element = node.range();
                if !xml[..content_start].ends_with('>') {
                    return Err("unsupported partial text representation".into());
                }
                let space = node.attribute_node(("http://www.w3.org/XML/1998/namespace", "space"));
                let mut changed = xml[element.clone()].to_owned();
                changed.replace_range(
                    range.start - element.start..range.end - element.start,
                    &replacement,
                );
                if let Some(attribute) = space {
                    let space = attribute.range_value();
                    changed.replace_range(
                        space.start - element.start..space.end - element.start,
                        "preserve",
                    );
                } else {
                    changed
                        .insert_str(content_start - element.start - 1, " xml:space=\"preserve\"");
                }
                (element, changed)
            } else {
                (range, replacement)
            }
        }
        "xlsx" => {
            if !tagged(root, SHEET, "worksheet")
                || root.children().any(|n| tagged(n, SHEET, "sheetProtection"))
            {
                return Err("worksheet is protected or invalid".into());
            }
            let mut cells = targets::cells(root).filter(|n| n.attribute("r") == Some(target));
            let cell = cells.next();
            if cells.next().is_some() {
                return Err("duplicate cell".into());
            }
            if let Some(cell) = cell {
                targets::editable_cell(xml, cell)?;
            }
            let style = match cell.and_then(|node| node.attribute("s")) {
                Some(style) => format!(" s=\"{}\"", style.parse::<u32>()?),
                None => String::new(),
            };
            let attributes = format!("r=\"{target}\"{style}");
            let changed_cell = match value {
                Replacement::Text(value) => {
                    let text = escape_text(value)?;
                    format!("<c {attributes} t=\"inlineStr\"><is><t xml:space=\"preserve\">{text}</t></is></c>")
                }
                Replacement::Number(value) if value.is_finite() => {
                    format!("<c {attributes} t=\"n\"><v>{value}</v></c>")
                }
                Replacement::Number(_) => return Err("nonfinite cell value".into()),
                Replacement::Boolean(value) => {
                    let encoded = u8::from(value);
                    format!("<c {attributes} t=\"b\"><v>{encoded}</v></c>")
                }
                Replacement::Blank => format!("<c {attributes}/>"),
            };
            if let Some(cell) = cell {
                (cell.range(), changed_cell)
            } else {
                return sheet_insert::Insertion::prepare(root)?.insert(xml, target, &changed_cell);
            }
        }
        _ => return Err("unsupported format".into()),
    };
    let mut updated = xml.to_owned();
    updated.replace_range(range, &replacement);
    Document::parse(&updated)?;
    Ok(updated)
}

fn number_part(path: &str, prefix: &str) -> bool {
    path.strip_prefix(prefix)
        .and_then(|n| n.strip_suffix(".xml"))
        .is_some_and(|n| {
            n.parse::<u32>().is_ok_and(|v| v > 0) && n.bytes().all(|b| b.is_ascii_digit())
        })
}

mod parts;
mod protocol;
mod session;
mod sheet_insert;
mod sheet_styles;
mod sheet_view;
mod snapshot;
mod targets;

const MAX_ARCHIVE: usize = 16 * 1024 * 1024;

fn rewrite(
    kind: &str,
    bytes: &[u8],
    part: &str,
    target: &str,
    value: Replacement<'_>,
) -> Result<Vec<u8>> {
    rewrite_inner(kind, bytes, part, Some((target, value)))
}

fn rewrite_inner(
    kind: &str,
    bytes: &[u8],
    part: &str,
    change: Option<(&str, Replacement<'_>)>,
) -> Result<Vec<u8>> {
    let (main, mime) = match kind {
        "docx" if part == "word/document.xml" => (
            part,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
        "xlsx" if number_part(part, "xl/worksheets/sheet") => (
            "xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ),
        "pptx" if number_part(part, "ppt/slides/slide") => (
            "ppt/presentation.xml",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ),
        _ => return Err("unsupported format or part".into()),
    };
    if bytes.len() > MAX_ARCHIVE {
        return Err("archive too large".into());
    }
    let mut archive = ZipArchive::new(std::io::Cursor::new(bytes))?;
    if archive.len() > 4096 {
        return Err("too many entries".into());
    }
    let mut names = HashSet::new();
    let mut total = 0u64;
    let mut valid_type = false;
    let mut changed = None;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name()?.to_string();
        let lower = name.to_ascii_lowercase();
        let clean = lower.strip_suffix('/').unwrap_or(&lower);
        if entry.enclosed_name().is_none()
            || name.len() > 4096
            || clean.split('/').count() > 64
            || entry.size() > entry.compressed_size().saturating_mul(500)
            || entry.is_symlink()
            || !names.insert(clean.to_owned())
            || lower.contains("vbaproject")
            || lower.contains("_xmlsignatures")
            || clean
                .split('/')
                .any(|c| c.is_empty() || matches!(c, "." | ".."))
            || name.contains(['\\', ':'])
        {
            return Err("unsafe archive entry".into());
        }
        total = total.checked_add(entry.size()).ok_or("size overflow")?;
        if total > 64 * 1024 * 1024 {
            return Err("expanded archive too large".into());
        }
        if name != part
            && !lower.ends_with(".rels")
            && !matches!(
                name.as_str(),
                "[Content_Types].xml"
                    | "word/settings.xml"
                    | "xl/workbook.xml"
                    | "ppt/presentation.xml"
            )
        {
            std::io::copy(&mut entry, &mut std::io::sink())?;
            continue;
        }
        let mut xml = String::new();
        (&mut entry).take(MAX_XML + 1).read_to_string(&mut xml)?;
        if xml.len() as u64 > MAX_XML {
            return Err("XML part too large".into());
        }
        let doc = Document::parse(&xml)?;
        if doc
            .descendants()
            .flat_map(|node| node.attributes())
            .any(|attr| {
                matches!(attr.name(), "Type" | "ContentType")
                    && ["digital-signature", "vbaproject", "macroenabled"]
                        .iter()
                        .any(|blocked| attr.value().to_ascii_lowercase().contains(blocked))
            })
        {
            return Err("signed package".into());
        }
        if name == "[Content_Types].xml" {
            valid_type = doc.root_element().children().any(|n| {
                tagged(n, CONTENT, "Override")
                    && n.attribute("PartName") == Some(&format!("/{main}"))
                    && n.attribute("ContentType") == Some(mime)
            });
        }
        if doc.descendants().any(|n| {
            n.is_element()
                && matches!(
                    n.tag_name().name(),
                    "documentProtection"
                        | "writeProtection"
                        | "workbookProtection"
                        | "fileSharing"
                        | "modifyVerifier"
                )
        }) {
            return Err("package is protected".into());
        }
        if name == part {
            changed = Some(if let Some((target, value)) = change {
                patch(&xml, kind, target, value)?
            } else {
                let (ns, root) = match kind {
                    "docx" => (WORD, "document"),
                    "xlsx" => (SHEET, "worksheet"),
                    _ => (PRESENTATION, "sld"),
                };
                if !tagged(doc.root_element(), ns, root) {
                    return Err("unexpected part root".into());
                }
                xml
            });
        }
    }
    let changed = changed
        .filter(|_| valid_type)
        .ok_or("missing target or invalid package type")?;
    if change.is_none() {
        return Ok(bytes.to_vec());
    }
    let output = std::io::Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(output);
    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        if entry.name()? == part {
            writer.start_file(
                part,
                SimpleFileOptions::default().compression_method(entry.compression()),
            )?;
            writer.write_all(changed.as_bytes())?;
        } else {
            writer.raw_copy_file(entry)?;
        }
    }
    let bytes = writer.finish()?.into_inner();
    if bytes.len() > MAX_ARCHIVE {
        return Err("edited archive too large".into());
    }
    Ok(bytes)
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() == 3 && args[1] == "memory-worker" {
        return protocol::run_memory(Path::new(&args[2]));
    }
    if args.len() == 4 && args[1] == "worker" {
        return protocol::run(Path::new(&args[2]), Path::new(&args[3]));
    }
    if args.len() == 8 && args[1] == "batch" {
        let source = Path::new(&args[2]);
        let kind = source
            .extension()
            .and_then(|s| s.to_str())
            .ok_or("missing format")?;
        let mut input = Vec::new();
        File::open(source)?
            .take(MAX_ARCHIVE as u64 + 1)
            .read_to_end(&mut input)?;
        let mut session = session::Session::new(kind, input)?;
        let section = args[4].parse()?;
        let first = session.select(1, section, &args[5])?;
        let second = session.select(1, section, &args[6])?;
        let before = session.capture(1)?;
        let replacement = Replacement::Text(&args[7]);
        let operations = [(first, replacement), (second, replacement)];

        // The first write can succeed on the private candidate while the
        // second operation fails. No live state or history may change.
        let malformed = session.select(1, section, "invalid")?;
        let err = session.edit_many(1, &[(first, replacement), (malformed, replacement)], || {
            false
        });
        assert!(err.is_err());
        assert!(std::sync::Arc::ptr_eq(&before, &session.capture(1)?));
        assert!(session.undo(1).is_err());

        let polls = std::cell::Cell::new(0);
        let err = session.edit_many(1, &operations, || {
            polls.set(polls.get() + 1);
            polls.get() == 3
        });
        assert!(err.is_err() && polls.get() == 3);
        assert!(std::sync::Arc::ptr_eq(&before, &session.capture(1)?));
        assert!(session.undo(1).is_err());

        session.edit_many(1, &operations, || false)?;
        let frozen = session.capture(2)?;
        session.undo(2)?;
        assert!(std::sync::Arc::ptr_eq(&before, &session.capture(3)?));
        assert!(session.undo(3).is_err());
        session.redo(3)?;
        assert!(std::sync::Arc::ptr_eq(&frozen, &session.capture(4)?));
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(&args[3])?;
        output.write_all(&frozen)?;
        output.sync_all()?;
        println!("rollback, cancellation and single undo verified");
        return Ok(());
    }
    if args.len() == 7 {
        let source = Path::new(&args[1]);
        let mut bytes = Vec::new();
        File::open(source)?
            .take(MAX_ARCHIVE as u64 + 1)
            .read_to_end(&mut bytes)?;
        let replacement = match args[5].as_str() {
            "number" => Replacement::Number(args[6].parse()?),
            "boolean" => Replacement::Boolean(args[6].parse()?),
            "blank" if args[6].is_empty() => Replacement::Blank,
            "text" => Replacement::Text(&args[6]),
            _ => return Err("unsupported cell input".into()),
        };
        let mut session = session::Session::new("xlsx", bytes)?;
        let selection = session.select(1, args[3].parse()?, &args[4])?;
        session.edit(1, selection, replacement)?;
        let bytes = session.capture(2)?;
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(&args[2])?;
        output.write_all(&bytes)?;
        output.sync_all()?;
        return Ok(());
    }
    if args.len() != 6 {
        return Err("expected source, new destination, section index, target, replacement".into());
    }
    let source = Path::new(&args[1]);
    let kind = source
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("missing format")?;
    let mut bytes = Vec::new();
    File::open(source)?
        .take(MAX_ARCHIVE as u64 + 1)
        .read_to_end(&mut bytes)?;
    let index = args[3].parse::<usize>()?;
    let mut other_session = session::Session::new(kind, bytes.clone())?;
    let mut session = session::Session::new(kind, bytes)?;
    let original = session.capture(1)?;
    let selection = if let Some(current_text) = args[4].strip_prefix("listed:") {
        let listed = session.list(1, index, 0)?;
        let mut matches = listed.iter().filter(|item| {
            item.address.as_deref() == Some(current_text)
                || (item.address.is_none() && item.text == current_text)
        });
        let selected = matches.next().ok_or("editable target not listed")?;
        if matches.next().is_some() {
            return Err("ambiguous fixture selection".into());
        }
        selected.id
    } else {
        session.select(1, index, &args[4])?
    };
    assert!(other_session
        .edit(1, selection, Replacement::Text(&args[5]))
        .is_err());
    assert_eq!(other_session.capture(1)?.as_ref(), original.as_ref());
    let key = args[4]
        .strip_prefix("listed:")
        .map_or(
            args[4].as_str(),
            |query| {
                if kind == "xlsx" {
                    query
                } else {
                    "0"
                }
            },
        );
    let other_selection = other_session.select(1, index, key)?;
    assert!(session
        .edit(1, other_selection, Replacement::Text(&args[5]))
        .is_err());
    session.edit(1, selection, Replacement::Text(&args[5]))?;
    let edited = session.capture(2)?;
    assert!(session
        .edit(1, selection, Replacement::Text(&args[5]))
        .is_err());
    assert!(session
        .edit(2, selection, Replacement::Text(&args[5]))
        .is_err());
    let malformed = session.select(2, index, "invalid")?;
    assert!(session
        .edit(2, malformed, Replacement::Text("invalid"))
        .is_err());
    assert!(std::sync::Arc::ptr_eq(&edited, &session.capture(2)?));
    let stale_after_undo = session.select(2, index, key)?;
    session.undo(2)?;
    assert!(session
        .edit(3, stale_after_undo, Replacement::Text("invalid"))
        .is_err());
    assert!(std::sync::Arc::ptr_eq(&original, &session.capture(3)?));
    assert!(session.capture(2).is_err());
    session.redo(3)?;
    assert!(std::sync::Arc::ptr_eq(&edited, &session.capture(4)?));
    let current = session.select(4, index, key)?;
    session.edit(4, current, Replacement::Text("A newer draft"))?;
    let newer = session.capture(5)?;
    assert_ne!(edited.as_ref(), newer.as_ref());
    session.undo(5)?;
    assert!(std::sync::Arc::ptr_eq(&edited, &session.capture(6)?));
    let current = session.select(6, index, key)?;
    session.edit(6, current, Replacement::Text("Another branch"))?;
    assert!(session.redo(7).is_err());
    let mut output = File::options()
        .write(true)
        .create_new(true)
        .open(&args[2])?;
    output.write_all(&edited)?;
    output.sync_all()?;
    println!("selection ownership, edit, undo, redo and frozen copy verified");
    Ok(())
}

#[cfg(test)]
mod range_tests {
    use super::*;

    #[test]
    fn text_range_edits_use_utf16_and_preserve_surrounding_bytes() {
        let xml = format!(
            r#"<w:document xmlns:w="{WORD}"><w:body><w:p><w:r><w:t>A🐴B</w:t></w:r></w:p></w:body></w:document>"#
        );
        assert_eq!(
            patch(&xml, "docx", "0:1:3", Replacement::Text("🐎")).unwrap(),
            xml.replace('🐴', "🐎")
        );
        assert!(patch(&xml, "docx", "0:2:3", Replacement::Text("🐎")).is_err());
        assert!(patch(&xml, "docx", "0:3:2", Replacement::Text("🐎")).is_err());
    }

    #[test]
    fn partial_text_with_encoded_entities_refuses_ambiguous_raw_offsets() {
        let xml = format!(
            r#"<w:document xmlns:w="{WORD}"><w:body><w:p><w:r><w:t>A&amp;B</w:t></w:r></w:p></w:body></w:document>"#
        );
        assert!(patch(&xml, "docx", "0:1:2", Replacement::Text("X")).is_err());
        let replaced = patch(&xml, "docx", "0:0:3", Replacement::Text(" A & C ")).unwrap();
        assert!(replaced.contains(r#"<w:t xml:space="preserve"> A &amp; C </w:t>"#));
        let cleared = patch(&xml, "docx", "0:0:3", Replacement::Text("")).unwrap();
        assert!(cleared.contains("<w:t></w:t>"));
        let retyped = patch(&cleared, "docx", "0:0:0", Replacement::Text("Restored")).unwrap();
        assert!(retyped.contains("<w:t>Restored</w:t>"));
    }
}
