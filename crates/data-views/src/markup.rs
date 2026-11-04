//! Bounded inert markup for the extra viewers (Step 07f D3, R-SEC-4).
//!
//! This is defense in depth, not the only gate: every displayed page is also
//! cleaned by DOMPurify and mounted in an iframe with `sandbox=""`. The rules
//! here are deliberately smaller than HTML: no scripts, styles, forms, links,
//! remote URLs, event handlers or embedded objects. Book resources may keep a
//! `book-resource:<id>` token; the UI replaces it only with a leased local URL.

use crate::viewer_error::ViewerError;

/// What a fragment belongs to. It changes only which local image tokens are
/// allowed; remote URLs are never allowed in any policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkupPolicy {
    Notebook,
    Email,
    Book,
}

const MAX_TAG_NAME: usize = 32;
const MAX_ATTRIBUTES: usize = 32;
const MAX_STACK: usize = 64;

const ALLOWED_TAGS: &[&str] = &[
    "p",
    "div",
    "span",
    "br",
    "hr",
    "pre",
    "code",
    "em",
    "strong",
    "b",
    "i",
    "u",
    "s",
    "sub",
    "sup",
    "ul",
    "ol",
    "li",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "dl",
    "dt",
    "dd",
];

const VOID_TAGS: &[&str] = &["br", "hr", "img"];

const SKIPPED_TAGS: &[&str] = &[
    "script", "style", "iframe", "object", "embed", "form", "input", "button", "link", "meta",
    "base", "video", "audio", "source", "svg", "math", "template", "noscript", "textarea",
    "select", "option",
];

/// Clean a bounded HTML fragment. The input and output are at most
/// `MAX_HTML_CHARS` characters (the callers enforce it before and after).
pub fn sanitize_fragment(input: &str, policy: MarkupPolicy) -> Result<String, ViewerError> {
    if input.chars().count() > crate::notebook::MAX_HTML_CHARS {
        return Err(ViewerError::TooLarge);
    }
    let mut output = String::with_capacity(input.len().min(256 * 1024));
    let mut stack: Vec<String> = Vec::new();
    let mut index = 0usize;
    let bytes = input.as_bytes();
    while index < bytes.len() {
        let Some(offset) = input[index..].find('<') else {
            output.push_str(&input[index..]);
            break;
        };
        let start = index + offset;
        output.push_str(&input[index..start]);
        let rest = &input[start..];
        if rest.starts_with("<!--") {
            let Some(end) = rest.find("-->") else { break };
            index = start + end + 3;
            continue;
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            let Some(end) = rest.find('>') else { break };
            index = start + end + 1;
            continue;
        }
        let Some((tag, consumed, closing, self_closing, attributes)) = parse_tag(rest) else {
            output.push_str("&lt;");
            index = start + 1;
            continue;
        };
        index = start + consumed;
        let name = tag.to_ascii_lowercase();
        if closing {
            if let Some(position) = stack.iter().rposition(|open| open == &name) {
                while stack.len() > position {
                    if let Some(open) = stack.pop() {
                        output.push_str("</");
                        output.push_str(&open);
                        output.push('>');
                    }
                }
            }
            continue;
        }
        if SKIPPED_TAGS.contains(&name.as_str()) {
            // Drop the whole element, not only its tag. A missing close tag
            // ends at the end of the fragment, which is also safe.
            if !VOID_TAGS.contains(&name.as_str()) {
                let close = format!("</{name}");
                if let Some(position) = rest.to_ascii_lowercase().find(&close) {
                    let after = &rest[position + close.len()..];
                    let skip = after.find('>').map(|end| end + 1).unwrap_or(after.len());
                    index = start + position + close.len() + skip;
                } else {
                    index = bytes.len();
                }
            }
            continue;
        }
        if !ALLOWED_TAGS.contains(&name.as_str()) {
            continue;
        }
        if stack.len() >= MAX_STACK && !VOID_TAGS.contains(&name.as_str()) {
            continue;
        }
        let filtered = filter_attributes(&name, &attributes, policy);
        output.push('<');
        output.push_str(&name);
        output.push_str(&filtered);
        if self_closing || VOID_TAGS.contains(&name.as_str()) {
            output.push('>');
            continue;
        }
        output.push('>');
        stack.push(name);
    }
    while let Some(open) = stack.pop() {
        output.push_str("</");
        output.push_str(&open);
        output.push('>');
    }
    if output.chars().count() > crate::notebook::MAX_HTML_CHARS {
        return Err(ViewerError::TooLarge);
    }
    Ok(output)
}

/// A parsed tag: lower-case name, bytes consumed including `>`, whether it
/// closes, whether it self-closes, and its raw attributes.
type ParsedTag = (String, usize, bool, bool, Vec<(String, Option<String>)>);

