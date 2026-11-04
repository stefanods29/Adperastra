//! Audience helper payloads of Step 22a T7 (office-deck-ui-1).
//!
//! These are the only records the presentation audience child may receive.
//! They are deliberately disjoint from presenter notes/comments: every struct
//! denies unknown fields, so an accidental `notes` or `next_slide` is a
//! deserialization error before any host code sees it. Browser-safe request
//! and reply envelopes come from the 07d helper transport unchanged.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::presentation::PresentationIntent;
use crate::webview_helper_types::{HelperGrantDTO, HelperReplyEnvelope, HelperRequestEnvelope};

/// The exact action values the audience helper accepts.
pub const PRESENTATION_FRAME_ACTION: &str = "presentation.frame";
pub const PRESENTATION_WAIT_ACTION: &str = "presentation.wait_intent";
pub const PRESENTATION_END_ACTION: &str = "presentation.end";

/// Fixed wait of the audience keyboard poll (D8).
pub const PRESENTATION_WAIT_MS: u16 = 8;
/// At most 16 typed keyboard intents may wait in the child (D8).
pub const PRESENTATION_MAX_QUEUE: usize = 16;
/// Rendered frame upload limit (E16).
pub const PRESENTATION_FRAME_MAX_BYTES: u64 = 8 * 1024 * 1024;
/// Rendered frame pixel limit (E16).
pub const PRESENTATION_FRAME_MAX_PIXELS: u64 = 4_194_304;
/// At most two live Office frame leases per presentation (D8).
pub const PRESENTATION_MAX_LIVE_FRAMES: usize = 2;
/// Presentation helper memory (D8); enforced by the additive helper config.
pub const PRESENTATION_HELPER_MEMORY: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationAudienceFrame {
    pub presentation_id: Uuid,
    pub slide_id: Uuid,
    pub frame_revision: u32,
    pub image_grant_id: Uuid,
    pub width: u32,
    pub height: u32,
    pub black: bool,
    pub paused: bool,
}

impl PresentationAudienceFrame {
    pub fn is_valid(&self) -> bool {
        self.width > 0
            && self.height > 0
            && u64::from(self.width) * u64::from(self.height) <= PRESENTATION_FRAME_MAX_PIXELS
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationFrameAck {
    pub presentation_id: Uuid,
    pub frame_revision: u32,
    pub displayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationWaitIntentRequest {
    pub presentation_id: Uuid,
    pub after_sequence: u64,
    pub wait_ms: u16,
}

impl PresentationWaitIntentRequest {
    pub fn is_valid(&self) -> bool {
        self.wait_ms == PRESENTATION_WAIT_MS
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationIntentReply {
    pub presentation_id: Uuid,
    pub sequence: u64,
    pub intent: Option<PresentationIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationAudienceEnd {
    pub presentation_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationEndAck {
    pub presentation_id: Uuid,
    pub ended: bool,
}

impl PresentationEndAck {
    pub fn is_valid(&self) -> bool {
        self.ended
    }
}

pub type PresentationFrameRequest = HelperRequestEnvelope<PresentationAudienceFrame>;
pub type PresentationFrameReply = HelperReplyEnvelope<PresentationFrameAck>;
pub type PresentationWaitRequest = HelperRequestEnvelope<PresentationWaitIntentRequest>;
pub type PresentationWaitReply = HelperReplyEnvelope<PresentationIntentReply>;
pub type PresentationEndRequest = HelperRequestEnvelope<PresentationAudienceEnd>;
pub type PresentationEndReply = HelperReplyEnvelope<PresentationEndAck>;

/// Resolve the one approved image grant of a frame. A grant id from another
/// frame, another session or a non-PNG grant has no match.
pub fn frame_grant_of<'a>(
    inputs: &'a [HelperGrantDTO],
    frame: &PresentationAudienceFrame,
) -> Option<&'a HelperGrantDTO> {
    inputs.iter().find(|grant| {
        grant.grant_id == frame.image_grant_id
            && grant.mime == "image/png"
            && grant.byte_len > 0
            && grant.byte_len <= PRESENTATION_FRAME_MAX_BYTES
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_are_rejected_from_audience_payload() {
        let value = serde_json::json!({
            "presentation_id": "00000000-0000-4000-8000-000000000001",
            "slide_id": "00000000-0000-4000-8000-000000000002",
            "frame_revision": 1,
            "image_grant_id": "00000000-0000-4000-8000-000000000003",
            "width": 1280,
            "height": 720,
            "black": false,
            "paused": false,
            "notes": "PRIVATE NOTES"
        });
        assert!(serde_json::from_value::<PresentationAudienceFrame>(value).is_err());
    }

    #[test]
    fn pixel_and_wait_bounds_are_exact() {
        let mut frame = PresentationAudienceFrame {
            presentation_id: Uuid::new_v4(),
            slide_id: Uuid::new_v4(),
            frame_revision: 1,
            image_grant_id: Uuid::new_v4(),
            width: 2048,
            height: 2048,
            black: false,
            paused: false,
        };
        assert!(frame.is_valid());
        frame.width = 2049;
        assert!(!frame.is_valid());
        let wait = PresentationWaitIntentRequest {
            presentation_id: Uuid::new_v4(),
            after_sequence: 0,
            wait_ms: 8,
        };
        assert!(wait.is_valid());
        assert!(!PresentationWaitIntentRequest { wait_ms: 9, ..wait }.is_valid());
    }
}
