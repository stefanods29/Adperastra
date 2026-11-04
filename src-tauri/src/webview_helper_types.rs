#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! Types of the trusted WebView helper host (Step 07d E7,
//! `helper-transport-1`).
//!
//! A helper is a separate `Adperastra.exe --<feature>-helper` process that
//! owns a hidden, incognito WebView2 window. The parent talks to it with the
//! kind1..kind5 framed transport in `helper_frames.rs`; these types are what
//! travels in those frames. None of them may carry bytes: bodies travel only
//! as frames, and a browser grant is a token URL, never a path
//! (plan/rules.md R-SEC-9).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::file_grant_backing::GrantedBacking;
use crate::webview_helper_inputs::PinnedSourceHandle;
use fs_service::SourceStamp;

/// The only control protocol version this build speaks.
pub const PROTOCOL_VERSION: u8 = 1;
/// Largest serialized control frame (768 KiB).
pub const MAX_CONTROL_BYTES: usize = 768 * 1024;
/// Largest body chunk one frame may carry (1 MiB).
pub const MAX_BODY_CHUNK: usize = 1024 * 1024;
/// Most inputs one helper may hold.
pub const MAX_INPUTS: usize = 256;
/// Most outputs one request may reserve.
pub const MAX_OUTPUT_SPECS: usize = 256;
/// Aggregate memory budget across grants and snapshots (1 GiB).
pub const MAX_AGGREGATE_MEMORY: u64 = 1024 * 1024 * 1024;
/// Largest one memory source (256 MiB).
pub const MAX_MEMORY_SOURCE: u64 = 256 * 1024 * 1024;
/// Longest name a grant may carry.
pub const MAX_GRANT_NAME: usize = 255;
/// Longest MIME string a grant, spec or output may carry.
pub const MAX_MIME: usize = 128;
/// Longest token URL (`fileUrl` of a 32 hex token plus an encoded name).
pub const MAX_TOKEN_URL: usize = 33_792;
/// Longest error code a child may report.
pub const MAX_ERROR_CODE: usize = 128;
/// How long a child has to become ready after start.
pub const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
/// How long an input replacement may take (E7).
pub const UPDATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
/// How long a cancelled child gets before it is terminated.
pub const CANCEL_GRACE: std::time::Duration = std::time::Duration::from_millis(250);

/// Every helper kind. Static launch flags pick one; a user URL never does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebviewHelperKind {
    Pdf,
    Book,
    Notebook,
    Model,
    Psd,
    PdfWrite,
    OfficeQuick,
    Presentation,
}

impl WebviewHelperKind {
    /// The stable wire name (`start.kind`).
    pub fn wire_name(self) -> &'static str {
        match self {
            WebviewHelperKind::Pdf => "pdf",
            WebviewHelperKind::Book => "book",
            WebviewHelperKind::Notebook => "notebook",
            WebviewHelperKind::Model => "model",
            WebviewHelperKind::Psd => "psd",
            WebviewHelperKind::PdfWrite => "pdf_write",
            WebviewHelperKind::OfficeQuick => "office_quick",
            WebviewHelperKind::Presentation => "presentation",
        }
    }

    /// The packaged, app-owned entry the child loads. Never a user string.
    pub fn entry(self) -> &'static str {
        match self {
            WebviewHelperKind::Pdf => "pdf-helper.html",
            WebviewHelperKind::Book => "book-helper.html",
            WebviewHelperKind::Notebook => "notebook-helper.html",
            WebviewHelperKind::Model => "model-helper.html",
            WebviewHelperKind::Psd => "psd-helper.html",
            WebviewHelperKind::PdfWrite => "pdf-write-helper.html",
            WebviewHelperKind::OfficeQuick => "office-quick-helper.html",
            WebviewHelperKind::Presentation => "presentation-helper.html",
        }
    }

    /// The window label of this kind's child window.
    pub fn window_label(self) -> &'static str {
        match self {
            WebviewHelperKind::Pdf => "webview-helper-pdf",
            WebviewHelperKind::Book => "webview-helper-book",
            WebviewHelperKind::Notebook => "webview-helper-notebook",
            WebviewHelperKind::Model => "webview-helper-model",
            WebviewHelperKind::Psd => "webview-helper-psd",
            WebviewHelperKind::PdfWrite => "webview-helper-pdf-write",
            WebviewHelperKind::OfficeQuick => "webview-helper-office-quick",
            WebviewHelperKind::Presentation => "webview-helper-presentation",
        }
    }

    /// True only for the reserved kind a later step activates (22a).
    pub fn accepts_audience(self) -> bool {
        matches!(self, WebviewHelperKind::Presentation)
    }
}

