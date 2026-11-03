//! Bounded ANSI removal for notebook output and logs (Step 07f).
//!
//! Only escape sequences are removed; the visible text stays exactly as the
//! producer wrote it. An unterminated sequence ends at the 4 KiB span cap and
//! reports truncation instead of silently swallowing the rest of a line.

/// The longest escape sequence span kept before it counts as truncated.
pub const MAX_ANSI_ESCAPE_CHARS: usize = 4 * 1024;
/// The longest visible line one record carries.
pub const MAX_TEXT_LINE_CHARS: usize = 64 * 1024;

/// Remove CSI (`ESC [`) and OSC (`ESC ]`) sequences. The boolean says a
/// sequence was cut at the span cap or never terminated.
pub fn strip_ansi(input: &str) -> (String, bool) {
    let mut output = String::with_capacity(input.len());
    let mut truncated = false;
    let mut chars = input.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            let Some(next) = chars.next() else {
                truncated = true;
                break;
            };
            match next {
                '[' => {
                    let mut span = 0usize;
                    let mut ended = false;
                    for value in chars.by_ref() {
                        span += 1;
                        if (0x40..=0x7e).contains(&(value as u32)) {
                            ended = true;
                            break;
                        }
                        if span >= MAX_ANSI_ESCAPE_CHARS {
                            break;
                        }
                    }
                    if !ended {
                        truncated = true;
                        break;
                    }
                }
                ']' => {
                    let mut span = 0usize;
                    let mut ended = false;
                    // The loop also peeks and consumes the two-character
                    // string terminator, so it keeps the explicit `next()`.
                    #[allow(clippy::while_let_on_iterator)]
                    while let Some(value) = chars.next() {
                        span += 1;
                        if value == '\u{7}' {
                            ended = true;
                            break;
                        }
                        if value == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            ended = true;
                            break;
                        }
                        if span >= MAX_ANSI_ESCAPE_CHARS {
                            break;
                        }
                    }
                    if !ended {
                        truncated = true;
                        break;
                    }
                }
                other => {
                    // A two-byte escape such as `ESC ( B` starts with
                    // another punctuation byte; drop it and its parameter.
                    if other.is_ascii() {
                        continue;
                    }
                    output.push(other);
                }
            }
            continue;
        }
        output.push(character);
        if output.chars().count() >= MAX_TEXT_LINE_CHARS {
            truncated = true;
            break;
        }
    }
    (output, truncated)
}

/// Cut text at a scalar boundary and say whether anything was removed.
pub fn truncate_chars(input: &str, max: usize) -> (String, bool) {
    let mut output = String::with_capacity(input.len().min(max.saturating_mul(4)));
    for (count, character) in input.chars().enumerate() {
        if count >= max {
            return (output, true);
        }
        output.push(character);
    }
    (output, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_csi_colors() {
        let (text, cut) = strip_ansi("\u{1b}[31mred\u{1b}[0m");
        assert_eq!(text, "red");
        assert!(!cut);
    }

    #[test]
    fn strips_osc_title() {
        let (text, cut) = strip_ansi("\u{1b}]0;title\u{7}kept");
        assert_eq!(text, "kept");
        assert!(!cut);
    }

    #[test]
    fn an_unterminated_sequence_is_explicit() {
        let (text, cut) = strip_ansi("before\u{1b}[999");
        assert_eq!(text, "before");
        assert!(cut);
    }
}
