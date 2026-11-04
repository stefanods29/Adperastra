//! Bounded, namespace-aware XMP inspection and editing (Step 08c D5).
//!
//! This is the pure-crate implementation used by image/PDF adapters. The
//! native `privacy_xmp` service and `src/pdf-write-helper/privacyXmp.ts` use
//! the same rule table in the isolated trusted WebView host for callers that
//! need an actual DOM (11b embedded tags). Both refuse DTD/ENTITY/PI markup,
//! match namespace URI + local name (never a user prefix) and preserve
//! unknown unselected namespaces byte-for-byte.

use convert::MetadataCategory;

use crate::error::PrivacyError;
use crate::types::{Coverage, MetadataContainer, PrivacyField};

pub const MAX_XMP_BYTES: usize = 1_048_576;
pub const MAX_XMP_NODES: usize = 10_000;
pub const MAX_XMP_DEPTH: usize = 32;
pub const MAX_XMP_ATTRS: usize = 10_000;
pub const MAX_XMP_TEXT: usize = 1_048_576;

pub const NS_XMPMETA: &str = "adobe:ns:meta/";
pub const NS_RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
pub const NS_DC: &str = "http://purl.org/dc/elements/1.1/";
pub const NS_EXIF: &str = "http://ns.adobe.com/exif/1.0/";
pub const NS_TIFF: &str = "http://ns.adobe.com/tiff/1.0/";
pub const NS_XMP: &str = "http://ns.adobe.com/xap/1.0/";
pub const NS_PDF: &str = "http://ns.adobe.com/pdf/1.3/";
pub const NS_IPTC: &str = "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/";
pub const NS_XML: &str = "http://www.w3.org/XML/1998/namespace";

const LOCATION_FIELDS: &[&str] = &[
    "Location",
    "City",
    "Country",
    "ProvinceState",
    "Sublocation",
    "WorldRegion",
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct QName {
    prefix: String,
    local: String,
}

impl QName {
    fn parse(text: &str) -> Result<Self, PrivacyError> {
        if text.is_empty() || text.len() > 256 {
            return Err(PrivacyError::Unsupported);
        }
        let (prefix, local) = match text.split_once(':') {
            Some((prefix, local)) => (prefix.to_string(), local.to_string()),
            None => (String::new(), text.to_string()),
        };
        if local.is_empty() {
            return Err(PrivacyError::Unsupported);
        }
        Ok(Self { prefix, local })
    }
}

#[derive(Debug, Clone)]
struct AttrSpan {
    name: QName,
    ns: Option<String>,
    value: String,
    start: usize,
    end: usize,
}

#[derive(Debug, Clone)]
struct ElementSpan {
    name: QName,
    ns: Option<String>,
    start: usize,
    open_end: usize,
    close_start: usize,
    end: usize,
    self_closing: bool,
    attrs: Vec<AttrSpan>,
}

#[derive(Debug, Clone)]
struct NamespaceFrame {
    name: QName,
    bindings: Vec<(String, String)>,
}

/// Reject any markup that can define entities, processing instructions or a
/// DTD before a parser sees it.
pub fn refuse_dangerous_markup(source: &[u8]) -> Result<(), PrivacyError> {
    if source.len() > MAX_XMP_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    let text = std::str::from_utf8(source).map_err(|_| PrivacyError::Unsupported)?;
    let upper = text.to_ascii_uppercase();
    if upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") || text.contains("<?") {
        return Err(PrivacyError::Unsupported);
    }
    Ok(())
}

/// Strip an enclosing `<?xpacket ...?>` wrapper (the only PI the XMP
/// container reader removes before handing the packet to this parser).
pub fn strip_xpacket(source: &[u8]) -> Result<Vec<u8>, PrivacyError> {
    if source.len() > MAX_XMP_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    let text = std::str::from_utf8(source).map_err(|_| PrivacyError::Unsupported)?;
    let mut value = text.trim().to_string();
    if value.starts_with("<?xpacket") {
        let Some(end) = value.find("?>") else {
            return Err(PrivacyError::Unsupported);
        };
        value = value[end + 2..].trim_start().to_string();
    }
    if let Some(start) = value.rfind("<?xpacket") {
        let tail = value[start..].trim_end();
        if tail.ends_with("?>") {
            value.truncate(start);
            value = value.trim_end().to_string();
        }
    }
    if value.contains("<?") {
        return Err(PrivacyError::Unsupported);
    }
    Ok(value.into_bytes())
}

