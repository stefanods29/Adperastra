#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! Guarded file backings and memory results (Step 07d E8, `file-backing-1`).
//!
//! A backing is the bytes behind one grant: either a pinned disk source that
//! the app opened itself, or a bounded memory buffer that never touches the
//! disk (a sensitive snapshot, or a page result of a sensitive session). The
//! `adpfile` protocol serves both; memory responses are always `no-store`
//! and never outlive their lease.
//!
//! This module has no dependency on Tauri or the cache store: it is a pure
//! byte source that `files.rs` and `cache.rs` both use.

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::Arc;
use tauri::http::{header, Method, Response, StatusCode};
use zeroize::Zeroizing;

use fs_service::owned_io::PinnedSource;

/// The bytes behind one grant.
pub enum GrantedBacking {
    /// A guarded local file the app opened itself. The pinned handle keeps
    /// the exact file open, so a replacement at the same path cannot be read.
    Disk {
        source: Arc<PinnedSource>,
        length: u64,
    },
    /// Bounded bytes that must never reach a cache or a disk.
    Memory {
        bytes: Arc<Zeroizing<Vec<u8>>>,
        length: u64,
        sensitive: bool,
    },
}

impl std::fmt::Debug for GrantedBacking {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print content, a path or a token.
        match self {
            GrantedBacking::Disk { length, .. } => f
                .debug_struct("GrantedBacking::Disk")
                .field("length", length)
                .finish(),
            GrantedBacking::Memory {
                length, sensitive, ..
            } => f
                .debug_struct("GrantedBacking::Memory")
                .field("length", length)
                .field("sensitive", sensitive)
                .finish(),
        }
    }
}

impl GrantedBacking {
    pub fn length(&self) -> u64 {
        match self {
            GrantedBacking::Disk { length, .. } => *length,
            GrantedBacking::Memory { length, .. } => *length,
        }
    }

    /// Memory this backing counts against the shared aggregate budget.
    pub fn memory_bytes(&self) -> u64 {
        match self {
            GrantedBacking::Disk { .. } => 0,
            GrantedBacking::Memory { length, .. } => *length,
        }
    }

    pub fn is_sensitive(&self) -> bool {
        match self {
            GrantedBacking::Disk { .. } => false,
            GrantedBacking::Memory { sensitive, .. } => *sensitive,
        }
    }

    /// True when the backing length agrees with the bytes it holds.
    pub fn is_consistent(&self) -> bool {
        match self {
            GrantedBacking::Disk { source, length } => source
                .file()
                .metadata()
                .is_ok_and(|m| m.is_file() && m.len() == *length),
            GrantedBacking::Memory { bytes, length, .. } => {
                bytes.len() as u64 == *length && *length <= 256 * 1024 * 1024
            }
        }
    }

    /// Read at most one protocol chunk without changing any shared cursor.
    pub fn read_range(&self, start: u64, len: usize) -> Result<Vec<u8>, String> {
        if !self.is_consistent() || start > self.length() || len > MAX_BACKING_CHUNK {
            return Err("files.invalid_request".to_string());
        }
        let take = usize::try_from((self.length() - start).min(len as u64))
            .map_err(|_| "files.invalid_request".to_string())?;
        match self {
            GrantedBacking::Disk { source, .. } => {
                let mut buffer = vec![0u8; take];
                let mut read = 0;
                while read < take {
                    let count =
                        positioned_read(source.file(), &mut buffer[read..], start + read as u64)
                            .map_err(|_| "files.read_failed".to_string())?;
                    if count == 0 {
                        return Err("files.read_failed".to_string());
                    }
                    read += count;
                }
                source
                    .verify_after_read()
                    .map_err(|_| "files.read_failed".to_string())?;
                Ok(buffer)
            }
            GrantedBacking::Memory { bytes, .. } => {
                let from =
                    usize::try_from(start).map_err(|_| "files.invalid_request".to_string())?;
                bytes
                    .get(from..from + take)
                    .map(|part| part.to_vec())
                    .ok_or_else(|| "files.invalid_request".to_string())
            }
        }
    }

    /// A bounded independent cursor retaining this immutable backing.
    pub fn reader(self: &Arc<Self>) -> BackingReader {
        BackingReader {
            backing: Arc::clone(self),
            offset: 0,
        }
    }
}

/// Largest individual read or protocol response, independent of file size.
pub const MAX_BACKING_CHUNK: usize = 4 * 1024 * 1024;

#[cfg(windows)]
fn positioned_read(file: &std::fs::File, bytes: &mut [u8], offset: u64) -> io::Result<usize> {
    use std::os::windows::fs::FileExt;
    file.seek_read(bytes, offset)
}
#[cfg(unix)]
fn positioned_read(file: &std::fs::File, bytes: &mut [u8], offset: u64) -> io::Result<usize> {
    use std::os::unix::fs::FileExt;
    file.read_at(bytes, offset)
}

