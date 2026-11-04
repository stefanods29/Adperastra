use super::*;

/// A valid value for `id`, or `None` when the kind or the bounds are wrong.
pub fn normalized_value(id: MetadataFieldId, value: MetadataValue) -> Option<MetadataValue> {
    match (id, value) {
        (MetadataFieldId::Width | MetadataFieldId::Height, MetadataValue::Integer { value })
            if value > 0 && value <= u32::MAX as u64 =>
        {
            Some(MetadataValue::Integer { value })
        }
        (MetadataFieldId::Orientation, MetadataValue::Integer { value })
            if (1..=8).contains(&value) =>
        {
            Some(MetadataValue::Integer { value })
        }
        (MetadataFieldId::DateTaken, MetadataValue::Date { value }) if is_iso8601_utc(&value) => {
            Some(MetadataValue::Date { value })
        }
        (
            MetadataFieldId::CameraMake
            | MetadataFieldId::CameraModel
            | MetadataFieldId::VideoCodec
            | MetadataFieldId::AudioTitle
            | MetadataFieldId::AudioAlbum,
            MetadataValue::Text { value },
        ) => normalized_text(value).map(|value| MetadataValue::Text { value }),
        (MetadataFieldId::DurationMs, MetadataValue::Integer { value })
            if value <= MAX_SAFE_INTEGER =>
        {
            Some(MetadataValue::Integer { value })
        }
        (MetadataFieldId::FrameRate, MetadataValue::Decimal { value })
            if value.is_finite() && value > 0.0 && value <= 1_000_000.0 =>
        {
            Some(MetadataValue::Decimal { value })
        }
        (MetadataFieldId::AudioArtist | MetadataFieldId::Author, MetadataValue::List { value }) => {
            let list = normalized_list(value);
            if list.is_empty() {
                None
            } else {
                Some(MetadataValue::List { value: list })
            }
        }
        (
            MetadataFieldId::PageCount | MetadataFieldId::WordCount,
            MetadataValue::Integer { value },
        ) if value <= u32::MAX as u64 => Some(MetadataValue::Integer { value }),
        _ => None,
    }
}

/// Trimmed, non-empty text within the per-field limit.
pub fn normalized_text(value: String) -> Option<String> {
    let text = value.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return None;
    }
    Some(text.to_string())
}

/// Trimmed, distinct, non-empty entries, at most `MAX_LIST_ENTRIES`.
pub fn normalized_list(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        let Some(text) = normalized_text(value) else {
            continue;
        };
        if !out.contains(&text) {
            out.push(text);
        }
        if out.len() == MAX_LIST_ENTRIES {
            break;
        }
    }
    out
}

/// `System.Media.Duration` is in 100 ns ticks; the UI shows milliseconds.
pub fn duration_ms_from_ticks(ticks: u64) -> Option<u64> {
    let milliseconds = ticks / 10_000;
    (milliseconds <= MAX_SAFE_INTEGER).then_some(milliseconds)
}

/// `System.Video.FrameRate` is in thousandths of a frame per second.
pub fn frame_rate_from_units(units: u64) -> Option<f64> {
    if units == 0 {
        return None;
    }
    let rate = units as f64 / 1000.0;
    (rate.is_finite() && rate > 0.0 && rate <= 1_000_000.0).then_some(rate)
}

/// Positive pixel dimensions only; zero never means "unknown" (D5).
pub fn positive_dimension(value: u64) -> Option<u64> {
    (value > 0 && value <= u32::MAX as u64).then_some(value)
}

/// Orientation is exactly 1 to 8; anything else is dropped.
pub fn orientation_value(value: i64) -> Option<u64> {
    (1..=8).contains(&value).then_some(value as u64)
}

/// Filetimes before 1601 or after year 9999 are not guessed.
pub fn filetime_to_iso8601(ticks: u64) -> Option<String> {
    const EPOCH_DIFFERENCE: u64 = 116_444_736_000_000_000;
    let seconds = (i128::from(ticks) - i128::from(EPOCH_DIFFERENCE)).div_euclid(10_000_000);
    let days = i64::try_from(seconds.div_euclid(86_400)).ok()?;
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    if !(1601..=9999).contains(&year) {
        return None;
    }
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    ))
}

/// Howard Hinnant's civil-date conversion (days since 1970-01-01).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Shape check only: `YYYY-MM-DDTHH:MM:SSZ` with real ranges. The helper
/// itself converts FILETIME, so a value that does not have this shape is a
/// programming error and is dropped.
pub fn is_iso8601_utc(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return false;
    }
    let number = |from: usize, to: usize| -> Option<u32> {
        let text = value.get(from..to)?;
        if !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        text.parse::<u32>().ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
    ) else {
        return false;
    };
    if year < 1601 || !(1..=12).contains(&month) || hour >= 24 || minute >= 60 || second >= 60 {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let last_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if leap => 29,
        _ => 28,
    };
    (1..=last_day).contains(&day)
}
