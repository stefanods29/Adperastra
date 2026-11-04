//! Bounded IPTC IIM inspection and rewriting inside a Photoshop APP13
//! resource (Step 08c D4/D5).
//!
//! IPTC location datasets 2:90/92/95/100/101 and creator datasets 2:80/85
//! participate in the GPS/author closures. Selecting the whole `iptc`
//! category removes the resource; it never pretends that unrelated records
//! were preserved.

use convert::MetadataCategory;

use crate::error::PrivacyError;
use crate::types::{Coverage, MetadataContainer, PrivacyField};

pub const MAX_IPTC_BYTES: usize = 1_048_576;
pub const MAX_IPTC_RECORDS: usize = 100_000;
const PHOTOSHOP_HEADER: &[u8] = b"Photoshop 3.0\0";
const IPTC_RESOURCE: u16 = 0x0404;

#[derive(Debug, Clone)]
struct Record {
    start: usize,
    end: usize,
    record: u8,
    dataset: u8,
    value: String,
}

fn sanitize(value: &str) -> String {
    let mut text = String::new();
    for character in value.chars().take(512) {
        text.push(if character.is_control() {
            ' '
        } else {
            character
        });
    }
    text
}

fn decode(value: &[u8]) -> String {
    std::str::from_utf8(value)
        .map(str::to_string)
        .unwrap_or_else(|_| value.iter().map(|byte| char::from(*byte)).collect())
}

fn parse_records(iptc: &[u8]) -> Result<Vec<Record>, PrivacyError> {
    if iptc.len() > MAX_IPTC_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    let mut records = Vec::new();
    let mut index = 0usize;
    while index < iptc.len() {
        if iptc[index] != 0x1c {
            // Tolerate padding but never reinterpret arbitrary bytes.
            index += 1;
            continue;
        }
        if index + 5 > iptc.len() {
            break;
        }
        let start = index;
        let record = iptc[index + 1];
        let dataset = iptc[index + 2];
        let mut length = u16::from_be_bytes([iptc[index + 3], iptc[index + 4]]) as usize;
        index += 5;
        if length & 0x8000 != 0 {
            if index + 2 > iptc.len() {
                return Err(PrivacyError::Unsupported);
            }
            let low = u16::from_be_bytes([iptc[index], iptc[index + 1]]) as usize;
            length = ((length & 0x7fff) << 16) | low;
            index += 2;
        }
        if length > MAX_IPTC_BYTES || index + length > iptc.len() {
            return Err(PrivacyError::Unsupported);
        }
        records.push(Record {
            start,
            end: index + length,
            record,
            dataset,
            value: decode(&iptc[index..index + length]),
        });
        if records.len() > MAX_IPTC_RECORDS {
            return Err(PrivacyError::TooLarge);
        }
        index += length;
    }
    Ok(records)
}

fn category_for(record: u8, dataset: u8) -> Option<MetadataCategory> {
    if record != 2 {
        return None;
    }
    match dataset {
        90 | 92 | 95 | 100 | 101 => Some(MetadataCategory::Gps),
        80 | 85 | 116 => Some(MetadataCategory::Author),
        55 | 60 => Some(MetadataCategory::Date),
        105 | 120 => Some(MetadataCategory::Comments),
        _ => None,
    }
}

fn label_key(category: &MetadataCategory) -> &'static str {
    match category {
        MetadataCategory::Gps => "privacy.gps",
        MetadataCategory::Author => "privacy.author",
        MetadataCategory::Date => "privacy.date",
        MetadataCategory::Comments => "privacy.comments",
        MetadataCategory::Iptc => "privacy.iptc",
        _ => "privacy.iptc",
    }
}

/// Inspect the raw IIM block (without the APP13 wrapper).
pub fn inspect_fields(iptc: &[u8]) -> Result<Vec<PrivacyField>, PrivacyError> {
    let records = parse_records(iptc)?;
    let mut fields = vec![PrivacyField {
        category: MetadataCategory::Iptc,
        containers: vec![MetadataContainer::Iptc],
        related_categories: Vec::new(),
        field_id: "iptc.block".to_string(),
        label_key: "privacy.iptc".to_string(),
        preview: String::new(),
        count: 1,
        content_affecting: false,
        coverage: Coverage::Complete,
    }];
    for record in records {
        if let Some(category) = category_for(record.record, record.dataset) {
            fields.push(PrivacyField {
                category,
                containers: vec![MetadataContainer::Iptc],
                related_categories: Vec::new(),
                field_id: format!("iptc.{}.{}", record.record, record.dataset),
                label_key: label_key(&category).to_string(),
                preview: sanitize(&record.value),
                count: 1,
                content_affecting: false,
                coverage: Coverage::Complete,
            });
        }
    }
    Ok(fields)
}

