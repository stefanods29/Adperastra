//! Publishing a verified creation spool (Step 06e D6, D9). The parent copies
//! the helper's spool into its own staging file, recomputes the hash, and
//! only then renames it in without replacing anything.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use fs_service::owned_io::{
    OwnedIoError, OwnedOutput, PinnedDirectory, PinnedSource, SourceIdentity,
};
use fs_service::CancellationToken;

/// The most numbered names one publication tries.
pub const MAX_PUBLISH_CANDIDATES: usize = 10_000;
const CHUNK: usize = 65_536;

/// Publish the expected spool under `file_name`, numbered when taken.
/// `max_candidates` is injectable for tests.
pub fn publish_spool(
    spool: &Path,
    expected_size: u64,
    expected_hash: &str,
    dest_dir: &Path,
    file_name: &str,
    token: &CancellationToken,
    max_candidates: usize,
) -> Result<PathBuf, String> {
    let identity =
        SourceIdentity::capture(spool).map_err(|_| "archive.output_changed".to_string())?;
    let mut source =
        PinnedSource::open(spool, &identity).map_err(|_| "archive.output_changed".to_string())?;
    if identity.size != expected_size {
        return Err("archive.output_changed".to_string());
    }
    let directory =
        PinnedDirectory::open(dest_dir).map_err(|_| "archive.dest_missing".to_string())?;
    let mut output = OwnedOutput::create(&directory, file_name)
        .map_err(|_| "archive.output_changed".to_string())?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut copied = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return Err("archive.cancelled".to_string());
        }
        let read = source
            .file_mut()
            .read(&mut buffer)
            .map_err(|_| "archive.output_changed".to_string())?;
        if read == 0 {
            break;
        }
        copied = copied.saturating_add(read as u64);
        if copied > expected_size {
            return Err("archive.output_changed".to_string());
        }
        hasher.update(&buffer[..read]);
        use std::io::Write;
        output
            .file_mut()
            .write_all(&buffer[..read])
            .map_err(|_| "archive.output_changed".to_string())?;
    }
    if copied != expected_size {
        return Err("archive.output_changed".to_string());
    }
    let hash = hasher.finalize().to_hex().to_string();
    if hash != expected_hash.to_lowercase() {
        return Err("archive.output_changed".to_string());
    }
    source
        .verify_after_read()
        .map_err(|_| "archive.output_changed".to_string())?;
    output
        .flush_sync()
        .map_err(|_| "archive.output_changed".to_string())?;
    publish_numbered(&mut output, file_name, max_candidates)
}

fn publish_numbered(
    output: &mut OwnedOutput,
    file_name: &str,
    max_candidates: usize,
) -> Result<PathBuf, String> {
    for number in 0..max_candidates.max(1) {
        let candidate = if number == 0 {
            file_name.to_string()
        } else {
            numbered(file_name, number)
        };
        match output.publish_name(&candidate) {
            Ok(path) => return Ok(path),
            Err(OwnedIoError::TargetExists) => continue,
            Err(_) => return Err("archive.output_changed".to_string()),
        }
    }
    // Every candidate is taken: nothing is replaced, nothing is lost.
    Err("archive.output_changed".to_string())
}

/// `report.zip` and 2 give `report (2).zip`.
pub fn numbered(name: &str, number: usize) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({number}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({number})"),
    }
}

/// Keep the actual published path even when a later cleanup step fails.
#[cfg(test)]
pub fn report_after_publish(
    report: &mut crate::archive_create::ArchiveCreateReport,
    published: &Path,
    later_error: Option<String>,
) {
    report.created = vec![published.to_string_lossy().into_owned()];
    report.error = later_error;
}

#[cfg(test)]
mod tests {
    use super::{numbered, publish_spool, report_after_publish};
    use crate::archive_create::ArchiveCreateReport;
    use fs_service::new_cancellation_token;
    use std::io::Write;

    fn spool(folder: &std::path::Path, bytes: &[u8]) -> (std::path::PathBuf, u64, String) {
        let path = folder.join("archive.spool");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        file.flush().unwrap();
        drop(file);
        let hash = blake3::hash(bytes).to_hex().to_string();
        (path, bytes.len() as u64, hash)
    }

    #[test]
    fn spool_path_and_hash_are_not_trusted() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().join("out");
        std::fs::create_dir(&dest).unwrap();
        let (path, size, hash) = spool(folder.path(), b"real archive bytes");
        let token = new_cancellation_token();

        // A wrong hash publishes nothing.
        let result = publish_spool(&path, size, &"0".repeat(64), &dest, "a.zip", &token, 10);
        assert_eq!(result.unwrap_err(), "archive.output_changed");
        // A wrong size publishes nothing.
        let result = publish_spool(&path, size + 1, &hash, &dest, "a.zip", &token, 10);
        assert!(result.is_err());
        assert!(std::fs::read_dir(&dest).unwrap().next().is_none());

        // The exact report publishes the exact bytes.
        let published = publish_spool(&path, size, &hash, &dest, "a.zip", &token, 10).unwrap();
        assert_eq!(std::fs::read(published).unwrap(), b"real archive bytes");
    }

    #[test]
    fn create_keeps_both_from_one_and_exhausts_safely() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().join("out");
        std::fs::create_dir(&dest).unwrap();
        let (path, size, hash) = spool(folder.path(), b"new archive");
        let token = new_cancellation_token();
        std::fs::write(dest.join("report.zip"), "old one").unwrap();
        std::fs::write(dest.join("report (1).zip"), "old two").unwrap();

        let first = publish_spool(&path, size, &hash, &dest, "report.zip", &token, 10).unwrap();
        assert_eq!(first.file_name().unwrap(), "report (2).zip");
        assert_eq!(
            std::fs::read_to_string(dest.join("report.zip")).unwrap(),
            "old one"
        );

        std::fs::write(dest.join("report (2).zip"), "old three").unwrap();
        let exhausted = publish_spool(&path, size, &hash, &dest, "report.zip", &token, 3);
        assert!(
            exhausted.is_err(),
            "a bound is a refusal, never a replacement"
        );
        for name in ["report.zip", "report (1).zip", "report (2).zip"] {
            assert!(dest.join(name).exists(), "every old file is kept");
        }
    }

    #[test]
    fn cancel_before_publish_keeps_sources_and_old_target() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().join("out");
        std::fs::create_dir(&dest).unwrap();
        let (path, size, hash) = spool(folder.path(), b"new archive");
        std::fs::write(dest.join("report.zip"), "old archive").unwrap();
        let token = new_cancellation_token();
        token.store(true, std::sync::atomic::Ordering::Relaxed);

        let result = publish_spool(&path, size, &hash, &dest, "report.zip", &token, 10);
        assert_eq!(result.unwrap_err(), "archive.cancelled");
        assert_eq!(
            std::fs::read_to_string(dest.join("report.zip")).unwrap(),
            "old archive"
        );
        assert!(
            path.exists(),
            "the app-owned spool is retained, not guessed away"
        );
    }

    #[test]
    fn publication_report_keeps_actual_effect_on_late_failure() {
        let mut report = ArchiveCreateReport::default();
        let published = std::path::Path::new("C:\\Out\\report (1).zip");
        report_after_publish(&mut report, published, Some("archive.other".to_string()));
        assert_eq!(report.created, vec!["C:\\Out\\report (1).zip"]);
        assert_eq!(report.error.as_deref(), Some("archive.other"));
    }

    #[test]
    fn numbered_names_stay_readable() {
        assert_eq!(numbered("report.zip", 2), "report (2).zip");
        assert_eq!(numbered("docs", 1), "docs (1)");
    }
}
