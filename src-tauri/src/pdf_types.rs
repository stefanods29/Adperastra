#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The PDF wire types (Step 07d, `pdf-reader-2`).
//!
//! These are the exact shapes of `src/services/pdf.ts`: snake_case fields,
//! tagged enums with a `kind` member, UUIDs as strings, no PDF.js type in
//! sight. PDF.js proxy objects live only inside the trusted helper frontend;
//! nothing about a parser task, a canvas or a font is serializable here.
//!
//! Every length, page and pixel is checked again in Rust: the UI is never
//! trusted with a page number, a path, a size or a repeat revision.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use fs_service::SourceStamp;

use cache_store::CacheLease;

/// Largest PDF the viewer opens (512 MiB, D5).
pub const PDF_MAX_BYTES: u64 = 512 * 1024 * 1024;
/// Most pages a document may have (D5).
pub const PDF_MAX_PAGES: u32 = 10_000;
/// Longest path, in UTF-16 units.
pub const PDF_MAX_PATH_UNITS: usize = 32_768;
/// Largest page render, in pixels (D5): 4,194,304.
pub const PDF_MAX_RENDER_PIXELS: u64 = 4_194_304;
/// Largest PNG a render may produce (8 MiB, D5).
pub const PDF_MAX_PNG_BYTES: u64 = 8 * 1024 * 1024;
/// Largest page side in points (144,000).
pub const PDF_MAX_SIDE_PT: f64 = 144_000.0;
/// Text runs one page answer may carry.
pub const PDF_MAX_TEXT_RUNS: usize = 50_000;
/// Characters one text run may carry.
pub const PDF_MAX_RUN_CHARS: usize = 4_096;
/// Most matches one search answer may carry.
pub const PDF_MAX_SEARCH_MATCHES: usize = 128;
/// Most characters a search query may have.
pub const PDF_MAX_SEARCH_QUERY: usize = 256;
/// Most outline nodes the viewer pages through.
pub const PDF_MAX_OUTLINE_NODES: usize = 5_000;
/// Deepest outline level.
pub const PDF_MAX_OUTLINE_DEPTH: usize = 32;
/// Most pages one print operation may include (D8).
pub const PDF_MAX_PRINT_PAGES: u32 = 100;
/// The DPI the trusted print view renders at.
pub const PDF_PRINT_DPI: u16 = 150;
/// Most sessions that keep a live helper, plus the inactive descriptors.
pub const PDF_MAX_ACTIVE_SESSIONS: usize = 2;
pub const PDF_MAX_SESSIONS: usize = 10;
/// Largest serialized answer of the non-image commands (768 KiB).
pub const PDF_MAX_ANSWER_BYTES: usize = 768 * 1024;
/// The cache provider id of every PDF page result (D6).
pub const PDF_PROVIDER_ID: &str = "pdfjs";
/// The pinned PDF.js version recorded in every cache key.
pub const PDF_PROVIDER_VERSION: &str = "6.4.299";

/// All four rotation values, and nothing else. On the wire it is the number
/// the UI shows (`0`, `90`, `180`, `270`), never a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "u16", try_from = "u16")]
pub enum PdfRotation {
    Deg0,
    Deg90,
    Deg180,
    Deg270,
}

impl From<PdfRotation> for u16 {
    fn from(value: PdfRotation) -> u16 {
        value.value()
    }
}

impl TryFrom<u16> for PdfRotation {
    type Error = String;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        PdfRotation::from_value(value).ok_or_else(|| "pdf.bad_request".to_string())
    }
}

impl PdfRotation {
    pub fn value(self) -> u16 {
        match self {
            PdfRotation::Deg0 => 0,
            PdfRotation::Deg90 => 90,
            PdfRotation::Deg180 => 180,
            PdfRotation::Deg270 => 270,
        }
    }

    pub fn from_value(value: u16) -> Option<Self> {
        match value {
            0 => Some(PdfRotation::Deg0),
            90 => Some(PdfRotation::Deg90),
            180 => Some(PdfRotation::Deg180),
            270 => Some(PdfRotation::Deg270),
            _ => None,
        }
    }
}

/// How one page is rastered: a display bucket or an exact DPI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PdfRasterSpec {
    Bucket { edge: u16 },
    Dpi { value: u16 },
}

