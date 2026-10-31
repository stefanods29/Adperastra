//! Parsing a 7-Zip technical listing (Step 06e T7). Every property is split
//! on its first ` = `, so equals signs and spaces inside values survive.
//! Anything inconsistent fails closed with `ambiguous_rar`.

use std::collections::HashMap;

use crate::error::ArchiveError;

/// The longest accepted listing line.
pub const MAX_RAR_LINE_BYTES: usize = 16_384;
/// The largest accepted listing output.
pub const MAX_RAR_LIST_BYTES: usize = 67_108_864;

/// One entry record of the technical listing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RarRecord {
    /// The printed path. A candidate, never an identity.
    pub path: String,
    pub size: u64,
    pub packed_size: u64,
    pub modified_unix: u64,
    pub encrypted: bool,
    pub is_folder: bool,
    pub is_link: bool,
    pub is_stream: bool,
}

/// The whole listing, plus the archive-level facts that decide support.
#[derive(Debug, Clone, Default)]
pub struct RarListing {
    pub archive_type: String,
    pub multi_volume: bool,
    pub records: Vec<RarRecord>,
}

/// Parse the stdout of `7z l -slt -sccUTF-8 -bd`. Only entry records are
/// returned; the archive header record is checked for volumes and type.
pub fn parse_listing(stdout: &[u8]) -> Result<RarListing, ArchiveError> {
    if stdout.len() > MAX_RAR_LIST_BYTES {
        return Err(ArchiveError::AmbiguousRar);
    }
    let text = std::str::from_utf8(stdout).map_err(|_| ArchiveError::AmbiguousRar)?;
    let mut listing = RarListing::default();
    let mut current: Option<HashMap<String, String>> = None;
    let mut started = false;
    for line in text.split('\n') {
        if line.len() > MAX_RAR_LINE_BYTES {
            return Err(ArchiveError::AmbiguousRar);
        }
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some((key, value)) = split_property(line) else {
            if line.is_empty() || line == "--" || line.starts_with("---") {
                continue;
            }
            if started {
                // A line inside the records that is not a property is an
                // unknown record boundary: refuse instead of guessing.
                return Err(ArchiveError::AmbiguousRar);
            }
            continue;
        };
        if key == "Path" {
            if let Some(previous) = current.take() {
                take_record(previous, &mut listing)?;
            }
            let mut record = HashMap::new();
            record.insert(key, value);
            current = Some(record);
            started = true;
            continue;
        }
        let Some(record) = current.as_mut() else {
            continue;
        };
        if record.insert(key.clone(), value).is_some() {
            // A property may appear once per record.
            return Err(ArchiveError::AmbiguousRar);
        }
    }
    if let Some(previous) = current.take() {
        take_record(previous, &mut listing)?;
    }
    if listing.archive_type.is_empty() {
        return Err(ArchiveError::AmbiguousRar);
    }
    Ok(listing)
}

/// The first ` = ` separates a property; everything after it stays intact.
fn split_property(line: &str) -> Option<(String, String)> {
    let position = line.find(" = ")?;
    Some((
        line[..position].to_string(),
        line[position + 3..].to_string(),
    ))
}

fn take_record(
    record: HashMap<String, String>,
    listing: &mut RarListing,
) -> Result<(), ArchiveError> {
    if let Some(kind) = record.get("Type") {
        listing.archive_type = kind.clone();
        if !kind.eq_ignore_ascii_case("Rar") {
            // Not a RAR archive: never hand it to the extractor.
            return Err(ArchiveError::Unsupported);
        }
        if let Some(volumes) = record.get("Volumes") {
            let count = volumes
                .trim()
                .parse::<u64>()
                .map_err(|_| ArchiveError::AmbiguousRar)?;
            if count > 1 {
                listing.multi_volume = true;
            }
        }
        if record
            .get("Multivolume")
            .is_some_and(|value| value.trim() == "+")
        {
            listing.multi_volume = true;
        }
        return Ok(());
    }
    let path = record
        .get("Path")
        .cloned()
        .ok_or(ArchiveError::AmbiguousRar)?;
    if path.is_empty() {
        return Err(ArchiveError::AmbiguousRar);
    }
    let folder = record
        .get("Folder")
        .is_some_and(|value| value.trim() == "+")
        || record
            .get("Attributes")
            .is_some_and(|value| value.trim_start().starts_with('D'));
    let is_link = record.contains_key("Symbolic Link")
        || record.contains_key("Hard Link")
        || record
            .get("Attributes")
            .is_some_and(|value| value.to_ascii_uppercase().contains('L'));
    let is_stream = record.contains_key("Alternate Stream")
        || record
            .get("Streams")
            .is_some_and(|value| value.trim() != "-" && !value.trim().is_empty())
        || record.get("Anti").is_some_and(|value| value.trim() == "+");
    let encrypted = record
        .get("Encrypted")
        .is_some_and(|value| value.trim() == "+");
    let size = match record.get("Size") {
        Some(value) if !folder => value
            .trim()
            .parse::<u64>()
            .map_err(|_| ArchiveError::AmbiguousRar)?,
        None if !folder => return Err(ArchiveError::AmbiguousRar),
        _ => 0,
    };
    let packed_size = record
        .get("Packed Size")
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let modified_unix = record
        .get("Modified")
        .and_then(|value| parse_utc(value.trim()))
        .unwrap_or(0);
    listing.records.push(RarRecord {
        path,
        size,
        packed_size,
        modified_unix,
        encrypted,
        is_folder: folder,
        is_link,
        is_stream,
    });
    Ok(())
}

/// `YYYY-MM-DD HH:MM:SS` or the same with a trailing ` UTC`; a missing or
/// impossible value is 0, never a guessed local date.
fn parse_utc(value: &str) -> Option<u64> {
    let value = value.strip_suffix(" UTC").unwrap_or(value);
    let (date, time) = value.split_once(' ')?;
    let mut date_parts = date.split('-');
    let year: i32 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() {
        return None;
    }
    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.parse().ok()?;
    if time_parts.next().is_some() || month > 12 || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    Some(civil_to_unix(year, month, day, hour, minute, second))
}

/// Days from 1970-01-01 to a civil date (Howard Hinnant's algorithm).
fn civil_to_unix(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> u64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 } as i32;
    let day_of_year = (153 * month_index + 2) / 5 + day as i32 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era as i64 * 146_097 + day_of_era as i64 - 719_468;
    if days < 0 {
        return 0;
    }
    (days as u64) * 86_400 + hour as u64 * 3_600 + minute as u64 * 60 + second as u64
}
