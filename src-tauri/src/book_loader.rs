//! Native E-book preparation (Step 07f T3/D2): bounded EPUB entry access
//! through the existing archive helper process and one guarded source grant
//! for MOBI.
//! The browser parser never receives a ZIP decoder, a raw path or the whole
//! book; it receives only named, bounded grants for the current section.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use archive::{ArchiveReadOptions, ExtractRequest};
use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::CancellationToken;
use uuid::Uuid;

use crate::archive_helper::{self, HelperMessage, HelperRequest};
use crate::helper::{HelperLine, HelperProcess};
use crate::webview_helper_types::{HelperInputGrant, HelperInputSource};

/// The published MOBI signature lives at byte 60 of the Palm database header.
const MOBI_SIGNATURE_OFFSET: usize = 60;
const MOBI_SIGNATURE: &[u8] = b"BOOKMOBI";
const PALM_DOC_SIGNATURE: &[u8] = b"TEXtREAd";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookFormat {
    Epub,
    Mobi,
}

#[allow(dead_code)] // id/label are kept for the TOC fallback; href is not re-read.
#[derive(Debug, Clone)]
pub struct BookSectionEntry {
    pub id: String,
    pub label: String,
    pub href: String,
}

#[allow(dead_code)] // some book metadata is kept for the TOC fallback/debugging.
pub struct BookPreparation {
    pub format: BookFormat,
    pub entry_name: String,
    pub opf_path: Option<String>,
    pub sections: Vec<BookSectionEntry>,
    pub grants: Vec<HelperInputGrant>,
    /// Internal EPUB entry name -> short 07d grant name (`HelperInputGrant`
    /// names are at most 255 characters; entry paths may be 1,024).
    pub grant_entries: Vec<(String, String)>,
    pub partial: bool,
    /// EPUB spine hrefs in reading order; empty for MOBI until the parser
    /// reports its own sections.
    pub spine: Vec<String>,
    pub path: PathBuf,
    pub work_dir: PathBuf,
}

/// Detect the format from bytes, never from a user-supplied extension alone.
pub fn detect_book_format(head: &[u8]) -> Option<BookFormat> {
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        return Some(BookFormat::Epub);
    }
    if head.len() >= MOBI_SIGNATURE_OFFSET + MOBI_SIGNATURE.len()
        && &head[MOBI_SIGNATURE_OFFSET..MOBI_SIGNATURE_OFFSET + MOBI_SIGNATURE.len()]
            == MOBI_SIGNATURE
    {
        return Some(BookFormat::Mobi);
    }
    if head.starts_with(PALM_DOC_SIGNATURE) {
        return Some(BookFormat::Mobi);
    }
    None
}

/// Prepare the first view. EPUB entries are extracted into the session's
/// app-owned work folder and each becomes one named grant; MOBI keeps its one
/// guarded source grant and reads bounded ranges.
pub fn prepare_book(
    path: &Path,
    work_dir: &Path,
    cancel: &CancellationToken,
) -> Result<BookPreparation, String> {
    let mut head = [0u8; 80];
    let read = read_head(path, &mut head)?;
    let format =
        detect_book_format(&head[..read]).ok_or_else(|| "extra_view.unsupported".to_string())?;
    let entry_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "book".to_string());
    match format {
        BookFormat::Mobi => {
            let grant = grant_for(path, &entry_name, "application/x-mobipocket-ebook")?;
            Ok(BookPreparation {
                format,
                entry_name: entry_name.clone(),
                opf_path: None,
                sections: Vec::new(),
                grants: vec![grant],
                grant_entries: vec![(entry_name.clone(), entry_name)],
                partial: false,
                spine: Vec::new(),
                path: path.to_path_buf(),
                work_dir: work_dir.to_path_buf(),
            })
        }
        BookFormat::Epub => prepare_epub(path, work_dir, entry_name, cancel),
    }
}