fn parse_tag(text: &str) -> Option<ParsedTag> {
    let bytes = text.as_bytes();
    let mut index = 1usize;
    let closing = bytes.get(index) == Some(&b'/');
    if closing {
        index += 1;
    }
    let name_start = index;
    while index < bytes.len()
        && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'-' || bytes[index] == b':')
    {
        index += 1;
    }
    if index == name_start || index - name_start > MAX_TAG_NAME {
        return None;
    }
    let name = text[name_start..index].to_string();
    let mut attributes = Vec::new();
    let mut self_closing = false;
    loop {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        if bytes[index] == b'>' {
            index += 1;
            break;
        }
        if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'>') {
            self_closing = true;
            index += 2;
            break;
        }
        let attr_start = index;
        while index < bytes.len()
            && !bytes[index].is_ascii_whitespace()
            && bytes[index] != b'='
            && bytes[index] != b'>'
            && bytes[index] != b'/'
        {
            index += 1;
        }
        if index == attr_start {
            index += 1;
            continue;
        }
        let name = text[attr_start..index].to_ascii_lowercase();
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let mut value = None;
        if bytes.get(index) == Some(&b'=') {
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            if let Some(quote) = bytes
                .get(index)
                .copied()
                .filter(|byte| *byte == b'"' || *byte == b'\'')
            {
                index += 1;
                let value_start = index;
                while index < bytes.len() && bytes[index] != quote {
                    index += 1;
                }
                value = Some(text[value_start..index].to_string());
                if index < bytes.len() {
                    index += 1;
                }
            } else {
                let value_start = index;
                while index < bytes.len()
                    && !bytes[index].is_ascii_whitespace()
                    && bytes[index] != b'>'
                {
                    index += 1;
                }
                value = Some(text[value_start..index].to_string());
            }
        }
        if attributes.len() < MAX_ATTRIBUTES {
            attributes.push((name, value));
        }
    }
    Some((name, index, closing, self_closing, attributes))
}

fn filter_attributes(
    tag: &str,
    attributes: &[(String, Option<String>)],
    policy: MarkupPolicy,
) -> String {
    let mut output = String::new();
    for (name, value) in attributes {
        if name.starts_with("on")
            || matches!(
                name.as_str(),
                "style"
                    | "srcset"
                    | "background"
                    | "formaction"
                    | "action"
                    | "method"
                    | "xlink:href"
                    | "href"
            )
        {
            continue;
        }
        match name.as_str() {
            "alt" | "title" => {
                if let Some(value) = value {
                    let value = truncate(value, 512);
                    output.push(' ');
                    output.push_str(name);
                    output.push_str("=\"");
                    output.push_str(&escape_attribute(&value));
                    output.push('"');
                }
            }
            "colspan" | "rowspan" => {
                if let Some(value) = value {
                    if let Ok(number) = value.parse::<u32>() {
                        output.push(' ');
                        output.push_str(name);
                        output.push_str("=\"");
                        output.push_str(&number.min(64).to_string());
                        output.push('"');
                    }
                }
            }
            "src" if tag == "img" => {
                let Some(value) = value else { continue };
                let allowed = match policy {
                    MarkupPolicy::Book => value.starts_with("book-resource:"),
                    MarkupPolicy::Email | MarkupPolicy::Notebook => false,
                };
                if allowed && value.len() <= 256 {
                    output.push_str(" src=\"");
                    output.push_str(&escape_attribute(value));
                    output.push('"');
                }
            }
            _ => {}
        }
    }
    output
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn escape_attribute(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '"' => output.push_str("&quot;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(character),
        }
    }
    output
}

/// Plain text of a fragment, for bounded find and page splitting. Entities
/// are left as text; the UI never executes this result.
pub fn fragment_text(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    for character in input.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
}

/// True when the fragment has no active content that this policy forbids.
/// Used by tests and by the book parser before it sends a page.
pub fn is_inert(input: &str, policy: MarkupPolicy) -> bool {
    if let Ok(clean) = sanitize_fragment(input, policy) {
        let lower = clean.to_ascii_lowercase();
        !lower.contains("<script")
            && !lower.contains("<style")
            && !lower.contains("<iframe")
            && !lower.contains("javascript:")
            && !lower.contains("http://")
            && !lower.contains("https://")
            && !clean.to_ascii_lowercase().contains(" on")
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_and_their_text_are_removed() {
        let clean = sanitize_fragment(
            "<p>ok</p><script>window.pwned=1</script><p>after</p>",
            MarkupPolicy::Notebook,
        )
        .unwrap();
        assert_eq!(clean, "<p>ok</p><p>after</p>");
        assert!(!clean.contains("pwned"));
    }

    #[test]
    fn remote_images_are_dropped_and_alt_kept() {
        let clean = sanitize_fragment(
            "<img src=\"https://tracker.example/x.png\" alt=\"logo\">",
            MarkupPolicy::Email,
        )
        .unwrap();
        assert_eq!(clean, "<img alt=\"logo\">");
    }

    #[test]
    fn event_handlers_and_styles_are_removed() {
        let clean = sanitize_fragment(
            "<div onclick=\"x()\" style=\"background:url(https://x)\">a</div>",
            MarkupPolicy::Email,
        )
        .unwrap();
        assert_eq!(clean, "<div>a</div>");
    }

    #[test]
    fn unbalanced_tags_are_closed() {
        let clean = sanitize_fragment("<b><i>x", MarkupPolicy::Notebook).unwrap();
        assert_eq!(clean, "<b><i>x</i></b>");
    }

    #[test]
    fn book_resources_keep_only_the_local_token() {
        let clean = sanitize_fragment(
            "<img src=\"book-resource:img-1\"><img src=\"../secret\">",
            MarkupPolicy::Book,
        )
        .unwrap();
        assert_eq!(clean, "<img src=\"book-resource:img-1\"><img>");
    }
}
