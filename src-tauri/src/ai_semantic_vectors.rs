//! Bounded text splitting and exact vector math for the semantic index
//! (Step 17c D3/D5). No vector library is used: rows are finite little-endian
//! f32 values and the dot product runs on one low-priority worker.

use crate::ai_search_types::{
    AiSearchError, AiSearchResult, IMAGE_EMBEDDING_DIMENSIONS, MAX_INDEXED_FILE_SCALARS,
    MAX_TEXT_CHUNKS_PER_FILE, TEXT_CHUNK_OVERLAP, TEXT_CHUNK_SCALARS, TEXT_EMBEDDING_DIMENSIONS,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChunk {
    pub index: u16,
    /// Unicode-scalar offsets, end exclusive.
    pub start: u32,
    pub end: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SplitText {
    pub chunks: Vec<TextChunk>,
    /// True when the source exceeded 24,000 scalars or 64 chunks.
    pub partial: bool,
}

/// Normalize only line endings; all other characters, including accents and
/// surrogate-pair characters, stay exactly as they are.
pub fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// 384 Unicode scalars per chunk with 64-scalar overlap, at most 64 chunks.
/// 448 scalars therefore give `0..384` and `320..448`.
pub fn split_text(text: &str) -> SplitText {
    let normalized = normalize_line_endings(text);
    let scalars: Vec<char> = normalized.chars().collect();
    if scalars.is_empty() {
        return SplitText {
            chunks: Vec::new(),
            partial: false,
        };
    }
    let limit = scalars.len().min(MAX_INDEXED_FILE_SCALARS);
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < limit && chunks.len() < MAX_TEXT_CHUNKS_PER_FILE {
        let end = (start + TEXT_CHUNK_SCALARS).min(limit);
        let text: String = scalars[start..end].iter().collect();
        chunks.push(TextChunk {
            index: chunks.len() as u16,
            start: start as u32,
            end: end as u32,
            text,
        });
        if end == limit {
            break;
        }
        start += TEXT_CHUNK_SCALARS - TEXT_CHUNK_OVERLAP;
    }
    let covered = chunks.last().map(|chunk| chunk.end as usize).unwrap_or(0);
    SplitText {
        chunks,
        partial: scalars.len() > MAX_INDEXED_FILE_SCALARS || covered < limit,
    }
}

/// Validate the dimensions of the pinned model and the finite values the
/// runtime promises. A zero vector is invalid because it cannot be L2
/// normalized.
pub fn validate_embedding(kind_is_text: bool, dimensions: u16, vector: &[f32]) -> AiSearchResult<()> {
    let expected = if kind_is_text {
        TEXT_EMBEDDING_DIMENSIONS
    } else {
        IMAGE_EMBEDDING_DIMENSIONS
    };
    if dimensions != expected || vector.len() != usize::from(dimensions) {
        return Err(AiSearchError::Invalid);
    }
    if vector.iter().any(|value| !value.is_finite()) {
        return Err(AiSearchError::Invalid);
    }
    let norm_squared: f64 = vector
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum();
    if !norm_squared.is_finite() || norm_squared <= f64::EPSILON {
        return Err(AiSearchError::Invalid);
    }
    Ok(())
}

/// The runtime already returns L2-normalized rows; this defensive copy makes
/// the stored row exactly normalized (tolerance 1e-5) without accepting a
/// different model's dimensions.
pub fn normalized_copy(vector: &[f32]) -> AiSearchResult<Vec<f32>> {
    let norm = vector
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        return Err(AiSearchError::Invalid);
    }
    let normalized: Vec<f32> = vector
        .iter()
        .map(|value| (f64::from(*value) / norm) as f32)
        .collect();
    let check = normalized
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    if (check - 1.0).abs() > 1e-5 {
        return Err(AiSearchError::Invalid);
    }
    Ok(normalized)
}

/// Exact dot product. Both rows must be finite and the same dimensions.
pub fn dot_product(left: &[f32], right: &[f32]) -> AiSearchResult<f64> {
    if left.len() != right.len() || left.is_empty() {
        return Err(AiSearchError::Invalid);
    }
    let mut total = 0.0f64;
    for (a, b) in left.iter().zip(right) {
        if !a.is_finite() || !b.is_finite() {
            return Err(AiSearchError::Invalid);
        }
        total += f64::from(*a) * f64::from(*b);
    }
    if !total.is_finite() {
        return Err(AiSearchError::Invalid);
    }
    Ok(total.clamp(-1.0, 1.0))
}

pub fn vector_to_le_bytes(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub fn vector_from_le_bytes(bytes: &[u8], dimensions: u16) -> AiSearchResult<Vec<f32>> {
    if bytes.len() != usize::from(dimensions) * 4 {
        return Err(AiSearchError::Invalid);
    }
    let mut vector = Vec::with_capacity(usize::from(dimensions));
    for chunk in bytes.as_chunks::<4>().0 {
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if !value.is_finite() {
            return Err(AiSearchError::Invalid);
        }
        vector.push(value);
    }
    Ok(vector)
}

#[cfg(test)]
mod tests {
    use super::{dot_product, split_text, validate_embedding};
    use crate::ai_search_types::TEXT_EMBEDDING_DIMENSIONS;

    #[test]
    fn split_overlaps_by_sixty_four_scalars() {
        let text = "a".repeat(448);
        let split = split_text(&text);
        assert_eq!(split.chunks.len(), 2);
        assert_eq!((split.chunks[0].start, split.chunks[0].end), (0, 384));
        assert_eq!((split.chunks[1].start, split.chunks[1].end), (320, 448));
        assert!(!split.partial);
    }

    #[test]
    fn exact_dot_product_orders_orthogonal_vectors() {
        assert_eq!(dot_product(&[1.0, 0.0], &[1.0, 0.0]).unwrap(), 1.0);
        assert_eq!(dot_product(&[1.0, 0.0], &[0.0, 1.0]).unwrap(), 0.0);
    }

    #[test]
    fn dimensions_and_nonfinite_values_are_refused() {
        assert!(validate_embedding(true, TEXT_EMBEDDING_DIMENSIONS, &vec![0.1; 383]).is_err());
        let mut vector = vec![0.0f32; usize::from(TEXT_EMBEDDING_DIMENSIONS)];
        vector[0] = f32::NAN;
        vector[1] = 1.0;
        assert!(validate_embedding(true, TEXT_EMBEDDING_DIMENSIONS, &vector).is_err());
    }
}