fn decode_entities(text: &str) -> Result<String, PrivacyError> {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find('&') {
        result.push_str(&rest[..index]);
        let Some(end) = rest[index..].find(';') else {
            return Err(PrivacyError::Unsupported);
        };
        let entity = &rest[index + 1..index + end];
        let value = match entity {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                let code =
                    u32::from_str_radix(&entity[2..], 16).map_err(|_| PrivacyError::Unsupported)?;
                char::from_u32(code).ok_or(PrivacyError::Unsupported)?
            }
            _ if entity.starts_with('#') => {
                let code = entity[1..]
                    .parse::<u32>()
                    .map_err(|_| PrivacyError::Unsupported)?;
                char::from_u32(code).ok_or(PrivacyError::Unsupported)?
            }
            _ => return Err(PrivacyError::Unsupported),
        };
        result.push(value);
        rest = &rest[index + end + 1..];
    }
    result.push_str(rest);
    Ok(result)
}

fn parse_attrs(source: &str, start: usize, end: usize) -> Result<Vec<AttrSpan>, PrivacyError> {
    let bytes = source.as_bytes();
    let mut attrs = Vec::new();
    let mut index = start;
    let mut total = 0usize;
    let mut value_total = 0usize;
    while index < end {
        while index < end && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= end {
            break;
        }
        let name_start = index;
        while index < end && !bytes[index].is_ascii_whitespace() && bytes[index] != b'=' {
            index += 1;
        }
        if index >= end || bytes[index] != b'=' {
            return Err(PrivacyError::Unsupported);
        }
        let name_text = &source[name_start..index];
        index += 1;
        while index < end && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= end || (bytes[index] != b'"' && bytes[index] != b'\'') {
            return Err(PrivacyError::Unsupported);
        }
        let quote = bytes[index];
        index += 1;
        let value_start = index;
        while index < end && bytes[index] != quote {
            index += 1;
        }
        if index >= end {
            return Err(PrivacyError::Unsupported);
        }
        let value = decode_entities(&source[value_start..index])?;
        index += 1;
        total += 1;
        value_total += value.len();
        if total > MAX_XMP_ATTRS || value_total > MAX_XMP_TEXT {
            return Err(PrivacyError::TooLarge);
        }
        attrs.push(AttrSpan {
            name: QName::parse(name_text)?,
            ns: None,
            value,
            start: name_start,
            end: index,
        });
    }
    Ok(attrs)
}

