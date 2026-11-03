/// The preview request: the same inputs and options without a destination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversionPreviewRequest {
    pub inputs: Vec<ConversionInput>,
    pub converter_id: ConverterId,
    pub options: ConvertOptions,
    pub request_revision: u32,
}

impl ConversionPreviewRequest {
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.inputs.is_empty() || self.inputs.len() > MAX_CONVERSION_INPUTS {
            return Err(ConvertError::BadRequest);
        }
        for input in &self.inputs {
            match input {
                ConversionInput::File { path, .. } => {
                    if path.is_empty()
                        || path.encode_utf16().count() > MAX_PATH_UNITS
                        || !Path::new(path).is_absolute()
                    {
                        return Err(ConvertError::BadRequest);
                    }
                }
                ConversionInput::Snapshot { snapshot_id, .. } => {
                    if uuid::Uuid::try_parse(snapshot_id).is_err() {
                        return Err(ConvertError::BadRequest);
                    }
                }
            }
        }
        self.options.validate()
    }
}

/// One item's outcome. The reason is a stable code (`convert.*`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemStatus {
    Done,
    Skipped,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkItemResult {
    pub input_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    pub output_count: u32,
    pub status: WorkItemStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub metadata_lost: Vec<MetadataCategory>,
    pub bytes_written: u64,
}

/// One output that really exists on disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversionOutput {
    pub output_id: String,
    pub input_indices: Vec<u32>,
    pub output_index: u32,
    pub path: String,
    pub byte_len: u64,
}

/// One page of the conversion report. `created_paths` names only outputs
/// whose row is on this page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversionReport {
    pub report_id: String,
    pub items: Vec<WorkItemResult>,
    pub outputs: Vec<ConversionOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub created_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_id: Option<String>,
    pub input_total: u32,
    pub done_count: u32,
    pub failed_count: u32,
    pub skipped_count: u32,
    pub cancelled_count: u32,
    pub outputs_created: u32,
    pub cancelled: bool,
    pub job_finished: bool,
    pub complete: bool,
}

/// What the image adapter previews: a bounded PNG plus approximate numbers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversionPreviewData {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_ms: Option<u64>,
    #[serde(default)]
    pub warnings: Vec<ConversionWarningCode>,
    #[serde(default)]
    pub metadata_lost: Vec<MetadataCategory>,
}

impl ConversionPreviewData {
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.png.is_empty()
            || self.png.len() > MAX_PREVIEW_BYTES
            || !self.png.starts_with(b"\x89PNG\r\n\x1a\n")
            || self.width == 0
            || self.height == 0
            || u64::from(self.width) * u64::from(self.height) > MAX_IMAGE_PIXELS
            || self.warnings.len() > MAX_ACCEPTED
            || self.metadata_lost.len() > MAX_ACCEPTED
        {
            return Err(ConvertError::BadRequest);
        }
        Ok(())
    }
}

/// The exact part of the output name an adapter contributes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OutputNamePart {
    None,
    Page { page: u32 },
    Sheet { sheet: String },
}

/// A request to begin one output file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputDraft {
    /// Advisory only; the parent owns the real name.
    pub name_hint: String,
    pub name_part: OutputNamePart,
    pub mime: String,
    pub input_indices: Vec<u32>,
}

/// What the adapter knows when it finished one output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputMetadata {
    pub byte_len: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default)]
    pub metadata_lost: Vec<MetadataCategory>,
    #[serde(default)]
    pub warnings: Vec<ConversionWarningCode>,
    /// Lower-case hex SHA-256 of the exact output bytes.
    pub hash_sha256: String,
}

/// The adapter's final answer for one invocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreparedOutput {
    pub outputs_count: u32,
    #[serde(default)]
    pub metadata_lost: Vec<MetadataCategory>,
    #[serde(default)]
    pub warnings: Vec<ConversionWarningCode>,
}
