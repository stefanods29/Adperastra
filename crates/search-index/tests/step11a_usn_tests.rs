//! Step 11a T6: the elevated helper sees metadata only and refuses malformed
//! or overlong records.

use search_index::usn_records::{build_parent_chain, parse_usn_records, HELPER_CAPABILITIES};
use std::collections::HashMap;

fn record(name: &str, offset: u16, version: u16, length: u32) -> Vec<u8> {
    let units: Vec<u16> = name.encode_utf16().collect();
    let mut bytes = vec![0u8; 60 + units.len() * 2];
    bytes[0..4].copy_from_slice(&length.to_le_bytes());
    bytes[4..6].copy_from_slice(&version.to_le_bytes());
    bytes[8..16].copy_from_slice(&1u64.to_le_bytes());
    bytes[16..24].copy_from_slice(&0u64.to_le_bytes());
    bytes[56..58].copy_from_slice(&((units.len() * 2) as u16).to_le_bytes());
    bytes[58..60].copy_from_slice(&offset.to_le_bytes());
    if offset == 60 {
        for (index, unit) in units.iter().enumerate() {
            bytes[60 + index * 2..62 + index * 2].copy_from_slice(&unit.to_le_bytes());
        }
    }
    bytes
}

#[test]
fn malformed_length_offset_and_version_are_refused() {
    assert!(parse_usn_records(&record("a.txt", 60, 2, 12), 10).is_err());
    assert!(parse_usn_records(&record("a.txt", 200, 2, 70), 10).is_err());
    assert!(parse_usn_records(&record("a.txt", 60, 3, 70), 10).is_err());
}

#[test]
fn a_parent_cycle_hits_the_depth_cap() {
    let mut parents = HashMap::new();
    parents.insert(1, 2);
    parents.insert(2, 1);
    assert!(build_parent_chain(1, &parents, 256).is_err());
}

#[test]
fn the_helper_contract_has_no_write_or_content_capability() {
    assert_eq!(HELPER_CAPABILITIES, &["read_volume_metadata"]);
    assert!(!HELPER_CAPABILITIES.iter().any(|value| {
        value.contains("write") || value.contains("content") || value.contains("open_file")
    }));
}
