//! Bounded parser for `USN_RECORD_V2` metadata from the optional NTFS helper.
//! No record is a file handle and no name is used as a path here; the helper
//! emits metadata only, and the parent validates the declared volume root.

use std::collections::HashMap;

use crate::limits::{USN_MAX_PARENT_DEPTH, USN_MAX_RECORDS, USN_RECORD_CHUNK};

/// The entire elevated helper surface. There is no write, file-open or
/// content-read capability; the parent validates the volume root.
pub const HELPER_CAPABILITIES: &[&str] = &["read_volume_metadata"];

const HEADER_V2: usize = 60;
const ATTR_DIRECTORY: u32 = 0x10;
const ATTR_OFFLINE: u32 = 0x1000;
const ATTR_RECALL_ON_OPEN: u32 = 0x0004_0000;
const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsnRecord {
    pub file_id: u64,
    pub parent_id: u64,
    pub usn: i64,
    pub timestamp: i64,
    pub reason: u32,
    pub source_info: u32,
    pub attributes: u32,
    pub name: String,
}

impl UsnRecord {
    pub fn is_directory(&self) -> bool {
        self.attributes & ATTR_DIRECTORY != 0
    }

    pub fn is_online_only(&self) -> bool {
        self.attributes & (ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS) != 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUsn {
    pub records: Vec<UsnRecord>,
    /// Bytes occupied by complete records; an incomplete tail starts here.
    pub consumed: usize,
}

/// Parse one 64 KiB chunk. A declared length that runs past the chunk is an
/// incomplete tail (the caller prepends it to the next chunk); a length
/// shorter than the V2 header, a bad name offset/version or an overlong
/// record is refused.
pub fn parse_usn_records(buffer: &[u8], max_records: usize) -> Result<ParsedUsn, String> {
    if max_records == 0 || max_records > USN_MAX_RECORDS {
        return Err("search.too_large".to_string());
    }
    let mut records = Vec::new();
    let mut offset = 0usize;
    while offset + 8 <= buffer.len() {
        if records.len() >= max_records {
            return Err("search.too_large".to_string());
        }
        let record_length = read_u32(buffer, offset)? as usize;
        if record_length == 0 {
            break;
        }
        if !(HEADER_V2..=USN_RECORD_CHUNK).contains(&record_length) {
            return Err("search.invalid".to_string());
        }
        if offset + record_length > buffer.len() {
            break;
        }
        let record = &buffer[offset..offset + record_length];
        let major = read_u16(record, 4)?;
        let minor = read_u16(record, 6)?;
        if major != 2 || minor != 0 {
            return Err("search.invalid".to_string());
        }
        let file_id = read_u64(record, 8)?;
        let parent_id = read_u64(record, 16)?;
        let usn = read_i64(record, 24)?;
        let timestamp = read_i64(record, 32)?;
        let reason = read_u32(record, 40)?;
        let source_info = read_u32(record, 44)?;
        let attributes = read_u32(record, 52)?;
        let name_length = read_u16(record, 56)? as usize;
        let name_offset = read_u16(record, 58)? as usize;
        if !name_length.is_multiple_of(2)
            || name_offset < HEADER_V2
            || name_offset + name_length > record_length
        {
            return Err("search.invalid".to_string());
        }
        let units: Vec<u16> = record[name_offset..name_offset + name_length]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let name = String::from_utf16(&units).map_err(|_| "search.invalid".to_string())?;
        if name.contains('\0') || name.is_empty() {
            return Err("search.invalid".to_string());
        }
        records.push(UsnRecord {
            file_id,
            parent_id,
            usn,
            timestamp,
            reason,
            source_info,
            attributes,
            name,
        });
        offset += record_length;
    }
    Ok(ParsedUsn {
        records,
        consumed: offset,
    })
}

/// Walk parent references from a file to the volume root. A repeated ID or a
/// chain longer than 256 is refused rather than followed.
pub fn build_parent_chain(
    file_id: u64,
    parents: &HashMap<u64, u64>,
    max_depth: usize,
) -> Result<Vec<u64>, String> {
    if max_depth == 0 || max_depth > USN_MAX_PARENT_DEPTH {
        return Err("search.invalid".to_string());
    }
    let mut chain = Vec::new();
    let mut current = file_id;
    let mut seen = std::collections::HashSet::new();
    while current != 0 {
        if !seen.insert(current) {
            return Err("search.invalid".to_string());
        }
        if chain.len() >= max_depth {
            return Err("search.too_large".to_string());
        }
        chain.push(current);
        match parents.get(&current) {
            Some(parent) => current = *parent,
            None => break,
        }
    }
    Ok(chain)
}

fn read_u16(buffer: &[u8], offset: usize) -> Result<u16, String> {
    buffer
        .get(offset..offset + 2)
        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
        .ok_or_else(|| "search.invalid".to_string())
}

fn read_u32(buffer: &[u8], offset: usize) -> Result<u32, String> {
    buffer
        .get(offset..offset + 4)
        .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .ok_or_else(|| "search.invalid".to_string())
}

fn read_u64(buffer: &[u8], offset: usize) -> Result<u64, String> {
    let bytes = buffer
        .get(offset..offset + 8)
        .ok_or_else(|| "search.invalid".to_string())?;
    let mut value = [0u8; 8];
    value.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(value))
}

fn read_i64(buffer: &[u8], offset: usize) -> Result<i64, String> {
    read_u64(buffer, offset).map(|value| value as i64)
}

#[cfg(test)]
mod tests {
    use super::{build_parent_chain, parse_usn_records};
    use std::collections::HashMap;

