//! Bounded model resource grants (Step 07g T2/D2).
//!
//! A glTF may name buffers and images in its parent folder; a 3MF may carry
//! textures in its validated archive. Native code turns exactly those
//! resources into application-issued grants. A URL, absolute path, traversal
//! or undeclared sibling never reaches the helper.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_service::owned_io::{PinnedSource, SourceIdentity};
use fs_service::SourceStamp;

use crate::special_3mf::read_3mf_resources;

pub const MAX_RESOURCES: usize = 256;
pub const MAX_RESOURCE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_GLTF_JSON: u64 = 32 * 1024 * 1024;

pub struct DiskResource {
    pub name: String,
    pub mime: String,
    pub path: PathBuf,
    pub stamp: SourceStamp,
    pub pinned: Arc<PinnedSource>,
}

#[derive(Default)]
pub struct ModelResources {
    pub disk: Vec<DiskResource>,
    /// 3MF textures already bounded by the archive preflight.
    pub memory: Vec<(String, Vec<u8>)>,
    pub partial: bool,
}

fn unsupported() -> String {
    "special_view.unsupported".to_string()
}

fn too_large() -> String {
    "special_view.too_large".to_string()
}

fn changed() -> String {
    "special_view.changed".to_string()
}

fn decode_percent(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn relative_name(uri: &str) -> Option<String> {
    if uri.is_empty() || uri.len() > 1024 || uri.starts_with('/') || uri.starts_with('\\') {
        return None;
    }
    if uri.chars().nth(1) == Some(':') {
        return None;
    }
    let decoded = decode_percent(uri)?;
    if decoded.starts_with('/') || decoded.starts_with('\\') || decoded.chars().nth(1) == Some(':')
    {
        return None;
    }
    let slashed = decoded.replace('\\', "/");
    let mut segments = Vec::new();
    for segment in slashed.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        return None;
    }
    let joined = segments.join("/");
    if joined.len() > 255 {
        return None;
    }
    Some(joined)
}

fn mime_for(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gltf") || lower.ends_with(".json") {
        "model/gltf+json"
    } else {
        "application/octet-stream"
    }
}

fn within(parent: &Path, candidate: &Path) -> bool {
    let parent = parent.to_string_lossy().replace('/', "\\").to_lowercase();
    let candidate = candidate
        .to_string_lossy()
        .replace('/', "\\")
        .to_lowercase();
    candidate.starts_with(&(parent.trim_end_matches('\\').to_string() + "\\"))
}

/// Collect the resources of one model. `stamp_for` is `CacheService::source_stamp`
/// supplied by the caller; no second stamp implementation is created here.
pub fn collect(
    path: &Path,
    stamp: &SourceStamp,
    stamp_for: &dyn Fn(&Path) -> Result<SourceStamp, String>,
) -> Result<ModelResources, String> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if extension == "3mf" {
        let textures = read_3mf_resources(path)?;
        if textures.textures.len() > 32 {
            return Err(too_large());
        }
        let mut memory = Vec::new();
        let mut total = 0u64;
        for texture in textures.textures {
            total = total
                .checked_add(texture.bytes.len() as u64)
                .ok_or_else(too_large)?;
            if total > 128 * 1024 * 1024 {
                return Err(too_large());
            }
            memory.push((texture.name, texture.bytes));
        }
        return Ok(ModelResources {
            disk: Vec::new(),
            memory,
            partial: textures.partial,
        });
    }
    if extension != "gltf" {
        return Ok(ModelResources::default());
    }

    let metadata = std::fs::metadata(path).map_err(|_| "special_view.unavailable".to_string())?;
    if metadata.len() > MAX_GLTF_JSON {
        return Err(too_large());
    }
    let bytes = std::fs::read(path).map_err(|_| "special_view.unavailable".to_string())?;
    if bytes.len() as u64 != stamp.size_bytes {
        return Err(changed());
    }
    let json: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "special_view.corrupt".to_string())?;
    let parent = path.parent().ok_or_else(unsupported)?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "special_view.unavailable".to_string())?;
    let mut resources = ModelResources::default();
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    let mut uris = Vec::new();
    for key in ["buffers", "images"] {
        if let Some(array) = json.get(key).and_then(|value| value.as_array()) {
            for entry in array {
                if let Some(uri) = entry.get("uri").and_then(|value| value.as_str()) {
                    uris.push(uri.to_string());
                }
            }
        }
    }
    if uris.len() > MAX_RESOURCES {
        return Err(too_large());
    }
    for uri in uris {
        let name = relative_name(&uri).ok_or_else(unsupported)?;
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err("special_view.corrupt".to_string());
        }
        let candidate = parent.join(name.replace('/', "\\"));
        let canonical = candidate
            .canonicalize()
            .map_err(|_| "special_view.changed".to_string())?;
        if !within(&parent, &canonical) {
            return Err(unsupported());
        }
        let identity =
            SourceIdentity::capture(&canonical).map_err(|_| "special_view.changed".to_string())?;
        let resource_stamp = stamp_for(&canonical)?;
        if resource_stamp.size_bytes != identity.size {
            return Err(changed());
        }
        total = total.checked_add(identity.size).ok_or_else(too_large)?;
        if total > MAX_RESOURCE_BYTES {
            return Err(too_large());
        }
        let pinned = PinnedSource::open_background(&canonical, &identity)
            .map_err(|_| "special_view.changed".to_string())?;
        resources.disk.push(DiskResource {
            mime: mime_for(&name).to_string(),
            name,
            path: canonical,
            stamp: resource_stamp,
            pinned: Arc::new(pinned),
        });
    }
    Ok(resources)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_traversal_and_schemes() {
        assert_eq!(relative_name("../secret.png"), None);
        assert_eq!(relative_name("https://example.test/a.png"), None);
        assert_eq!(relative_name("C:\\Windows\\win.ini"), None);
        assert_eq!(relative_name("//server/share/a.png"), None);
        assert_eq!(relative_name("%2e%2e/secret.png"), None);
        assert_eq!(
            relative_name("textures/wood.png"),
            Some("textures/wood.png".to_string())
        );
    }

    #[test]
    fn parent_containment_is_case_insensitive() {
        assert!(within(
            Path::new("C:\\Models"),
            Path::new("c:\\models\\a.png")
        ));
        assert!(!within(
            Path::new("C:\\Models"),
            Path::new("C:\\Models2\\a.png")
        ));
        assert!(!within(
            Path::new("C:\\Models"),
            Path::new("C:\\Other\\a.png")
        ));
    }
}
