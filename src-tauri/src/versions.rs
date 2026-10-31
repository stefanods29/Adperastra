//! Version hook (contract 19). Step 06a: a no-op; Step 06b keeps a
//! snapshot here before any change.

use std::path::Path;

/// Why a file's content is about to change.
pub enum ModifyReason {
    Save,
    SaveAs,
}

/// Called before every change to an existing file's content (R-SAFE-5).
pub fn before_modify(_path: &Path, _reason: ModifyReason) -> Result<(), String> {
    Ok(())
}