impl PdfRasterSpec {
    pub fn is_valid(self) -> bool {
        match self {
            PdfRasterSpec::Bucket { edge } => matches!(edge, 512 | 1024 | 2048),
            PdfRasterSpec::Dpi { value } => (72..=600).contains(&value),
        }
    }

    /// The ASCII options key of the cache entry (D6).
    pub fn cache_option(self) -> String {
        match self {
            PdfRasterSpec::Bucket { edge } => format!("bucket={edge}"),
            PdfRasterSpec::Dpi { value } => format!("dpi={value}"),
        }
    }
}

/// An immutable snapshot reference (E9); every field is checked natively.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfSnapshotRef {
    pub snapshot_id: Uuid,
    pub document_id: String,
    pub revision: u64,
    pub content_id: Uuid,
}

impl PdfSnapshotRef {
    pub fn is_valid(&self) -> bool {
        !self.snapshot_id.is_nil()
            && !self.content_id.is_nil()
            && !self.document_id.is_empty()
            && self.document_id.len() <= 128
            && self.revision < (1u64 << 53)
    }
}

/// What to open. A snapshot never carries a path or bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PdfInput {
    File {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected: Option<SourceStamp>,
    },
    Snapshot {
        reference: PdfSnapshotRef,
    },
}

/// The immutable identity every page result belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PdfSourceIdentity {
    Disk {
        stamp: SourceStamp,
    },
    Snapshot {
        document_id: String,
        revision: u64,
        content_id: Uuid,
        sensitive: bool,
    },
}

impl PdfSourceIdentity {
    pub fn is_sensitive(&self) -> bool {
        matches!(
            self,
            PdfSourceIdentity::Snapshot {
                sensitive: true,
                ..
            }
        )
    }

    pub fn is_valid(&self) -> bool {
        match self {
            PdfSourceIdentity::Disk { stamp } => stamp.size_bytes <= PDF_MAX_BYTES,
            PdfSourceIdentity::Snapshot {
                document_id,
                revision,
                content_id,
                ..
            } => {
                !document_id.is_empty()
                    && document_id.len() <= 128
                    && *revision < (1u64 << 53)
                    && !content_id.is_nil()
            }
        }
    }
}

/// What the document allows. Defaults are false until determined.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfPermissions {
    #[serde(default)]
    pub can_copy: bool,
    #[serde(default)]
    pub can_print: bool,
}

/// One open document as the UI sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfSession {
    pub session_id: Uuid,
    pub source: PdfSourceIdentity,
    pub page_count: u32,
    pub password_required: bool,
    pub permissions: PdfPermissions,
}

/// One page's size and intrinsic rotation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PdfPageInfo {
    pub page: u32,
    pub width_pt: f64,
    pub height_pt: f64,
    pub rotation: PdfRotation,
}

impl PdfPageInfo {
    pub fn is_valid(&self) -> bool {
        self.page >= 1
            && self.page <= PDF_MAX_PAGES
            && self.width_pt.is_finite()
            && self.height_pt.is_finite()
            && self.width_pt > 0.0
            && self.height_pt > 0.0
            && self.width_pt <= PDF_MAX_SIDE_PT
            && self.height_pt <= PDF_MAX_SIDE_PT
    }
}

/// One rendered page and the lease that serves its PNG (E2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfPageImage {
    pub info: PdfPageInfo,
    pub image: CacheLease,
    pub render_width: u32,
    pub render_height: u32,
    pub resolved_scale: f64,
    pub rendered_rotation: PdfRotation,
    pub request_revision: u32,
}

/// One text run in PDF points, top-left origin, unrotated page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfTextRun {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub direction: PdfTextDirection,
    pub font_size: f64,
    pub order: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfTextDirection {
    Ltr,
    Rtl,
}

/// One bounded chunk of a page's text (E3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfTextPage {
    pub page: u32,
    pub runs: Vec<PdfTextRun>,
    pub next_run: Option<u32>,
    pub complete: bool,
    pub source: PdfSourceIdentity,
}

impl PdfTextPage {
    pub fn is_valid(&self) -> bool {
        self.page >= 1
            && self.page <= PDF_MAX_PAGES
            && self.runs.len() <= PDF_MAX_TEXT_RUNS
            && self
                .runs
                .iter()
                .all(|run| run.text.chars().count() <= PDF_MAX_RUN_CHARS && run.font_size > 0.0)
    }
}

