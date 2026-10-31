//! Writing user files safely (shared since Step 06d): new content goes to a
//! temporary file next to the target (`~<name>.partial`), is flushed, and is
//! then renamed into place, so a cancelled or failed write never damages the
//! file that was there (plan/rules.md R-SAFE-3).

use std::path::{Path, PathBuf};

/// The temporary file used while writing `target`: same folder, so the final
/// rename stays on one drive.
pub fn partial_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match target.parent() {
        Some(parent) => parent.join(format!("~{name}.partial")),
        None => PathBuf::from(format!("~{name}.partial")),
    }
}