/// Every action a helper frontend may be asked to do (exact dotted wire
/// values; an unknown value is refused at deserialization).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HelperAction {
    #[serde(rename = "pdf.open")]
    PdfOpen,
    #[serde(rename = "pdf.render")]
    PdfRender,
    #[serde(rename = "pdf.text")]
    PdfText,
    #[serde(rename = "pdf.outline")]
    PdfOutline,
    #[serde(rename = "pdf.search")]
    PdfSearch,
    #[serde(rename = "pdf.print")]
    PdfPrint,
    #[serde(rename = "book.open")]
    BookOpen,
    #[serde(rename = "book.page")]
    BookPage,
    #[serde(rename = "book.contents")]
    BookContents,
    #[serde(rename = "notebook.open")]
    NotebookOpen,
    #[serde(rename = "notebook.page")]
    NotebookPage,
    #[serde(rename = "model.open")]
    ModelOpen,
    #[serde(rename = "model.scene")]
    ModelScene,
    #[serde(rename = "psd.open")]
    PsdOpen,
    #[serde(rename = "psd.layers")]
    PsdLayers,
    #[serde(rename = "pdf.write_images")]
    PdfWriteImages,
    #[serde(rename = "pdf.write_blocks")]
    PdfWriteBlocks,
    #[serde(rename = "pdf.edit.inspect")]
    PdfEditInspect,
    #[serde(rename = "pdf.edit.serialize")]
    PdfEditSerialize,
    #[serde(rename = "privacy.xmp")]
    PrivacyXmp,
    #[serde(rename = "office.quick.open")]
    OfficeQuickOpen,
    #[serde(rename = "office.quick.page")]
    OfficeQuickPage,
    #[serde(rename = "presentation.frame")]
    PresentationFrame,
    #[serde(rename = "presentation.wait_intent")]
    PresentationWaitIntent,
    #[serde(rename = "presentation.end")]
    PresentationEnd,
}

impl HelperAction {
    /// Each child can receive only actions belonging to its compiled entry.
    pub fn allowed_for(self, kind: WebviewHelperKind) -> bool {
        match kind {
            WebviewHelperKind::Pdf => self.is_pdf(),
            WebviewHelperKind::Book => {
                matches!(self, Self::BookOpen | Self::BookPage | Self::BookContents)
            }
            WebviewHelperKind::Notebook => matches!(self, Self::NotebookOpen | Self::NotebookPage),
            WebviewHelperKind::Model => matches!(self, Self::ModelOpen | Self::ModelScene),
            WebviewHelperKind::Psd => matches!(self, Self::PsdOpen | Self::PsdLayers),
            WebviewHelperKind::PdfWrite => matches!(
                self,
                Self::PdfWriteImages
                    | Self::PdfWriteBlocks
                    | Self::PdfEditInspect
                    | Self::PdfEditSerialize
                    | Self::PrivacyXmp
            ),
            WebviewHelperKind::OfficeQuick => self.is_office_quick(),
            WebviewHelperKind::Presentation => matches!(
                self,
                Self::PresentationFrame | Self::PresentationWaitIntent | Self::PresentationEnd
            ),
        }
    }

    /// True when this action belongs to the PDF reader (07d).
    pub fn is_pdf(self) -> bool {
        matches!(
            self,
            HelperAction::PdfOpen
                | HelperAction::PdfRender
                | HelperAction::PdfText
                | HelperAction::PdfOutline
                | HelperAction::PdfSearch
                | HelperAction::PdfPrint
        )
    }

    pub fn is_office_quick(self) -> bool {
        matches!(
            self,
            HelperAction::OfficeQuickOpen | HelperAction::OfficeQuickPage
        )
    }
}

/// One rectangle in physical pixels that must match a live monitor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperDisplayRect {
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
}

impl HelperDisplayRect {
    pub fn is_valid(&self) -> bool {
        self.width > 0 && self.height > 0 && self.width <= 32_768 && self.height <= 32_768
    }
}

/// Where the helper window sits. Audience is reserved for the presentation
/// kind; every other kind is hidden all its life.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HelperWindowPlacement {
    Hidden,
    Audience {
        display_id: String,
        rect: HelperDisplayRect,
    },
}

impl HelperWindowPlacement {
    pub fn is_valid(&self) -> bool {
        match self {
            HelperWindowPlacement::Hidden => true,
            HelperWindowPlacement::Audience { display_id, rect } => {
                !display_id.is_empty() && display_id.len() <= 128 && rect.is_valid()
            }
        }
    }
}

