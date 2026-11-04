//! Bounded reachable-object graph for PDF inspection and cleaning
//! (Step 08c D6/D7).
//!
//! The walk is iterative over a visited set with explicit object and depth
//! caps, so a cyclic or hostile PDF cannot exhaust memory. Only reachable
//! objects are counted; a fresh save then prunes everything else.

use std::collections::BTreeSet;

use lopdf::{Document, LoadOptions, Object, ObjectId};

use crate::error::PrivacyError;

pub const MAX_PDF_OBJECTS: usize = 1_000_000;
pub const MAX_PDF_DEPTH: usize = 128;
pub const MAX_PDF_NODES: usize = 4_000_000;
pub const MAX_STREAM_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_TOTAL_STREAM_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_DECOMPRESSION_RATIO: usize = 500;

#[derive(Debug, Default)]
pub struct PdfGraph {
    pub ids: BTreeSet<ObjectId>,
    pub metadata_streams: Vec<ObjectId>,
    pub embedded_files: Vec<ObjectId>,
    pub javascript_objects: Vec<ObjectId>,
    pub signature_fields: Vec<ObjectId>,
}

impl PdfGraph {
    pub fn contains(&self, id: ObjectId) -> bool {
        self.ids.contains(&id)
    }
}

/// Load a PDF with bounded object/xref stream decompression and refuse every
/// encrypted document before any inspection claim is made.
pub fn load_bounded(bytes: &[u8]) -> Result<Document, PrivacyError> {
    let options = LoadOptions::with_max_decompressed_size(MAX_STREAM_BYTES);
    let document =
        Document::load_mem_with_options(bytes, options).map_err(|_| PrivacyError::Unsupported)?;
    if document.is_encrypted() || document.was_encrypted() {
        return Err(PrivacyError::Unsupported);
    }
    if document.objects.len() > MAX_PDF_OBJECTS {
        return Err(PrivacyError::TooLarge);
    }
    Ok(document)
}

fn type_name(dict: &lopdf::Dictionary) -> Option<&[u8]> {
    dict.get(b"Type")
        .ok()
        .and_then(|value| value.as_name().ok())
}

fn dict_type(doc: &Document, object: &Object) -> Option<Vec<u8>> {
    let dict = match object {
        Object::Dictionary(dict) => dict,
        Object::Stream(stream) => &stream.dict,
        Object::Reference(id) => doc.objects.get(id).and_then(|value| match value {
            Object::Dictionary(dict) => Some(dict),
            Object::Stream(stream) => Some(&stream.dict),
            _ => None,
        })?,
        _ => return None,
    };
    type_name(dict).map(|value| value.to_vec())
}

/// Walk every reachable object once and record the structures this step must
/// disclose or remove.
pub fn scan(doc: &Document) -> Result<PdfGraph, PrivacyError> {
    let mut graph = PdfGraph::default();
    let mut stack: Vec<(Object, usize)> = vec![(Object::Dictionary(doc.trailer.clone()), 0)];
    while let Some((object, depth)) = stack.pop() {
        if depth > MAX_PDF_DEPTH {
            return Err(PrivacyError::TooLarge);
        }
        match object {
            Object::Reference(id) => {
                if graph.ids.contains(&id) {
                    continue;
                }
                graph.ids.insert(id);
                if graph.ids.len() > MAX_PDF_OBJECTS {
                    return Err(PrivacyError::TooLarge);
                }
                let Some(target) = doc.objects.get(&id) else {
                    continue;
                };
                if let Object::Stream(stream) = target {
                    let is_metadata = stream
                        .dict
                        .get(b"Type")
                        .ok()
                        .and_then(|value| value.as_name().ok())
                        == Some(b"Metadata")
                        || stream
                            .dict
                            .get(b"Subtype")
                            .ok()
                            .and_then(|value| value.as_name().ok())
                            == Some(b"XML");
                    if is_metadata {
                        graph.metadata_streams.push(id);
                    }
                }
                let next = match target {
                    Object::Stream(stream) => Object::Dictionary(stream.dict.clone()),
                    other => other.clone(),
                };
                stack.push((next, depth + 1));
            }
            Object::Array(values) => {
                if stack.len().saturating_add(values.len()) > MAX_PDF_NODES {
                    return Err(PrivacyError::TooLarge);
                }
                for value in values {
                    stack.push((value, depth + 1));
                }
            }
            Object::Dictionary(dict) => {
                if stack.len().saturating_add(dict.len()) > MAX_PDF_NODES {
                    return Err(PrivacyError::TooLarge);
                }
                if type_name(&dict) == Some(b"Filespec")
                    || type_name(&dict) == Some(b"EmbeddedFile")
                {
                    // The caller matches the exact object ID through its page/name tree.
                }
                for (_, value) in dict.iter() {
                    stack.push((value.clone(), depth + 1));
                }
            }
            Object::Stream(stream) => {
                if stack.len().saturating_add(stream.dict.len()) > MAX_PDF_NODES {
                    return Err(PrivacyError::TooLarge);
                }
                for (_, value) in stream.dict.iter() {
                    stack.push((value.clone(), depth + 1));
                }
            }
            _ => {}
        }
    }
    graph.metadata_streams.sort_unstable();
    graph.metadata_streams.dedup();
    for id in &graph.ids {
        let Some(object) = doc.objects.get(id) else {
            continue;
        };
        let Some(kind) = dict_type(doc, object) else {
            continue;
        };
        if kind.as_slice() == b"Filespec" || kind.as_slice() == b"EmbeddedFile" {
            graph.embedded_files.push(*id);
        }
        if kind.as_slice() == b"Action" {
            let dict = match object {
                Object::Dictionary(dict) => dict,
                Object::Stream(stream) => &stream.dict,
                _ => continue,
            };
            if dict.get(b"S").ok().and_then(|value| value.as_name().ok()) == Some(b"JavaScript") {
                graph.javascript_objects.push(*id);
            }
        }
        if kind.as_slice() == b"Annot" {
            let dict = match object {
                Object::Dictionary(dict) => dict,
                Object::Stream(stream) => &stream.dict,
                _ => continue,
            };
            if dict.get(b"FT").ok().and_then(|value| value.as_name().ok()) == Some(b"Sig") {
                graph.signature_fields.push(*id);
            }
        }
    }
    graph.embedded_files.sort_unstable();
    graph.embedded_files.dedup();
    graph.javascript_objects.sort_unstable();
    graph.javascript_objects.dedup();
    graph.signature_fields.sort_unstable();
    graph.signature_fields.dedup();
    Ok(graph)
}

/// Read a stream with both per-stream and total caps.
pub fn decompressed_stream(
    doc: &Document,
    id: ObjectId,
    total: &mut usize,
) -> Result<Vec<u8>, PrivacyError> {
    let object = doc.objects.get(&id).ok_or(PrivacyError::Unsupported)?;
    let stream = object.as_stream().map_err(|_| PrivacyError::Unsupported)?;
    let limit = MAX_STREAM_BYTES.min(MAX_TOTAL_STREAM_BYTES.saturating_sub(*total));
    if !stream.content.is_empty() && limit == 0 {
        return Err(PrivacyError::TooLarge);
    }
    let decoded = stream
        .decompressed_content_with_limit(limit)
        .map_err(|_| PrivacyError::TooLarge)?;
    if !stream.content.is_empty()
        && decoded.len() / stream.content.len().max(1) > MAX_DECOMPRESSION_RATIO
    {
        return Err(PrivacyError::TooLarge);
    }
    *total = total.saturating_add(decoded.len());
    if *total > MAX_TOTAL_STREAM_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    Ok(decoded)
}
