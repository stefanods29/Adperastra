//! Bounded content extractors (Step 11a E4). The registry is the only way a
//! format reaches content indexing. PDF, e-book, email and Office adapters
//! are registered by their producer modules; no fallback parser is invented
//! here.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use fs_service::CancellationToken;

use crate::limits::{MAX_CONTENT_INPUT_BYTES, MAX_CONTENT_TEXT_BYTES, MAX_EXTRACTED_BYTES};
use crate::types::{ExtractedText, ExtractionCoverage, ExtractorRequest};

pub trait ContentExtractor: Send + Sync {
    fn id(&self) -> &'static str;
    fn extensions(&self) -> &'static [&'static str];
    fn extract(
        &self,
        request: &ExtractorRequest,
        cancel: &CancellationToken,
    ) -> Result<ExtractedText, String>;
    /// OCR adapters obey the explicit per-root OCR consent and the session
    /// budget; ordinary text adapters return false.
    fn is_ocr(&self) -> bool {
        false
    }
}

struct Registered {
    id: &'static str,
    extensions: &'static [&'static str],
    extractor: Arc<dyn ContentExtractor>,
    ocr: bool,
}

#[derive(Default)]
pub struct ContentExtractorRegistry {
    entries: Vec<Registered>,
    ids: HashMap<&'static str, usize>,
}

impl ContentExtractorRegistry {
    pub fn register(
        &mut self,
        id: &'static str,
        extensions: &'static [&'static str],
        extractor: Arc<dyn ContentExtractor>,
    ) -> Result<(), String> {
        self.register_with_kind(id, extensions, false, extractor)
    }

    /// Additive registration used by OCR providers. The public E4 `register`
    /// keeps its exact signature for 13's Office adapter.
    pub fn register_with_kind(
        &mut self,
        id: &'static str,
        extensions: &'static [&'static str],
        ocr: bool,
        extractor: Arc<dyn ContentExtractor>,
    ) -> Result<(), String> {
        if id.is_empty() || extensions.is_empty() {
            return Err("search.invalid".to_string());
        }
        if self.ids.contains_key(id) {
            return Err("search.invalid".to_string());
        }
        if self
            .entries
            .iter()
            .any(|entry| Arc::ptr_eq(&entry.extractor, &extractor))
        {
            return Err("search.invalid".to_string());
        }
        let index = self.entries.len();
        self.entries.push(Registered {
            id,
            extensions,
            extractor,
            ocr,
        });
        self.ids.insert(id, index);
        Ok(())
    }

    pub fn resolve(&self, path: &Path) -> Option<Arc<dyn ContentExtractor>> {
        let extension = path
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        self.entries
            .iter()
            .find(|entry| {
                entry
                    .extensions
                    .iter()
                    .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
            })
            .map(|entry| entry.extractor.clone())
    }

    pub fn is_ocr(&self, id: &str) -> bool {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .is_some_and(|entry| entry.ocr)
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.entries.iter().map(|entry| entry.id).collect()
    }

    /// The formats that need no helper or opt-in content consent beyond the
    /// root toggle: plain text and text-like structured files.
    pub fn with_text_defaults() -> Self {
        let mut registry = Self::default();
        registry
            .register(
                "plain-text",
                &[
                    "txt", "text", "md", "markdown", "csv", "tsv", "log", "json", "jsonl", "xml",
                    "yaml", "yml", "toml", "ini", "sql", "rs", "ts", "tsx", "js", "jsx", "py",
                    "ps1", "sh", "bat", "c", "h", "cpp", "hpp", "java", "cs", "go", "rb", "lua",
                ],
                Arc::new(PlainTextExtractor),
            )
            .expect("plain text registration is unique");
        registry
    }
}

/// UTF-8/UTF-16 text with a hard input and stored-character budget.
pub struct PlainTextExtractor;