/// One guarded input of a helper session (native-only).
#[derive(Clone)]
pub enum HelperInputSource {
    Disk {
        path: PathBuf,
        expected: SourceStamp,
        pinned: Arc<PinnedSourceHandle>,
    },
    Memory {
        data: Arc<Zeroizing<Vec<u8>>>,
        document_id: String,
        revision: u64,
        content_id: Uuid,
        sensitive: bool,
    },
    Snapshot {
        backing: Arc<GrantedBacking>,
        document_id: String,
        revision: u64,
        content_id: Uuid,
        sensitive: bool,
    },
}

impl HelperInputSource {
    /// Bytes this source counts against the aggregate budget.
    pub fn memory_bytes(&self) -> u64 {
        match self {
            HelperInputSource::Disk { .. } => 0,
            HelperInputSource::Memory { data, .. } => data.len() as u64,
            HelperInputSource::Snapshot { backing, .. } => backing.memory_bytes(),
        }
    }

    pub fn is_sensitive(&self) -> bool {
        match self {
            HelperInputSource::Disk { .. } => false,
            HelperInputSource::Memory { sensitive, .. } => *sensitive,
            HelperInputSource::Snapshot { sensitive, .. } => *sensitive,
        }
    }
}

/// One input the trusted caller grants to the child (native-only).
#[derive(Clone)]
pub struct HelperInputGrant {
    pub grant_id: Uuid,
    pub name: String,
    pub mime: String,
    pub source: HelperInputSource,
}

impl std::fmt::Debug for HelperInputGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HelperInputGrant")
            .field("grant_id", &self.grant_id)
            .field("name", &self.name)
            .field("mime", &self.mime)
            .field("sensitive", &self.source.is_sensitive())
            .finish()
    }
}

impl HelperInputGrant {
    pub fn is_valid(&self) -> bool {
        !self.name.is_empty()
            && self.name.len() <= MAX_GRANT_NAME
            && self.mime.len() <= MAX_MIME
            && match &self.source {
                HelperInputSource::Disk { path, .. } => path.is_absolute(),
                HelperInputSource::Memory {
                    data, document_id, ..
                } => data.len() as u64 <= MAX_MEMORY_SOURCE && valid_document_id(document_id),
                HelperInputSource::Snapshot {
                    backing,
                    document_id,
                    ..
                } => backing.length() <= MAX_MEMORY_SOURCE && valid_document_id(document_id),
            }
    }
}

pub fn valid_document_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128
}

/// What the parent sends before the child may ask for bytes: no tokens, no
/// bytes, no URLs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperInputManifest {
    pub grant_id: Uuid,
    pub name: String,
    pub mime: String,
    pub source: HelperInputManifestSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HelperInputManifestSource {
    Disk {
        path: String,
        expected: SourceStamp,
    },
    Memory {
        document_id: String,
        revision: u64,
        content_id: Uuid,
        sensitive: bool,
        byte_len: u64,
    },
}

/// One browser-safe grant: a token URL, never a path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperGrantDTO {
    pub grant_id: Uuid,
    pub token_url: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
    pub sensitive: bool,
}

impl HelperGrantDTO {
    pub fn is_valid(&self) -> bool {
        !self.name.is_empty()
            && self.name.len() <= MAX_GRANT_NAME
            && self.mime.len() <= MAX_MIME
            && self.token_url.len() <= MAX_TOKEN_URL
            && self.token_url.starts_with("http://adpfile.localhost/")
    }
}

/// One result the child must upload before its reply is accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperOutputReservation {
    pub output_id: Uuid,
    pub mime: String,
    pub token_url: String,
    pub upload_token: String,
    pub max_bytes: u64,
    pub sensitive: bool,
}

impl HelperOutputReservation {
    pub fn is_valid(&self) -> bool {
        self.mime.len() <= MAX_MIME
            && self.max_bytes > 0
            && self.token_url.len() <= MAX_TOKEN_URL
            && is_upload_token(&self.upload_token)
            && self
                .token_url
                .starts_with("http://adpfile.localhost/helper-output/")
    }
}

/// A token is exactly 32 lower-case hex characters.
pub fn is_upload_token(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// One required result of a request, declared before the child starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperOutputSpec {
    pub mime: String,
    pub max_bytes: u64,
}

impl HelperOutputSpec {
    pub fn is_valid(&self, config_cap: u64) -> bool {
        !self.mime.is_empty()
            && self.mime.len() <= MAX_MIME
            && self.max_bytes > 0
            && self.max_bytes <= config_cap
    }
}

