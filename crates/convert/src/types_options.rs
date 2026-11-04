/// Options of the image engine (Step 08a).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageOptions {
    pub quality: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub keep_aspect: bool,
    pub allow_upscale: bool,
    /// R, G, B and A for transparent pixels (JPEG/BMP flattening).
    pub background_rgba: [u8; 4],
    pub first_frame: bool,
    pub metadata_keep: bool,
}

impl Default for ImageOptions {
    fn default() -> Self {
        Self {
            quality: 90,
            width: None,
            height: None,
            keep_aspect: true,
            allow_upscale: false,
            background_rgba: [255, 255, 255, 255],
            first_frame: false,
            metadata_keep: true,
        }
    }
}

impl ImageOptions {
    pub fn validate(&self) -> Result<(), ConvertError> {
        if self.quality == 0 || self.quality > 100 {
            return Err(ConvertError::BadRequest);
        }
        for dimension in [self.width, self.height].into_iter().flatten() {
            if dimension == 0 || dimension > MAX_IMAGE_DIMENSION {
                return Err(ConvertError::BadRequest);
            }
        }
        Ok(())
    }
}

/// One 1-based page range; validated after normalization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageRange {
    pub first: u32,
    pub last: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PdfConversionOptions {
    pub ranges: Vec<PageRange>,
    pub dpi: u16,
    pub image_format: String,
    pub quality: u8,
    pub combine: bool,
}

impl Default for PdfConversionOptions {
    fn default() -> Self {
        Self {
            ranges: Vec::new(),
            dpi: 150,
            image_format: "png".to_string(),
            quality: 90,
            combine: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DocumentConversionOptions {
    pub include_images: bool,
    pub page_size: String,
    pub margin_mm: u16,
    pub sanitize: bool,
    pub encoding: String,
    pub title: Option<String>,
}

impl Default for DocumentConversionOptions {
    fn default() -> Self {
        Self {
            include_images: true,
            page_size: "a4".to_string(),
            margin_mm: 20,
            sanitize: true,
            encoding: "utf8".to_string(),
            title: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TableConversionOptions {
    pub delimiter: String,
    pub header: bool,
    pub sheet: Option<String>,
    pub formulas: String,
    pub dates: String,
    pub newline: String,
}

impl Default for TableConversionOptions {
    fn default() -> Self {
        Self {
            delimiter: "comma".to_string(),
            header: true,
            sheet: None,
            formulas: "text".to_string(),
            dates: "iso".to_string(),
            newline: "crlf".to_string(),
        }
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ArchiveConversionOptions {
    pub format: String,
    pub level: u8,
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_password: Option<String>,
    pub encrypt_names: bool,
    pub preserve_timestamps: bool,
}

impl std::fmt::Debug for ArchiveConversionOptions {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ArchiveConversionOptions")
            .field("format", &self.format)
            .field("level", &self.level)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field(
                "source_password",
                &self.source_password.as_ref().map(|_| "<redacted>"),
            )
            .field("encrypt_names", &self.encrypt_names)
            .field("preserve_timestamps", &self.preserve_timestamps)
            .finish()
    }
}

impl Default for ArchiveConversionOptions {
    fn default() -> Self {
        Self {
            format: "zip".to_string(),
            level: 6,
            password: None,
            source_password: None,
            encrypt_names: false,
            preserve_timestamps: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MediaConversionOptions {
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: String,
    pub audio_codec: String,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate: Option<u32>,
    pub keep_metadata: bool,
    pub burn_subtitles: bool,
    pub speed: f64,
    pub volume: f64,
}

impl Default for MediaConversionOptions {
    fn default() -> Self {
        Self {
            start_ms: None,
            end_ms: None,
            width: None,
            height: None,
            video_codec: "auto".to_string(),
            audio_codec: "auto".to_string(),
            bitrate_kbps: None,
            sample_rate: None,
            keep_metadata: true,
            burn_subtitles: false,
            speed: 1.0,
            volume: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OfficeConversionOptions {
    pub page_ranges: Vec<PageRange>,
    pub export_comments: bool,
    pub export_notes: bool,
    pub encoding: String,
    pub preserve_metadata: bool,
    pub external_links: bool,
    pub macros: bool,
}

impl Default for OfficeConversionOptions {
    fn default() -> Self {
        Self {
            page_ranges: Vec::new(),
            export_comments: true,
            export_notes: false,
            encoding: "utf8".to_string(),
            preserve_metadata: true,
            external_links: false,
            macros: false,
        }
    }
}

/// The options of exactly one adapter family. The wire shape is
/// `{ "kind": "image", "value": { ... } }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ConvertOptions {
    Image(ImageOptions),
    Pdf(PdfConversionOptions),
    Document(DocumentConversionOptions),
    Table(TableConversionOptions),
    Archive(ArchiveConversionOptions),
    Media(MediaConversionOptions),
    Office(OfficeConversionOptions),
}

impl ConvertOptions {
    pub fn kind(&self) -> &'static str {
        match self {
            ConvertOptions::Image(_) => "image",
            ConvertOptions::Pdf(_) => "pdf",
            ConvertOptions::Document(_) => "document",
            ConvertOptions::Table(_) => "table",
            ConvertOptions::Archive(_) => "archive",
            ConvertOptions::Media(_) => "media",
            ConvertOptions::Office(_) => "office",
        }
    }

    pub fn validate(&self) -> Result<(), ConvertError> {
        match self {
            ConvertOptions::Image(options) => options.validate(),
            ConvertOptions::Pdf(options) => {
                if !(72..=600).contains(&options.dpi) {
                    return Err(ConvertError::BadRequest);
                }
                for range in &options.ranges {
                    if range.first < 1 || range.last < range.first {
                        return Err(ConvertError::BadRequest);
                    }
                }
                Ok(())
            }
            ConvertOptions::Document(options) => {
                if !matches!(options.page_size.as_str(), "source" | "a4" | "letter")
                    || options.margin_mm > 50
                    || options.encoding != "utf8"
                    || options
                        .title
                        .as_ref()
                        .is_some_and(|title| title.is_empty() || title.len() > 512)
                {
                    return Err(ConvertError::BadRequest);
                }
                Ok(())
            }
            ConvertOptions::Table(options) => {
                if !matches!(options.delimiter.as_str(), "comma" | "tab" | "semicolon")
                    || !matches!(options.formulas.as_str(), "text" | "preserve")
                    || !matches!(options.dates.as_str(), "iso" | "text")
                    || !matches!(options.newline.as_str(), "lf" | "crlf")
                {
                    return Err(ConvertError::BadRequest);
                }
                Ok(())
            }
            ConvertOptions::Archive(options) => {
                if !matches!(options.format.as_str(), "zip" | "seven_z")
                    || options.level > 9
                    || options.password.as_ref().is_some_and(|value| value.len() > 1024)
                    || options
                        .source_password
                        .as_ref()
                        .is_some_and(|value| value.len() > 1024)
                {
                    return Err(ConvertError::BadRequest);
                }
                Ok(())
            }
            ConvertOptions::Media(options) => {
                if options.speed.is_finite()
                    && (0.25..=4.0).contains(&options.speed)
                    && options.volume.is_finite()
                    && (0.0..=4.0).contains(&options.volume)
                {
                    Ok(())
                } else {
                    Err(ConvertError::BadRequest)
                }
            }
            ConvertOptions::Office(options) => {
                if options.encoding != "utf8" || options.external_links || options.macros {
                    return Err(ConvertError::BadRequest);
                }
                Ok(())
            }
        }
    }
}

