//! The CSV/XLSX converter adapter (Step 08b D5, D6, E1).
//!
//! One `Converter` implementation for both directions. The common 08a
//! queue, preview, publication and report own everything outside this file;
//! this adapter only reads typed numbers/strings from the canonical readers,
//! prepares bounded output bytes and calls the shared sink.
//!
//! Required warnings are computed before any `sink.begin`:
//! `formula_cached_value`, `formula_safety_prefix` and `sheet_selection`.
//! The native preflight in the 08a request path compares them with
//! `ConversionRequest.accepted_warning_codes`.

use std::sync::atomic::Ordering;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::adapters::{adapter_specs_08b, validate_options_kind};
use crate::csv_output::{write_csv_sheet, CsvWriteOptions, DatePolicy, FormulaPolicy};
use crate::error::ConvertError;
use crate::table_read::{read_csv, read_xlsx, CellValue, SheetData};
use crate::table_write::write_xlsx;
use crate::types::{
    ConversionPreviewData, ConversionWarningCode, ConvertOptions, ConverterSpec, OutputDraft,
    OutputMetadata, OutputNamePart, PreparedOutput,
};

/// The two table adapter IDs this module implements.
pub const TABLE_CONVERTER_IDS: [&str; 2] = ["csv/xlsx", "xlsx/csv"];

/// The CSV-to-XLSX adapter.
pub struct TableConverter {
    id: &'static str,
    spec: ConverterSpec,
}

impl TableConverter {
    pub fn new(id: &'static str) -> Result<Self, ConvertError> {
        if !TABLE_CONVERTER_IDS.contains(&id) {
            return Err(ConvertError::Unsupported);
        }
        let id_json = format!("\"{id}\"");
        let spec = adapter_specs_08b()
            .into_iter()
            .find(|spec| serde_json::to_string(&spec.id).ok().as_deref() == Some(id_json.as_str()))
            .ok_or(ConvertError::Unsupported)?;
        Ok(Self { id, spec })
    }

    /// The warnings the exact input/options pair requires before output.
    pub fn requirements(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
    ) -> Result<Vec<ConversionWarningCode>, ConvertError> {
        validate_options_kind(self.id, options)?;
        if inputs.is_empty() {
            return Err(ConvertError::BadRequest);
        }
        let token = fs_service::new_cancellation_token();
        let bytes = read_source(&mut inputs[0], 512 * 1024 * 1024, &token)?;
        let value = option_value(options)?;
        let mut warnings = Vec::new();
        if self.id == "xlsx/csv" {
            let sheet = value.get("sheet").and_then(Value::as_str);
            let workbook = read_xlsx(&bytes, sheet, &fs_service::new_cancellation_token())?;
            if sheet.is_some() && workbook.total_sheets > 1 {
                warnings.push(warning("sheet_selection")?);
            }
            let policy = formula_policy(&value)?;
            if policy == FormulaPolicy::Preserve && workbook.cached_missing {
                warnings.push(warning("formula_cached_value")?);
            }
            let write_options = csv_options(&value)?;
            for sheet in &workbook.sheets {
                let result = write_csv_sheet(sheet, &write_options)?;
                if result.safety_prefix_count > 0 {
                    warnings.push(warning("formula_safety_prefix")?);
                    break;
                }
            }
        }
        warnings.sort_by_key(|warning| serde_json::to_string(warning).unwrap_or_default());
        warnings.dedup_by(|a, b| serde_json::to_string(a).ok() == serde_json::to_string(b).ok());
        Ok(warnings)
    }