fn scan(source: &str) -> Result<Vec<ElementSpan>, PrivacyError> {
    let bytes = source.as_bytes();
    let mut index = 0usize;
    let mut nodes = 0usize;
    let mut text_total = 0usize;
    let mut frames: Vec<NamespaceFrame> = Vec::new();
    let mut elements: Vec<ElementSpan> = Vec::new();
    let mut open: Vec<(usize, usize)> = Vec::new();

    let resolve = |prefix: &str, frames: &[NamespaceFrame]| -> Option<String> {
        if prefix == "xml" {
            return Some(NS_XML.to_string());
        }
        let mut current = frames.len();
        while current > 0 {
            current -= 1;
            for (name, value) in &frames[current].bindings {
                if name == prefix {
                    return Some(value.clone());
                }
            }
            if prefix.is_empty() {
                // The default namespace only applies to unprefixed elements;
                // the caller decides. Keep searching outward for a default.
            }
        }
        None
    };

    while index < bytes.len() {
        if bytes[index] != b'<' {
            let start = index;
            while index < bytes.len() && bytes[index] != b'<' {
                index += 1;
            }
            text_total += index - start;
            if text_total > MAX_XMP_TEXT {
                return Err(PrivacyError::TooLarge);
            }
            continue;
        }
        if source[index..].starts_with("<!--") {
            let Some(end) = source[index + 4..].find("-->") else {
                return Err(PrivacyError::Unsupported);
            };
            index = index + 4 + end + 3;
            continue;
        }
        if source[index..].starts_with("<![CDATA[") {
            let Some(end) = source[index + 9..].find("]]>") else {
                return Err(PrivacyError::Unsupported);
            };
            text_total += end;
            if text_total > MAX_XMP_TEXT {
                return Err(PrivacyError::TooLarge);
            }
            index = index + 9 + end + 3;
            continue;
        }
        if source[index..].starts_with("<!") || source[index..].starts_with("<?") {
            return Err(PrivacyError::Unsupported);
        }
        if source[index..].starts_with("</") {
            let Some(end) = source[index + 2..].find('>') else {
                return Err(PrivacyError::Unsupported);
            };
            let name_text = source[index + 2..index + 2 + end].trim();
            let name = QName::parse(name_text)?;
            let Some((frame_index, open_index)) = open.pop() else {
                return Err(PrivacyError::Unsupported);
            };
            if frames[frame_index].name != name {
                return Err(PrivacyError::Unsupported);
            }
            let close_start = index;
            index = index + 2 + end + 1;
            if let Some(element) = elements.get_mut(open_index) {
                element.close_start = close_start;
                element.end = index;
            }
            frames.truncate(frame_index);
            continue;
        }

        let start = index;
        index += 1;
        let name_start = index;
        while index < bytes.len()
            && !bytes[index].is_ascii_whitespace()
            && bytes[index] != b'>'
            && bytes[index] != b'/'
        {
            index += 1;
        }
        let name = QName::parse(&source[name_start..index])?;
        let attr_start = index;
        let mut quote: Option<u8> = None;
        while index < bytes.len() {
            let byte = bytes[index];
            if let Some(active) = quote {
                if byte == active {
                    quote = None;
                }
            } else if byte == b'"' || byte == b'\'' {
                quote = Some(byte);
            } else if byte == b'>' {
                break;
            }
            index += 1;
        }
        if index >= bytes.len() {
            return Err(PrivacyError::Unsupported);
        }
        let attr_end = index;
        let self_closing = attr_end > attr_start && bytes[attr_end - 1] == b'/';
        let open_end = index + 1;

        let attrs_end = if self_closing {
            attr_end.saturating_sub(1)
        } else {
            attr_end
        };
        let mut attrs = parse_attrs(source, attr_start, attrs_end)?;
        let mut bindings = Vec::new();
        for attr in &mut attrs {
            if attr.name.prefix == "xmlns" {
                bindings.push((attr.name.local.clone(), attr.value.clone()));
            } else if attr.name.prefix.is_empty() && attr.name.local == "xmlns" {
                bindings.push((String::new(), attr.value.clone()));
            }
        }
        let parent = frames.len();
        frames.push(NamespaceFrame {
            name: name.clone(),
            bindings,
        });
        let ns = if name.prefix.is_empty() {
            resolve("", &frames)
        } else {
            resolve(&name.prefix, &frames)
        };
        if !name.prefix.is_empty() && ns.is_none() {
            return Err(PrivacyError::Unsupported);
        }
        for attr in &mut attrs {
            if attr.name.prefix.is_empty() || attr.name.prefix == "xmlns" {
                continue;
            }
            attr.ns = resolve(&attr.name.prefix, &frames);
            if attr.ns.is_none() {
                return Err(PrivacyError::Unsupported);
            }
        }
        nodes += 1;
        if nodes > MAX_XMP_NODES || frames.len() > MAX_XMP_DEPTH {
            return Err(PrivacyError::TooLarge);
        }
        elements.push(ElementSpan {
            name,
            ns,
            start,
            open_end,
            close_start: if self_closing { open_end } else { attr_end },
            end: if self_closing { open_end } else { attr_end },
            self_closing,
            attrs,
        });
        if self_closing {
            frames.pop();
        } else {
            open.push((parent, elements.len() - 1));
        }
        index = open_end;
    }
    if !open.is_empty() || elements.is_empty() {
        return Err(PrivacyError::Unsupported);
    }
    Ok(elements)
}