/// One outline node; `page` is the only navigable target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfOutlineNode {
    pub id: Uuid,
    pub title: String,
    pub page: Option<u32>,
    pub children: Vec<PdfOutlineNode>,
}

/// One bounded page of the outline (E4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfOutlinePage {
    pub nodes: Vec<PdfOutlineNode>,
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfSearchMatch {
    pub page: u32,
    pub run: u32,
    pub offset: u32,
    pub length: u32,
    pub excerpt: String,
}

/// One bounded page of search matches (E4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfSearchPage {
    pub matches: Vec<PdfSearchMatch>,
    pub next_cursor: Option<Uuid>,
    pub complete: bool,
    pub scanned_pages: u32,
    pub total_pages: u32,
}

impl PdfSearchPage {
    pub fn is_valid(&self) -> bool {
        self.matches.len() <= PDF_MAX_SEARCH_MATCHES
            && self.matches.iter().all(|entry| {
                entry.page >= 1
                    && entry.page <= PDF_MAX_PAGES
                    && entry.excerpt.chars().count() <= 256
            })
    }
}

/// The per-tab view state (D9); never a password or a token.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PdfViewState {
    pub page: u32,
    pub zoom: u32,
    pub fit: PdfFit,
    pub rotation: PdfRotation,
    pub thumbnails_open: bool,
    pub outline_open: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfFit {
    Width,
    Page,
    None,
}

impl Default for PdfViewState {
    fn default() -> Self {
        Self {
            page: 1,
            zoom: 100,
            fit: PdfFit::Width,
            rotation: PdfRotation::Deg0,
            thumbnails_open: true,
            outline_open: false,
        }
    }
}

impl PdfViewState {
    pub fn is_valid(&self, page_count: u32) -> bool {
        self.page >= 1 && self.page <= page_count && (10..=400).contains(&self.zoom)
    }
}

/// One render request (E2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfRenderRequest {
    pub session_id: Uuid,
    pub page: u32,
    pub raster: PdfRasterSpec,
    pub rotation: PdfRotation,
    pub request_revision: u32,
}

impl PdfRenderRequest {
    pub fn is_valid(&self) -> bool {
        !self.session_id.is_nil()
            && self.page >= 1
            && self.page <= PDF_MAX_PAGES
            && self.raster.is_valid()
            && self.request_revision >= 1
    }
}

/// Validated render size: width and height in pixels, and the scale used.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RasterSize {
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// The exact raster math of D5 / "Exact raster math and helper transport".
pub fn raster_size(
    info: &PdfPageInfo,
    raster: PdfRasterSpec,
    rotation: PdfRotation,
) -> Result<RasterSize, String> {
    if !info.is_valid() {
        return Err("pdf.bad_request".to_string());
    }
    if !raster.is_valid() {
        return Err("pdf.bad_request".to_string());
    }
    let rotated = rotation.value() == 90 || rotation.value() == 270;
    let width_pt = if rotated {
        info.height_pt
    } else {
        info.width_pt
    };
    let height_pt = if rotated {
        info.width_pt
    } else {
        info.height_pt
    };
    let scale = match raster {
        PdfRasterSpec::Bucket { edge } => edge as f64 / width_pt.max(height_pt),
        PdfRasterSpec::Dpi { value } => value as f64 / 72.0,
    };
    if !scale.is_finite() || scale <= 0.0 {
        return Err("pdf.bad_request".to_string());
    }
    let width = (width_pt * scale).ceil().max(1.0);
    let height = (height_pt * scale).ceil().max(1.0);
    if width > u32::MAX as f64 || height > u32::MAX as f64 {
        return Err("pdf.too_large".to_string());
    }
    let (width, height) = (width as u32, height as u32);
    if (width as u64) * (height as u64) > PDF_MAX_RENDER_PIXELS {
        return Err("pdf.too_large".to_string());
    }
    Ok(RasterSize {
        width,
        height,
        scale,
    })
}

/// Check a page number against a live session.
pub fn page_of(session: &PdfSession, page: u32) -> Result<u32, String> {
    if page >= 1 && page <= session.page_count {
        Ok(page)
    } else {
        Err("pdf.bad_request".to_string())
    }
}

/// A rotation value from the wire (0/90/180/270 only).
pub fn rotation_from_wire(value: u16) -> Result<PdfRotation, String> {
    PdfRotation::from_value(value).ok_or_else(|| "pdf.bad_request".to_string())
}

