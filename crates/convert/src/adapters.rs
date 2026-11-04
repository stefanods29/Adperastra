//! The Step 08b adapter declarations and option-kind checks (D1, E1).
//!
//! The wire names are the interface; the Rust enum variant names of the 08a
//! registry are not fixed by that guide. The static specs are therefore built
//! from their exact JSON wire shape, and option-kind checks read the tagged
//! `ConvertOptions` wire shape. This keeps one canonical type set while
//! avoiding guessed private variant names.
//!
//! The TypeScript mirror is `src/convert/adapters08b.ts`.

use serde_json::{json, Value};

use crate::error::ConvertError;
use crate::types::{ConversionWarningCode, ConvertOptions, ConverterSpec};

/// The exact wire IDs this step adds (D1).
pub const CONVERTER_IDS_08B: [&str; 10] = [
    "images/pdf",
    "pdf/png",
    "pdf/jpeg",
    "markdown/html",
    "markdown/pdf",
    "html/pdf",
    "csv/xlsx",
    "xlsx/csv",
    "zip/seven_z",
    "seven_z/zip",
];

const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

/// The `ConvertOptions` kind each adapter requires.
pub fn options_kind_for_adapter(id: &str) -> Option<&'static str> {
    match id {
        "images/pdf" => Some("document"),
        "pdf/png" | "pdf/jpeg" => Some("pdf"),
        "markdown/html" | "markdown/pdf" | "html/pdf" => Some("document"),
        "csv/xlsx" | "xlsx/csv" => Some("table"),
        "zip/seven_z" | "seven_z/zip" => Some("archive"),
        // Step 12b media converters run in the native engine, but their
        // option family is still the shared tagged `media` shape.
        "media/video" | "media/audio" | "media/gif" => Some("media"),
        // Step 08a image adapters also participate in presets.
        "image/png" | "image/jpeg" | "image/webp" | "image/bmp" | "image/gif" | "image/tiff"
        | "svg/png" => Some("image"),
        _ => None,
    }
}

/// True when the tagged options kind matches the adapter exactly.
pub fn options_kind_matches(id: &str, options: &ConvertOptions) -> bool {
    let Some(expected) = options_kind_for_adapter(id) else {
        return false;
    };
    let Ok(value) = serde_json::to_value(options) else {
        return false;
    };
    value.get("kind").and_then(Value::as_str) == Some(expected)
}

/// The canonical target extension (no leading dot).
pub fn extension_for_converter(id: &str) -> Option<&'static str> {
    match id {
        "images/pdf" | "markdown/pdf" | "html/pdf" => Some("pdf"),
        "pdf/png" | "image/png" | "svg/png" => Some("png"),
        "pdf/jpeg" | "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        "image/gif" => Some("gif"),
        "image/tiff" => Some("tiff"),
        "markdown/html" => Some("html"),
        "csv/xlsx" => Some("xlsx"),
        "xlsx/csv" => Some("csv"),
        "zip/seven_z" => Some("7z"),
        "seven_z/zip" => Some("zip"),
        _ => None,
    }
}

/// True when the adapter is a `combine` adapter (one output from many
/// sources). Every other 08b adapter runs once per input.
pub fn is_combine_adapter(id: &str) -> bool {
    id == "images/pdf"
}

/// Reject an options kind before any output staging.
pub fn validate_options_kind(id: &str, options: &ConvertOptions) -> Result<(), ConvertError> {
    if options_kind_matches(id, options) {
        Ok(())
    } else {
        Err(ConvertError::BadRequest)
    }
}

/// The native preflight gate: every required warning must be acknowledged
/// before `sink.begin`. A missing one is `convert.warning_required`.
pub fn ensure_warnings_accepted(
    required: &[ConversionWarningCode],
    accepted: &[ConversionWarningCode],
) -> Result<(), ConvertError> {
    let accepted: std::collections::HashSet<String> = accepted
        .iter()
        .filter_map(|warning| serde_json::to_string(warning).ok())
        .collect();
    for warning in required {
        let key = serde_json::to_string(warning).map_err(|_| ConvertError::BadRequest)?;
        if !accepted.contains(&key) {
            return Err(ConvertError::WarningRequired);
        }
    }
    Ok(())
}

