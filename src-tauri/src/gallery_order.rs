//! Gallery ordering and date grouping (Step 07c, decisions D5/D6).
//!
//! Pure functions only: the scan builds items, the page builder reads them in
//! this order, and the UI mirrors the same rules in `galleryDates.ts`. The
//! backend groups by UTC month; the UI turns the same instant into the local
//! calendar month with the active locale.

use crate::gallery_types::{gallery_path_key, GalleryDateSource, GalleryItem};

/// Parses the ISO UTC strings the metadata service returns (`...Z`). A
/// fractional part is accepted and ignored; any other offset is not guessed.
pub fn parse_iso_utc_to_unix(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' || *bytes.last()? != b'Z' {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    let hour: u64 = value.get(11..13)?.parse().ok()?;
    let minute: u64 = value.get(14..16)?.parse().ok()?;
    let second: u64 = value.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if civil_from_days(days) != (year, month, day) {
        return None;
    }
    let tail = &value[19..value.len() - 1];
    if !tail.is_empty()
        && (!tail.starts_with('.')
            || tail.len() < 2
            || !tail[1..].bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    Some(days * 86_400 + (hour * 3_600 + minute * 60 + second) as i64)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_prime = (i64::from(month) + 9) % 12;
    let day_of_year = (153 * month_prime + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The civil date for days since 1970-01-01 (the inverse of the function
/// above), used for UTC month keys.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

/// `YYYY-MM` in UTC, or `undated` for a zero date.
pub fn utc_month(unix: i64) -> String {
    if unix == 0 {
        return "undated".to_string();
    }
    let (year, month, _) = civil_from_days(unix.div_euclid(86_400));
    format!("{year:04}-{month:02}")
}

/// The date used for ordering and grouping: taken when requested and known,
/// else modified. Zero means no date at all.
pub fn effective_unix(
    taken_utc: Option<&str>,
    modified_unix: u64,
    date_source: GalleryDateSource,
) -> i64 {
    if date_source == GalleryDateSource::Taken {
        if let Some(taken) = taken_utc.and_then(parse_iso_utc_to_unix) {
            return taken;
        }
    }
    i64::try_from(modified_unix).unwrap_or(0)
}

/// `YYYY-MM` in UTC, else `undated`.
pub fn gallery_group_key(
    taken_utc: Option<&str>,
    modified_unix: u64,
    date_source: GalleryDateSource,
) -> String {
    utc_month(effective_unix(taken_utc, modified_unix, date_source))
}

fn path_key(item: &GalleryItem) -> String {
    gallery_path_key(&item.item.path)
}

/// Modified (or taken) date newest first, then normalized path ascending, so
/// the order is total and stable across pages. Keys are computed once per item
/// (250,000 pictures must not allocate inside the comparator).
pub fn sort_gallery_items(items: &mut [GalleryItem], date_source: GalleryDateSource) {
    items.sort_by_cached_key(|item| {
        let date = effective_unix(
            item.taken_utc.as_deref(),
            item.item.modified_unix,
            date_source,
        );
        (
            std::cmp::Reverse(date),
            path_key(item),
            item.identity.clone(),
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::explorer::ExplorerItem;
    use fs_service::ItemKind;
    use std::path::PathBuf;

    fn item(path: &str, modified: u64) -> GalleryItem {
        GalleryItem {
            item: ExplorerItem {
                path: path.to_string(),
                name: PathBuf::from(path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                kind: ItemKind::File,
                size: 1,
                modified_unix: modified,
                hidden: false,
                system: false,
                is_link: false,
                online_only: false,
                file_id: None,
                file_id_stable: false,
            },
            identity: format!("path:{}", gallery_path_key(path)),
            taken_utc: None,
            group_key: utc_month(modified as i64),
            source_ids: vec!["00000000-0000-4000-8000-000000000001".to_string()],
        }
    }

    #[test]
    fn taken_iso_parses_to_utc_seconds() {
        assert_eq!(
            parse_iso_utc_to_unix("2026-01-01T00:30:00Z"),
            Some(1_767_227_400)
        );
        assert_eq!(
            parse_iso_utc_to_unix("2026-01-01T00:30:00.250Z"),
            Some(1_767_227_400)
        );
        assert_eq!(parse_iso_utc_to_unix("2026-01-01T00:30:00+05:00"), None);
        assert_eq!(parse_iso_utc_to_unix("nonsense"), None);
    }

    #[test]
    fn utc_month_uses_the_utc_calendar() {
        assert_eq!(utc_month(1_767_227_400), "2026-01");
        assert_eq!(utc_month(0), "undated");
        let (year, month, day) = civil_from_days(days_from_civil(2024, 2, 29));
        assert_eq!((year, month, day), (2024, 2, 29));
    }

    #[test]
    fn missing_taken_falls_back_to_modified() {
        assert_eq!(
            gallery_group_key(None, 1_714_521_600, GalleryDateSource::Taken),
            "2024-05"
        );
        assert_eq!(
            gallery_group_key(
                Some("2026-01-01T00:30:00Z"),
                1_714_521_600,
                GalleryDateSource::Modified
            ),
            "2024-05"
        );
    }

    #[test]
    fn zero_dates_are_undated() {
        assert_eq!(
            gallery_group_key(None, 0, GalleryDateSource::Taken),
            "undated"
        );
        assert_eq!(
            gallery_group_key(Some("2026-01-01T00:30:00Z"), 0, GalleryDateSource::Modified),
            "undated"
        );
    }

    #[test]
    fn sort_is_newest_first_with_a_path_tie_break() {
        let mut items = vec![
            item("C:\\Pictures\\b.png", 100),
            item("C:\\Pictures\\a.png", 100),
            item("C:\\Pictures\\new.png", 200),
        ];
        sort_gallery_items(&mut items, GalleryDateSource::Modified);
        let order: Vec<&str> = items.iter().map(|i| i.item.name.as_str()).collect();
        assert_eq!(order, vec!["new.png", "a.png", "b.png"]);
    }
}