fn category_for(ns: Option<&str>, local: &str) -> Option<MetadataCategory> {
    let ns = ns?;
    match ns {
        NS_EXIF if local.starts_with("GPS") => Some(MetadataCategory::Gps),
        NS_EXIF
            if matches!(
                local,
                "DateTime"
                    | "DateTimeOriginal"
                    | "DateTimeDigitized"
                    | "OffsetTime"
                    | "OffsetTimeOriginal"
                    | "OffsetTimeDigitized"
                    | "SubSecTime"
                    | "SubSecTimeOriginal"
                    | "SubSecTimeDigitized"
            ) =>
        {
            Some(MetadataCategory::Date)
        }
        NS_EXIF if local.starts_with("Lens") => Some(MetadataCategory::Camera),
        NS_EXIF if matches!(local, "BodySerialNumber" | "CameraOwnerName" | "OwnerName") => {
            Some(MetadataCategory::Camera)
        }
        NS_EXIF if local == "UserComment" => Some(MetadataCategory::Comments),
        NS_TIFF if local == "Make" || local == "Model" => Some(MetadataCategory::Camera),
        NS_TIFF if local == "Artist" || local == "Copyright" => Some(MetadataCategory::Author),
        NS_XMP if local == "CreateDate" || local == "ModifyDate" || local == "MetadataDate" => {
            Some(MetadataCategory::Date)
        }
        NS_PDF if local == "Author" || local == "Creator" || local == "Producer" => {
            Some(MetadataCategory::Author)
        }
        NS_PDF if local == "CreationDate" || local == "ModDate" => Some(MetadataCategory::Date),
        NS_DC if local == "creator" || local == "rights" => Some(MetadataCategory::Author),
        NS_DC if local == "description" || local == "subject" => Some(MetadataCategory::Comments),
        NS_IPTC if LOCATION_FIELDS.contains(&local) => Some(MetadataCategory::Gps),
        NS_IPTC if local == "By-line" || local == "By-lineTitle" || local == "CopyrightNotice" => {
            Some(MetadataCategory::Author)
        }
        NS_IPTC if local == "DateCreated" || local == "TimeCreated" => Some(MetadataCategory::Date),
        NS_IPTC if local == "Caption" || local == "Headline" => Some(MetadataCategory::Comments),
        _ => None,
    }
}

fn is_known_namespace(ns: &str) -> bool {
    matches!(
        ns,
        NS_XMPMETA | NS_RDF | NS_DC | NS_EXIF | NS_TIFF | NS_XMP | NS_PDF | NS_IPTC | NS_XML
    )
}

