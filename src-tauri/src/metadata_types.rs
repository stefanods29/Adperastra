//! Rich file facts (Step 07b, contract 21): the fixed, bounded data that the
//! Windows property helper may report. `src/services/metadata.ts` mirrors
//! every type below with the same names; only these allowlisted IDs ever
//! travel to the UI, and a wrong-kind value is dropped, never coerced (D5).

use serde::{Deserialize, Serialize};
use std::path::{Component, Path};

use fs_service::SourceStamp;

/// The most fields one result carries (the allowlist has 15).
pub const MAX_FIELDS: usize = 16;
/// The longest text one field carries, in characters.
pub const MAX_TEXT_CHARS: usize = 4_096;
/// The most entries one list value carries.
pub const MAX_LIST_ENTRIES: usize = 16;
/// The longest request path, in UTF-16 units (same bound as 07a).
pub const MAX_PATH_UNITS: usize = 32_768;
/// The largest serialized result (D5); JS-safe integers only.
pub const MAX_SERIALIZED_BYTES: usize = 64 * 1024;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// The fixed field allowlist, in display order (D5). The wire names are the
/// table's IDs; `src/services/metadata.ts` lists the same names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataFieldId {
    Width,
    Height,
    Orientation,
    DateTaken,
    CameraMake,
    CameraModel,
    DurationMs,
    VideoCodec,
    FrameRate,
    AudioTitle,
    AudioArtist,
    AudioAlbum,
    Author,
    PageCount,
    WordCount,
}

/// Every ID in display order (the order of `MetadataInfo.fields`).
pub const ALL_FIELD_IDS: [MetadataFieldId; 15] = [
    MetadataFieldId::Width,
    MetadataFieldId::Height,
    MetadataFieldId::Orientation,
    MetadataFieldId::DateTaken,
    MetadataFieldId::CameraMake,
    MetadataFieldId::CameraModel,
    MetadataFieldId::DurationMs,
    MetadataFieldId::VideoCodec,
    MetadataFieldId::FrameRate,
    MetadataFieldId::AudioTitle,
    MetadataFieldId::AudioArtist,
    MetadataFieldId::AudioAlbum,
    MetadataFieldId::Author,
    MetadataFieldId::PageCount,
    MetadataFieldId::WordCount,
];

impl MetadataFieldId {
    /// Position in the fixed table, used for sorting and de-duplicating.
    pub fn index(self) -> usize {
        ALL_FIELD_IDS
            .iter()
            .position(|candidate| *candidate == self)
            .unwrap_or(ALL_FIELD_IDS.len())
    }
}

/// One fact's value. The wrong variant for a field is refused, never
/// coerced (D5): a number is never shown as text and text is never parsed
/// into a number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MetadataValue {
    Text {
        value: String,
    },
    Integer {
        value: u64,
    },
    Decimal {
        value: f64,
    },
    /// ISO 8601 UTC (`1970-01-01T03:04:05Z`). Local guessing never happens.
    Date {
        value: String,
    },
    List {
        value: Vec<String>,
    },
}

/// One field and its value (wire type).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetadataField {
    pub id: MetadataFieldId,
    pub value: MetadataValue,
}

/// Everything one successful read reports (wire type). The UI translates
/// nothing here: it only formats these values (R-LANG). `PartialEq` is
/// deliberately not derived: the producer's `SourceStamp` contract does not
/// promise it, so [`same_stamp`] compares the documented fields instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataInfo {
    /// The exact source revision the facts belong to.
    pub source: SourceStamp,
    /// At most `MAX_FIELDS`, sorted in table order, each ID once.
    pub fields: Vec<MetadataField>,
    /// True when a present field could not be reported safely.
    #[serde(default)]
    pub partial: bool,
    /// The fields that were present but could not be reported.
    #[serde(default)]
    pub missing: Vec<MetadataFieldId>,
}

/// Compare the documented `SourceStamp` fields without requiring the
/// producer to derive `PartialEq`.
pub fn same_stamp(left: &SourceStamp, right: &SourceStamp) -> bool {
    left.path_key == right.path_key
        && left.volume_id == right.volume_id
        && left.file_id == right.file_id
        && left.modified_ticks == right.modified_ticks
        && left.size_bytes == right.size_bytes
}

