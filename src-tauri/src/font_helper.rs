//! The font helper (Step 06f): Adperastra.exe --font-helper reads one font
//! file in its own process (plan/rules.md R-SEC-9) and reports its names and
//! its characters. A damaged font can never take the app down.

use serde::{Deserialize, Serialize};
use std::io::{BufReader, Read, Write};
use std::path::Path;
use ttf_parser::{name_id, Face, Language};

use crate::helper::{read_capped_line, HelperLine};

/// The flag that turns this executable into the font helper.
pub const HELPER_FLAG: &str = "--font-helper";
/// How much memory the helper may use (a 256 MiB job object limit).
pub const HELPER_MEMORY_LIMIT: usize = 268_435_456;
/// The largest font file the helper reads.
pub const MAX_FONT_FILE: u64 = 67_108_864;
/// The longest name text that travels back.
pub const MAX_NAME_CHARS: usize = 2_000;
/// The most character ranges the map carries.
pub const MAX_RANGES: usize = 20_000;
/// The longest request line the helper accepts.
const MAX_REQUEST_LINE: usize = 1_048_576;

/// What the app asks the helper to do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperRequest {
    pub path: String,
}

/// Everything the sample sheet and the character map show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FontInfo {
    pub format: String,
    pub family: Option<String>,
    pub style: Option<String>,
    pub full_name: Option<String>,
    pub version: Option<String>,
    pub designer: Option<String>,
    pub copyright: Option<String>,
    pub license: Option<String>,
    pub glyphs: u32,
    pub weight: u16,
    pub italic: bool,
    pub monospaced: bool,
    pub faces: u32,
    /// Inclusive code point ranges, sorted.
    pub ranges: Vec<[u32; 2]>,
    pub ranges_cut: bool,
    pub code_points: u32,
}

/// What the helper tells the app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HelperMessage {
    Info { info: Box<FontInfo> },
    Failed { code: String },
}

/// Entry point of the helper process; returns its exit code.
pub fn run_helper() -> i32 {
    let mut input = BufReader::new(std::io::stdin());
    let request: HelperRequest = match read_capped_line(&mut input, MAX_REQUEST_LINE) {
        HelperLine::Line(line) => match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(_) => {
                return send(&HelperMessage::Failed {
                    code: "font.bad_request".to_string(),
                })
            }
        },
        _ => {
            return send(&HelperMessage::Failed {
                code: "font.bad_request".to_string(),
            })
        }
    };
    let message = match read_font_file(&request.path) {
        Ok(info) => HelperMessage::Info {
            info: Box::new(info),
        },
        Err(code) => HelperMessage::Failed { code },
    };
    send(&message)
}

fn send(message: &HelperMessage) -> i32 {
    let Ok(line) = serde_json::to_string(message) else {
        return 1;
    };
    let mut output = std::io::stdout();
    let written = output
        .write_all(line.as_bytes())
        .and_then(|()| output.write_all(b"\n"))
        .and_then(|()| output.flush());
    if written.is_err() {
        return 1;
    }
    0
}

/// Validate an Install click's path: a font file Windows can install.
pub fn validate_install_path(path: &str) -> Result<(), String> {
    crate::validate_absolute_path(path).map_err(|_| "font.bad_request".to_string())?;
    let extension = Path::new(path)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if matches!(extension.as_str(), "ttf" | "otf" | "ttc") {
        Ok(())
    } else {
        Err("font.bad_request".to_string())
    }
}

fn read_font_file(path: &str) -> Result<FontInfo, String> {
    crate::validate_absolute_path(path).map_err(|_| "font.bad_request".to_string())?;
    let metadata = std::fs::metadata(path).map_err(|_| "font.unreadable".to_string())?;
    if metadata.len() > MAX_FONT_FILE {
        return Err("font.unreadable".to_string());
    }
    let file = std::fs::File::open(path).map_err(|_| "font.unreadable".to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_FONT_FILE.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "font.unreadable".to_string())?;
    if bytes.len() as u64 > MAX_FONT_FILE {
        return Err("font.unreadable".to_string());
    }
    read_font(&bytes)
}

