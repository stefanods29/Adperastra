//! Receipt arithmetic for Step 17d T3 (decision D5).
//!
//! Amounts become signed `i64` minor units only after an explicit ISO 4217
//! currency with a known scale. Unknown currency keeps the text; ambiguous
//! *day/month* versus *month/day* dates stay text; identifiers such as tax
//! IDs are never converted to numbers.
#![allow(dead_code)]


pub const RECEIPT_MISMATCH_WARNING: &str = "receipt_arithmetic_mismatch";
pub const RECEIPT_DATE_AMBIGUOUS: &str = "receipt_date_ambiguous";
pub const RECEIPT_CURRENCY_UNKNOWN: &str = "receipt_currency_unknown";

/// ISO 4217 codes with a known minor-unit exponent. Nothing is inferred from
/// language or locale.
pub const CURRENCY_MINOR_UNITS: &[(&str, u32)] = &[
    ("PEN", 2),
    ("USD", 2),
    ("EUR", 2),
    ("GBP", 2),
    ("MXN", 2),
    ("CAD", 2),
    ("BRL", 2),
    ("ARS", 2),
    ("CLP", 0),
    ("COP", 2),
    ("JPY", 0),
    ("KRW", 0),
    ("CNY", 2),
    ("INR", 2),
    ("CHF", 2),
    ("KWD", 3),
    ("BHD", 3),
    ("TND", 3),
];

pub fn currency_scale(code: &str) -> Option<u32> {
    CURRENCY_MINOR_UNITS
        .iter()
        .find(|(known, _)| *known == code)
        .map(|(_, scale)| *scale)
}

/// The explicit code of a field, or `None`. Never guessed from the text.
pub fn explicit_currency(text: &str) -> Option<String> {
    let code = text.trim().to_uppercase();
    if code.len() != 3 || !code.chars().all(|c| c.is_ascii_uppercase()) {
        return None;
    }
    currency_scale(&code).map(|_| code)
}

fn digits(value: &str) -> Option<i64> {
    let mut result = String::new();
    for character in value.chars() {
        if character.is_ascii_digit() {
            result.push(character);
        } else if character == '.' || character == ',' || character == ' ' {
            continue;
        } else {
            return None;
        }
    }
    if result.is_empty() || result.len() > 18 {
        return None;
    }
    result.parse().ok()
}

/// Thousands groups use one separator and exactly three digits each.
fn whole_value(whole: &str) -> Option<i64> {
    if whole.is_empty() {
        return None;
    }
    if whole.chars().all(|c| c.is_ascii_digit()) {
        return whole.parse().ok();
    }
    let separators: Vec<char> = whole
        .chars()
        .filter(|c| *c == '.' || *c == ',' || *c == ' ')
        .collect();
    let separator = *separators.first()?;
    if !separators.iter().all(|value| *value == separator) {
        return None;
    }
    let parts: Vec<&str> = whole.split(separator).collect();
    let first = parts.first()?;
    if first.is_empty() || first.len() > 3 || !first.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    for part in &parts[1..] {
        if part.len() != 3 || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
    }
    digits(whole)
}

/// Parse an amount to minor units; `1.234` under a 2-decimal currency is
/// ambiguous and refused instead of guessing.
pub fn parse_minor_amount(text: &str, currency_code: Option<&str>) -> Option<i64> {
    let scale = currency_scale(currency_code?)?;
    let raw = text.trim();
    if raw.is_empty() || raw.len() > 32 {
        return None;
    }
    let (negative, body) = match raw.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, raw),
    };
    if body.is_empty() {
        return None;
    }
    let last_separator = body.rfind(['.', ',']);
    let (whole, fraction) = match last_separator {
        Some(index) => (&body[..index], Some(&body[index + 1..])),
        None => (body, None),
    };
    let mut fraction_digits = 0i64;
    let fraction_len = fraction.map(str::len).unwrap_or(0);
    if let Some(fraction) = fraction {
        if fraction.is_empty() || fraction.len() > 3 || !fraction.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        if fraction_len as u32 > scale {
            if fraction.len() == 3 && scale == 0 {
                return whole_value(&format!("{whole}{fraction}")).map(|value| if negative { -value } else { value });
            }
            return None;
        }
        let padded = format!("{:0<width$}", fraction, width = scale as usize);
        fraction_digits = padded.parse().ok()?;
    }
    let whole = whole_value(whole)?;
    let factor = 10i64.checked_pow(scale)?;
    let value = whole.checked_mul(factor)?.checked_add(fraction_digits)?;
    Some(if negative { -value } else { value })
}

