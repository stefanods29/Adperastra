//! Verification of installed components against a manifest.

use crate::manifest::{Component, ComponentKind, Manifest};
use crate::Result;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Ok,
    Missing,
    Broken(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentReport {
    pub id: String,
    pub status: Status,
}

/// Expands `%VAR%` from the environment; unknown vars are left as-is.
pub fn expand_env(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Streams a file through SHA-256 and returns the lowercase hex digest.
pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
pub fn verify_component(c: &Component, base: &Path, full: bool) -> ComponentReport {
    let status = match &c.kind {
        ComponentKind::File { path } => verify_file(c, &base.join(path), full),
        ComponentKind::AnyPath { paths } => {
            let found = paths.iter().any(|p| Path::new(&expand_env(p)).exists());
            if found {
                Status::Ok
            } else {
                Status::Missing
            }
        }
    };
    ComponentReport {
        id: c.id.clone(),
        status,
    }
}

fn verify_file(c: &Component, path: &Path, full: bool) -> Status {
    if !path.exists() {
        return Status::Missing;
    }
    if !path.is_file() {
        return Status::Broken(format!("{} is not a file", path.display()));
    }
    if let Some(expected) = c.size {
        match std::fs::metadata(path) {
            Ok(md) if md.len() == expected => {}
            Ok(md) => {
                return Status::Broken(format!(
                    "size mismatch for {}: expected {}, got {}",
                    c.id,
                    expected,
                    md.len()
                ));
            }
            Err(e) => return Status::Broken(format!("cannot stat {}: {e}", c.id)),
        }
    }
    if full {
        if let Some(expected) = &c.sha256 {
            match hash_file(path) {
                Ok(actual) if actual.eq_ignore_ascii_case(expected) => {}
                Ok(actual) => {
                    return Status::Broken(format!(
                        "hash mismatch for {}: expected {}, got {}",
                        c.id, expected, actual
                    ));
                }
                Err(e) => return Status::Broken(format!("cannot hash {}: {e}", c.id)),
            }
        }
    }
    Status::Ok
}

pub fn verify_all(m: &Manifest, base: &Path, full: bool) -> Vec<ComponentReport> {
    m.components
        .iter()
        .map(|c| verify_component(c, base, full))
        .collect()
}

/// Ids of required components whose report status is not `Ok`.
pub fn missing_required(m: &Manifest, reports: &[ComponentReport]) -> Vec<String> {
    let required: std::collections::HashSet<&str> = m
        .components
        .iter()
        .filter(|c| c.required)
        .map(|c| c.id.as_str())
        .collect();
    reports
        .iter()
        .filter(|r| r.status != Status::Ok && required.contains(r.id.as_str()))
        .map(|r| r.id.clone())
        .collect()
}