pub struct BackingReader {
    backing: Arc<GrantedBacking>,
    offset: u64,
}
impl Read for BackingReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let bytes = self
            .backing
            .read_range(self.offset, buffer.len().min(MAX_BACKING_CHUNK))
            .map_err(io::Error::other)?;
        buffer[..bytes.len()].copy_from_slice(&bytes);
        self.offset += bytes.len() as u64;
        Ok(bytes.len())
    }
}
impl Seek for BackingReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let next = match from {
            SeekFrom::Start(value) => i128::from(value),
            SeekFrom::Current(delta) => i128::from(self.offset) + i128::from(delta),
            SeekFrom::End(delta) => i128::from(self.backing.length()) + i128::from(delta),
        };
        if next < 0 || next > i128::from(self.backing.length()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid backing offset",
            ));
        }
        self.offset = next as u64;
        Ok(self.offset)
    }
}

fn base(status: StatusCode, _sensitive: bool) -> tauri::http::response::Builder {
    // Memory and disk backings are both `no-store`: a granted page is shown,
    // never kept by the webview's HTTP cache (E8).
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, "sandbox")
}

fn empty(status: StatusCode, sensitive: bool) -> Response<Vec<u8>> {
    base(status, sensitive)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Answer one protocol request for a backing. Pure apart from the read, so
/// it is unit-tested without a window; the caller holds the lease for the
/// whole life of the `Arc`.
pub fn serve_backing(
    backing: &GrantedBacking,
    mime: &str,
    method: &Method,
    range: Option<&str>,
) -> Response<Vec<u8>> {
    let sensitive = backing.is_sensitive();
    if method == Method::OPTIONS {
        return base(StatusCode::NO_CONTENT, sensitive)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    if method != Method::GET && method != Method::HEAD {
        return empty(StatusCode::METHOD_NOT_ALLOWED, sensitive);
    }
    if !backing.is_consistent() {
        return empty(StatusCode::NOT_FOUND, sensitive);
    }
    let total = backing.length();
    let (status, start, len) = match crate::files::parse_range(range, total) {
        crate::files::RangeAnswer::Unsatisfiable => {
            return base(StatusCode::RANGE_NOT_SATISFIABLE, sensitive)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
        crate::files::RangeAnswer::Full => {
            if total > MAX_BACKING_CHUNK as u64 {
                return empty(StatusCode::PAYLOAD_TOO_LARGE, sensitive);
            }
            (StatusCode::OK, 0u64, total)
        }
        crate::files::RangeAnswer::Part { start, end } => {
            (StatusCode::PARTIAL_CONTENT, start, end - start + 1)
        }
    };
    if len > MAX_BACKING_CHUNK as u64 {
        return empty(StatusCode::PAYLOAD_TOO_LARGE, sensitive);
    }
    let body = if method == Method::GET {
        match backing.read_range(start, len as usize) {
            Ok(bytes) => bytes,
            Err(_) => return empty(StatusCode::INTERNAL_SERVER_ERROR, sensitive),
        }
    } else {
        Vec::new()
    };
    let mut builder = base(status, sensitive)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len.to_string());
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, start + len - 1, total),
        );
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn memory(bytes: &[u8], sensitive: bool) -> GrantedBacking {
        GrantedBacking::Memory {
            bytes: Arc::new(Zeroizing::new(bytes.to_vec())),
            length: bytes.len() as u64,
            sensitive,
        }
    }

    #[test]
    fn memory_ranges_are_capped_and_no_store() {
        let backing = memory(b"0123456789", true);
        let full = serve_backing(&backing, "image/png", &Method::GET, None);
        assert_eq!(full.status(), StatusCode::OK);
        assert_eq!(full.body(), b"0123456789");
        assert_eq!(
            full.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let part = serve_backing(&backing, "image/png", &Method::GET, Some("bytes=2-4"));
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.body(), b"234");
        let head = serve_backing(&backing, "image/png", &Method::HEAD, None);
        assert!(head.body().is_empty());
        assert_eq!(head.status(), StatusCode::OK);
    }

    #[test]
    fn inconsistent_memory_is_never_served() {
        let backing = GrantedBacking::Memory {
            bytes: Arc::new(Zeroizing::new(vec![1, 2, 3])),
            length: 10,
            sensitive: true,
        };
        assert_eq!(
            serve_backing(&backing, "image/png", &Method::GET, None).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn disk_backing_reads_through_the_pinned_handle() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("page.png");
        fs::write(&path, b"abcdefghij").unwrap();
        let identity = fs_service::owned_io::SourceIdentity::capture(&path).unwrap();
        let pinned = fs_service::owned_io::PinnedSource::open(&path, &identity).unwrap();
        let backing = GrantedBacking::Disk {
            source: Arc::new(pinned),
            length: 10,
        };
        let part = serve_backing(&backing, "image/png", &Method::GET, Some("bytes=5-8"));
        assert_eq!(part.body(), b"fghi");
        // A replaced file at the same path is not what this backing serves.
        assert!(
            fs::remove_file(&path).is_err(),
            "the pinned object denies deletion"
        );
        let after = serve_backing(&backing, "image/png", &Method::GET, Some("bytes=0-1"));
        assert_eq!(after.body(), b"ab");
    }

    #[test]
    fn lengths_and_budgets_are_reported() {
        let backing = memory(&[0u8; 32], false);
        assert_eq!(backing.memory_bytes(), 32);
        assert_eq!(backing.length(), 32);
        assert!(!backing.is_sensitive());
        assert!(backing.is_consistent());
        let text = format!("{backing:?}");
        assert!(!text.contains("0, 0, 0"));
    }
}
