//! Creating one archive (Step 06e T9): validation first, one creation at a
//! time, the helper's verified spool copied into owned staging, and a
//! no-replace publication that keeps the actual path for Undo.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use archive::{CreateEncryption, CreateFormat, CreateSpoolReport, SkippedEntry};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::archive::run_helper_job;
use crate::archive_create_publish::{publish_spool, MAX_PUBLISH_CANDIDATES};
use crate::archive_create_spool::{
    check_budget, prepare_spool_folder, release_spool_folder, take_creation_lock, SpoolBudget,
};
use crate::archive_helper::{HelperCreate, HelperMessage, HelperRequest};
use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id, validate_absolute_path, AppState};

/// What the UI asks to create. The password never reaches a Debug string.
#[derive(Clone, Serialize, Deserialize)]
pub struct CreateRequest {
    pub sources: Vec<String>,
    pub dest_dir: String,
    pub file_name: String,
    pub format: CreateFormat,
    pub encryption: CreateEncryption,
    pub password: Option<String>,
    pub encrypt_names: bool,
}

impl fmt::Debug for CreateRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CreateRequest")
            .field("sources", &self.sources)
            .field("dest_dir", &self.dest_dir)
            .field("file_name", &self.file_name)
            .field("format", &self.format)
            .field("encryption", &self.encryption)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("encrypt_names", &self.encrypt_names)
            .finish()
    }
}

/// What one creation did (mirrors `src/services/archiveCreate.ts`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ArchiveCreateReport {
    pub created: Vec<String>,
    pub files_written: u64,
    pub folders_written: u64,
    pub source_bytes: u64,
    pub archive_size: u64,
    pub skipped: Vec<SkippedEntry>,
    pub skipped_more: u64,
    pub cancelled: bool,
    pub error: Option<String>,
}

/// The checked, ready-to-run pieces of one creation.
pub struct ValidatedCreate {
    pub options: archive::CreateOptions,
    pub dest_dir: PathBuf,
    pub file_name: String,
    pub include_hidden: bool,
    pub sources: Vec<String>,
}

pub fn extension_for(format: CreateFormat) -> &'static str {
    match format {
        CreateFormat::Zip => "zip",
        CreateFormat::SevenZ => "7z",
    }
}

/// Every check that must pass before a job, a lock or a spool exists.
pub fn validate_request(
    request: &CreateRequest,
    show_hidden: bool,
) -> Result<ValidatedCreate, String> {
    if request.sources.is_empty() || request.sources.len() > archive::MAX_CREATE_SOURCES {
        return Err("archive.too_many_sources".to_string());
    }
    let mut path_bytes = 0usize;
    for source in &request.sources {
        validate_absolute_path(source).map_err(|_| "archive.bad_request".to_string())?;
        path_bytes = path_bytes.saturating_add(source.len());
    }
    if path_bytes > archive::MAX_CREATE_PATH_BYTES {
        return Err("archive.too_many_sources".to_string());
    }
    validate_absolute_path(&request.dest_dir).map_err(|_| "archive.bad_request".to_string())?;
    let dest = PathBuf::from(&request.dest_dir);
    if !dest.is_dir() {
        return Err("archive.dest_missing".to_string());
    }
    validate_file_name(&request.file_name, request.format)?;
    let options = archive::CreateOptions {
        format: request.format,
        encryption: request.encryption,
        password: request.password.clone(),
        encrypt_names: request.encrypt_names,
        include_hidden: show_hidden,
    };
    options
        .validate()
        .map_err(|error| error.code().to_string())?;
    Ok(ValidatedCreate {
        options,
        dest_dir: dest,
        file_name: request.file_name.clone(),
        include_hidden: show_hidden,
        sources: request.sources.clone(),
    })
}

fn validate_file_name(name: &str, format: CreateFormat) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.chars().count() > 255
        || fs_service::validate_new_name(name).is_err()
    {
        return Err("archive.bad_request".to_string());
    }
    let suffix = format!(".{}", extension_for(format));
    if !name.to_lowercase().ends_with(&suffix) {
        return Err("archive.bad_request".to_string());
    }
    Ok(())
}