fn prepare_epub(
    path: &Path,
    work_dir: &Path,
    entry_name: String,
    cancel: &CancellationToken,
) -> Result<BookPreparation, String> {
    let listing = archive_list(path, cancel)?;
    let container_path = "META-INF/container.xml".to_string();
    if !listing
        .entries
        .iter()
        .any(|entry| entry.path == container_path)
    {
        return Err("extra_view.corrupt".to_string());
    }
    let container_size = listing
        .entries
        .iter()
        .find(|candidate| candidate.path == container_path)
        .map(|candidate| candidate.size)
        .unwrap_or(0);
    if container_size > 4 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    extract_entries(
        path,
        work_dir,
        std::slice::from_ref(&container_path),
        cancel,
    )?;
    let container = std::fs::read_to_string(work_dir.join(&container_path))
        .map_err(|_| "extra_view.corrupt".to_string())?;
    let opf_path = parse_container(&container).ok_or_else(|| "extra_view.corrupt".to_string())?;
    let opf_size = listing
        .entries
        .iter()
        .find(|candidate| candidate.path == opf_path)
        .map(|candidate| candidate.size)
        .unwrap_or(0);
    if opf_size > 4 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    extract_entries(path, work_dir, std::slice::from_ref(&opf_path), cancel)?;
    let opf = std::fs::read_to_string(work_dir.join(&opf_path))
        .map_err(|_| "extra_view.corrupt".to_string())?;
    let (manifest, spine) = parse_opf(&opf)?;
    if spine.is_empty() {
        return Err("extra_view.corrupt".to_string());
    }
    let mut sections = Vec::new();
    let mut spine_hrefs = Vec::new();
    for (index, idref) in spine.iter().enumerate() {
        let Some(item) = manifest.get(idref) else {
            continue;
        };
        if !item.media_type.contains("html") && !item.media_type.contains("xml") {
            continue;
        }
        let href =
            normalize_entry(&item.href).ok_or_else(|| "extra_view.bad_request".to_string())?;
        spine_hrefs.push(href.clone());
        sections.push(BookSectionEntry {
            id: idref.clone(),
            label: label_from_href(&href, index),
            href,
        });
    }
    if sections.is_empty() {
        return Err("extra_view.corrupt".to_string());
    }
    let first_section = sections[0].href.clone();
    let first_size = listing
        .entries
        .iter()
        .find(|candidate| candidate.path == first_section)
        .map(|candidate| candidate.size)
        .unwrap_or(0);
    if first_size > 4 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    let mut wanted = vec![
        container_path.clone(),
        opf_path.clone(),
        first_section.clone(),
    ];
    if let Some(nav) = manifest
        .values()
        .find(|item| item.properties.contains("nav"))
    {
        if let Some(href) = normalize_entry(&nav.href) {
            let size = listing
                .entries
                .iter()
                .find(|candidate| candidate.path == href)
                .map(|candidate| candidate.size)
                .unwrap_or(0);
            if size > 4 * 1024 * 1024 {
                return Err("extra_view.too_large".to_string());
            }
            wanted.push(href);
        }
    }
    extract_entries(path, work_dir, &wanted, cancel)?;
    let first_html = std::fs::read_to_string(work_dir.join(&first_section)).unwrap_or_default();
    let resources = referenced_entries(&first_section, &first_html);
    wanted.extend(resources.iter().cloned());
    wanted.sort();
    wanted.dedup();
    if wanted.len() > 256 {
        wanted.truncate(256);
    }
    let mut wanted_bytes = 0u64;
    for entry in &wanted {
        let size = listing
            .entries
            .iter()
            .find(|candidate| &candidate.path == entry)
            .map(|candidate| candidate.size)
            .unwrap_or(0);
        if size > 4 * 1024 * 1024 {
            return Err("extra_view.too_large".to_string());
        }
        wanted_bytes = wanted_bytes.saturating_add(size);
    }
    if wanted_bytes > 512 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    extract_entries(path, work_dir, &wanted, cancel)?;
    let mut grants = Vec::new();
    let mut grant_entries = Vec::new();
    for entry in &wanted {
        let file = work_dir.join(entry);
        if !file.is_file() {
            continue;
        }
        let grant_name = format!("e{}", grants.len());
        let mime = mime_for_entry(entry);
        grants.push(grant_for(&file, &grant_name, mime)?);
        grant_entries.push((entry.clone(), grant_name));
    }
    let partial = listing.partial || spine.len() > sections.len() || grants.len() < wanted.len();
    Ok(BookPreparation {
        format: BookFormat::Epub,
        entry_name,
        opf_path: Some(opf_path),
        sections,
        grants,
        grant_entries,
        partial,
        spine: spine_hrefs,
        path: path.to_path_buf(),
        work_dir: work_dir.to_path_buf(),
    })
}

