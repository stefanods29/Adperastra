//! The one approved audience frame input of Step 22a T7.
//!
//! A rendered frame is an immutable Office lease. File grants alone cannot
//! prove that the lease belongs to this presentation's engine session, so
//! this module first checks the native presentation registry and then calls
//! the 20a lease resolver. It validates the authoritative backing (length,
//! sensitivity, PNG signature and header dimensions) before minting one
//! helper input with a fresh random grant id. The Office lease id is never
//! used as the helper grant id.
#![allow(dead_code)]


use std::collections::VecDeque;
use std::sync::Arc;

use uuid::Uuid;

use crate::file_grant_backing::GrantedBacking;
use crate::office_edit_values::OfficeStoragePolicy;
use crate::presentation::BindingPresentationFrame;
use crate::presentation_helper_types::{PRESENTATION_FRAME_MAX_BYTES, PRESENTATION_FRAME_MAX_PIXELS};
use crate::webview_helper_types::{HelperInputGrant, HelperInputSource};

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// Read the exact IHDR dimensions, refusing anything that is not a PNG.
pub fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE {
        return None;
    }
    if u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) != 13 {
        return None;
    }
    if &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

/// A resolver seam for tests; the production path calls the native 20a
/// registry through `resolve_office_lease` in `office_edit_leases.rs`.
pub trait AudienceLeaseResolver {
    fn resolve(&self, session_id: Uuid, lease_id: Uuid) -> Result<Arc<GrantedBacking>, String>;
}

struct NativeLeaseResolver;

impl AudienceLeaseResolver for NativeLeaseResolver {
    fn resolve(&self, session_id: Uuid, lease_id: Uuid) -> Result<Arc<GrantedBacking>, String> {
        crate::office_edit_leases::resolve_office_lease(session_id, lease_id)
            .map_err(|_| "office_edit.changed".to_string())
    }
}

/// Prepare exactly one helper input for one rendered frame.
pub fn prepare_audience_frame_input(
    session_id: Uuid,
    presentation_id: Uuid,
    frame: &BindingPresentationFrame,
) -> Result<HelperInputGrant, String> {
    let bound = crate::presentation::presentation_binds_session(presentation_id, session_id);
    prepare_audience_frame_input_with(&NativeLeaseResolver, bound, session_id, presentation_id, frame)
}

/// Testable core: ownership is checked before the resolver is called, so a
/// foreign session can never cause a lease read or an input update.
pub fn prepare_audience_frame_input_with(
    resolver: &dyn AudienceLeaseResolver,
    bound: bool,
    session_id: Uuid,
    presentation_id: Uuid,
    frame: &BindingPresentationFrame,
) -> Result<HelperInputGrant, String> {
    if !bound {
        return Err("office_edit.changed".to_string());
    }
    if frame.width == 0 || frame.height == 0 {
        return Err("presentation.invalid".to_string());
    }
    if u64::from(frame.width) * u64::from(frame.height) > PRESENTATION_FRAME_MAX_PIXELS {
        return Err("presentation.too_large".to_string());
    }
    if frame.image.mime != "image/png" {
        return Err("presentation.invalid".to_string());
    }
    if frame.image.byte_len > PRESENTATION_FRAME_MAX_BYTES {
        return Err("presentation.too_large".to_string());
    }
    if let (Some(width), Some(height)) = (frame.image.width, frame.image.height) {
        if width != frame.width || height != frame.height {
            return Err("presentation.invalid".to_string());
        }
    }
    let backing = resolver.resolve(session_id, frame.image.lease_id)?;
    if backing.length() != frame.image.byte_len {
        return Err("office_edit.changed".to_string());
    }
    let sensitive = matches!(&frame.image.storage_policy, OfficeStoragePolicy::Sensitive);
    if backing.is_sensitive() != sensitive {
        return Err("office_edit.changed".to_string());
    }
    let header = backing
        .read_range(0, 24)
        .map_err(|_| "presentation.failed".to_string())?;
    let dimensions = png_dimensions(&header).ok_or_else(|| "presentation.invalid".to_string())?;
    if dimensions != (frame.width, frame.height) {
        return Err("presentation.invalid".to_string());
    }
    Ok(HelperInputGrant {
        // A fresh helper grant id, never the Office lease id.
        grant_id: Uuid::new_v4(),
        name: "frame.png".to_string(),
        mime: "image/png".to_string(),
        source: HelperInputSource::Snapshot {
            backing,
            document_id: presentation_id.to_string(),
            revision: u64::from(frame.frame_revision),
            content_id: frame.image.lease_id,
            sensitive,
        },
    })
}

/// Bounded frame-lease bookkeeping. The current frame stays alive until its
/// replacement is acknowledged; at most two rendered frames are retained.
#[derive(Debug, Default)]
pub struct FrameLeaseTracker {
    leases: VecDeque<Uuid>,
}

impl FrameLeaseTracker {
    /// Add a frame after its acknowledgment. Returns leases that may now be
    /// released (oldest first), keeping at most two live frames.
    pub fn acknowledge(&mut self, lease_id: Uuid) -> Vec<Uuid> {
        if self.leases.contains(&lease_id) {
            return Vec::new();
        }
        self.leases.push_back(lease_id);
        let mut released = Vec::new();
        while self.leases.len() > 2 {
            if let Some(old) = self.leases.pop_front() {
                released.push(old);
            }
        }
        released
    }

    pub fn clear(&mut self) -> Vec<Uuid> {
        let all: Vec<Uuid> = self.leases.drain(..).collect();
        all
    }

    pub fn len(&self) -> usize {
        self.leases.len()
    }

    pub fn is_empty(&self) -> bool {
        self.leases.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(24);
        bytes.extend_from_slice(&PNG_SIGNATURE);
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn png_header_reads_exact_dimensions() {
        assert_eq!(png_dimensions(&png_header(1280, 720)), Some((1280, 720)));
        assert_eq!(png_dimensions(b"not a png at all...."), None);
    }

    #[test]
    fn max_two_frame_leases_keep_the_newest() {
        let mut tracker = FrameLeaseTracker::default();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let c = Uuid::new_v4();
        assert!(tracker.acknowledge(a).is_empty());
        assert!(tracker.acknowledge(b).is_empty());
        assert_eq!(tracker.acknowledge(c), vec![a]);
        assert_eq!(tracker.len(), 2);
        assert_eq!(tracker.clear(), vec![b, c]);
    }
}