/// The ten static specs in their exact wire shape. The coordinator registers
/// them once through the Step 08a registry; no second registry exists.
pub fn adapter_specs_08b() -> Vec<ConverterSpec> {
    let specs = json!([
        spec(
            "images/pdf",
            ["png", "jpeg", "gif", "webp", "bmp", "tiff"],
            "pdf",
            "combine",
            512 * MIB,
            512 * MIB,
            false,
            &[],
            "pdf-lib-1.17.1",
            [
                option_choice(
                    "page_size",
                    "convert.pageSize",
                    "source",
                    [
                        ("source", "convert.pageSizeSource"),
                        ("a4", "convert.pageSizeA4"),
                        ("letter", "convert.pageSizeLetter")
                    ]
                ),
                option_integer("margin_mm", "convert.margin", 20, 0, 50)
            ]
        ),
        spec(
            "pdf/png",
            ["pdf"],
            "png",
            "each",
            512 * MIB,
            GIB,
            false,
            &[],
            "pdfjs-6.4.299",
            [option_integer("dpi", "convert.dpi", 150, 72, 600)]
        ),
        spec(
            "pdf/jpeg",
            ["pdf"],
            "jpeg",
            "each",
            512 * MIB,
            GIB,
            true,
            &[],
            "pdfjs-6.4.299",
            [
                option_integer("dpi", "convert.dpi", 150, 72, 600),
                option_integer("quality", "convert.quality", 90, 1, 100)
            ]
        ),
        spec(
            "markdown/html",
            ["md"],
            "html",
            "each",
            512 * MIB,
            512 * MIB,
            true,
            &[],
            "markdown-it-15.0.3",
            [option_bool("include_images", "convert.includeImages", true)]
        ),
        spec(
            "markdown/pdf",
            ["md"],
            "pdf",
            "each",
            512 * MIB,
            512 * MIB,
            true,
            &[],
            "pdf-lib-1.17.1",
            [
                option_bool("include_images", "convert.includeImages", true),
                option_choice(
                    "page_size",
                    "convert.pageSize",
                    "a4",
                    [
                        ("a4", "convert.pageSizeA4"),
                        ("letter", "convert.pageSizeLetter")
                    ]
                ),
                option_integer("margin_mm", "convert.margin", 20, 0, 50)
            ]
        ),
        spec(
            "html/pdf",
            ["html"],
            "pdf",
            "each",
            512 * MIB,
            512 * MIB,
            true,
            &[],
            "pdf-lib-1.17.1",
            [
                option_bool("include_images", "convert.includeImages", true),
                option_choice(
                    "page_size",
                    "convert.pageSize",
                    "a4",
                    [
                        ("a4", "convert.pageSizeA4"),
                        ("letter", "convert.pageSizeLetter")
                    ]
                ),
                option_integer("margin_mm", "convert.margin", 20, 0, 50)
            ]
        ),
        spec(
            "csv/xlsx",
            ["csv"],
            "xlsx",
            "each",
            512 * MIB,
            512 * MIB,
            false,
            &[],
            "rust_xlsxwriter-0.102.0",
            [
                option_choice(
                    "delimiter",
                    "convert.delimiter",
                    "comma",
                    [
                        ("comma", "table.delimiterComma"),
                        ("tab", "table.delimiterTab"),
                        ("semicolon", "table.delimiterSemicolon")
                    ]
                ),
                option_bool("header", "convert.header", true)
            ]
        ),
        spec(
            "xlsx/csv",
            ["xlsx"],
            "csv",
            "each",
            512 * MIB,
            512 * MIB,
            true,
            &[],
            "calamine-0.37.0",
            [
                option_choice(
                    "formulas",
                    "convert.formulas",
                    "text",
                    [
                        ("text", "convert.formulaText"),
                        ("preserve", "convert.formulaCached")
                    ]
                ),
                option_choice(
                    "dates",
                    "convert.dates",
                    "iso",
                    [("iso", "convert.datesIso"), ("text", "convert.datesText")]
                ),
                option_choice(
                    "newline",
                    "convert.newline",
                    "crlf",
                    [("crlf", "convert.newlineCrlf"), ("lf", "convert.newlineLf")]
                )
            ]
        ),
        spec(
            "zip/seven_z",
            ["zip"],
            "seven_z",
            "each",
            8 * GIB,
            8 * GIB,
            true,
            &["timestamps"],
            "archive-06e",
            [
                option_integer("level", "convert.compression", 6, 0, 9),
                option_bool("encrypt_names", "convert.encryptNames", false),
                option_bool("preserve_timestamps", "convert.preserveTimestamps", true)
            ]
        ),
        spec(
            "seven_z/zip",
            ["seven_z"],
            "zip",
            "each",
            8 * GIB,
            8 * GIB,
            true,
            &["timestamps"],
            "archive-06e",
            [
                option_integer("level", "convert.compression", 6, 0, 9),
                option_bool("preserve_timestamps", "convert.preserveTimestamps", true)
            ]
        )
    ]);
    serde_json::from_value(specs)
        .expect("the static 08b adapter specs match the canonical wire shape")
}