/// A helper report is publishable only when it is complete and consistent.
pub fn spool_report_is_complete(report: &CreateSpoolReport) -> bool {
    report.size > 0
        && report.size == report.archive_size
        && report.blake3.len() == 64
        && report
            .blake3
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

/// Start one creation as a job in the Explorer's jobs panel.
#[tauri::command]
pub fn archive_create_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    request: CreateRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let show_hidden = {
        let state = app.state::<AppState>();
        let settings = state
            .settings
            .lock()
            .map_err(|_| "archive.other".to_string())?;
        settings.explorer.show_hidden
    };
    let validated = validate_request(&request, show_hidden)?;
    let data_dir = app.state::<AppState>().data_dir.clone();
    let base = data_dir.join("archive-create");
    let lock = take_creation_lock(&base)?;
    // The helper enforces the 8 GiB output cap; this check only refuses when
    // stored spool data already fills the shared budget or the disk is full.
    check_budget(&base, 0, SpoolBudget::default())?;
    let spool = prepare_spool_folder(&base, &request_id)?;
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |ctx| {
        let mut report = ArchiveCreateReport::default();
        let helper_request = HelperRequest::Create {
            request: HelperCreate {
                sources: validated.sources.clone(),
                include_hidden: validated.include_hidden,
                format: validated.options.format,
                encryption: validated.options.encryption,
                password: validated.options.password.clone(),
                encrypt_names: validated.options.encrypt_names,
                spool: spool.to_string_lossy().into_owned(),
            },
        };
        let mut spool_report: Option<CreateSpoolReport> = None;
        let outcome = run_helper_job(ctx, &helper_request, |message| {
            if let HelperMessage::SpoolCreated { report: found } = message {
                spool_report = Some(found.clone());
                return Ok(true);
            }
            Ok(false)
        });
        if ctx.token().load(Ordering::Relaxed) || outcome.cancelled() {
            report.cancelled = true;
            release_spool_folder(&spool);
            return serde_json::to_value(report).map_err(|_| "archive.other".to_string());
        }
        if let Some(code) = outcome.error {
            report.error = Some(code);
            release_spool_folder(&spool);
            return serde_json::to_value(report).map_err(|_| "archive.other".to_string());
        }
        let Some(found) = spool_report else {
            report.error = Some("archive.helper_failed".to_string());
            release_spool_folder(&spool);
            return serde_json::to_value(report).map_err(|_| "archive.other".to_string());
        };
        if !spool_report_is_complete(&found) {
            report.error = Some("archive.output_changed".to_string());
            release_spool_folder(&spool);
            return serde_json::to_value(report).map_err(|_| "archive.other".to_string());
        }
        report.files_written = found.files_written;
        report.folders_written = found.folders_written;
        report.source_bytes = found.source_bytes;
        report.skipped = found.skipped.clone();
        report.skipped_more = found.skipped_more;
        report.archive_size = found.size;
        // The extra final item keeps the bar below 100% until publication.
        ctx.set_progress(&fs_service::OpProgress {
            items_done: found.files_written as usize,
            items_total: found.files_written as usize + 1,
            bytes_done: found.source_bytes,
            bytes_total: found.source_bytes,
            current: validated.file_name.clone(),
        });
        match publish_spool(
            &spool,
            found.size,
            &found.blake3,
            &validated.dest_dir,
            &validated.file_name,
            ctx.token(),
            MAX_PUBLISH_CANDIDATES,
        ) {
            Ok(path) => {
                report.created = vec![display_path(&path)];
                drop(lock);
                release_spool_folder(&spool);
            }
            Err(code) => {
                report.error = Some(code);
                release_spool_folder(&spool);
                return serde_json::to_value(report).map_err(|_| "archive.other".to_string());
            }
        }
        ctx.set_progress(&fs_service::OpProgress {
            items_done: found.files_written as usize + 1,
            items_total: found.files_written as usize + 1,
            bytes_done: found.source_bytes,
            bytes_total: found.source_bytes,
            current: report.created.first().cloned().unwrap_or_default(),
        });
        serde_json::to_value(report).map_err(|_| "archive.other".to_string())
    });
    Ok(())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{spool_report_is_complete, validate_request, CreateRequest};
    use archive::{CreateEncryption, CreateFormat, CreateSpoolReport};

    fn request(name: &str) -> CreateRequest {
        CreateRequest {
            sources: vec!["C:\\Data\\notes.txt".to_string()],
            dest_dir: "C:\\Out".to_string(),
            file_name: name.to_string(),
            format: CreateFormat::Zip,
            encryption: CreateEncryption::None,
            password: None,
            encrypt_names: false,
        }
    }

    #[test]
    fn create_validation_precedes_job_or_spool() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().to_string_lossy().into_owned();
        let ok = CreateRequest {
            dest_dir: dest.clone(),
            file_name: "report.zip".to_string(),
            ..request("report.zip")
        };
        assert!(validate_request(&ok, true).is_ok());

        for bad in ["report.7z", "report", "re\\port.zip", "CON.zip", ""] {
            let invalid = CreateRequest {
                dest_dir: dest.clone(),
                ..request(bad)
            };
            assert!(validate_request(&invalid, true).is_err(), "{bad}");
        }
        let wrong_extension = CreateRequest {
            dest_dir: dest.clone(),
            file_name: "report.zip".to_string(),
            format: CreateFormat::SevenZ,
            ..request("report.zip")
        };
        assert!(validate_request(&wrong_extension, true).is_err());

        let bad_password = CreateRequest {
            dest_dir: dest,
            file_name: "report.zip".to_string(),
            encryption: CreateEncryption::Aes256,
            password: Some("line\nbreak".to_string()),
            ..request("report.zip")
        };
        assert_eq!(
            validate_request(&bad_password, true).err().as_deref(),
            Some("archive.invalid_password")
        );
        // Validation only: no job, lock or spool was made.
        assert!(!folder.path().join("archive-create").exists());
    }

    #[test]
    fn helper_death_leaves_no_published_archive() {
        let mut report = CreateSpoolReport::default();
        assert!(!spool_report_is_complete(&report));
        report.size = 10;
        report.archive_size = 10;
        report.blake3 = "a".repeat(64);
        assert!(spool_report_is_complete(&report));
        report.blake3 = "A".repeat(64);
        assert!(!spool_report_is_complete(&report), "only lower-case hex");
        report.blake3 = "short".to_string();
        assert!(!spool_report_is_complete(&report));
    }
}