/// What a completed upload must match.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperOutputDTO {
    pub output_id: Uuid,
    pub mime: String,
    pub byte_len: u64,
    pub sha256: String,
}

/// One request to a helper (kind1 `request` frame).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebviewHelperRequest {
    pub request_id: Uuid,
    pub action: HelperAction,
    pub payload: serde_json::Value,
    pub output_specs: Vec<HelperOutputSpec>,
}

impl WebviewHelperRequest {
    pub fn is_valid(&self) -> bool {
        self.output_specs.len() <= MAX_OUTPUT_SPECS && !self.request_id.is_nil()
    }

    pub fn serialized_len(&self) -> Result<usize, String> {
        serde_json::to_vec(self)
            .map(|bytes| bytes.len())
            .map_err(|_| "helper.failed".to_string())
    }
}

/// One request as the helper frontend sees it (kind1 `request` frame).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HelperRequestEnvelope<T> {
    pub protocol_version: u8,
    pub request_id: Uuid,
    pub action: HelperAction,
    pub inputs: Vec<HelperGrantDTO>,
    pub output_reservations: Vec<HelperOutputReservation>,
    pub payload: T,
}

impl<T> HelperRequestEnvelope<T> {
    pub fn is_valid(&self) -> bool {
        self.protocol_version == PROTOCOL_VERSION
            && !self.request_id.is_nil()
            && self.inputs.len() <= MAX_INPUTS
            && self.output_reservations.len() <= MAX_OUTPUT_SPECS
            && self.inputs.iter().all(HelperGrantDTO::is_valid)
            && self
                .output_reservations
                .iter()
                .all(HelperOutputReservation::is_valid)
    }
}

/// The child's one answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum HelperReplyEnvelope<T> {
    Ok {
        protocol_version: u8,
        request_id: Uuid,
        payload: T,
        outputs: Vec<HelperOutputDTO>,
    },
    Error {
        protocol_version: u8,
        request_id: Uuid,
        error_code: String,
    },
}

impl<T> HelperReplyEnvelope<T> {
    pub fn request_id(&self) -> Uuid {
        match self {
            HelperReplyEnvelope::Ok { request_id, .. } => *request_id,
            HelperReplyEnvelope::Error { request_id, .. } => *request_id,
        }
    }

    pub fn version_ok(&self) -> bool {
        match self {
            HelperReplyEnvelope::Ok {
                protocol_version, ..
            } => *protocol_version == PROTOCOL_VERSION,
            HelperReplyEnvelope::Error {
                protocol_version, ..
            } => *protocol_version == PROTOCOL_VERSION,
        }
    }

    pub fn error_code(&self) -> Option<&str> {
        match self {
            HelperReplyEnvelope::Ok { .. } => None,
            HelperReplyEnvelope::Error { error_code, .. } => Some(error_code),
        }
    }
}

/// One verified result body (native-only after the reply).
pub enum HelperOutputStorage {
    OwnedFile(fs_service::owned_io::OwnedOutput),
    Memory(Zeroizing<Vec<u8>>),
}

/// One verified output of a finished request.
pub struct HelperOutput {
    pub output_id: Uuid,
    pub mime: String,
    pub byte_len: u64,
    pub storage: HelperOutputStorage,
}

/// A finished request: its id, the validated reply and its verified outputs.
pub struct WebviewHelperResult {
    pub request_id: Uuid,
    pub reply: serde_json::Value,
    pub outputs: Vec<HelperOutput>,
}

/// One line of the binary child/control protocol.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case")]
pub enum HelperControlFrame {
    Start {
        protocol_version: u8,
        kind: WebviewHelperKind,
        placement: HelperWindowPlacement,
        inputs: Vec<HelperInputManifest>,
    },
    Ready {
        protocol_version: u8,
        private_profile: bool,
    },
    InputUpdate {
        update_id: Uuid,
        inputs: Vec<HelperInputManifest>,
    },
    InputsReady {
        update_id: Uuid,
        inputs: Vec<HelperGrantDTO>,
        private_profile: bool,
    },
    Request {
        request: HelperRequestEnvelope<serde_json::Value>,
    },
    Reply {
        reply: HelperReplyEnvelope<serde_json::Value>,
    },
}

/// A helper's configuration, fixed by compiled code, never by a URL.
pub struct WebviewHelperConfig {
    pub kind: WebviewHelperKind,
    pub entry: &'static str,
    pub max_body_bytes: usize,
    pub max_output_bytes: u64,
    pub data_dir: PathBuf,
    pub placement: HelperWindowPlacement,
}