fn wants_removal(category: MetadataCategory, ns: Option<&str>, local: &str) -> bool {
    let Some(ns) = ns else {
        return false;
    };
    match category {
        MetadataCategory::Gps => {
            (ns == NS_EXIF && local.starts_with("GPS"))
                || (ns == NS_IPTC && LOCATION_FIELDS.contains(&local))
        }
        MetadataCategory::Author => {
            (ns == NS_DC && matches!(local, "creator" | "rights"))
                || (ns == NS_PDF && matches!(local, "Author" | "Creator" | "Producer"))
                || (ns == NS_TIFF && matches!(local, "Artist" | "Copyright"))
                || (ns == NS_EXIF && matches!(local, "OwnerName" | "CameraOwnerName"))
                || (ns == NS_IPTC
                    && matches!(local, "By-line" | "By-lineTitle" | "CopyrightNotice"))
        }
        MetadataCategory::Date => {
            (ns == NS_XMP && matches!(local, "CreateDate" | "ModifyDate" | "MetadataDate"))
                || (ns == NS_EXIF
                    && matches!(
                        local,
                        "DateTime"
                            | "DateTimeOriginal"
                            | "DateTimeDigitized"
                            | "OffsetTime"
                            | "OffsetTimeOriginal"
                            | "OffsetTimeDigitized"
                            | "SubSecTime"
                            | "SubSecTimeOriginal"
                            | "SubSecTimeDigitized"
                    ))
                || (ns == NS_PDF && matches!(local, "CreationDate" | "ModDate"))
                || (ns == NS_IPTC && matches!(local, "DateCreated" | "TimeCreated"))
        }
        MetadataCategory::Camera => {
            (ns == NS_TIFF && matches!(local, "Make" | "Model"))
                || (ns == NS_EXIF
                    && (local.starts_with("Lens")
                        || matches!(local, "BodySerialNumber" | "CameraOwnerName" | "OwnerName")))
        }
        MetadataCategory::Comments => {
            (ns == NS_DC && matches!(local, "description" | "subject"))
                || (ns == NS_EXIF && local == "UserComment")
                || (ns == NS_IPTC && matches!(local, "Caption" | "Headline"))
        }
        MetadataCategory::Exif => ns == NS_EXIF || ns == NS_TIFF,
        MetadataCategory::Iptc => ns == NS_IPTC,
        _ => false,
    }
}

fn sanitize(value: &str) -> String {
    let mut text = String::new();
    for character in value.chars().take(512) {
        if character.is_control() {
            text.push(' ');
        } else {
            text.push(character);
        }
    }
    text
}

fn id_part(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-') {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect()
}

fn field(
    category: MetadataCategory,
    field_id: String,
    preview: &str,
    coverage: Coverage,
) -> PrivacyField {
    PrivacyField {
        category,
        containers: vec![MetadataContainer::Xmp],
        related_categories: Vec::new(),
        field_id,
        label_key: label_key(&category).to_string(),
        preview: sanitize(preview),
        count: 1,
        content_affecting: false,
        coverage,
    }
}

fn label_key(category: &MetadataCategory) -> &'static str {
    match category {
        MetadataCategory::Exif => "privacy.exif",
        MetadataCategory::Gps => "privacy.gps",
        MetadataCategory::Camera => "privacy.camera",
        MetadataCategory::Date => "privacy.date",
        MetadataCategory::Icc => "privacy.icc",
        MetadataCategory::Xmp => "privacy.xmp",
        MetadataCategory::Iptc => "privacy.iptc",
        MetadataCategory::Author => "privacy.author",
        MetadataCategory::Comments => "privacy.comments",
        MetadataCategory::Attachments => "privacy.attachments",
        MetadataCategory::Forms => "privacy.forms",
        MetadataCategory::Annotations => "privacy.annotations",
        MetadataCategory::Scripts => "privacy.scripts",
        MetadataCategory::Timestamps => "privacy.timestamps",
        _ => "privacy.scope",
    }
}