    fn record(name: &str, name_offset: u16, version: u16, declared: u32) -> Vec<u8> {
        let units: Vec<u16> = name.encode_utf16().collect();
        let name_length = (units.len() * 2) as u16;
        let mut bytes = vec![0u8; 60 + units.len() * 2];
        bytes[0..4].copy_from_slice(&declared.to_le_bytes());
        bytes[4..6].copy_from_slice(&version.to_le_bytes());
        bytes[6..8].copy_from_slice(&0u16.to_le_bytes());
        bytes[8..16].copy_from_slice(&7u64.to_le_bytes());
        bytes[16..24].copy_from_slice(&5u64.to_le_bytes());
        bytes[52..56].copy_from_slice(&0u32.to_le_bytes());
        bytes[56..58].copy_from_slice(&name_length.to_le_bytes());
        bytes[58..60].copy_from_slice(&name_offset.to_le_bytes());
        if name_offset as usize == 60 {
            for (index, unit) in units.iter().enumerate() {
                bytes[60 + index * 2..62 + index * 2].copy_from_slice(&unit.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn a_valid_record_round_trips() {
        let parsed = parse_usn_records(&record("report.txt", 60, 2, 80), 10).unwrap();
        assert_eq!(parsed.records.len(), 1);
        assert_eq!(parsed.records[0].name, "report.txt");
        assert_eq!(parsed.records[0].parent_id, 5);
        assert_eq!(parsed.consumed, 80);
    }

    #[test]
    fn a_short_declared_length_is_refused() {
        assert!(parse_usn_records(&record("a.txt", 60, 2, 12), 10).is_err());
    }

    #[test]
    fn a_name_offset_outside_the_record_is_refused() {
        assert!(parse_usn_records(&record("a.txt", 200, 2, 70), 10).is_err());
    }

    #[test]
    fn an_unknown_record_version_is_refused() {
        assert!(parse_usn_records(&record("a.txt", 60, 3, 70), 10).is_err());
    }

    #[test]
    fn a_cycle_hits_the_depth_cap() {
        let mut parents = HashMap::new();
        parents.insert(1, 2);
        parents.insert(2, 3);
        parents.insert(3, 1);
        assert!(build_parent_chain(1, &parents, 256).is_err());
    }

    #[test]
    fn a_chain_longer_than_the_cap_is_refused() {
        let mut parents = HashMap::new();
        for id in 1..10 {
            parents.insert(id, id + 1);
        }
        assert!(build_parent_chain(1, &parents, 4).is_err());
    }
}