fn empty_info(format: &str) -> FontInfo {
    FontInfo {
        format: format.to_string(),
        family: None,
        style: None,
        full_name: None,
        version: None,
        designer: None,
        copyright: None,
        license: None,
        glyphs: 0,
        weight: 400,
        italic: false,
        monospaced: false,
        faces: 1,
        ranges: Vec::new(),
        ranges_cut: false,
        code_points: 0,
    }
}

/// Read font details from the file's bytes. WOFF fonts give only their format
/// (their tables are compressed); a collection shows its first face.
pub fn read_font(bytes: &[u8]) -> Result<FontInfo, String> {
    if bytes.starts_with(b"wOFF") {
        return Ok(empty_info("woff"));
    }
    if bytes.starts_with(b"wOF2") {
        return Ok(empty_info("woff2"));
    }
    if bytes.starts_with(b"ttcf") {
        let faces = ttf_parser::fonts_in_collection(bytes).unwrap_or(1);
        let face = Face::parse(bytes, 0).map_err(|_| "font.unreadable".to_string())?;
        let mut info = info_from_face(&face, "ttc")?;
        info.faces = faces;
        return Ok(info);
    }
    let format = if bytes.starts_with(b"OTTO") {
        "otf"
    } else {
        "ttf"
    };
    let face = Face::parse(bytes, 0).map_err(|_| "font.unreadable".to_string())?;
    info_from_face(&face, format)
}

fn info_from_face(face: &Face<'_>, format: &str) -> Result<FontInfo, String> {
    let (ranges, ranges_cut, code_points) = merge_code_points(face);
    Ok(FontInfo {
        format: format.to_string(),
        family: pick_name(face, &[name_id::TYPOGRAPHIC_FAMILY, name_id::FAMILY]),
        style: pick_name(face, &[name_id::SUBFAMILY]),
        full_name: pick_name(face, &[name_id::FULL_NAME]),
        version: pick_name(face, &[name_id::VERSION]),
        designer: pick_name(face, &[name_id::DESIGNER]),
        copyright: pick_name(face, &[name_id::COPYRIGHT_NOTICE]),
        license: pick_name(face, &[name_id::LICENSE]),
        glyphs: u32::from(face.number_of_glyphs()),
        weight: face.weight().to_number(),
        italic: face.is_italic(),
        monospaced: face.is_monospaced(),
        faces: 1,
        ranges,
        ranges_cut,
        code_points,
    })
}

/// The English (United States) name when there is one, else the first
/// Unicode name, for the first name ID that has one.
fn pick_name(face: &Face<'_>, ids: &[u16]) -> Option<String> {
    for wanted in ids {
        let mut first: Option<String> = None;
        let mut english: Option<String> = None;
        for name in face.names() {
            if !name.is_unicode() || name.name_id != *wanted {
                continue;
            }
            let Some(text) = name.to_string() else {
                continue;
            };
            let text = cut_name(&text);
            if name.language() == Language::English_UnitedStates {
                english = Some(text.clone());
            }
            if first.is_none() {
                first = Some(text);
            }
        }
        if let Some(text) = english.or(first) {
            return Some(text);
        }
    }
    None
}

fn cut_name(text: &str) -> String {
    if text.chars().count() <= MAX_NAME_CHARS {
        return text.to_string();
    }
    text.chars().take(MAX_NAME_CHARS).collect()
}