fn leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn iso_date(year: u32, month: u32, day: u32) -> Option<String> {
    if !(1000..=9999).contains(&year) || !(1..=12).contains(&month) {
        return None;
    }
    if day < 1 || day > days_in_month(year, month) {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

/// Unambiguous dates become ISO; `03/04/2026` returns `None` (D5).
pub fn parse_receipt_date(text: &str) -> Option<String> {
    let raw = text.trim();
    let iso: Vec<&str> = raw.split('-').collect();
    if iso.len() == 3 && iso[0].len() == 4 {
        let year = iso[0].parse().ok()?;
        let month = iso[1].parse().ok()?;
        let day = iso[2].parse().ok()?;
        return iso_date(year, month, day);
    }
    let parts: Vec<&str> = raw
        .split(['/', '.', '-'])
        .collect();
    if parts.len() != 3 || parts[2].len() != 4 {
        return None;
    }
    let first: u32 = parts[0].parse().ok()?;
    let second: u32 = parts[1].parse().ok()?;
    let year: u32 = parts[2].parse().ok()?;
    if first > 12 && second <= 12 {
        return iso_date(year, second, first);
    }
    if second > 12 && first <= 12 {
        return iso_date(year, first, second);
    }
    None
}

/// Identifiers keep their leading zeros and separators exactly.
pub fn tax_id_text(text: &str) -> String {
    text.trim().to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptFieldText {
    pub vendor: String,
    pub tax_id: String,
    pub date: String,
    pub currency: String,
    pub subtotal: String,
    pub tax: String,
    pub total: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptArithmetic {
    pub currency_code: Option<String>,
    pub date_iso: Option<String>,
    pub subtotal_minor: Option<i64>,
    pub tax_minor: Option<i64>,
    pub total_minor: Option<i64>,
    pub arithmetic_ok: Option<bool>,
    pub warnings: Vec<String>,
}

pub fn compute_receipt(field: &ReceiptFieldText) -> ReceiptArithmetic {
    let mut warnings = Vec::new();
    let currency = explicit_currency(&field.currency);
    if currency.is_none() {
        warnings.push(RECEIPT_CURRENCY_UNKNOWN.to_string());
    }
    let subtotal = parse_minor_amount(&field.subtotal, currency.as_deref());
    let tax = parse_minor_amount(&field.tax, currency.as_deref());
    let total = parse_minor_amount(&field.total, currency.as_deref());
    let arithmetic_ok = match (subtotal, tax, total) {
        (Some(subtotal), Some(tax), Some(total)) => {
            let ok = subtotal
                .checked_add(tax)
                .is_some_and(|sum| (sum - total).abs() <= 1);
            if !ok {
                warnings.push(RECEIPT_MISMATCH_WARNING.to_string());
            }
            Some(ok)
        }
        _ => None,
    };
    let date_iso = parse_receipt_date(&field.date);
    if !field.date.trim().is_empty() && date_iso.is_none() {
        warnings.push(RECEIPT_DATE_AMBIGUOUS.to_string());
    }
    ReceiptArithmetic {
        currency_code: currency,
        date_iso,
        subtotal_minor: subtotal,
        tax_minor: tax,
        total_minor: total,
        arithmetic_ok,
        warnings,
    }
}

#[cfg(test)]
#[path = "ai_extraction_receipts_tests.rs"]
mod tests;