/// Remove selected datasets; `Iptc` means remove the whole IIM block.
pub fn remove_categories(
    iptc: &[u8],
    categories: &[MetadataCategory],
) -> Result<Option<Vec<u8>>, PrivacyError> {
    if categories.contains(&MetadataCategory::Iptc) {
        return Ok(None);
    }
    let records = parse_records(iptc)?;
    let selected = crate::sorted_categories(categories);
    let mut output = Vec::with_capacity(iptc.len());
    let mut cursor = 0usize;
    for record in records {
        let remove = selected.iter().any(|category| {
            category_for(record.record, record.dataset)
                .as_ref()
                .is_some_and(|value| value == category)
        });
        if remove {
            output.extend_from_slice(&iptc[cursor..record.start]);
        } else {
            output.extend_from_slice(&iptc[cursor..record.end]);
        }
        cursor = record.end;
    }
    output.extend_from_slice(&iptc[cursor..]);
    Ok(Some(output))
}

/// Read one Photoshop resource from an APP13 payload.
pub fn read_resource(app13: &[u8], wanted: u16) -> Result<Option<Vec<u8>>, PrivacyError> {
    if app13.len() > MAX_IPTC_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    if !app13.starts_with(PHOTOSHOP_HEADER) {
        return Ok(None);
    }
    let mut index = PHOTOSHOP_HEADER.len();
    while index + 8 <= app13.len() {
        if &app13[index..index + 4] != b"8BIM" {
            return Err(PrivacyError::Unsupported);
        }
        let resource = u16::from_be_bytes([app13[index + 4], app13[index + 5]]);
        index += 6;
        let name_length = *app13.get(index).ok_or(PrivacyError::Unsupported)? as usize;
        index += 1 + name_length;
        if name_length.is_multiple_of(2) {
            index += 1;
        }
        if index + 4 > app13.len() {
            return Err(PrivacyError::Unsupported);
        }
        let size = u32::from_be_bytes([
            app13[index],
            app13[index + 1],
            app13[index + 2],
            app13[index + 3],
        ]) as usize;
        index += 4;
        if size > MAX_IPTC_BYTES || index + size > app13.len() {
            return Err(PrivacyError::Unsupported);
        }
        if resource == wanted {
            return Ok(Some(app13[index..index + size].to_vec()));
        }
        index += size + (size & 1);
    }
    Ok(None)
}

/// Rebuild an APP13 payload with the selected resource removed. `None`
/// means the payload has no other resource and the whole segment goes.
pub fn remove_resource(app13: &[u8], wanted: u16) -> Result<Option<Vec<u8>>, PrivacyError> {
    if app13.len() > MAX_IPTC_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    if !app13.starts_with(PHOTOSHOP_HEADER) {
        return Ok(Some(app13.to_vec()));
    }
    let mut output = Vec::with_capacity(app13.len());
    output.extend_from_slice(PHOTOSHOP_HEADER);
    let mut index = PHOTOSHOP_HEADER.len();
    let mut removed = false;
    while index + 8 <= app13.len() {
        let start = index;
        if &app13[index..index + 4] != b"8BIM" {
            return Err(PrivacyError::Unsupported);
        }
        let resource = u16::from_be_bytes([app13[index + 4], app13[index + 5]]);
        index += 6;
        let name_length = *app13.get(index).ok_or(PrivacyError::Unsupported)? as usize;
        index += 1 + name_length;
        if name_length.is_multiple_of(2) {
            index += 1;
        }
        if index + 4 > app13.len() {
            return Err(PrivacyError::Unsupported);
        }
        let size = u32::from_be_bytes([
            app13[index],
            app13[index + 1],
            app13[index + 2],
            app13[index + 3],
        ]) as usize;
        index += 4 + size + (size & 1);
        if index > app13.len() {
            return Err(PrivacyError::Unsupported);
        }
        if resource == wanted {
            removed = true;
        } else {
            output.extend_from_slice(&app13[start..index]);
        }
    }
    if removed && output.len() == PHOTOSHOP_HEADER.len() {
        Ok(None)
    } else {
        Ok(Some(output))
    }
}

/// Replace the IPTC resource in an APP13 payload.
pub fn replace_resource(app13: &[u8], value: &[u8]) -> Result<Vec<u8>, PrivacyError> {
    if value.len() > MAX_IPTC_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    let Some(without) = remove_resource(app13, IPTC_RESOURCE)? else {
        return Ok(Vec::new());
    };
    let mut output = without;
    if output.len() < PHOTOSHOP_HEADER.len() {
        output = PHOTOSHOP_HEADER.to_vec();
    }
    output.extend_from_slice(b"8BIM");
    output.extend_from_slice(&IPTC_RESOURCE.to_be_bytes());
    output.push(0);
    output.push(0);
    output.extend_from_slice(&(value.len() as u32).to_be_bytes());
    output.extend_from_slice(value);
    if value.len() % 2 == 1 {
        output.push(0);
    }
    Ok(output)
}