/// Every Unicode character the font maps, without controls and surrogates,
/// joined into runs.
fn merge_code_points(face: &Face<'_>) -> (Vec<[u32; 2]>, bool, u32) {
    let mut points: Vec<u32> = Vec::new();
    if let Some(cmap) = face.tables().cmap {
        for subtable in cmap.subtables {
            if !subtable.is_unicode() {
                continue;
            }
            subtable.codepoints(|code| points.push(code));
        }
    }
    points.retain(|code| {
        !(*code <= 31 || (127..=159).contains(code) || (0xD800..=0xDFFF).contains(code))
            && *code <= 0x10FFFF
    });
    points.sort_unstable();
    points.dedup();
    let code_points = u32::try_from(points.len()).unwrap_or(u32::MAX);
    let mut ranges: Vec<[u32; 2]> = Vec::new();
    for code in &points {
        if let Some(last) = ranges.last_mut() {
            if last[1].saturating_add(1) == *code {
                last[1] = *code;
                continue;
            }
        }
        ranges.push([*code, *code]);
    }
    let ranges_cut = ranges.len() > MAX_RANGES;
    if ranges_cut {
        ranges.truncate(MAX_RANGES);
    }
    (ranges, ranges_cut, code_points)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_u16(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_be_bytes());
    }

    fn push_u32(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_be_bytes());
    }

    fn push_i16(out: &mut Vec<u8>, value: i16) {
        out.extend_from_slice(&value.to_be_bytes());
    }

    fn build_name_table(names: &[(u16, &str)]) -> Vec<u8> {
        let mut records = Vec::new();
        let mut strings = Vec::new();
        for (name, text) in names {
            let encoded: Vec<u8> = text
                .encode_utf16()
                .flat_map(|unit| unit.to_be_bytes())
                .collect();
            push_u16(&mut records, 3);
            push_u16(&mut records, 1);
            push_u16(&mut records, 0x0409);
            push_u16(&mut records, *name);
            push_u16(&mut records, encoded.len() as u16);
            push_u16(&mut records, strings.len() as u16);
            strings.extend_from_slice(&encoded);
        }
        let mut out = Vec::new();
        push_u16(&mut out, 0);
        push_u16(&mut out, names.len() as u16);
        push_u16(&mut out, 6 + 12 * names.len() as u16);
        out.extend_from_slice(&records);
        out.extend_from_slice(&strings);
        out
    }

    fn build_cmap(code_points: &[u32]) -> Vec<u8> {
        let mut points = code_points.to_vec();
        points.sort_unstable();
        points.dedup();
        let mut groups: Vec<(u32, u32)> = Vec::new();
        for code in points {
            if let Some(last) = groups.last_mut() {
                if last.1 + 1 == code {
                    last.1 = code;
                    continue;
                }
            }
            groups.push((code, code));
        }
        let mut subtable = Vec::new();
        push_u16(&mut subtable, 12);
        push_u16(&mut subtable, 0);
        push_u32(&mut subtable, 16 + 12 * groups.len() as u32);
        push_u32(&mut subtable, 0);
        push_u32(&mut subtable, groups.len() as u32);
        for (start, end) in &groups {
            push_u32(&mut subtable, *start);
            push_u32(&mut subtable, *end);
            push_u32(&mut subtable, 1);
        }
        let mut out = Vec::new();
        push_u16(&mut out, 0);
        push_u16(&mut out, 1);
        push_u16(&mut out, 3);
        push_u16(&mut out, 10);
        push_u32(&mut out, 12);
        out.extend_from_slice(&subtable);
        out
    }

    fn build_sfnt(tables: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let count = tables.len() as u16;
        let power = count.ilog2() as u16;
        let mut header = Vec::new();
        push_u32(&mut header, 0x0001_0000);
        push_u16(&mut header, count);
        push_u16(&mut header, 16 * (1u16 << power));
        push_u16(&mut header, power);
        push_u16(&mut header, 16 * count - 16 * (1u16 << power));
        let mut offset = 12 + 16 * tables.len() as u32;
        let mut records = Vec::new();
        let mut body = Vec::new();
        for (tag, data) in tables {
            records.extend_from_slice(*tag);
            push_u32(&mut records, 0);
            push_u32(&mut records, offset);
            push_u32(&mut records, data.len() as u32);
            body.extend_from_slice(data);
            let padding = (4 - data.len() % 4) % 4;
            body.extend(std::iter::repeat_n(0u8, padding));
            offset += (data.len() + padding) as u32;
        }
        let mut out = header;
        out.extend_from_slice(&records);
        out.extend_from_slice(&body);
        out
    }

    /// A valid TrueType font with one glyph and the given names and
    /// characters.
    fn minimal_font(names: &[(u16, &str)], code_points: &[u32]) -> Vec<u8> {
        let mut head = Vec::new();
        push_u32(&mut head, 0x0001_0000);
        push_u32(&mut head, 0x0001_0000);
        push_u32(&mut head, 0);
        push_u32(&mut head, 0x5F0F_3CF5);
        push_u16(&mut head, 0);
        push_u16(&mut head, 1000);
        head.extend_from_slice(&0i64.to_be_bytes());
        head.extend_from_slice(&0i64.to_be_bytes());
        for _ in 0..4 {
            push_i16(&mut head, 0);
        }
        push_u16(&mut head, 0);
        push_u16(&mut head, 8);
        push_i16(&mut head, 2);
        push_i16(&mut head, 0);
        push_i16(&mut head, 0);
        assert_eq!(head.len(), 54);
        let mut hhea = Vec::new();
        push_u32(&mut hhea, 0x0001_0000);
        push_i16(&mut hhea, 800);
        push_i16(&mut hhea, -200);
        push_i16(&mut hhea, 0);
        push_u16(&mut hhea, 500);
        for _ in 0..3 {
            push_i16(&mut hhea, 0);
        }
        push_i16(&mut hhea, 1);
        push_i16(&mut hhea, 0);
        push_i16(&mut hhea, 0);
        for _ in 0..4 {
            push_i16(&mut hhea, 0);
        }
        push_i16(&mut hhea, 0);
        push_u16(&mut hhea, 1);
        assert_eq!(hhea.len(), 36);
        let mut maxp = Vec::new();
        push_u32(&mut maxp, 0x0000_5000);
        push_u16(&mut maxp, 1);
        let mut hmtx = Vec::new();
        push_u16(&mut hmtx, 500);
        push_i16(&mut hmtx, 0);
        build_sfnt(&[
            (b"head", head),
            (b"hhea", hhea),
            (b"maxp", maxp),
            (b"hmtx", hmtx),
            (b"name", build_name_table(names)),
            (b"cmap", build_cmap(code_points)),
        ])
    }

    #[test]
    fn merges_runs_and_drops_controls() {
        let font = minimal_font(&[], &[160, 10, 65, 66, 67, 70, 0xD800]);
        let info = read_font(&font).unwrap();
        assert_eq!(info.ranges, vec![[65, 67], [70, 70], [160, 160]]);
        assert_eq!(info.code_points, 5);
    }

    #[test]
    fn reads_names_and_ranges() {
        let font = minimal_font(&[(name_id::FAMILY, "Sample")], &[65, 66, 67]);
        let info = read_font(&font).unwrap();
        assert_eq!(info.format, "ttf");
        assert_eq!(info.family.as_deref(), Some("Sample"));
        assert_eq!(info.ranges, vec![[65, 67]]);
        assert_eq!(info.glyphs, 1);
    }

    #[test]
    fn garbage_is_refused() {
        assert_eq!(
            read_font(&[1, 2, 3, 4]).unwrap_err(),
            "font.unreadable".to_string()
        );
    }

    #[test]
    fn woff_gives_no_names() {
        let mut bytes = b"wOFF".to_vec();
        bytes.extend(std::iter::repeat_n(0u8, 32));
        let info = read_font(&bytes).unwrap();
        assert_eq!(info.format, "woff");
        assert!(info.family.is_none());
        assert!(info.ranges.is_empty());
    }

    #[test]
    fn old_helper_message_shape() {
        let font = minimal_font(&[(name_id::FAMILY, "Sample")], &[65]);
        let info = read_font(&font).unwrap();
        let line = serde_json::to_string(&HelperMessage::Info {
            info: Box::new(info.clone()),
        })
        .unwrap();
        let back: HelperMessage = serde_json::from_str(&line).unwrap();
        assert_eq!(
            back,
            HelperMessage::Info {
                info: Box::new(info)
            }
        );
    }

    #[test]
    fn install_refuses_other_types() {
        assert_eq!(
            validate_install_path("C:\\a.exe").unwrap_err(),
            "font.bad_request".to_string()
        );
    }
}