    fn convert_table(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        output: &mut dyn ConvertOutputSink,
        context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError> {
        validate_options_kind(self.id, options)?;
        if inputs.is_empty() {
            return Err(ConvertError::BadRequest);
        }
        let value = option_value(options)?;
        let bytes = read_source(&mut inputs[0], self.spec.max_input_bytes, &context.cancel)?;
        let mut warnings = Vec::new();
        let mut outputs = 0u32;
        let metadata_lost = Vec::new();

        if self.id == "csv/xlsx" {
            let delimiter = delimiter_of(&value)?;
            let header = value.get("header").and_then(Value::as_bool).unwrap_or(true);
            let sheet = read_csv(&bytes, delimiter, &context.cancel)?;
            let workbook = write_xlsx(&[sheet], header, context.max_output_bytes)?;
            let draft = OutputDraft {
                name_hint: inputs[0].name.clone(),
                name_part: name_part_none()?,
                mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    .to_string(),
                input_indices: vec![0],
            };
            publish_one(
                output,
                draft,
                &workbook,
                warnings.clone(),
                metadata_lost.clone(),
                context,
            )?;
            outputs = 1;
        } else {
            let sheet = value.get("sheet").and_then(Value::as_str);
            let workbook = read_xlsx(&bytes, sheet, &context.cancel)?;
            if sheet.is_some() && workbook.total_sheets > 1 {
                warnings.push(warning("sheet_selection")?);
            }
            let policy = formula_policy(&value)?;
            if policy == FormulaPolicy::Preserve && workbook.cached_missing {
                warnings.push(warning("formula_cached_value")?);
            }
            let write_options = csv_options(&value)?;
            for sheet in &workbook.sheets {
                if context.cancel.load(Ordering::Relaxed) {
                    return Err(ConvertError::Cancelled);
                }
                let result = write_csv_sheet(sheet, &write_options)?;
                if result.safety_prefix_count > 0 {
                    warnings.push(warning("formula_safety_prefix")?);
                }
                let draft = OutputDraft {
                    name_hint: format!("{}-{}.csv", stem_of(&inputs[0].name), sheet.name),
                    name_part: name_part_sheet(&sheet.name)?,
                    mime: "text/csv".to_string(),
                    input_indices: vec![0],
                };
                publish_one(
                    output,
                    draft,
                    &result.bytes,
                    warnings.clone(),
                    metadata_lost.clone(),
                    context,
                )?;
                outputs += 1;
            }
        }
        if outputs == 0 {
            return Err(ConvertError::BadRequest);
        }
        warnings.sort_by_key(|warning| serde_json::to_string(warning).unwrap_or_default());
        warnings.dedup_by(|a, b| serde_json::to_string(a).ok() == serde_json::to_string(b).ok());
        Ok(PreparedOutput {
            outputs_count: outputs,
            metadata_lost,
            warnings,
        })
    }
}

impl Converter for TableConverter {
    fn spec(&self) -> ConverterSpec {
        self.spec.clone()
    }

    fn required_warnings(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
    ) -> Result<Vec<ConversionWarningCode>, ConvertError> {
        self.requirements(inputs, options)
    }

    fn preview(
        &self,
        _inputs: &mut [ConvertSource],
        _options: &ConvertOptions,
        _context: &mut ConvertContext,
    ) -> Result<ConversionPreviewData, ConvertError> {
        // The queue shows a text summary and the original file facts for
        // non-image formats; a fabricated bitmap would look like a real
        // document preview. The UI labels this as unavailable.
        Err(ConvertError::Unsupported)
    }

