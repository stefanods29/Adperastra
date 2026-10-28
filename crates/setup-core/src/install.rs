//! Installing/repairing a single `File` component from a local or URL source.

use crate::manifest::{Component, ComponentKind, Installer, Source};
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

pub fn fetch_installer(
    inst: &Installer,
    source_base: &Path,
    dest_dir: &Path,
    progress: &mut dyn FnMut(f32),
) -> Result<PathBuf> {
    std::fs::create_dir_all(dest_dir)?;
    let dest = dest_dir.join("installer.exe");
    let part = part_path(&dest);
    progress(0.0);
    let result = (|| -> Result<()> {
        let mut out = std::fs::File::create(&part)?;
        match &inst.source {
            Source::Local { path } => {
                let src_path = source_base.join(path);
                let total = std::fs::metadata(&src_path).map(|m| m.len()).ok();
                let mut input = std::fs::File::open(&src_path)?;
                copy_stream(&mut input, &mut out, total, progress)?;
            }
            Source::Url { url } => {
                let mut resp = reqwest::blocking::get(url)
                    .map_err(|e| SetupError::Download(format!("installer: {e}")))?;
                if !resp.status().is_success() {
                    return Err(SetupError::Download(format!(
                        "installer: HTTP {}",
                        resp.status()
                    )));
                }
                let total = resp.content_length();
                copy_stream(&mut resp, &mut out, total, progress)?;
            }
        }
        out.flush()?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    let actual_size = std::fs::metadata(&part)?.len();
    if actual_size != inst.size {
        let _ = std::fs::remove_file(&part);
        return Err(SetupError::SizeMismatch(format!(
            "installer: expected {} bytes, got {actual_size}",
            inst.size
        )));
    }
    let actual_hash = hash_file(&part)?;
    if !actual_hash.eq_ignore_ascii_case(&inst.sha256) {
        let _ = std::fs::remove_file(&part);
        return Err(SetupError::HashMismatch(format!(
            "installer: expected {}, got {actual_hash}",
            inst.sha256
        )));
    }
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    std::fs::rename(&part, &dest)?;
    progress(1.0);
    Ok(dest)
}

pub fn install_runtime(
    c: &Component,
    base: &Path,
    work_dir: &Path,
    progress: &mut dyn FnMut(f32),
) -> Result<()> {
    let inst = c
        .installer
        .as_ref()
        .ok_or_else(|| SetupError::NotInstallable(format!("{}: no installer", c.id)))?;
    let dest_dir = work_dir.join("installers").join(&c.id);
    let installer_path = fetch_installer(inst, base, &dest_dir, progress)?;
    #[cfg(not(windows))]
    {
        let _ = &installer_path;
        return Err(SetupError::Download(format!(
            "{}: running installers is only supported on Windows",
            c.id
        )));
    }
    #[cfg(windows)]
    {
        let status = std::process::Command::new(&installer_path)
            .args(&inst.args)
            .status()?;
        match status.code() {
            Some(0) | Some(1641) | Some(3010) => Ok(()),
            Some(code) => Err(SetupError::Download(format!(
                "{}: installer exited with code {code}",
                c.id
            ))),
            None => Err(SetupError::Download(format!(
                "{}: installer terminated without an exit code",
                c.id
            ))),
        }
    }
}
