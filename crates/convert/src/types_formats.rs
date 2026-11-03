/// One conversion may name at most this many inputs (plan D3).
pub const MAX_CONVERSION_INPUTS: usize = 10_000;
/// Largest accepted source file for the image adapters.
pub const MAX_IMAGE_INPUT_BYTES: u64 = 512 * 1024 * 1024;
/// Largest accepted output for the image adapters.
pub const MAX_IMAGE_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
/// Hard ceiling any adapter may declare (32 GiB).
pub const MAX_DECLARED_BYTES: u64 = 32 * 1024 * 1024 * 1024;
/// Largest decoded pixel product the image adapters accept.
pub const MAX_IMAGE_PIXELS: u64 = 100_000_000;
/// Largest width or height the image adapters accept.
pub const MAX_IMAGE_DIMENSION: u32 = 65_536;
/// A preview PNG never exceeds this.
pub const MAX_PREVIEW_BYTES: usize = 4 * 1024 * 1024;
/// The preview's longest edge.
pub const PREVIEW_EDGE: u32 = 512;
/// Most options one converter may declare.
pub const MAX_OPTION_SPECS: usize = 32;
/// Most accepted metadata categories / warning codes per request.
pub const MAX_ACCEPTED: usize = 64;
/// Longest path on the wire, in UTF-16 units.
pub const MAX_PATH_UNITS: usize = 32_768;
/// Longest display name (document or file).
pub const MAX_NAME_UNITS: usize = 255;
/// Longest MIME string.
pub const MAX_MIME_CHARS: usize = 128;
/// Longest naming pattern (Step 08a accepts only the default one).
pub const MAX_NAMING_PATTERN: usize = 128;
/// The only pattern 08a understands; 08b extends the grammar additively.
pub const DEFAULT_NAMING_PATTERN: &str = "{stem}.{ext}";

/// A converter's stable identifier. Lower-case ASCII, at most two
/// slash-separated segments (`image/png`, `svg/png`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConverterId(String);

impl ConverterId {
    pub fn parse(value: &str) -> Result<Self, ConvertError> {
        if value.is_empty() || value.len() > 64 {
            return Err(ConvertError::BadRequest);
        }
        let mut segments = 0;
        for segment in value.split('/') {
            segments += 1;
            if segment.is_empty()
                || !segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            {
                return Err(ConvertError::BadRequest);
            }
        }
        if segments > 2 {
            return Err(ConvertError::BadRequest);
        }
        Ok(Self(value.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A file format the registry can name. Later steps append variants; none
/// of these IDs may be renamed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormatId {
    Png,
    Jpeg,
    Webp,
    Bmp,
    Gif,
    Tiff,
    Ico,
    Svg,
    Pdf,
    Html,
    Md,
    Csv,
    Xlsx,
    Zip,
    SevenZ,
}

impl FormatId {
    /// The lower-case extension used in output names.
    pub fn extension(self) -> &'static str {
        match self {
            FormatId::Png => "png",
            FormatId::Jpeg => "jpg",
            FormatId::Webp => "webp",
            FormatId::Bmp => "bmp",
            FormatId::Gif => "gif",
            FormatId::Tiff => "tiff",
            FormatId::Ico => "ico",
            FormatId::Svg => "svg",
            FormatId::Pdf => "pdf",
            FormatId::Html => "html",
            FormatId::Md => "md",
            FormatId::Csv => "csv",
            FormatId::Xlsx => "xlsx",
            FormatId::Zip => "zip",
            FormatId::SevenZ => "7z",
        }
    }

    /// The format a file's extension names, when it is one we know.
    pub fn from_extension(extension: &str) -> Option<Self> {
        Some(match extension.to_ascii_lowercase().as_str() {
            "png" => FormatId::Png,
            "jpg" | "jpeg" | "jfif" => FormatId::Jpeg,
            "webp" => FormatId::Webp,
            "bmp" => FormatId::Bmp,
            "gif" => FormatId::Gif,
            "tif" | "tiff" => FormatId::Tiff,
            "ico" => FormatId::Ico,
            "svg" => FormatId::Svg,
            "pdf" => FormatId::Pdf,
            "html" | "htm" => FormatId::Html,
            "md" | "markdown" => FormatId::Md,
            "csv" => FormatId::Csv,
            "xlsx" => FormatId::Xlsx,
            "zip" => FormatId::Zip,
            "7z" | "seven_z" => FormatId::SevenZ,
            _ => return None,
        })
    }

    /// The format a MIME type names, when it is one we know.
    pub fn from_mime(mime: &str) -> Option<Self> {
        Some(match mime.split(';').next().unwrap_or("").trim() {
            "image/png" => FormatId::Png,
            "image/jpeg" => FormatId::Jpeg,
            "image/webp" => FormatId::Webp,
            "image/bmp" => FormatId::Bmp,
            "image/gif" => FormatId::Gif,
            "image/tiff" => FormatId::Tiff,
            "image/x-icon" | "image/vnd.microsoft.icon" => FormatId::Ico,
            "image/svg+xml" => FormatId::Svg,
            "application/pdf" => FormatId::Pdf,
            "text/html" => FormatId::Html,
            "text/markdown" => FormatId::Md,
            "text/csv" => FormatId::Csv,
            _ => return None,
        })
    }

    /// The MIME type the adapters label their outputs with.
    pub fn mime(self) -> &'static str {
        match self {
            FormatId::Png => "image/png",
            FormatId::Jpeg => "image/jpeg",
            FormatId::Webp => "image/webp",
            FormatId::Bmp => "image/bmp",
            FormatId::Gif => "image/gif",
            FormatId::Tiff => "image/tiff",
            FormatId::Ico => "image/x-icon",
            FormatId::Svg => "image/svg+xml",
            FormatId::Pdf => "application/pdf",
            FormatId::Html => "text/html",
            FormatId::Md => "text/markdown",
            FormatId::Csv => "text/csv",
            FormatId::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            FormatId::Zip => "application/zip",
            FormatId::SevenZ => "application/x-7z-compressed",
        }
    }

    /// True when the image engine can write this format in this round.
    pub fn is_writable_image(self) -> bool {
        matches!(
            self,
            FormatId::Png
                | FormatId::Jpeg
                | FormatId::Webp
                | FormatId::Bmp
                | FormatId::Gif
                | FormatId::Tiff
        )
    }

    /// True when the encoded format stores per-pixel transparency.
    pub fn supports_alpha(self) -> bool {
        matches!(
            self,
            FormatId::Png | FormatId::Webp | FormatId::Gif | FormatId::Tiff
        )
    }
}

/// A kind of metadata a format can carry. Only categories an adapter really
/// keeps are advertised in its `ConverterSpec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataCategory {
    Exif,
    Gps,
    Camera,
    Date,
    Icc,
    Xmp,
    Iptc,
    Author,
    Comments,
    Attachments,
    Forms,
    Annotations,
    Scripts,
    Timestamps,
}

/// A loss the user must acknowledge before pixels are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversionWarningCode {
    TransparencyLoss,
    AnimationFirstFrame,
    PaletteReduction,
    LayoutLoss,
    FormulaCachedValue,
    FormulaSafetyPrefix,
    SheetSelection,
}