impl WebviewHelperConfig {
    /// Validate the static limits (1..=16 MiB body, output up to 1 GiB).
    pub fn validate(&self) -> Result<(), String> {
        if self.max_body_bytes == 0 || self.max_body_bytes > 16 * 1024 * 1024 {
            return Err("helper.invalid_config".to_string());
        }
        if self.max_output_bytes == 0 || self.max_output_bytes > 1024 * 1024 * 1024 {
            return Err("helper.invalid_config".to_string());
        }
        if self.entry != self.kind.entry() {
            return Err("helper.invalid_config".to_string());
        }
        if !self.placement.is_valid() {
            return Err("helper.invalid_placement".to_string());
        }
        if matches!(self.placement, HelperWindowPlacement::Audience { .. })
            && !self.kind.accepts_audience()
        {
            return Err("helper.invalid_placement".to_string());
        }
        if !self.data_dir.is_absolute() {
            return Err("helper.invalid_config".to_string());
        }
        Ok(())
    }

    /// The flag that starts this kind's child process. Only the reader has
    /// its own flag; every other kind (including the reserved PDF writer) is
    /// started by the generic host with its static kind argument.
    pub fn helper_flag(&self) -> &'static str {
        match self.kind {
            WebviewHelperKind::Pdf => crate::pdf_helper::HELPER_FLAG,
            _ => crate::webview_helper::HELPER_FLAG,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actions_are_exact_dotted_values() {
        assert_eq!(
            serde_json::to_value(HelperAction::PdfOpen).unwrap(),
            "pdf.open"
        );
        assert_eq!(
            serde_json::to_value(HelperAction::PdfWriteImages).unwrap(),
            "pdf.write_images"
        );
        assert!(serde_json::from_value::<HelperAction>(serde_json::json!("pdf.eval")).is_err());
    }

    #[test]
    fn output_reservations_require_a_helper_output_route() {
        let mut reservation = HelperOutputReservation {
            output_id: Uuid::new_v4(),
            mime: "image/png".to_string(),
            token_url: "http://adpfile.localhost/helper-output/a/b".to_string(),
            upload_token: "0123456789abcdef0123456789abcdef".to_string(),
            max_bytes: 8 * 1024 * 1024,
            sensitive: false,
        };
        assert!(reservation.is_valid());
        reservation.token_url =
            "http://adpfile.localhost/0123456789abcdef0123456789abcdef/x".to_string();
        assert!(!reservation.is_valid());
        reservation.token_url = "http://adpfile.localhost/helper-output/a/b".to_string();
        reservation.upload_token = "0123456789ABCDEF0123456789abcdef".to_string();
        assert!(!reservation.is_valid());
    }

    #[test]
    fn only_presentation_accepts_an_audience() {
        assert!(!WebviewHelperKind::Pdf.accepts_audience());
        assert!(WebviewHelperKind::Presentation.accepts_audience());
    }

    #[test]
    fn placements_are_bounded() {
        let rect = HelperDisplayRect {
            left: 0,
            top: 0,
            width: 1920,
            height: 1080,
        };
        assert!(rect.is_valid());
        let audience = HelperWindowPlacement::Audience {
            display_id: "1".to_string(),
            rect: HelperDisplayRect { width: 0, ..rect },
        };
        assert!(!audience.is_valid());
    }

    #[test]
    fn every_helper_accepts_its_own_actions_and_rejects_other_helpers() {
        let owners = [
            (WebviewHelperKind::Pdf, HelperAction::PdfRender),
            (WebviewHelperKind::Book, HelperAction::BookPage),
            (WebviewHelperKind::Notebook, HelperAction::NotebookPage),
            (WebviewHelperKind::Model, HelperAction::ModelScene),
            (WebviewHelperKind::Psd, HelperAction::PsdLayers),
            (WebviewHelperKind::PdfWrite, HelperAction::PdfWriteBlocks),
            (
                WebviewHelperKind::OfficeQuick,
                HelperAction::OfficeQuickPage,
            ),
            (
                WebviewHelperKind::Presentation,
                HelperAction::PresentationFrame,
            ),
        ];
        for (owner, action) in owners {
            for (candidate, _) in owners {
                assert_eq!(action.allowed_for(candidate), candidate == owner);
            }
        }
        assert!(HelperAction::PdfEditInspect.allowed_for(WebviewHelperKind::PdfWrite));
        assert!(HelperAction::PrivacyXmp.allowed_for(WebviewHelperKind::PdfWrite));
    }
}
