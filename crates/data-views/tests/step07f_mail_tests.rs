use data_views::mail::{clean_attachment_name, parse_email};

fn html_message(body: &str) -> Vec<u8> {
    format!(
        "From: Ana <ana@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: Hello\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}"
    )
    .into_bytes()
}

#[test]
fn email_remote_image_makes_zero_requests() {
    let doc = parse_email(&html_message(
        "<p>Hello</p><img src=\"https://tracker.example/pixel.png\" srcset=\"https://x 2x\" alt=\"logo\">",
    ))
    .unwrap();
    let html = doc.summary.html.unwrap();
    assert!(!html.contains("https://"));
    assert!(!html.contains("http://"));
    assert!(!html.contains("srcset"));
    assert!(html.contains("alt=\"logo\""));
}

#[test]
fn malformed_cid_cannot_escape_the_message() {
    let doc = parse_email(&html_message(
        "<img src=\"cid:../../secret\" alt=\"a\"><img src=\"cid:ok\">",
    ))
    .unwrap();
    let html = doc.summary.html.unwrap();
    assert!(!html.contains("cid:"));
    assert!(!html.contains("../"));
}

#[test]
fn a_body_without_html_keeps_plain_text() {
    let bytes = b"From: a@example.com\r\nTo: b@example.com\r\nSubject: Plain\r\n\r\nHello\r\n";
    let doc = parse_email(bytes).unwrap();
    assert!(doc.summary.html.is_none());
    assert_eq!(doc.summary.subject, "Plain");
    assert!(doc.summary.plain_text.contains("Hello"));
}

#[test]
fn attachment_names_are_not_paths() {
    assert_eq!(
        clean_attachment_name(Some("..\\..\\secret.txt")),
        ".._.._secret.txt"
    );
    assert_eq!(clean_attachment_name(Some("CON")), "attachment");
    assert_eq!(clean_attachment_name(None), "attachment");
}
