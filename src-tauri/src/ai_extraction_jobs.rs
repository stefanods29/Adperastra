//! Bounded extraction job planning and review paging (Step 17d T3, D1/D3).
//!
//! Work is split source by source and section by section so a 200-page batch
//! never holds one unbounded model call. Failures stay visible with their
//! page counts; a review is returned in immutable, cursor-bound pages.
#![allow(dead_code)]


use uuid::Uuid;

use crate::ai_extraction_types::{
    ExtractionReview, ExtractionSource, MAX_EXTRACTION_PAGES, MAX_MODEL_PAYLOAD_BYTES,
    MAX_REVIEW_PAGE_BYTES,
};
use crate::ai_extraction_validation::validate_review;

/// Pages one model call may see.
pub const MAX_SECTION_PAGES: u32 = 10;
/// Review records one page may carry before a cursor is issued.
pub const MAX_PAGE_BLOCKS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageSection {
    pub source_index: usize,
    pub first: u32,
    pub last: u32,
}

impl PageSection {
    pub fn count(&self) -> u32 {
        self.last - self.first + 1
    }
}

/// 1-based page sections of at most ten pages, total at most 200 pages.
pub fn plan_sections(sources: &[ExtractionSource]) -> Result<Vec<PageSection>, String> {
    let total: u32 = sources
        .iter()
        .try_fold(0u32, |sum, source| sum.checked_add(source.page_count))
        .ok_or_else(|| "ai_extract.too_large".to_string())?;
    if total == 0 || total > MAX_EXTRACTION_PAGES {
        return Err("ai_extract.too_large".to_string());
    }
    let mut sections = Vec::new();
    for (source_index, source) in sources.iter().enumerate() {
        let mut first = 1u32;
        while first <= source.page_count {
            let last = (first + MAX_SECTION_PAGES - 1).min(source.page_count);
            sections.push(PageSection {
                source_index,
                first,
                last,
            });
            first = last + 1;
        }
    }
    Ok(sections)
}

/// A structured model payload stays under 256 KiB (D1/T3).
pub fn validate_model_payload(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_MODEL_PAYLOAD_BYTES {
        return Err("ai_extract.too_large".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageOutcome {
    Done { pages: u32 },
    Failed { pages: u32, code: String },
}

/// Counts keep every failed source and its pages; a failed page is never
/// reported as done.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct JobCounts {
    pub done_sources: u32,
    pub failed_sources: u32,
    pub pages: u32,
    pub warnings: Vec<String>,
}

pub fn retain_outcomes(outcomes: &[PageOutcome]) -> JobCounts {
    let mut counts = JobCounts::default();
    for outcome in outcomes {
        match outcome {
            PageOutcome::Done { pages } => {
                counts.done_sources += 1;
                counts.pages += pages;
            }
            PageOutcome::Failed { pages, code } => {
                counts.failed_sources += 1;
                counts.pages += pages;
                if !counts.warnings.contains(code) {
                    counts.warnings.push(code.clone());
                }
            }
        }
    }
    counts
}

fn serialized_len(review: &ExtractionReview) -> usize {
    serde_json::to_vec(review).map(|bytes| bytes.len()).unwrap_or(usize::MAX)
}

/// Cursor-bound immutable review pages. The pager never rewrites a record;
/// it copies whole blocks/tables/receipts in their original order.
pub struct ReviewPager {
    review: ExtractionReview,
    block: usize,
    table: usize,
    receipt: usize,
    revision: u64,
}

impl ReviewPager {
    /// The latest immutable review (corrections replace the pager).
    pub fn review(&self) -> &ExtractionReview {
        &self.review
    }

    pub fn new(review: ExtractionReview) -> Result<Self, String> {
        validate_review(&review)?;
        let revision = review.revision;
        Ok(Self {
            review,
            block: 0,
            table: 0,
            receipt: 0,
            revision,
        })
    }

    /// The next page (at most `cap` bytes) and a fresh cursor bound to the
    /// same review id and revision when more records remain.
    pub fn next_page(&mut self, cap: usize) -> Result<(ExtractionReview, Option<Uuid>), String> {
        if self.review.revision != self.revision {
            return Err("ai_extract.changed".to_string());
        }
        let cap = cap.clamp(1024, MAX_REVIEW_PAGE_BYTES);
        let mut page = self.review.clone();
        page.blocks.clear();
        page.tables.clear();
        page.receipts.clear();
        page.next_cursor = None;

        while self.block < self.review.blocks.len() {
            page.blocks.push(self.review.blocks[self.block].clone());
            let over = page.blocks.len() >= MAX_PAGE_BLOCKS || serialized_len(&page) > cap;
            if over && page.blocks.len() > 1 {
                page.blocks.pop();
                break;
            }
            self.block += 1;
        }
        while self.table < self.review.tables.len() {
            page.tables.push(self.review.tables[self.table].clone());
            let over = serialized_len(&page) > cap;
            if over && !page.blocks.is_empty() {
                page.tables.pop();
                break;
            }
            self.table += 1;
        }
        while self.receipt < self.review.receipts.len() {
            page.receipts.push(self.review.receipts[self.receipt].clone());
            let over = serialized_len(&page) > cap;
            if over && (!page.blocks.is_empty() || !page.tables.is_empty()) {
                page.receipts.pop();
                break;
            }
            self.receipt += 1;
        }
        let remaining =
            self.block < self.review.blocks.len()
                || self.table < self.review.tables.len()
                || self.receipt < self.review.receipts.len();
        if remaining {
            let cursor = Uuid::new_v4();
            page.next_cursor = Some(cursor);
        }
        page.complete = self.review.complete && !remaining;
        let cursor = page.next_cursor;
        Ok((page, cursor))
    }
}

#[cfg(test)]
#[path = "ai_extraction_jobs_tests.rs"]
mod tests;
