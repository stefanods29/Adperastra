//! Tiny local log: `<data_dir>/logs/setup.log`, one line per call.

use std::io::Write;
use std::path::Path;

/// Appends `{unix_seconds} {message}`; never panics, ignores all errors.
pub fn append_log(data_dir: &Path, message: &str) {
    let _ = append_inner(data_dir, message);
}

fn append_inner(data_dir: &Path, message: &str) -> std::io::Result<()> {
    let dir = data_dir.join("logs");
    std::fs::create_dir_all(&dir)?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("setup.log"))?;
    writeln!(f, "{secs} {message}")
}