/// Inspect one XMP packet. Unknown namespaces are reported as unknown XMP
/// coverage so a selected XMP removal can never claim completeness.
pub fn inspect_fields(source: &[u8]) -> Result<Vec<PrivacyField>, PrivacyError> {
    let source = strip_xpacket(source)?;
    let text = std::str::from_utf8(&source).map_err(|_| PrivacyError::Unsupported)?;
    let elements = scan(text)?;
    let mut fields: Vec<PrivacyField> = Vec::new();
    let mut push = |field: PrivacyField| {
        if let Some(existing) = fields
            .iter_mut()
            .find(|item| item.field_id == field.field_id)
        {
            existing.count = existing.count.saturating_add(field.count);
            if existing.preview.is_empty() {
                existing.preview = field.preview;
            }
        } else {
            fields.push(field);
        }
    };
    push(field(
        MetadataCategory::Xmp,
        "xmp.packet".to_string(),
        "",
        Coverage::Complete,
    ));
    for element in &elements {
        if let Some(ns) = element.ns.as_deref() {
            if let Some(category) = category_for(Some(ns), &element.name.local) {
                let mut detected = field(
                    category,
                    format!(
                        "xmp.element.{}.{}",
                        prefix_id(ns),
                        id_part(&element.name.local)
                    ),
                    "",
                    Coverage::Complete,
                );
                if category == MetadataCategory::Camera
                    && matches!(element.name.local.as_str(), "OwnerName" | "CameraOwnerName")
                {
                    detected.related_categories.push(MetadataCategory::Author);
                }
                push(detected);
            } else if ns == NS_EXIF || ns == NS_TIFF {
                push(field(
                    MetadataCategory::Exif,
                    format!(
                        "xmp.element.{}.{}",
                        prefix_id(ns),
                        id_part(&element.name.local)
                    ),
                    "",
                    Coverage::Partial,
                ));
            } else if !is_known_namespace(ns) {
                push(field(
                    MetadataCategory::Xmp,
                    format!(
                        "xmp.unknown.{}.{}",
                        prefix_id(ns),
                        id_part(&element.name.local)
                    ),
                    "",
                    Coverage::Unknown,
                ));
            }
        }
        for attr in &element.attrs {
            if attr.name.prefix == "xmlns" || attr.name.local == "xmlns" {
                continue;
            }
            let Some(ns) = attr.ns.as_deref() else {
                continue;
            };
            if let Some(category) = category_for(Some(ns), &attr.name.local) {
                let mut detected = field(
                    category,
                    format!("xmp.attr.{}.{}", prefix_id(ns), id_part(&attr.name.local)),
                    &attr.value,
                    Coverage::Complete,
                );
                if category == MetadataCategory::Camera
                    && matches!(attr.name.local.as_str(), "OwnerName" | "CameraOwnerName")
                {
                    detected.related_categories.push(MetadataCategory::Author);
                }
                push(detected);
            } else if !is_known_namespace(ns) {
                push(field(
                    MetadataCategory::Xmp,
                    format!(
                        "xmp.unknown.attr.{}.{}",
                        prefix_id(ns),
                        id_part(&attr.name.local)
                    ),
                    "",
                    Coverage::Unknown,
                ));
            }
        }
    }
    Ok(fields)
}

fn prefix_id(ns: &str) -> &'static str {
    match ns {
        NS_XMPMETA => "xmpmeta",
        NS_RDF => "rdf",
        NS_DC => "dc",
        NS_EXIF => "exif",
        NS_TIFF => "tiff",
        NS_XMP => "xmp",
        NS_PDF => "pdf",
        NS_IPTC => "iptc",
        NS_XML => "xml",
        _ => "ext",
    }
}

/// Remove the selected semantic categories. `Xmp` returns `None`: the caller
/// removes the whole packet/stream instead of pretending to preserve it.
pub fn remove_categories(
    source: &[u8],
    categories: &[MetadataCategory],
) -> Result<Option<Vec<u8>>, PrivacyError> {
    if categories.contains(&MetadataCategory::Xmp) {
        return Ok(None);
    }
    let source = strip_xpacket(source)?;
    let text = std::str::from_utf8(&source).map_err(|_| PrivacyError::Unsupported)?;
    let elements = scan(text)?;
    let selected = crate::sorted_categories(categories);
    let unknown_namespace = elements.iter().any(|element| {
        element
            .ns
            .as_deref()
            .is_some_and(|ns| !is_known_namespace(ns))
            || element
                .attrs
                .iter()
                .any(|attr| attr.ns.as_deref().is_some_and(|ns| !is_known_namespace(ns)))
    });
    let selective = selected.iter().any(|category| {
        matches!(
            category,
            MetadataCategory::Gps
                | MetadataCategory::Camera
                | MetadataCategory::Date
                | MetadataCategory::Author
                | MetadataCategory::Comments
        )
    });
    if unknown_namespace && selective {
        return Err(PrivacyError::Unverified);
    }
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    for element in &elements {
        if selected
            .iter()
            .any(|category| wants_removal(*category, element.ns.as_deref(), &element.name.local))
        {
            edits.push((element.start, element.end, String::new()));
            continue;
        }
        for attr in &element.attrs {
            if attr.name.prefix == "xmlns" || attr.name.local == "xmlns" {
                continue;
            }
            if selected
                .iter()
                .any(|category| wants_removal(*category, attr.ns.as_deref(), &attr.name.local))
            {
                edits.push((attr.start, attr.end, String::new()));
            }
        }
    }
    Ok(Some(apply_edits(text, edits)?))
}

