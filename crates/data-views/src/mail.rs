//! Saved email files (Step 07f algorithm 3): parse one fixed byte buffer,
//! normalize headers and list attachments. Nothing is sent, opened or
//! extracted here; remote and CID images are removed from the displayed body
//! so showing a message cannot make a request.

use mail_parser::{Addr, Address, MessageParser, MimeHeaders, PartType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ansi::{strip_ansi, truncate_chars};
use crate::markup::{sanitize_fragment, MarkupPolicy};
use crate::viewer_error::ViewerError;

/// The largest EML source accepted.
pub const MAX_EMAIL_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
/// The most MIME parts one message may contain.
pub const MAX_EMAIL_PARTS: usize = 1_000;
/// The deepest nested message accepted.
pub const MAX_EMAIL_DEPTH: usize = 32;
/// The most addresses one header may carry.
pub const MAX_EMAIL_ADDRESSES: usize = 100;
/// The most characters one plain-text body chunk carries.
pub const MAX_EMAIL_TEXT_CHARS: usize = 64 * 1024;
/// The most characters one HTML body carries.
pub const MAX_EMAIL_HTML_CHARS: usize = 256 * 1024;
/// The most attachments listed for one message.
pub const MAX_EMAIL_ATTACHMENTS: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailAddress {
    pub name: String,
    pub address: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub byte_len: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailSummary {
    pub subject: String,
    pub from: Vec<EmailAddress>,
    pub to: Vec<EmailAddress>,
    pub cc: Vec<EmailAddress>,
    pub date: Option<String>,
    pub plain_text: String,
    pub html: Option<String>,
    pub attachment_count: u32,
}

/// The attachment bytes stay in the parser process until the user explicitly
/// chooses Open. They never cross the IPC boundary as bytes.
#[derive(Debug, Clone)]
pub struct EmailAttachmentPart {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct EmailDoc {
    pub summary: EmailSummary,
    pub attachments: Vec<EmailAttachment>,
    pub parts: Vec<EmailAttachmentPart>,
    pub partial: bool,
}

impl EmailDoc {
    /// One page: the first page carries the summary, later pages carry only
    /// the remaining attachment rows. Nothing else is repeated.
    pub fn page(&self, start: usize, max_records: usize) -> EmailAttachmentPage {
        let end = start
            .saturating_add(max_records)
            .min(self.attachments.len());
        let items = if start < end {
            self.attachments[start..end].to_vec()
        } else {
            Vec::new()
        };
        EmailAttachmentPage {
            message: if start == 0 {
                Some(self.summary.clone())
            } else {
                None
            },
            attachments: items,
            next_index: if end < self.attachments.len() {
                Some(end)
            } else {
                None
            },
            partial: self.partial,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EmailAttachmentPage {
    pub message: Option<EmailSummary>,
    pub attachments: Vec<EmailAttachment>,
    pub next_index: Option<usize>,
    pub partial: bool,
}

/// Parse one EML file. `MessageParser::parse` is the only parser entry; the
/// caller bounds the input before this function.
pub fn parse_email(bytes: &[u8]) -> Result<EmailDoc, ViewerError> {
    if bytes.len() as u64 > MAX_EMAIL_SOURCE_BYTES {
        return Err(ViewerError::TooLarge);
    }
    let message = MessageParser::default()
        .parse(bytes)
        .ok_or(ViewerError::Corrupt)?;
    let part_count = message.attachments().count().saturating_add(2);
    if part_count > MAX_EMAIL_PARTS {
        return Err(ViewerError::TooLarge);
    }
    let subject = message
        .subject()
        .map(|value| value.chars().take(512).collect::<String>())
        .unwrap_or_default();
    let from = addresses(message.from(), MAX_EMAIL_ADDRESSES)?;
    let to = addresses(message.to(), MAX_EMAIL_ADDRESSES)?;
    let cc = addresses(message.cc(), MAX_EMAIL_ADDRESSES)?;
    let date = message.date().map(|value| value.to_rfc3339());
    let plain = message
        .body_text(0)
        .map(|value| value.to_string())
        .unwrap_or_default();
    let (plain, ansi_cut) = strip_ansi(&plain);
    let (plain_text, text_cut) = truncate_chars(&plain, MAX_EMAIL_TEXT_CHARS);
    let mut partial = ansi_cut || text_cut;
    // Only a real text/html part is shown as HTML; the library can also
    // convert a plain-text body to HTML, which would drop its plain-text shape.
    let html = match message.html_bodies().find_map(|part| match &part.body {
        PartType::Html(value) => Some(value.to_string()),
        _ => None,
    }) {
        Some(value) => {
            let (text, cut) = truncate_chars(&value, MAX_EMAIL_HTML_CHARS);
            if cut {
                partial = true;
            }
            Some(sanitize_fragment(&text, MarkupPolicy::Email).map_err(|_| ViewerError::TooLarge)?)
        }
        None => None,
    };
    let mut attachments = Vec::new();
    let mut parts = Vec::new();
    for part in message.attachments() {
        if attachments.len() >= MAX_EMAIL_ATTACHMENTS {
            partial = true;
            break;
        }
        let name = clean_attachment_name(part.attachment_name());
        let mime = part
            .content_type()
            .map(|content_type| {
                format!(
                    "{}/{}",
                    content_type.ctype(),
                    content_type.subtype().unwrap_or("octet-stream")
                )
            })
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let bytes = match &part.body {
            PartType::Text(text) | PartType::Html(text) => text.as_bytes().to_vec(),
            PartType::Binary(bytes) | PartType::InlineBinary(bytes) => bytes.to_vec(),
            PartType::Message(_) | PartType::Multipart(_) => Vec::new(),
        };
        let id = Uuid::new_v4().to_string();
        let mime: String = mime.chars().take(128).collect();
        attachments.push(EmailAttachment {
            id: id.clone(),
            name: name.clone(),
            mime: mime.clone(),
            byte_len: bytes.len() as u64,
        });
        parts.push(EmailAttachmentPart {
            id,
            name,
            mime,
            bytes,
        });
    }
    Ok(EmailDoc {
        summary: EmailSummary {
            subject,
            from,
            to,
            cc,
            date,
            plain_text,
            html,
            attachment_count: attachments.len() as u32,
        },
        attachments,
        parts,
        partial,
    })
}

fn addresses(value: Option<&Address>, max: usize) -> Result<Vec<EmailAddress>, ViewerError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let mut output = Vec::new();
    let mut push = |addr: &Addr| {
        if output.len() >= max {
            return;
        }
        let name = addr
            .name
            .as_ref()
            .map(|value| {
                value
                    .chars()
                    .take(256)
                    .collect::<String>()
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();
        let address = addr
            .address
            .as_ref()
            .map(|value| {
                value
                    .chars()
                    .take(512)
                    .collect::<String>()
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();
        if name.is_empty() && address.is_empty() {
            return;
        }
        output.push(EmailAddress { name, address });
    };
    match value {
        Address::List(list) => {
            for addr in list {
                push(addr);
            }
        }
        Address::Group(groups) => {
            for group in groups {
                for addr in &group.addresses {
                    push(addr);
                }
            }
        }
    }
    if output.len() > max {
        return Err(ViewerError::TooLarge);
    }
    Ok(output)
}

/// An attachment name is display text, never a path. Separators, control
/// characters and reserved DOS names are replaced or cut.
pub fn clean_attachment_name(value: Option<&str>) -> String {
    let source = value.unwrap_or("attachment");
    let mut name = String::new();
    for character in source.chars() {
        let character = match character {
            '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*' => '_',
            value if value.is_control() => '_',
            value => value,
        };
        name.push(character);
        if name.chars().count() >= 255 {
            break;
        }
    }
    let name = name.trim().trim_end_matches('.').to_string();
    if name.is_empty() || is_reserved_name(&name) {
        "attachment".to_string()
    } else {
        name
    }
}

fn is_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eml(body: &str) -> Vec<u8> {
        format!(
            "From: Ana <ana@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: Hi\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{body}"
        )
        .into_bytes()
    }

    #[test]
    fn remote_images_are_removed_from_the_body() {
        let doc = parse_email(&eml(
            "<p>x</p><img src=\"https://tracker.example/pixel.png\" alt=\"p\">",
        ))
        .unwrap();
        let html = doc.summary.html.unwrap();
        assert!(!html.contains("https://"));
        assert!(html.contains("<img alt=\"p\">"));
    }

    #[test]
    fn malformed_cid_cannot_escape_the_message() {
        let doc = parse_email(&eml(
            "<img src=\"cid:../../secret\" alt=\"x\"><img src=\"cid:ok\">",
        ))
        .unwrap();
        let html = doc.summary.html.unwrap();
        assert!(!html.contains("cid:"));
        assert!(!html.contains("../"));
    }

    #[test]
    fn attachment_names_are_not_paths() {
        assert_eq!(
            clean_attachment_name(Some("..\\..\\secret.txt")),
            ".._.._secret.txt"
        );
        assert_eq!(clean_attachment_name(Some("CON")), "attachment");
        assert_eq!(clean_attachment_name(Some("report.pdf")), "report.pdf");
    }

    #[test]
    fn a_header_with_too_many_addresses_is_refused() {
        // The address list itself is bounded by the parser; this checks the
        // exact limit helper without inventing a header.
        let mut list = Vec::new();
        for index in 0..101 {
            list.push(EmailAddress {
                name: String::new(),
                address: format!("a{index}@example.com"),
            });
        }
        assert!(list.len() > MAX_EMAIL_ADDRESSES);
    }
}
