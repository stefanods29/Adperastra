/// One choice of an integer/choice option (format data, not user text).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OptionChoice {
    pub value: String,
    pub label_key: String,
}

/// One option an adapter exposes to the dialog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptionSpec {
    pub id: String,
    pub label_key: String,
    /// `boolean`, `integer` or `choice`.
    pub kind: String,
    /// A bool, a finite integer or a string, matching `kind`.
    pub default: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<OptionChoice>>,
}

impl OptionSpec {
    pub fn boolean(id: &str, label_key: &str, default: bool) -> Self {
        Self {
            id: id.to_string(),
            label_key: label_key.to_string(),
            kind: "boolean".to_string(),
            default: serde_json::Value::Bool(default),
            min: None,
            max: None,
            choices: None,
        }
    }

    pub fn integer(id: &str, label_key: &str, default: i64, min: i64, max: i64) -> Self {
        Self {
            id: id.to_string(),
            label_key: label_key.to_string(),
            kind: "integer".to_string(),
            default: serde_json::Value::Number(default.into()),
            min: Some(min),
            max: Some(max),
            choices: None,
        }
    }

    pub fn choice(id: &str, label_key: &str, default: &str, choices: &[(&str, &str)]) -> Self {
        Self {
            id: id.to_string(),
            label_key: label_key.to_string(),
            kind: "choice".to_string(),
            default: serde_json::Value::String(default.to_string()),
            min: None,
            max: None,
            choices: Some(
                choices
                    .iter()
                    .map(|(value, label_key)| OptionChoice {
                        value: (*value).to_string(),
                        label_key: (*label_key).to_string(),
                    })
                    .collect(),
            ),
        }
    }

    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.id.is_empty()
            || self.id.len() > 64
            || !self
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(ConvertError::BadRequest);
        }
        if self.label_key.is_empty() || self.label_key.len() > 128 {
            return Err(ConvertError::BadRequest);
        }
        match self.kind.as_str() {
            "boolean" => {
                if !self.default.is_boolean() || self.min.is_some() || self.max.is_some() {
                    return Err(ConvertError::BadRequest);
                }
            }
            "integer" => {
                let value = self
                    .default
                    .as_i64()
                    .ok_or(ConvertError::BadRequest)?;
                let (min, max) = (
                    self.min.ok_or(ConvertError::BadRequest)?,
                    self.max.ok_or(ConvertError::BadRequest)?,
                );
                if min > max || value < min || value > max {
                    return Err(ConvertError::BadRequest);
                }
            }
            "choice" => {
                let value = self
                    .default
                    .as_str()
                    .ok_or(ConvertError::BadRequest)?;
                let choices = self.choices.as_ref().ok_or(ConvertError::BadRequest)?;
                if choices.is_empty() || choices.len() > 64 {
                    return Err(ConvertError::BadRequest);
                }
                let mut seen = BTreeSet::new();
                for choice in choices {
                    if choice.value.is_empty()
                        || choice.value.len() > 64
                        || choice.label_key.is_empty()
                        || choice.label_key.len() > 128
                        || !seen.insert(choice.value.clone())
                    {
                        return Err(ConvertError::BadRequest);
                    }
                }
                if !seen.contains(value) {
                    return Err(ConvertError::BadRequest);
                }
            }
            _ => return Err(ConvertError::BadRequest),
        }
        Ok(())
    }
}

/// What one converter accepts and promises. This is static data: no field
/// ever names executable code.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConverterSpec {
    pub id: ConverterId,
    pub inputs: Vec<FormatId>,
    pub output: FormatId,
    pub options: Vec<OptionSpec>,
    /// `each` or `combine`.
    pub input_mode: String,
    pub max_input_bytes: u64,
    pub max_output_bytes: u64,
    pub lossy: bool,
    pub preserves: Vec<MetadataCategory>,
    pub engine_id: String,
    pub available: bool,
    pub help_slug: String,
}

impl ConverterSpec {
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.inputs.is_empty() || self.inputs.len() > 64 || self.options.len() > MAX_OPTION_SPECS
        {
            return Err(ConvertError::BadRequest);
        }
        let mut seen = BTreeSet::new();
        for input in &self.inputs {
            if !seen.insert(*input) {
                return Err(ConvertError::BadRequest);
            }
        }
        let mut seen_options = BTreeSet::new();
        for option in &self.options {
            option.validate()?;
            if !seen_options.insert(option.id.clone()) {
                return Err(ConvertError::BadRequest);
            }
        }
        if self.input_mode != "each" && self.input_mode != "combine" {
            return Err(ConvertError::BadRequest);
        }
        if self.max_input_bytes == 0
            || self.max_output_bytes == 0
            || self.max_input_bytes > MAX_DECLARED_BYTES
            || self.max_output_bytes > MAX_DECLARED_BYTES
        {
            return Err(ConvertError::BadRequest);
        }
        if self.engine_id.is_empty() || self.engine_id.len() > 64 {
            return Err(ConvertError::BadRequest);
        }
        if self.help_slug.is_empty() || self.help_slug.len() > 128 {
            return Err(ConvertError::BadRequest);
        }
        Ok(())
    }

    pub fn supports_output(&self, output: FormatId) -> bool {
        self.available && self.output == output
    }
}