/// Replace only `dc:subject` with a deduplicated RDF Bag, in provided order.
pub fn set_keywords(source: &[u8], keywords: &[String]) -> Result<Vec<u8>, PrivacyError> {
    if keywords.len() > 1_000 {
        return Err(PrivacyError::TooLarge);
    }
    let mut unique: Vec<&String> = Vec::new();
    for keyword in keywords {
        if keyword.is_empty() || keyword.chars().count() > 60 {
            return Err(PrivacyError::BadRequest);
        }
        if !unique.contains(&keyword) {
            unique.push(keyword);
        }
    }
    let source = strip_xpacket(source)?;
    let text = std::str::from_utf8(&source).map_err(|_| PrivacyError::Unsupported)?;
    let elements = scan(text)?;
    let Some(subject) = elements
        .iter()
        .find(|element| element.ns.as_deref() == Some(NS_DC) && element.name.local == "subject")
    else {
        return Err(PrivacyError::BadRequest);
    };
    let rdf_prefix = elements
        .iter()
        .flat_map(|element| element.attrs.iter())
        .find_map(|attr| {
            (attr.name.prefix == "xmlns" && attr.name.local == "rdf" && attr.value == NS_RDF)
                .then(|| "rdf".to_string())
        })
        .unwrap_or_else(|| "rdf".to_string());
    let mut bag = format!("<{rdf_prefix}:Bag>");
    for keyword in unique {
        bag.push_str(&format!(
            "<{rdf_prefix}:li>{}</{rdf_prefix}:li>",
            escape_text(keyword)
        ));
    }
    bag.push_str(&format!("</{rdf_prefix}:Bag>"));
    let replacement = if subject.self_closing {
        format!(
            "<{}:{}{}>{}</{}:{}>",
            subject.name.prefix,
            subject.name.local,
            if rdf_prefix == "rdf" {
                format!(" xmlns:rdf=\"{NS_RDF}\"")
            } else {
                String::new()
            },
            bag,
            subject.name.prefix,
            subject.name.local
        )
    } else {
        format!(
            "{}{}{}",
            &text[subject.start..subject.open_end],
            bag,
            &text[subject.close_start..subject.end]
        )
    };
    let edit = if subject.self_closing {
        (subject.start, subject.end, replacement)
    } else {
        (subject.open_end, subject.close_start, bag)
    };
    apply_edits(text, vec![edit])
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn apply_edits(source: &str, edits: Vec<(usize, usize, String)>) -> Result<Vec<u8>, PrivacyError> {
    // Drop attrs and nested elements already covered by a larger removal.
    let removals: Vec<(usize, usize)> = edits
        .iter()
        .filter(|(_, _, replacement)| replacement.is_empty())
        .map(|(start, end, _)| (*start, *end))
        .collect();
    let mut kept: Vec<(usize, usize, String)> = edits
        .into_iter()
        .filter(|(start, end, replacement)| {
            if !replacement.is_empty() {
                return true;
            }
            !removals.iter().any(|(outer_start, outer_end)| {
                *outer_start <= *start
                    && *outer_end >= *end
                    && (*outer_start, *outer_end) != (*start, *end)
            })
        })
        .collect();
    kept.sort_by_key(|left| std::cmp::Reverse(left.0));
    let mut output = source.to_string();
    for (start, end, replacement) in kept {
        if end < start || end > output.len() || start > output.len() {
            return Err(PrivacyError::Unsupported);
        }
        output.replace_range(start..end, &replacement);
    }
    Ok(output.into_bytes())
}
