//! Installing/repairing a single `File` component from a local or URL source.

use crate::manifest::{Component, ComponentKind, Source};
use crate::verify::hash_file;
use crate::{Result, SetupError};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

pub fn install_component(
    c: &Component,
    base: &Path,
    source_base: &Path,
    progress: &mut dyn FnMut(f32),
) -> Result<()> {
    let rel = match &c.kind {
        ComponentKind::File { path } => path,
        ComponentKind::AnyPath { .. } => {
            return Err(SetupError::NotInstallable(c.id.clone()));
        }
    };
    let source = c
        .source
        .as_ref()
        .ok_or_else(|| SetupError::NotInstallable(format!("{}: no source", c.id)))?;
    let dest = base.join(rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part = part_path(&dest);
    let result = copy_to_part(c, source, source_base, &part, progress);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    verify_part(c, &part)?;
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    std::fs::rename(&part, &dest)?;
    progress(1.0);
    Ok(())
}

fn verify_part(c: &Component, part: &Path) -> Result<()> {
    if let Some(expected) = c.size {
        let actual = std::fs::metadata(part)?.len();
        if actual != expected {
            let _ = std::fs::remove_file(part);
            return Err(SetupError::SizeMismatch(format!(
                "{}: expected {expected} bytes, got {actual}",
                c.id
            )));
        }
    }
    if let Some(expected) = &c.sha256 {
        let actual = hash_file(part)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(part);
            return Err(SetupError::HashMismatch(format!(
                "{}: expected {expected}, got {actual}",
                c.id
            )));
        }
    }
    Ok(())
}
fn copy_to_part(
    c: &Component,
    source: &Source,
    source_base: &Path,
    part: &Path,
    progress: &mut dyn FnMut(f32),
) -> Result<()> {
    progress(0.0);
    let mut out = std::fs::File::create(part)?;
    match source {
        Source::Local { path } => {
            let src_path = source_base.join(path);
            let total = std::fs::metadata(&src_path).map(|m| m.len()).ok();
            let mut input = std::fs::File::open(&src_path)?;
            copy_stream(&mut input, &mut out, total, progress)?;
        }
        Source::Url { url } => {
            let mut resp = reqwest::blocking::get(url)
                .map_err(|e| SetupError::Download(format!("{}: {e}", c.id)))?;
            if !resp.status().is_success() {
                return Err(SetupError::Download(format!(
                    "{}: HTTP {}",
                    c.id,
                    resp.status()
                )));
            }
            let total = resp.content_length();
            copy_stream(&mut resp, &mut out, total, progress)?;
        }
    }
    out.flush()?;
    Ok(())
}

fn copy_stream(
    input: &mut dyn Read,
    out: &mut dyn Write,
    total: Option<u64>,
    progress: &mut dyn FnMut(f32),
) -> Result<()> {
    let mut buf = [0u8; 8192];
    let mut copied: u64 = 0;
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])?;
        copied += n as u64;
        if let Some(t) = total {
            if t > 0 {
                progress((copied as f32 / t as f32).clamp(0.0, 1.0));
            }
        }
    }
    Ok(())
}