/// Extract one later section and its local resources, then return fresh
/// grants for `WebviewHelperSession::update_inputs`.
pub type SectionGrants = (Vec<HelperInputGrant>, Vec<(String, String)>);

pub fn prepare_section(
    preparation: &BookPreparation,
    section: usize,
    cancel: &CancellationToken,
) -> Result<SectionGrants, String> {
    if preparation.format != BookFormat::Epub {
        return Ok((
            preparation.grants.clone(),
            preparation.grant_entries.clone(),
        ));
    }
    let href = preparation
        .spine
        .get(section)
        .cloned()
        .ok_or_else(|| "extra_view.bad_request".to_string())?;
    let listing = archive_list(&preparation.path, cancel)?;
    let section_size = listing
        .entries
        .iter()
        .find(|candidate| candidate.path == href)
        .map(|candidate| candidate.size)
        .unwrap_or(0);
    if section_size > 4 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    let wanted = vec![href.clone()];
    extract_entries(&preparation.path, &preparation.work_dir, &wanted, cancel)?;
    let html = std::fs::read_to_string(preparation.work_dir.join(&href)).unwrap_or_default();
    let mut resources = referenced_entries(&href, &html);
    resources.sort();
    resources.dedup();
    if resources.len() > 32 {
        resources.truncate(32);
    }
    let mut total = 0u64;
    for entry in std::iter::once(&href).chain(resources.iter()) {
        let size = listing
            .entries
            .iter()
            .find(|candidate| &candidate.path == entry)
            .map(|candidate| candidate.size)
            .unwrap_or(0);
        if size > 4 * 1024 * 1024 {
            return Err("extra_view.too_large".to_string());
        }
        total = total.saturating_add(size);
    }
    if total > 64 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    extract_entries(&preparation.path, &preparation.work_dir, &resources, cancel)?;
    let mut grants = Vec::new();
    let mut grant_entries = Vec::new();
    for entry in std::iter::once(&href).chain(resources.iter()) {
        let file = preparation.work_dir.join(entry);
        if !file.is_file() {
            continue;
        }
        let grant_name = format!("s{}", grants.len());
        grants.push(grant_for(&file, &grant_name, mime_for_entry(entry))?);
        grant_entries.push((entry.clone(), grant_name));
    }
    if grants.is_empty() {
        return Err("extra_view.corrupt".to_string());
    }
    Ok((grants, grant_entries))
}

fn read_head(path: &Path, buffer: &mut [u8]) -> Result<usize, String> {
    use std::io::Read;
    let metadata = std::fs::metadata(path).map_err(|_| "extra_view.unavailable".to_string())?;
    if !metadata.is_file() {
        return Err("extra_view.bad_request".to_string());
    }
    if metadata.len() > 256 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    let file = std::fs::File::open(path).map_err(|_| "extra_view.unavailable".to_string())?;
    file.take(buffer.len() as u64)
        .read(buffer)
        .map_err(|_| "extra_view.unavailable".to_string())
}

/// Run one request in the existing archive helper process, never in the app
/// process (R-SEC-9). The helper reads one line and answers with bounded
/// JSON lines; the parent collects the entries or the extraction report.
type ArchiveHelperResult = (
    Vec<archive::ArchiveEntry>,
    Option<archive::ExtractReport>,
    bool,
);

