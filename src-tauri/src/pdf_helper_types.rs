#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! Private payloads of the PDF helper (Step 07d, `pdf-reader-2`).
//!
//! The Python-free mirror of `src/pdf-helper/types.ts`. They travel inside
//! the kind1 request/reply frames of `webview_helper_protocol.rs`, name a
//! `grant_id` instead of a session, and never contain a path, a stamp, a
//! token or a byte. The native parent checks every answer against the live
//! session before it becomes a `PdfPageImage`, `PdfTextPage`, outline or
//! search page.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::pdf_types::{
    PdfPageInfo, PdfRasterSpec, PdfRotation, PdfSearchMatch, PdfTextRun, PDF_MAX_SEARCH_MATCHES,
    PDF_MAX_SEARCH_QUERY, PDF_MAX_TEXT_RUNS,
};

/// The child's flag; static, never built from user text.
pub const PDF_HELPER_FLAG: &str = "--pdf-helper";
/// Longest password the helper accepts (kept in memory only).
pub const PDF_MAX_PASSWORD: usize = 1_024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperOpenRequest {
    pub grant_id: Uuid,
    #[serde(default)]
    pub password: Option<String>,
}

impl PdfHelperOpenRequest {
    pub fn is_valid(&self) -> bool {
        !self.grant_id.is_nil()
            && self
                .password
                .as_ref()
                .map(|password| password.chars().count() <= PDF_MAX_PASSWORD)
                .unwrap_or(true)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperOpenReply {
    pub page_count: u32,
    pub can_copy: bool,
    pub can_print: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperRenderRequest {
    pub page: u32,
    pub raster: PdfRasterSpec,
    pub rotation: PdfRotation,
    pub request_revision: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PdfHelperRenderReply {
    pub info: PdfPageInfo,
    pub render_width: u32,
    pub render_height: u32,
    pub resolved_scale: f64,
    pub rendered_rotation: PdfRotation,
    pub request_revision: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperTextRequest {
    pub page: u32,
    #[serde(default)]
    pub after_run: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfHelperTextReply {
    pub page: u32,
    pub runs: Vec<PdfTextRun>,
    #[serde(default)]
    pub next_run: Option<u32>,
    pub complete: bool,
}

impl PdfHelperTextReply {
    pub fn is_valid(&self) -> bool {
        self.page >= 1
            && self.runs.len() <= PDF_MAX_TEXT_RUNS
            && self.runs.iter().all(|run| {
                run.text.chars().count() <= 4_096
                    && run.font_size.is_finite()
                    && run.font_size > 0.0
                    && run.x.is_finite()
                    && run.y.is_finite()
                    && run.width.is_finite()
                    && run.height.is_finite()
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperOutlineRequest {
    #[serde(default)]
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfHelperOutlineNode {
    pub id: Uuid,
    pub title: String,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub children: Vec<PdfHelperOutlineNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfHelperOutlineReply {
    pub nodes: Vec<PdfHelperOutlineNode>,
    #[serde(default)]
    pub next_offset: Option<u32>,
    pub complete: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperSearchPosition {
    pub page: u32,
    pub run: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperSearchRequest {
    pub query: String,
    pub match_case: bool,
    pub page: u32,
    pub run: u32,
    pub offset: u32,
}

impl PdfHelperSearchRequest {
    pub fn is_valid(&self) -> bool {
        !self.query.trim().is_empty() && self.query.chars().count() <= PDF_MAX_SEARCH_QUERY
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfHelperSearchReply {
    pub matches: Vec<PdfSearchMatch>,
    #[serde(default)]
    pub next_position: Option<PdfHelperSearchPosition>,
    pub complete: bool,
    pub scanned_pages: u32,
}

impl PdfHelperSearchReply {
    pub fn is_valid(&self) -> bool {
        self.matches.len() <= PDF_MAX_SEARCH_MATCHES
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperPrintRequest {
    pub first_page: u32,
    pub last_page: u32,
    pub dpi: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfHelperPrintReply {
    pub completed: bool,
}

/// Count every node of an outline answer inside the limits.
pub fn outline_nodes_within(reply: &PdfHelperOutlineReply, limit: usize) -> bool {
    fn count(
        nodes: &[PdfHelperOutlineNode],
        depth: usize,
        total: &mut usize,
        limit: usize,
    ) -> bool {
        if depth > 32 {
            return false;
        }
        for node in nodes {
            *total += 1;
            if *total > limit || node.title.chars().count() > 512 {
                return false;
            }
            if !count(&node.children, depth + 1, total, limit) {
                return false;
            }
        }
        true
    }
    let mut total = 0usize;
    count(&reply.nodes, 0, &mut total, limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(title: &str, children: Vec<PdfHelperOutlineNode>) -> PdfHelperOutlineNode {
        PdfHelperOutlineNode {
            id: Uuid::new_v4(),
            title: title.to_string(),
            page: Some(1),
            children,
        }
    }

    #[test]
    fn open_requests_bound_the_password() {
        let request = PdfHelperOpenRequest {
            grant_id: Uuid::new_v4(),
            password: Some("x".repeat(PDF_MAX_PASSWORD + 1)),
        };
        assert!(!request.is_valid());
        let fine = PdfHelperOpenRequest {
            grant_id: Uuid::new_v4(),
            password: None,
        };
        assert!(fine.is_valid());
    }

    #[test]
    fn outline_answers_stay_inside_the_limits() {
        let deep = (0..40).fold(node("leaf", Vec::new()), |child, _| {
            node("level", vec![child])
        });
        let reply = PdfHelperOutlineReply {
            nodes: vec![deep],
            next_offset: None,
            complete: false,
        };
        assert!(!outline_nodes_within(&reply, 5_000));
        let mut wide = Vec::new();
        for index in 0..5_001 {
            wide.push(node(&format!("n{index}"), Vec::new()));
        }
        let reply = PdfHelperOutlineReply {
            nodes: wide,
            next_offset: None,
            complete: false,
        };
        assert!(!outline_nodes_within(&reply, 5_000));
        let ok = PdfHelperOutlineReply {
            nodes: vec![node("a", vec![node("b", Vec::new())])],
            next_offset: Some(2),
            complete: false,
        };
        assert!(outline_nodes_within(&ok, 5_000));
    }

    #[test]
    fn text_replies_refuse_negative_or_absurd_runs() {
        let reply = PdfHelperTextReply {
            page: 1,
            runs: vec![PdfTextRun {
                text: "hi".to_string(),
                x: 0.0,
                y: 0.0,
                width: 5.0,
                height: 10.0,
                direction: crate::pdf_types::PdfTextDirection::Ltr,
                font_size: 10.0,
                order: 0,
            }],
            next_run: None,
            complete: true,
        };
        assert!(reply.is_valid());
        let bad = PdfHelperTextReply { page: 0, ..reply };
        assert!(!bad.is_valid());
    }

    #[test]
    fn search_queries_are_bounded() {
        let request = PdfHelperSearchRequest {
            query: "x".repeat(PDF_MAX_SEARCH_QUERY + 1),
            match_case: false,
            page: 1,
            run: 0,
            offset: 0,
        };
        assert!(!request.is_valid());
        let empty = PdfHelperSearchRequest {
            query: "   ".to_string(),
            ..request
        };
        assert!(!empty.is_valid());
    }
}
