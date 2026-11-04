//! Native receipt oracles for Step 17d T3 (decision D5).

use super::{
    compute_receipt, explicit_currency, parse_minor_amount, parse_receipt_date, tax_id_text,
    ReceiptFieldText, RECEIPT_CURRENCY_UNKNOWN, RECEIPT_DATE_AMBIGUOUS, RECEIPT_MISMATCH_WARNING,
};

fn field(currency: &str, subtotal: &str, tax: &str, total: &str, date: &str) -> ReceiptFieldText {
    ReceiptFieldText {
        vendor: "Acme".to_string(),
        tax_id: "000123".to_string(),
        date: date.to_string(),
        currency: currency.to_string(),
        subtotal: subtotal.to_string(),
        tax: tax.to_string(),
        total: total.to_string(),
    }
}

#[test]
fn receipt_minor_units() {
    let result = compute_receipt(&field("PEN", "100.00", "18.00", "118.00", "2026-11-03"));
    assert_eq!(result.currency_code.as_deref(), Some("PEN"));
    assert_eq!(result.subtotal_minor, Some(10_000));
    assert_eq!(result.tax_minor, Some(1_800));
    assert_eq!(result.total_minor, Some(11_800));
    assert_eq!(result.arithmetic_ok, Some(true));
    assert!(result.warnings.is_empty());
    assert_eq!(result.date_iso.as_deref(), Some("2026-11-03"));
}

#[test]
fn receipt_mismatch() {
    let result = compute_receipt(&field("PEN", "100.00", "18.00", "117.98", "2026-11-03"));
    assert_eq!(result.arithmetic_ok, Some(false));
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning == RECEIPT_MISMATCH_WARNING));
    // The totals are reported exactly as parsed; nothing is adjusted.
    assert_eq!(result.total_minor, Some(11_798));
}

#[test]
fn receipt_ambiguous_date() {
    assert_eq!(parse_receipt_date("03/04/2026"), None);
    assert_eq!(
        parse_receipt_date("13/04/2026").as_deref(),
        Some("2026-04-13")
    );
    assert_eq!(
        parse_receipt_date("04/13/2026").as_deref(),
        Some("2026-04-13")
    );
    let result = compute_receipt(&field("PEN", "1.00", "0.00", "1.00", "03/04/2026"));
    assert_eq!(result.date_iso, None);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning == RECEIPT_DATE_AMBIGUOUS));
}

#[test]
fn receipt_tax_id() {
    assert_eq!(tax_id_text("000123"), "000123");
    assert_eq!(tax_id_text(" 000 123 "), "000 123");
    assert_ne!(tax_id_text("000123"), "123");
}

#[test]
fn receipt_currency_not_guessed() {
    assert_eq!(explicit_currency("PEN").as_deref(), Some("PEN"));
    assert_eq!(explicit_currency("xyz"), None);
    assert_eq!(explicit_currency(""), None);
    let result = compute_receipt(&field("", "100.00", "18.00", "118.00", "2026-11-03"));
    assert_eq!(result.currency_code, None);
    assert_eq!(result.subtotal_minor, None);
    assert_eq!(result.arithmetic_ok, None);
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning == RECEIPT_CURRENCY_UNKNOWN));
    // An unknown code is still not guessed.
    let unknown = compute_receipt(&field("XYZ", "1.00", "0.00", "1.00", "2026-11-03"));
    assert_eq!(unknown.currency_code, None);
    assert_eq!(unknown.total_minor, None);
}

#[test]
fn receipt_amount_ambiguity_refused() {
    assert_eq!(parse_minor_amount("1.234", Some("PEN")), None);
    assert_eq!(parse_minor_amount("1,234.56", Some("PEN")), Some(123_456));
    assert_eq!(parse_minor_amount("1.234,56", Some("PEN")), Some(123_456));
    // A three-digit tail in a zero-decimal currency is a thousands group.
    assert_eq!(parse_minor_amount("1,000", Some("JPY")), Some(1_000));
    assert_eq!(parse_minor_amount("1.000", Some("JPY")), Some(1_000));
    assert_eq!(parse_minor_amount("100.00", None), None);
    assert_eq!(parse_minor_amount("-18.00", Some("PEN")), Some(-1_800));
}

#[test]
fn receipt_warning_labels_are_stable() {
    assert_eq!(RECEIPT_MISMATCH_WARNING, "receipt_arithmetic_mismatch");
    assert_eq!(RECEIPT_DATE_AMBIGUOUS, "receipt_date_ambiguous");
}
