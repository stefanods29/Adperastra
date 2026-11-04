//! The Step 06a plaintext draft command module is retired (Step 09h T2).
//!
//! `src/services/recovery.ts` now uploads immutable snapshots and calls the
//! encrypted store. The old functions stay here as internal compatibility
//! shims for the draft facade when it imports them by name, but they are no
//! longer registered in `generate_handler!` or the isolation allowlist, so no
//! webview can reach them. None of them reads, writes or deletes a plaintext
//! recovery file.

#![allow(dead_code)] // Compatibility shims kept for the draft facade.

use tauri::WebviewWindow;

use crate::ensure_main;

fn retired() -> String {
    "recovery.unsupported".to_string()
}

pub async fn recovery_write(
    window: WebviewWindow,
    path: String,
    text: String,
    file_modified_unix: u64,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let _ = (path, text, file_modified_unix);
    Err(retired())
}

pub async fn recovery_read(window: WebviewWindow, path: String) -> Result<(), String> {
    ensure_main(window.label())?;
    let _ = path;
    Err(retired())
}

pub async fn recovery_delete(window: WebviewWindow, path: String) -> Result<(), String> {
    ensure_main(window.label())?;
    let _ = path;
    Err(retired())
}
