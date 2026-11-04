//! Calendar helpers for natural-language date filters (Step 17c T4).
//! Intervals are half-open internally and converted once to 11a inclusive
//! bounds. The TS preview applies the captured IANA zone; this native check
//! is the UTC floor/safety path.

use crate::ai_search_types::is_safe_u64;

fn invalid() -> String {
    "ai_search.invalid".to_string()
}

fn ambiguous() -> String {
    "ai_search.ambiguous".to_string()
}

pub(crate) fn resolve_preset(now: u64, preset: &str) -> Result<(Option<u64>, Option<u64>), String> {
    let now = now.min(9_007_199_254_740_991);
    let day = now - now % 86_400;
    let days_since_epoch = day / 86_400;
    let (year, month, _day_of_month) = civil_from_days(days_since_epoch as i64);
    let (start, end) = match preset {
        "today" => (day, day + 86_400),
        "yesterday" => (day - 86_400, day),
        "this_week" => {
            let weekday = (days_since_epoch + 3) % 7; // 1970-01-01 was Thursday
            let start = day - weekday * 86_400;
            (start, start + 7 * 86_400)
        }
        "last_week" => {
            let weekday = (days_since_epoch + 3) % 7;
            let start = day - weekday * 86_400 - 7 * 86_400;
            (start, start + 7 * 86_400)
        }
        "this_month" => {
            let start = days_from_civil(year, month, 1);
            let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
            let end = days_from_civil(next_year, next_month, 1);
            (start as u64 * 86_400, end as u64 * 86_400)
        }
        "last_month" => {
            let (year, month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
            let start = days_from_civil(year, month, 1);
            let end = days_from_civil(
                if month == 12 { year + 1 } else { year },
                if month == 12 { 1 } else { month + 1 },
                1,
            );
            (start as u64 * 86_400, end as u64 * 86_400)
        }
        "this_year" => {
            let start = days_from_civil(year, 1, 1);
            let end = days_from_civil(year + 1, 1, 1);
            (start as u64 * 86_400, end as u64 * 86_400)
        }
        "last_year" => {
            let start = days_from_civil(year - 1, 1, 1);
            let end = days_from_civil(year, 1, 1);
            (start as u64 * 86_400, end as u64 * 86_400)
        }
        _ => return Err(ambiguous()),
    };
    if end <= start {
        return Err(invalid());
    }
    Ok((Some(start), Some(end - 1)))
}

pub(crate) fn parse_date(value: &str) -> Result<u64, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(invalid());
    }
    let year = value[..4].parse::<i64>().map_err(|_| invalid())?;
    let month = value[5..7].parse::<u32>().map_err(|_| invalid())?;
    let day = value[8..10].parse::<u32>().map_err(|_| invalid())?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(invalid());
    }
    let days = days_from_civil(year, month, day);
    if days < 0 {
        return Err(invalid());
    }
    let (check_year, check_month, check_day) = civil_from_days(days);
    if (check_year, check_month, check_day) != (year, month, day) {
        return Err(invalid());
    }
    let seconds = days * 86_400;
    if !is_safe_u64(seconds as u64) {
        return Err("ai_search.too_large".to_string());
    }
    Ok(seconds as u64)
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}
