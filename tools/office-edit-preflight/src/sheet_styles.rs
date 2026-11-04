//! Read style records as bounded typed display data; leave package bytes alone.
use crate::{Result, SHEET};
use roxmltree::Document;
use serde_json::{json, Value};

pub struct Styles(Vec<Value>);

fn color(node: roxmltree::Node<'_, '_>) -> Option<Value> {
    let rgb = node.attribute("rgb")?;
    if !matches!(rgb.len(), 6 | 8) || !rgb.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let rgba = u32::from_str_radix(rgb, 16).ok()?;
    Some(
        json!({"r":(rgba>>16)&255,"g":(rgba>>8)&255,"b":rgba&255,"a":if rgb.len()==8{(rgba>>24)&255}else{255}}),
    )
}

impl Styles {
    pub fn read(bytes: &[u8]) -> Result<Self> {
        let source = match crate::sheet_view::xml(bytes, "xl/styles.xml") {
            Ok(source) => source,
            Err(_) => return Ok(Self(vec![])),
        };
        let doc = Document::parse(&source)?;
        let root = doc.root_element();
        let group = |name| root.children().find(|n| n.has_tag_name((SHEET, name)));
        let fonts: Vec<_> = group("fonts")
            .into_iter()
            .flat_map(|n| n.children())
            .filter(|n| n.has_tag_name((SHEET, "font")))
            .collect();
        let fills: Vec<_> = group("fills")
            .into_iter()
            .flat_map(|n| n.children())
            .filter(|n| n.has_tag_name((SHEET, "fill")))
            .collect();
        let custom: std::collections::HashMap<_, _> = group("numFmts")
            .into_iter()
            .flat_map(|n| n.children())
            .filter_map(|n| {
                Some((
                    n.attribute("numFmtId")?.parse::<u32>().ok()?,
                    n.attribute("formatCode")?,
                ))
            })
            .collect();
        let mut styles = Vec::new();
        for xf in group("cellXfs")
            .into_iter()
            .flat_map(|n| n.children())
            .filter(|n| n.has_tag_name((SHEET, "xf")))
        {
            if styles.len() >= 4096 {
                return Err("style limit".into());
            }
            let mut format = json!({});
            let mut text = json!({});
            if let Some(font) = xf
                .attribute("fontId")
                .and_then(|n| n.parse::<usize>().ok())
                .and_then(|n| fonts.get(n))
            {
                for (element, key) in [("b", "bold"), ("i", "italic"), ("strike", "strike")] {
                    if let Some(node) = font.children().find(|n| n.has_tag_name((SHEET, element))) {
                        text[key] = json!(!matches!(node.attribute("val"), Some("0" | "false")));
                    }
                }
                if let Some(node) = font.children().find(|n| n.has_tag_name((SHEET, "sz"))) {
                    if let Some(size) = node
                        .attribute("val")
                        .and_then(|s| s.parse::<f64>().ok())
                        .filter(|n| n.is_finite() && (1.0..=400.0).contains(n))
                    {
                        text["size_pt"] = json!(size);
                    }
                }
                if let Some(name) = font
                    .children()
                    .find(|n| n.has_tag_name((SHEET, "name")))
                    .and_then(|n| n.attribute("val"))
                    .filter(|s| {
                        !s.is_empty()
                            && s.chars().count() <= 128
                            && !s.chars().any(char::is_control)
                    })
                {
                    text["font"] = json!({"family":name,"source":"document","embeddable":false});
                }
                if let Some(value) = font
                    .children()
                    .find(|n| n.has_tag_name((SHEET, "color")))
                    .and_then(color)
                {
                    text["foreground"] = value;
                }
            }
            if text.as_object().is_some_and(|v| !v.is_empty()) {
                format["text"] = text;
            }
            if let Some(fill) = xf
                .attribute("fillId")
                .and_then(|n| n.parse::<usize>().ok())
                .and_then(|n| fills.get(n))
            {
                if let Some(pattern) = fill.children().find(|n| {
                    n.has_tag_name((SHEET, "patternFill"))
                        && n.attribute("patternType") == Some("solid")
                }) {
                    if let Some(value) = pattern
                        .children()
                        .find(|n| n.has_tag_name((SHEET, "fgColor")))
                        .and_then(color)
                    {
                        format["fill"] = value;
                    }
                }
            }
            if let Some(alignment) = xf.children().find(|n| n.has_tag_name((SHEET, "alignment"))) {
                if let Some(horizontal) = alignment
                    .attribute("horizontal")
                    .filter(|s| ["left", "center", "right"].contains(s))
                {
                    format["horizontal"] = json!(horizontal);
                }
                if alignment.attribute("wrapText") == Some("1") {
                    format["wrap"] = json!(true);
                }
            }
            if let Some(code) = xf
                .attribute("numFmtId")
                .and_then(|n| n.parse::<u32>().ok())
                .and_then(|id| custom.get(&id))
                .filter(|s| s.len() <= 256)
            {
                format["number_format"] = json!(code);
            }
            styles.push(format);
        }
        Ok(Self(styles))
    }
    pub fn cell(&self, index: usize) -> Result<Value> {
        if self.0.is_empty() && index == 0 {
            Ok(json!({}))
        } else {
            self.0
                .get(index)
                .cloned()
                .ok_or_else(|| "unknown cell style".into())
        }
    }
}