/// True when a path is inside the encoded limits and absolute.
pub fn valid_pdf_path(path: &str) -> bool {
    !path.is_empty()
        && path.encode_utf16().count() <= PDF_MAX_PATH_UNITS
        && std::path::Path::new(path).is_absolute()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(width: f64, height: f64) -> PdfPageInfo {
        PdfPageInfo {
            page: 1,
            width_pt: width,
            height_pt: height,
            rotation: PdfRotation::Deg0,
        }
    }

    #[test]
    fn a_72_point_square_at_150_dpi_is_150_pixels() {
        let size = raster_size(
            &page(72.0, 72.0),
            PdfRasterSpec::Dpi { value: 150 },
            PdfRotation::Deg0,
        )
        .unwrap();
        assert_eq!((size.width, size.height), (150, 150));
        assert!((size.scale - (150.0 / 72.0)).abs() < 1e-9);
    }

    #[test]
    fn a_1000_point_square_at_600_dpi_is_too_large() {
        assert_eq!(
            raster_size(
                &page(1000.0, 1000.0),
                PdfRasterSpec::Dpi { value: 600 },
                PdfRotation::Deg0
            )
            .err(),
            Some("pdf.too_large".to_string())
        );
    }

    #[test]
    fn buckets_use_the_longest_rotated_edge() {
        let size = raster_size(
            &page(100.0, 200.0),
            PdfRasterSpec::Bucket { edge: 512 },
            PdfRotation::Deg90,
        )
        .unwrap();
        // Rotated, the longest edge is the page width (100 pt -> 512 px).
        assert_eq!((size.width, size.height), (512, 256));
        assert_eq!(
            raster_size(
                &page(100.0, 200.0),
                PdfRasterSpec::Bucket { edge: 1000 },
                PdfRotation::Deg0
            )
            .err(),
            Some("pdf.bad_request".to_string())
        );
    }

    #[test]
    fn pages_rotations_and_revisions_are_exact() {
        let mut info = page(100.0, 200.0);
        info.page = 0;
        assert!(!info.is_valid());
        assert_eq!(
            rotation_from_wire(45).err(),
            Some("pdf.bad_request".to_string())
        );
        assert_eq!(PdfRotation::Deg270.value(), 270);
        let request = PdfRenderRequest {
            session_id: Uuid::new_v4(),
            page: 1,
            raster: PdfRasterSpec::Bucket { edge: 1024 },
            rotation: PdfRotation::Deg0,
            request_revision: 0,
        };
        assert!(!request.is_valid());
        assert_eq!(
            raster_size(
                &page(f64::NAN, 1.0),
                PdfRasterSpec::Bucket { edge: 512 },
                PdfRotation::Deg0
            )
            .err(),
            Some("pdf.bad_request".to_string())
        );
    }

    #[test]
    fn view_state_never_carries_a_secret() {
        let json = serde_json::to_value(PdfViewState::default()).unwrap();
        let keys = json
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(keys.len(), 6);
        assert!(!keys
            .iter()
            .any(|key| key.contains("password") || key.contains("token")));
        let mut state = PdfViewState::default();
        assert!(state.is_valid(10));
        state.page = 11;
        assert!(!state.is_valid(10));
        state.page = 1;
        state.zoom = 401;
        assert!(!state.is_valid(10));
    }

    #[test]
    fn input_snapshots_carry_no_path() {
        let input = PdfInput::Snapshot {
            reference: PdfSnapshotRef {
                snapshot_id: Uuid::new_v4(),
                document_id: "doc".to_string(),
                revision: 1,
                content_id: Uuid::new_v4(),
            },
        };
        let json = serde_json::to_value(&input).unwrap();
        assert!(json.get("path").is_none());
        assert_eq!(json["kind"], "snapshot");
        let file = PdfInput::File {
            path: "C:\\docs\\a.pdf".to_string(),
            expected: None,
        };
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(json["kind"], "file");
        assert!(json.get("expected").is_none());
    }

    #[test]
    fn sensitive_snapshots_are_recognized() {
        let identity = PdfSourceIdentity::Snapshot {
            document_id: "doc".to_string(),
            revision: 2,
            content_id: Uuid::new_v4(),
            sensitive: true,
        };
        assert!(identity.is_sensitive());
        assert!(identity.is_valid());
    }
}