fn run_archive_helper(
    request: HelperRequest,
    cancel: &CancellationToken,
) -> Result<ArchiveHelperResult, String> {
    let mut helper = HelperProcess::spawn(
        archive_helper::HELPER_FLAG,
        archive_helper::HELPER_MEMORY_LIMIT,
    )?;
    let line = serde_json::to_string(&request).map_err(|_| "extra_view.bad_request".to_string())?;
    helper.send_line(&line)?;
    let mut entries = Vec::new();
    let mut report = None;
    let mut partial = false;
    let mut error = None;
    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            helper.kill();
            return Err("files.cancelled".to_string());
        }
        match helper.recv(std::time::Duration::from_secs(15)) {
            Some(HelperLine::Line(text)) => {
                let message: HelperMessage = match serde_json::from_str(&text) {
                    Ok(message) => message,
                    Err(_) => {
                        helper.kill();
                        return Err("extra_view.corrupt".to_string());
                    }
                };
                match message {
                    HelperMessage::Entries { entries: batch } => {
                        entries.extend(batch);
                        if entries.len() > 50_000 {
                            helper.kill();
                            return Err("extra_view.too_large".to_string());
                        }
                    }
                    HelperMessage::Listed {
                        partial: listed_partial,
                        ..
                    } => {
                        partial = listed_partial;
                        break;
                    }
                    HelperMessage::Extracted { report: extracted } => {
                        report = Some(extracted);
                        break;
                    }
                    HelperMessage::Failed { code } => {
                        error = Some(code);
                        break;
                    }
                    HelperMessage::Progress { .. }
                    | HelperMessage::Alive
                    | HelperMessage::Created { .. }
                    | HelperMessage::SpoolCreated { .. }
                    | HelperMessage::RarStatus { .. } => {}
                }
            }
            Some(HelperLine::TooLong) => {
                helper.kill();
                return Err("extra_view.too_large".to_string());
            }
            Some(HelperLine::Closed) => {
                return Err("extra_view.corrupt".to_string());
            }
            None => {
                helper.kill();
                return Err("extra_view.unavailable".to_string());
            }
        }
    }
    helper.kill();
    if let Some(code) = error {
        return Err(archive_code(&code));
    }
    Ok((entries, report, partial))
}

fn archive_code(code: &str) -> String {
    match code {
        "archive.bomb" | "archive.too_many_entries" | "archive.too_large" => {
            "extra_view.too_large".to_string()
        }
        "archive.unsupported" | "archive.unsupported_method" => {
            "extra_view.unsupported".to_string()
        }
        "archive.cancelled" => "files.cancelled".to_string(),
        _ => "extra_view.corrupt".to_string(),
    }
}

fn archive_list(path: &Path, cancel: &CancellationToken) -> Result<archive::Listing, String> {
    let (entries, _, partial) = run_archive_helper(
        HelperRequest::List {
            path: path.to_string_lossy().to_string(),
            options: ArchiveReadOptions::default(),
        },
        cancel,
    )?;
    if entries.len() > 50_000 {
        return Err("extra_view.too_large".to_string());
    }
    let total = entries
        .iter()
        .fold(0u64, |sum, entry| sum.saturating_add(entry.size));
    if total > 512 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    Ok(archive::Listing {
        format: archive::ArchiveFormat::Zip,
        entries,
        partial,
    })
}