impl ContentExtractor for PlainTextExtractor {
    fn id(&self) -> &'static str {
        "plain-text"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[
            "txt", "text", "md", "markdown", "csv", "tsv", "log", "json", "jsonl", "xml", "yaml",
            "yml", "toml", "ini", "sql", "rs", "ts", "tsx", "js", "jsx", "py", "ps1", "sh", "bat",
            "c", "h", "cpp", "hpp", "java", "cs", "go", "rb", "lua",
        ]
    }

    fn extract(
        &self,
        request: &ExtractorRequest,
        cancel: &CancellationToken,
    ) -> Result<ExtractedText, String> {
        if request.is_expired() {
            return Err("search.failed".to_string());
        }
        let input = read_pinned(request, cancel)?;
        let (decoded, oversized) = decode_text(&input);
        let budget = request.char_budget();
        // The stored text must pass `ExtractedText::validate`, whose byte cap
        // is the extracted-result bound, not the larger normalization buffer.
        let mut text = String::with_capacity(budget.saturating_mul(4).min(decoded.len()));
        let mut truncated = oversized || decoded.len() > MAX_CONTENT_TEXT_BYTES;
        let mut stored_chars = 0usize;
        for character in decoded.chars() {
            if cancel.load(Ordering::Relaxed) {
                return Err("search.changed".to_string());
            }
            if text.len() + character.len_utf8() > MAX_EXTRACTED_BYTES || stored_chars >= budget {
                truncated = true;
                break;
            }
            match character {
                '\0' => {}
                '\r' => {
                    text.push('\n');
                    stored_chars += 1;
                }
                '\t' | '\n' => {
                    text.push(character);
                    stored_chars += 1;
                }
                value if value.is_control() => {
                    text.push(' ');
                    stored_chars += 1;
                }
                value => {
                    text.push(value);
                    stored_chars += 1;
                }
            }
        }
        Ok(ExtractedText {
            text: text.trim().to_string(),
            truncated,
            coverage: if truncated {
                ExtractionCoverage::Partial
            } else {
                ExtractionCoverage::Complete
            },
            metadata: Vec::new(),
        })
    }
}

fn read_pinned(request: &ExtractorRequest, cancel: &CancellationToken) -> Result<Vec<u8>, String> {
    let size = request.pinned.identity().size;
    if size > MAX_CONTENT_INPUT_BYTES {
        return Err("search.too_large".to_string());
    }
    let mut file = request
        .pinned
        .file()
        .try_clone()
        .map_err(|_| "search.failed".to_string())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "search.failed".to_string())?;
    let mut bytes = Vec::with_capacity(size.min(MAX_CONTENT_INPUT_BYTES) as usize);
    let mut limited = file.take(MAX_CONTENT_INPUT_BYTES + 1);
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("search.changed".to_string());
        }
        let read = limited
            .read(&mut buffer)
            .map_err(|_| "search.failed".to_string())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() as u64 > MAX_CONTENT_INPUT_BYTES {
            return Err("search.too_large".to_string());
        }
    }
    request
        .pinned
        .verify_after_read()
        .map_err(|_| "search.changed".to_string())?;
    Ok(bytes)
}

fn decode_text(bytes: &[u8]) -> (String, bool) {
    let (decoded, oversized) = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        (String::from_utf16_lossy(&units), false)
    } else if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        (String::from_utf16_lossy(&units), false)
    } else {
        let body = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            &bytes[3..]
        } else {
            bytes
        };
        (String::from_utf8_lossy(body).to_string(), false)
    };
    (decoded, oversized)
}

/// Register the registry with the one adapter this step owns. Producer
/// adapters add themselves at startup without replacing it.
pub fn default_registry() -> ContentExtractorRegistry {
    ContentExtractorRegistry::with_text_defaults()
}

#[cfg(test)]
mod tests {
    use super::{ContentExtractor, ContentExtractorRegistry, PlainTextExtractor};
    use crate::types::ExtractorRequest;
    use fs_service::new_cancellation_token;
    use fs_service::owned_io::{PinnedSource, SourceIdentity};
    use fs_service::source_stamp::capture_source_stamp;
    use std::sync::Arc;

    #[test]
    fn duplicate_ids_are_refused() {
        let mut registry = ContentExtractorRegistry::default();
        registry
            .register("one", &["txt"], Arc::new(PlainTextExtractor))
            .unwrap();
        assert!(registry
            .register("one", &["md"], Arc::new(PlainTextExtractor))
            .is_err());
    }

    #[test]
    fn extensions_resolve_case_insensitively() {
        let registry = ContentExtractorRegistry::with_text_defaults();
        assert!(registry
            .resolve(std::path::Path::new("notes.TXT"))
            .is_some());
        assert!(registry
            .resolve(std::path::Path::new("photo.png"))
            .is_none());
    }

    #[test]
    fn an_expired_request_does_no_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.txt");
        std::fs::write(&path, "alpha café").unwrap();
        let identity = SourceIdentity::capture(&path).unwrap();
        let pinned = PinnedSource::open(&path, &identity).unwrap();
        let request = ExtractorRequest {
            path: path.clone(),
            stamp: capture_source_stamp(&path).unwrap(),
            max_chars: 1000,
            deadline: std::time::Instant::now(),
            pinned: Arc::new(pinned),
        };
        assert!(PlainTextExtractor
            .extract(&request, &new_cancellation_token())
            .is_err());
    }
}
