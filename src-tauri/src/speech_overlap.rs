//! Overlap handling for 30 s windows with 1 s overlap (D7).
//!
//! A duplicated phrase at the seam is kept once. Non-matching overlap words
//! are always kept: dropping them would silently lose speech. When the seam
//! cannot be proven identical the result is marked partial rather than
//! guessed.
#![allow(dead_code)]


use crate::speech_types::TimeUs;

pub const MAX_OVERLAP_WORDS: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub struct SegmentDraft {
    pub text: String,
    pub start_us: TimeUs,
    pub end_us: TimeUs,
}

impl SegmentDraft {
    pub fn words(&self) -> Vec<String> {
        self.text.split_whitespace().map(normalize_word).collect()
    }
}

pub fn normalize_word(word: &str) -> String {
    word.chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct OverlapResult {
    /// The next segment with a duplicated prefix removed; `None` when the
    /// whole segment was the duplicate and must be counted once.
    pub segment: Option<SegmentDraft>,
    /// True when a duplicate was likely but could not be proven word-equal.
    pub partial: bool,
}

fn overlaps(previous: &SegmentDraft, next: &SegmentDraft) -> bool {
    next.start_us < previous.end_us
}

/// Longest identical suffix/prefix n (1..=20) when the segments overlap.
pub fn duplicate_word_count(previous: &SegmentDraft, next: &SegmentDraft) -> usize {
    if !overlaps(previous, next) {
        return 0;
    }
    let left = previous.words();
    let right = next.words();
    let limit = left.len().min(right.len()).min(MAX_OVERLAP_WORDS);
    for size in (2..=limit).rev() {
        if left[left.len() - size..] == right[..size] {
            return size;
        }
    }
    0
}

/// Keeps the first segment's identity and trims only a proven duplicate.
pub fn merge_overlap(previous: &SegmentDraft, next: &SegmentDraft) -> OverlapResult {
    let duplicate = duplicate_word_count(previous, next);
    if duplicate == 0 {
        // Words that merely look close are kept; the seam is reported as
        // partial so nothing claims a clean, fully verified transcript.
        let partial = overlaps(previous, next)
            && !previous.words().is_empty()
            && !next.words().is_empty();
        return OverlapResult { segment: Some(next.clone()), partial };
    }
    let trimmed: Vec<&str> = next.text.split_whitespace().skip(duplicate).collect();
    if trimmed.is_empty() {
        return OverlapResult { segment: None, partial: false };
    }
    OverlapResult {
        segment: Some(SegmentDraft {
            text: trimmed.join(" "),
            ..next.clone()
        }),
        partial: false,
    }
}

/// Applies the rule over a whole chunk sequence in time order.
pub fn merge_chunks(chunks: Vec<Vec<SegmentDraft>>) -> (Vec<SegmentDraft>, bool) {
    let mut merged: Vec<SegmentDraft> = Vec::new();
    let mut partial = false;
    for chunk in chunks {
        for draft in chunk {
            match merged.last() {
                Some(previous) => {
                    let result = merge_overlap(previous, &draft);
                    partial |= result.partial;
                    if let Some(segment) = result.segment {
                        merged.push(segment);
                    }
                }
                None => merged.push(draft),
            }
        }
    }
    merged.sort_by_key(|segment| (segment.start_us, segment.end_us));
    (merged, partial)
}

/// Segments must be strictly ordered and non-empty; lazy deletion at the
/// seam never reorders earlier segments.
pub fn segments_sorted(segments: &[SegmentDraft]) -> bool {
    segments
        .windows(2)
        .all(|pair| pair[0].end_us <= pair[1].start_us && pair[1].end_us > pair[1].start_us)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(text: &str, start_us: u64, end_us: u64) -> SegmentDraft {
        SegmentDraft { text: text.to_string(), start_us, end_us }
    }

    #[test]
    fn identical_suffix_is_removed_once() {
        let previous = draft("Hello. Budget one hundred twenty.", 0, 30_000_000);
        let next = draft("Budget one hundred twenty. Goodbye.", 29_000_000, 59_000_000);
        let result = merge_overlap(&previous, &next);
        assert_eq!(result.segment.unwrap().text, "Goodbye.");
        assert!(!result.partial);
    }

    #[test]
    fn non_matching_overlap_keeps_every_word() {
        let previous = draft("Hello. Budget one", 0, 30_000_000);
        let next = draft("one hundred twenty. Goodbye.", 29_000_000, 59_000_000);
        let result = merge_overlap(&previous, &next);
        assert_eq!(result.segment.unwrap().text, "one hundred twenty. Goodbye.");
    }
}