impl MetadataInfo {
    pub fn new(source: SourceStamp) -> Self {
        Self {
            source,
            fields: Vec::new(),
            partial: false,
            missing: Vec::new(),
        }
    }

    /// Add a raw field; [`Self::finalize`] validates and bounds it.
    pub fn push(&mut self, field: MetadataField) {
        if self.fields.len() < MAX_FIELDS {
            self.fields.push(field);
        }
    }

    /// Sort, de-duplicate, drop values that do not match their field, and
    /// keep the serialized result inside the 64 KiB payload limit.
    pub fn finalize(mut self) -> Self {
        let mut fields: Vec<MetadataField> = Vec::with_capacity(self.fields.len());
        let mut seen = [false; ALL_FIELD_IDS.len()];
        let mut missing = std::mem::take(&mut self.missing);
        missing.sort();
        missing.dedup();
        for field in self.fields.drain(..) {
            let index = field.id.index();
            if index >= seen.len() || seen[index] {
                continue;
            }
            if let MetadataValue::List { value } = &field.value {
                if value.len() > MAX_LIST_ENTRIES
                    || value
                        .iter()
                        .any(|text| text.chars().count() > MAX_TEXT_CHARS)
                {
                    self.partial = true;
                    missing.push(field.id);
                }
            }
            match normalized_value(field.id, field.value) {
                Some(value) => {
                    seen[index] = true;
                    fields.push(MetadataField {
                        id: field.id,
                        value,
                    });
                }
                None => {
                    self.partial = true;
                    if !missing.contains(&field.id) {
                        missing.push(field.id);
                    }
                }
            }
        }
        fields.sort_by_key(|field| field.id);
        loop {
            let candidate = MetadataInfo {
                source: self.source.clone(),
                fields: fields.clone(),
                partial: self.partial || !missing.is_empty(),
                missing: missing.clone(),
            };
            let length = serde_json::to_vec(&candidate)
                .map(|bytes| bytes.len())
                .unwrap_or(usize::MAX);
            if length <= MAX_SERIALIZED_BYTES || fields.is_empty() {
                break;
            }
            if let Some(dropped) = fields.pop() {
                if !missing.contains(&dropped.id) {
                    missing.push(dropped.id);
                }
            }
        }
        missing.sort_by_key(|id| id.index());
        missing.dedup();
        missing.truncate(MAX_FIELDS);
        self.fields = fields;
        self.missing = missing;
        self.partial = self.partial || !self.missing.is_empty();
        self
    }

    /// Enforce the DTO limit even when the source path alone exceeds it.
    pub fn validated(self) -> Result<Self, String> {
        self.source
            .validate()
            .map_err(|_| "metadata.bad_request".to_string())?;
        let info = self.finalize();
        let bytes = serde_json::to_vec(&info).map_err(|_| "metadata.failed".to_string())?;
        if bytes.len() > MAX_SERIALIZED_BYTES {
            return Err("metadata.too_large".into());
        }
        Ok(info)
    }
}

#[path = "metadata_values.rs"]
mod values;
pub use values::*;

/// What the UI asks for (wire type). It names a path and its own consumer
/// only; no source identity or Windows property name is accepted (D4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetadataRequest {
    pub path: String,
    pub consumer_id: String,
}

/// Validate a request before any disk work (`metadata.bad_request`).
pub fn validate_request(request: &MetadataRequest) -> Result<(), String> {
    if request.path.encode_utf16().count() > MAX_PATH_UNITS {
        return Err("metadata.bad_request".to_string());
    }
    fs_service::validate_path_input(&request.path)
        .map_err(|_| "metadata.bad_request".to_string())?;
    let path = Path::new(&request.path);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("metadata.bad_request".to_string());
    }
    let consumer = uuid::Uuid::parse_str(&request.consumer_id)
        .map_err(|_| "metadata.bad_request".to_string())?;
    if consumer.hyphenated().to_string() != request.consumer_id.to_ascii_lowercase() {
        return Err("metadata.bad_request".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "metadata_types_tests.rs"]
mod metadata_types_tests;
