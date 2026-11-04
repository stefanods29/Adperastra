//! The fixed property allowlist and the PROPVARIANT conversion used by the
//! metadata helper (Step 07b D4/D5).
//!
//! Nothing in the UI can name a Windows property: this table is the only
//! source of property names. A reader converts only the variant kinds the
//! table expects, never activates a COM object from a returned value, and
//! frees every returned variant through its RAII guard.

use crate::metadata_types::{
    duration_ms_from_ticks, filetime_to_iso8601, frame_rate_from_units, normalized_list,
    normalized_text, orientation_value, positive_dimension, MetadataFieldId, MetadataValue,
    MAX_LIST_ENTRIES,
};

/// One allowlisted property: the UI field it feeds and its canonical name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PropertySpec {
    pub field: MetadataFieldId,
    pub canonical_name: &'static str,
}

/// The complete allowlist, in display order (D5). Adding a row is the only
/// way a new fact can appear; arbitrary user-selected names never do.
pub const PROPERTY_SPECS: [PropertySpec; 15] = [
    PropertySpec {
        field: MetadataFieldId::Width,
        canonical_name: "System.Image.HorizontalSize",
    },
    PropertySpec {
        field: MetadataFieldId::Height,
        canonical_name: "System.Image.VerticalSize",
    },
    PropertySpec {
        field: MetadataFieldId::Orientation,
        canonical_name: "System.Photo.Orientation",
    },
    PropertySpec {
        field: MetadataFieldId::DateTaken,
        canonical_name: "System.Photo.DateTaken",
    },
    PropertySpec {
        field: MetadataFieldId::CameraMake,
        canonical_name: "System.Photo.CameraManufacturer",
    },
    PropertySpec {
        field: MetadataFieldId::CameraModel,
        canonical_name: "System.Photo.CameraModel",
    },
    PropertySpec {
        field: MetadataFieldId::DurationMs,
        canonical_name: "System.Media.Duration",
    },
    PropertySpec {
        field: MetadataFieldId::VideoCodec,
        canonical_name: "System.Video.Compression",
    },
    PropertySpec {
        field: MetadataFieldId::FrameRate,
        canonical_name: "System.Video.FrameRate",
    },
    PropertySpec {
        field: MetadataFieldId::AudioTitle,
        canonical_name: "System.Title",
    },
    PropertySpec {
        field: MetadataFieldId::AudioArtist,
        canonical_name: "System.Music.Artist",
    },
    PropertySpec {
        field: MetadataFieldId::AudioAlbum,
        canonical_name: "System.Music.AlbumTitle",
    },
    PropertySpec {
        field: MetadataFieldId::Author,
        canonical_name: "System.Author",
    },
    PropertySpec {
        field: MetadataFieldId::PageCount,
        canonical_name: "System.Document.PageCount",
    },
    PropertySpec {
        field: MetadataFieldId::WordCount,
        canonical_name: "System.Document.WordCount",
    },
];

/// The canonical name of one allowlisted field.
#[allow(dead_code)] // Fixed table helpers used by provider tests and later steps.
pub fn canonical_name(field: MetadataFieldId) -> &'static str {
    PROPERTY_SPECS
        .iter()
        .find(|spec| spec.field == field)
        .map(|spec| spec.canonical_name)
        .unwrap_or_default()
}

/// The field a canonical name belongs to. Unknown names are omitted.
#[allow(dead_code)]
pub fn field_for_property_name(name: &str) -> Option<MetadataFieldId> {
    PROPERTY_SPECS
        .iter()
        .find(|spec| spec.canonical_name == name)
        .map(|spec| spec.field)
}

/// Values read for a field, before its final bounds check.
///
/// Text fields take their first value; artist and author keep the list.
pub fn value_for_values(
    field: MetadataFieldId,
    values: Vec<String>,
    integer: Option<u64>,
    decimal: Option<f64>,
) -> Option<MetadataValue> {
    match field {
        MetadataFieldId::Width | MetadataFieldId::Height => {
            positive_dimension(integer?).map(|value| MetadataValue::Integer { value })
        }
        MetadataFieldId::Orientation => {
            orientation_value(integer? as i64).map(|value| MetadataValue::Integer { value })
        }
        MetadataFieldId::DateTaken => {
            let value = values.into_iter().next()?;
            Some(MetadataValue::Date { value })
        }
        MetadataFieldId::CameraMake
        | MetadataFieldId::CameraModel
        | MetadataFieldId::VideoCodec
        | MetadataFieldId::AudioTitle
        | MetadataFieldId::AudioAlbum => {
            normalized_text(values.into_iter().next()?).map(|value| MetadataValue::Text { value })
        }
        MetadataFieldId::DurationMs => {
            duration_ms_from_ticks(integer?).map(|value| MetadataValue::Integer { value })
        }
        MetadataFieldId::FrameRate => {
            // A fractional variant (VT_R4/VT_R8) is already frames per
            // second; the property's usual VT_UI4 is thousandths.
            if let Some(value) = decimal.filter(|value| value.is_finite() && *value > 0.0) {
                return Some(MetadataValue::Decimal { value });
            }
            let value = frame_rate_from_units(integer?)?;
            Some(MetadataValue::Decimal { value })
        }
        MetadataFieldId::AudioArtist | MetadataFieldId::Author => {
            let list = normalized_list(values);
            if list.is_empty() {
                None
            } else {
                Some(MetadataValue::List { value: list })
            }
        }
        MetadataFieldId::PageCount | MetadataFieldId::WordCount => {
            let value = integer?;
            (value <= u32::MAX as u64).then_some(MetadataValue::Integer { value })
        }
    }
}

/// Split a single string value into list entries (`a; b` is how Windows
/// stores many authors). Bounded before trimming.
pub fn split_list_text(text: &str) -> Vec<String> {
    text.split(';')
        .take(MAX_LIST_ENTRIES + 1)
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

/// Result preserves absent versus malformed/present and truncated values.
#[derive(Debug, Clone)]
pub enum PropertyRead {
    Absent,
    Value(MetadataValue),
    Partial(MetadataValue),
    Invalid,
}

/// LPWSTR scalar properties retain semicolons; only declared lists split.
pub fn values_for_text(field: MetadataFieldId, text: &str) -> Vec<String> {
    if matches!(
        field,
        MetadataFieldId::AudioArtist | MetadataFieldId::Author
    ) {
        split_list_text(text)
    } else {
        vec![text.to_string()]
    }
}

#[cfg(windows)]
#[path = "metadata_property_windows.rs"]
pub mod windows;

#[cfg(test)]
#[path = "metadata_properties_tests.rs"]
mod metadata_properties_tests;