fn extract_entries(
    archive_path: &Path,
    work_dir: &Path,
    entries: &[String],
    cancel: &CancellationToken,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let metadata =
        std::fs::metadata(archive_path).map_err(|_| "extra_view.unavailable".to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let request = ExtractRequest {
        paths: entries.to_vec(),
        base: String::new(),
        dest_dir: work_dir.to_string_lossy().to_string(),
        new_folder: None,
        expected_size: metadata.len(),
        expected_modified: modified,
        single_file: false,
        zone: None,
    };
    let (_, report, _) = run_archive_helper(
        HelperRequest::Extract {
            path: archive_path.to_string_lossy().to_string(),
            request,
            options: ArchiveReadOptions::default(),
        },
        cancel,
    )?;
    if let Some(report) = report {
        if report.error.is_some() {
            return Err("extra_view.corrupt".to_string());
        }
        if report.cancelled {
            return Err("files.cancelled".to_string());
        }
        if !report.skipped.is_empty() {
            return Err("extra_view.corrupt".to_string());
        }
    }
    Ok(())
}

fn parse_container(xml: &str) -> Option<String> {
    let start = xml.find("<rootfile")?;
    let rest = &xml[start..];
    let value = attribute(rest, "full-path")?;
    normalize_entry(&value)
}

#[derive(Debug, Clone)]
struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

fn parse_opf(xml: &str) -> Result<(HashMap<String, ManifestItem>, Vec<String>), String> {
    if xml.len() > 4 * 1024 * 1024 {
        return Err("extra_view.too_large".to_string());
    }
    let mut manifest = HashMap::new();
    for tag in element_tags(xml, "item") {
        let Some(id) = attribute(tag, "id") else {
            continue;
        };
        let Some(href) = attribute(tag, "href") else {
            continue;
        };
        let media_type = attribute(tag, "media-type").unwrap_or_default();
        let properties = attribute(tag, "properties").unwrap_or_default();
        manifest.insert(
            id,
            ManifestItem {
                href,
                media_type,
                properties,
            },
        );
    }
    let mut spine = Vec::new();
    for tag in element_tags(xml, "itemref") {
        if attribute(tag, "linear").as_deref() == Some("no") {
            continue;
        }
        if let Some(idref) = attribute(tag, "idref") {
            spine.push(idref);
        }
    }
    if spine.is_empty() {
        return Err("extra_view.corrupt".to_string());
    }
    Ok((manifest, spine))
}

/// Every opening tag named `name`, without confusing `item` with `itemref`.
fn element_tags<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let needle = format!("<{name}");
    let mut output = Vec::new();
    let mut rest = xml;
    while let Some(position) = rest.find(&needle) {
        let start = position + needle.len();
        let next = rest.as_bytes().get(start).copied();
        if !matches!(
            next,
            Some(b' ') | Some(b'\t') | Some(b'\r') | Some(b'\n') | Some(b'>') | Some(b'/')
        ) {
            rest = &rest[start..];
            continue;
        }
        let end = rest[start..]
            .find('>')
            .map(|value| start + value)
            .unwrap_or(rest.len());
        output.push(&rest[position..end]);
        rest = &rest[(end + 1).min(rest.len())..];
    }
    output
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &rest[quote.len_utf8()..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn normalize_entry(value: &str) -> Option<String> {
    let decoded = percent_decode(value)?;
    let decoded = decoded.replace('\\', "/");
    if decoded.is_empty()
        || decoded.len() > 1024
        || decoded.starts_with('/')
        || decoded.contains('\0')
        || decoded.split('/').any(|part| part == "..")
        || decoded.as_bytes().get(1) == Some(&b':')
    {
        return None;
    }
    let mut parts = Vec::new();
    for part in decoded.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        parts.push(part);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex(bytes[index + 1])?;
            let low = hex(bytes[index + 2])?;
            output.push(high * 16 + low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn referenced_entries(section: &str, html: &str) -> Vec<String> {
    let base = {
        let mut parts: Vec<&str> = section.split('/').collect();
        parts.pop();
        parts.join("/")
    };
    let mut output = Vec::new();
    for needle in ["src=", "href="] {
        let mut rest = html;
        while let Some(position) = rest.find(needle) {
            rest = &rest[position + needle.len()..];
            let value = if let Some(value) = rest.strip_prefix('"') {
                value.split('"').next().unwrap_or("")
            } else if let Some(value) = rest.strip_prefix('\'') {
                value.split('\'').next().unwrap_or("")
            } else {
                rest.split_whitespace().next().unwrap_or("")
            };
            let value = value
                .split('#')
                .next()
                .unwrap_or("")
                .split('?')
                .next()
                .unwrap_or("");
            if value.is_empty()
                || value.contains(':')
                || value.starts_with('/')
                || value.starts_with("..")
            {
                continue;
            }
            let joined = if base.is_empty() {
                value.to_string()
            } else {
                format!("{base}/{value}")
            };
            if let Some(normalized) = normalize_entry(&joined) {
                if normalized != section && is_resource(&normalized) {
                    output.push(normalized);
                }
            }
        }
    }
    output.sort();
    output.dedup();
    output
}

fn is_resource(entry: &str) -> bool {
    let extension = entry
        .rsplit_once('.')
        .map(|(_, value)| value.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "css" | "ttf" | "otf" | "woff" | "woff2"
    )
}

fn mime_for_entry(entry: &str) -> &'static str {
    let extension = entry
        .rsplit_once('.')
        .map(|(_, value)| value.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "xhtml" | "html" | "htm" => "application/xhtml+xml",
        "css" => "text/css",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ncx" => "application/x-dtbncx+xml",
        _ => "application/octet-stream",
    }
}

fn label_from_href(href: &str, index: usize) -> String {
    href.rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(512).collect())
        .unwrap_or_else(|| format!("Section {}", index + 1))
}

fn grant_for(path: &Path, name: &str, mime: &str) -> Result<HelperInputGrant, String> {
    let stamp =
        fs_service::capture_source_stamp(path).map_err(|_| "extra_view.unavailable".to_string())?;
    let identity =
        SourceIdentity::capture(path).map_err(|_| "extra_view.unavailable".to_string())?;
    let pinned = Arc::new(
        PinnedSource::open(path, &identity).map_err(|_| "extra_view.changed".to_string())?,
    );
    Ok(HelperInputGrant {
        grant_id: Uuid::new_v4(),
        name: name.to_string(),
        mime: mime.to_string(),
        source: HelperInputSource::Disk {
            path: path.to_path_buf(),
            expected: stamp,
            pinned,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_escape_is_refused() {
        assert_eq!(normalize_entry("../secret"), None);
        assert_eq!(normalize_entry("OEBPS/../secret"), None);
        assert_eq!(normalize_entry("C:\\secret"), None);
        assert_eq!(
            normalize_entry("OEBPS/chapter%201.xhtml").as_deref(),
            Some("OEBPS/chapter 1.xhtml")
        );
    }

    #[test]
    fn mobi_header_is_detected_by_bytes() {
        let mut head = vec![0u8; 80];
        head[MOBI_SIGNATURE_OFFSET..MOBI_SIGNATURE_OFFSET + 8].copy_from_slice(MOBI_SIGNATURE);
        assert_eq!(detect_book_format(&head), Some(BookFormat::Mobi));
        assert_eq!(
            detect_book_format(b"PK\x03\x04rest"),
            Some(BookFormat::Epub)
        );
        assert_eq!(detect_book_format(b"not a book"), None);
    }

    #[test]
    fn resources_outside_the_section_are_not_followed() {
        let html = r#"<img src="../secret.png"><img src="images/a.png"><a href="https://x">x</a>"#;
        let resources = referenced_entries("OEBPS/text/ch1.xhtml", html);
        assert_eq!(resources, vec!["OEBPS/text/images/a.png".to_string()]);
    }

    #[test]
    fn container_and_opf_attributes_are_bounded() {
        let container = r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#;
        assert_eq!(
            parse_container(container).as_deref(),
            Some("OEBPS/content.opf")
        );
        let opf = r#"<manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine>"#;
        let (manifest, spine) = parse_opf(opf).unwrap();
        assert_eq!(spine, vec!["c1".to_string()]);
        assert_eq!(manifest["c1"].href, "text/ch1.xhtml");
    }
}