#[allow(clippy::too_many_arguments)]
fn spec(
    id: &str,
    inputs: impl IntoIterator<Item = &'static str>,
    output: &str,
    input_mode: &str,
    max_input_bytes: u64,
    max_output_bytes: u64,
    lossy: bool,
    preserves: &'static [&'static str],
    engine_id: &str,
    options: impl IntoIterator<Item = Value>,
) -> Value {
    json!({
        "id": id,
        "inputs": inputs.into_iter().collect::<Vec<_>>(),
        "output": output,
        "options": options.into_iter().collect::<Vec<_>>(),
        "input_mode": input_mode,
        "max_input_bytes": max_input_bytes,
        "max_output_bytes": max_output_bytes,
        "lossy": lossy,
        "preserves": preserves.to_vec(),
        "engine_id": engine_id,
        "available": true,
        "help_slug": "converting-files"
    })
}

fn option_bool(id: &str, label_key: &str, default: bool) -> Value {
    json!({"id": id, "label_key": label_key, "kind": "boolean", "default": default})
}

fn option_integer(id: &str, label_key: &str, default: i64, min: i64, max: i64) -> Value {
    json!({"id": id, "label_key": label_key, "kind": "integer", "default": default, "min": min, "max": max})
}

fn option_choice(
    id: &str,
    label_key: &str,
    default: &str,
    choices: impl IntoIterator<Item = (&'static str, &'static str)>,
) -> Value {
    json!({
        "id": id,
        "label_key": label_key,
        "kind": "choice",
        "default": default,
        "choices": choices.into_iter().map(|(value, key)| json!({"value": value, "label_key": key})).collect::<Vec<_>>()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_adapter_declares_its_exact_option_kind() {
        for id in CONVERTER_IDS_08B {
            assert!(options_kind_for_adapter(id).is_some(), "{id}");
            assert!(extension_for_converter(id).is_some(), "{id}");
        }
        assert!(is_combine_adapter("images/pdf"));
        assert!(!is_combine_adapter("pdf/png"));
    }

    #[test]
    fn a_missing_warning_acknowledgement_blocks_before_output() {
        let warning: ConversionWarningCode =
            serde_json::from_value(json!("formula_safety_prefix")).unwrap();
        assert!(matches!(
            ensure_warnings_accepted(std::slice::from_ref(&warning), &[]),
            Err(ConvertError::WarningRequired)
        ));
        assert!(ensure_warnings_accepted(std::slice::from_ref(&warning), &[warning]).is_ok());
    }

    #[test]
    fn specs_have_ten_unique_ids_and_bounded_sizes() {
        let specs = adapter_specs_08b();
        assert_eq!(specs.len(), 10);
        let mut ids = std::collections::HashSet::new();
        for spec in specs {
            assert!(ids.insert(serde_json::to_string(&spec.id).unwrap()));
            assert!(spec.max_input_bytes > 0);
            assert!(spec.max_output_bytes > 0);
            assert!(spec.available);
        }
    }
}
