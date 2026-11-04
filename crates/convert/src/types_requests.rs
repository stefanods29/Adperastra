/// One input: a guarded disk file, or an immutable editor snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConversionInput {
    File {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected: Option<SourceStamp>,
    },
    Snapshot {
        snapshot_id: String,
        document_id: String,
        revision: u64,
    },
}

impl ConversionInput {
    pub fn file(path: impl Into<String>) -> Self {
        Self::File {
            path: path.into(),
            expected: None,
        }
    }

    pub fn path(&self) -> Option<&str> {
        match self {
            ConversionInput::File { path, .. } => Some(path),
            ConversionInput::Snapshot { .. } => None,
        }
    }
}

/// The naming grammar. 08a accepts only `{stem}.{ext}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversionNaming {
    pub pattern: String,
    /// UTC date `YYYY-MM-DD`, captured once when the user confirms.
    pub date_utc: String,
    pub start_index: u32,
}

impl Default for ConversionNaming {
    fn default() -> Self {
        Self {
            pattern: DEFAULT_NAMING_PATTERN.to_string(),
            date_utc: String::new(),
            start_index: 1,
        }
    }
}

impl ConversionNaming {
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.pattern != DEFAULT_NAMING_PATTERN
            || self.pattern.len() > MAX_NAMING_PATTERN
            || self.start_index == 0
        {
            return Err(ConvertError::BadRequest);
        }
        if !self.date_utc.is_empty() && !is_utc_date(&self.date_utc) {
            return Err(ConvertError::BadRequest);
        }
        Ok(())
    }
}

/// A UTC date in `YYYY-MM-DD` form, with a real calendar day.
pub fn is_utc_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        return false;
    }
    let year: i32 = value[0..4].parse().unwrap_or(0);
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    if !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day <= days
}

/// The complete request the dialog sends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversionRequest {
    pub inputs: Vec<ConversionInput>,
    pub converter_id: ConverterId,
    pub options: ConvertOptions,
    pub dest_dir: String,
    pub keep_original: bool,
    #[serde(default)]
    pub accepted_losses: Vec<MetadataCategory>,
    #[serde(default)]
    pub accepted_warning_codes: Vec<ConversionWarningCode>,
    pub request_revision: u32,
    #[serde(default)]
    pub naming: ConversionNaming,
}

impl ConversionRequest {
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.inputs.is_empty() || self.inputs.len() > MAX_CONVERSION_INPUTS {
            return Err(ConvertError::BadRequest);
        }
        // Replacement stays unavailable until Step 09f proves an exact
        // approved-object contract; this round never deletes an original.
        if !self.keep_original {
            return Err(ConvertError::BadRequest);
        }
        if self.dest_dir.is_empty()
            || self.dest_dir.encode_utf16().count() > MAX_PATH_UNITS
            || !Path::new(&self.dest_dir).is_absolute()
        {
            return Err(ConvertError::BadRequest);
        }
        for input in &self.inputs {
            match input {
                ConversionInput::File { path, expected } => {
                    if path.is_empty()
                        || path.encode_utf16().count() > MAX_PATH_UNITS
                        || !Path::new(path).is_absolute()
                    {
                        return Err(ConvertError::BadRequest);
                    }
                    if let Some(stamp) = expected {
                        stamp.validate().map_err(|_| ConvertError::BadRequest)?;
                    }
                }
                ConversionInput::Snapshot {
                    snapshot_id,
                    document_id,
                    revision,
                } => {
                    if uuid::Uuid::try_parse(snapshot_id).is_err()
                        || document_id.is_empty()
                        || document_id.len() > MAX_NAME_UNITS
                        || *revision == 0
                    {
                        return Err(ConvertError::BadRequest);
                    }
                }
            }
        }
        if !unique(&self.accepted_losses) || self.accepted_losses.len() > MAX_ACCEPTED {
            return Err(ConvertError::BadRequest);
        }
        if !unique(&self.accepted_warning_codes) || self.accepted_warning_codes.len() > MAX_ACCEPTED
        {
            return Err(ConvertError::BadRequest);
        }
        self.options.validate()?;
        self.naming.validate()?;
        Ok(())
    }
}

fn unique<T: Ord>(items: &[T]) -> bool {
    let mut seen = BTreeSet::new();
    items.iter().all(|item| seen.insert(item))
}

