#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The PDF helper child (Step 07d D2).
//!
//! `Adperastra.exe --pdf-helper` never starts the Explorer: `main()` hands
//! the process to the trusted WebView host, which builds one hidden,
//! incognito window on the packaged `pdf-helper.html` entry, proves the
//! profile is private and then answers PDF actions. The child has no main-app
//! command, no main-app capability and its own `webview-helper/pdf` data
//! subfolder.

use std::path::{Path, PathBuf};

use crate::webview_helper_types::{
    HelperAction, HelperWindowPlacement, WebviewHelperConfig, WebviewHelperKind,
};

/// Same value as `pdf_helper_types::PDF_HELPER_FLAG`; re-exported for
/// `main()` and the spawn site.
pub const HELPER_FLAG: &str = crate::pdf_helper_types::PDF_HELPER_FLAG;

/// Largest body the PDF helper carries in one frame.
pub const HELPER_MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
/// Largest single result the PDF helper may produce (one PNG page).
pub const HELPER_MAX_OUTPUT_BYTES: u64 = 8 * 1024 * 1024;

/// The helper's own data folder, under the app's data folder.
pub fn helper_data_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("webview-helper").join("pdf")
}

/// One session's nonpersistent profile folder. It is removed when the
/// session closes; a sensitive session never keeps it.
pub fn session_data_dir(data_dir: &Path, session: uuid::Uuid) -> PathBuf {
    helper_data_dir(data_dir).join(session.simple().to_string())
}

/// The static configuration of the PDF helper.
pub fn helper_config(data_dir: PathBuf) -> WebviewHelperConfig {
    WebviewHelperConfig {
        kind: WebviewHelperKind::Pdf,
        entry: WebviewHelperKind::Pdf.entry(),
        max_body_bytes: HELPER_MAX_BODY_BYTES,
        max_output_bytes: HELPER_MAX_OUTPUT_BYTES,
        data_dir,
        placement: HelperWindowPlacement::Hidden,
    }
}

/// Every action the PDF helper accepts; a book/model action is refused.
pub fn action_allowed(action: HelperAction) -> bool {
    action.is_pdf()
}

/// Run the child. Static kind and static data folder only.
pub fn run_helper(data_dir: PathBuf) -> ! {
    let dir = helper_data_dir(&data_dir);
    let _ = std::fs::create_dir_all(&dir);
    crate::webview_helper::run_helper_process(WebviewHelperKind::Pdf, dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pdf_actions_belong_here() {
        assert!(action_allowed(HelperAction::PdfOpen));
        assert!(action_allowed(HelperAction::PdfPrint));
        assert!(!action_allowed(HelperAction::BookOpen));
        assert!(!action_allowed(HelperAction::ModelOpen));
    }

    #[test]
    fn the_config_is_bounded_and_hidden() {
        let config = helper_config(std::path::PathBuf::from("C:\\data\\webview-helper\\pdf"));
        assert!(config.validate().is_ok());
        assert_eq!(config.entry, "pdf-helper.html");
        assert_eq!(config.kind, WebviewHelperKind::Pdf);
        assert_eq!(config.placement, HelperWindowPlacement::Hidden);
        assert_eq!(config.max_output_bytes, 8 * 1024 * 1024);
    }

    #[test]
    fn folders_stay_under_app_data() {
        let base = std::path::Path::new("C:\\data");
        assert_eq!(
            helper_data_dir(base),
            std::path::PathBuf::from("C:\\data\\webview-helper\\pdf")
        );
        let session = uuid::Uuid::nil();
        assert!(session_data_dir(base, session).starts_with("C:\\data\\webview-helper\\pdf"));
    }
}