    fn convert(
        &self,
        inputs: &mut [ConvertSource],
        options: &ConvertOptions,
        output: &mut dyn ConvertOutputSink,
        context: &mut ConvertContext,
    ) -> Result<PreparedOutput, ConvertError> {
        self.convert_table(inputs, options, output, context)
    }
}

fn publish_one(
    output: &mut dyn ConvertOutputSink,
    draft: OutputDraft,
    bytes: &[u8],
    warnings: Vec<ConversionWarningCode>,
    metadata_lost: Vec<crate::types::MetadataCategory>,
    context: &mut ConvertContext,
) -> Result<(), ConvertError> {
    let index = output.begin(draft)?;
    let result = (|| {
        for chunk in bytes.chunks(1024 * 1024) {
            if context.cancel.load(Ordering::Relaxed) {
                return Err(ConvertError::Cancelled);
            }
            output.write(index, chunk)?;
        }
        output.finish(
            index,
            OutputMetadata {
                byte_len: bytes.len() as u64,
                width: None,
                height: None,
                metadata_lost,
                warnings,
                hash_sha256: sha256_hex(bytes),
            },
        )
    })();
    if result.is_err() {
        let _ = output.abort(index);
    }
    result
}

fn read_source(
    source: &mut ConvertSource,
    max_bytes: u64,
    token: &fs_service::CancellationToken,
) -> Result<Vec<u8>, ConvertError> {
    if source.byte_len > max_bytes {
        return Err(ConvertError::TooLarge);
    }
    let mut bytes =
        Vec::with_capacity(usize::try_from(source.byte_len.min(max_bytes)).unwrap_or(0));
    use std::io::{Seek, SeekFrom};
    source
        .reader
        .seek(SeekFrom::Start(0))
        .map_err(ConvertError::Io)?;
    let reader = &mut *source.reader;
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return Err(ConvertError::Cancelled);
        }
        let read = reader.read(&mut buffer).map_err(ConvertError::Io)?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > max_bytes {
            return Err(ConvertError::TooLarge);
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    if total != source.byte_len {
        return Err(ConvertError::Changed);
    }
    source
        .reader
        .seek(SeekFrom::Start(0))
        .map_err(ConvertError::Io)?;
    Ok(bytes)
}

fn option_value(options: &ConvertOptions) -> Result<Value, ConvertError> {
    let value = serde_json::to_value(options).map_err(|_| ConvertError::BadRequest)?;
    if value.get("kind").and_then(Value::as_str) != Some("table") {
        return Err(ConvertError::BadRequest);
    }
    Ok(value.get("value").cloned().unwrap_or(Value::Null))
}

fn delimiter_of(value: &Value) -> Result<u8, ConvertError> {
    match value.get("delimiter").and_then(Value::as_str) {
        Some("comma") | None => Ok(b','),
        Some("tab") => Ok(b'\t'),
        Some("semicolon") => Ok(b';'),
        _ => Err(ConvertError::BadRequest),
    }
}

fn formula_policy(value: &Value) -> Result<FormulaPolicy, ConvertError> {
    match value.get("formulas").and_then(Value::as_str) {
        Some("preserve") => Ok(FormulaPolicy::Preserve),
        Some("text") | None => Ok(FormulaPolicy::Text),
        _ => Err(ConvertError::BadRequest),
    }
}

fn csv_options(value: &Value) -> Result<CsvWriteOptions, ConvertError> {
    let delimiter = delimiter_of(value)?;
    let newline = match value.get("newline").and_then(Value::as_str) {
        Some("lf") => "\n",
        Some("crlf") | None => "\r\n",
        _ => return Err(ConvertError::BadRequest),
    };
    let dates = match value.get("dates").and_then(Value::as_str) {
        Some("text") => DatePolicy::Text,
        Some("iso") | None => DatePolicy::Iso,
        _ => return Err(ConvertError::BadRequest),
    };
    Ok(CsvWriteOptions {
        delimiter,
        newline,
        formulas: formula_policy(value)?,
        dates,
    })
}

fn warning(code: &str) -> Result<ConversionWarningCode, ConvertError> {
    serde_json::from_value(json!(code)).map_err(|_| ConvertError::BadRequest)
}

fn name_part_none() -> Result<OutputNamePart, ConvertError> {
    serde_json::from_value(json!({"kind":"none"})).map_err(|_| ConvertError::BadRequest)
}

fn name_part_sheet(sheet: &str) -> Result<OutputNamePart, ConvertError> {
    serde_json::from_value(json!({"kind":"sheet","sheet":sheet}))
        .map_err(|_| ConvertError::BadRequest)
}

fn stem_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => name.to_string(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[allow(dead_code)]
fn cell_text_for_test(cell: &CellValue) -> String {
    match cell {
        CellValue::Text(text) => text.clone(),
        CellValue::Number(number) => number.to_string(),
        CellValue::Bool(value) => value.to_string(),
        CellValue::DateIso(value) => value.clone(),
        CellValue::Formula { text, .. } => text.clone(),
        CellValue::Empty => String::new(),
    }
}

#[allow(dead_code)]
fn sheet_names(sheets: &[SheetData]) -> Vec<&str> {
    sheets.iter().map(|sheet| sheet.name.as_str()).collect()
}

use crate::registry::{ConvertContext, ConvertOutputSink, ConvertSource, Converter};
