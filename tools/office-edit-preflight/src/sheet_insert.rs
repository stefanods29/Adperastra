//! Insert a single literal cell without reserializing worksheet XML.
use crate::{
    sheet_view::{address, point},
    targets::{blocked_ranges, CellBounds},
    Result, SHEET,
};
use roxmltree::{Attribute, Node};
use std::ops::Range;

pub struct Insertion<'a, 'input> {
    data: Node<'a, 'input>,
    rows: Vec<(u32, Node<'a, 'input>)>,
    dimension: Option<(Attribute<'a, 'input>, CellBounds)>,
    blocked: Vec<CellBounds>,
}

impl<'a, 'input> Insertion<'a, 'input> {
    pub fn prepare(root: Node<'a, 'input>) -> Result<Self> {
        if !root.has_tag_name((SHEET, "worksheet"))
            || root
                .children()
                .any(|node| node.has_tag_name((SHEET, "sheetProtection")))
        {
            return Err("worksheet is protected or invalid".into());
        }
        let mut data_nodes = root
            .children()
            .filter(|node| node.has_tag_name((SHEET, "sheetData")));
        let data = data_nodes.next().ok_or("missing sheet data")?;
        if data_nodes.next().is_some() || data.lookup_namespace_uri(None) != Some(SHEET) {
            return Err("ambiguous sheet data".into());
        }
        let mut rows = Vec::<(u32, Node<'a, 'input>)>::new();
        for row in data.children().filter(Node::is_element) {
            if !row.has_tag_name((SHEET, "row")) || row.lookup_namespace_uri(None) != Some(SHEET) {
                return Err("unsupported worksheet row".into());
            }
            let index = row
                .attribute("r")
                .ok_or("missing row number")?
                .parse::<u32>()?;
            let index = index
                .checked_sub(1)
                .filter(|value| *value < 1_048_576)
                .ok_or("row outside worksheet")?;
            if rows.last().is_some_and(|(previous, _)| *previous >= index) {
                return Err("worksheet rows are not unique and ordered".into());
            }
            let mut previous = None;
            for cell in row.children().filter(Node::is_element) {
                if !cell.has_tag_name((SHEET, "c")) {
                    return Err("unsupported worksheet row content".into());
                }
                let (row, column) = point(cell.attribute("r").ok_or("missing cell address")?)
                    .ok_or("invalid cell address")?;
                if row != index || previous.is_some_and(|value| value >= column) {
                    return Err("worksheet cells are not unique and ordered".into());
                }
                previous = Some(column);
            }
            rows.push((index, row));
        }
        let mut dimensions = root
            .children()
            .filter(|node| node.has_tag_name((SHEET, "dimension")));
        let dimension = dimensions
            .next()
            .map(|node| {
                let attr = node
                    .attribute_node("ref")
                    .ok_or("missing worksheet dimension")?;
                Ok::<_, Box<dyn std::error::Error>>((attr, CellBounds::parse(attr.value())?))
            })
            .transpose()?;
        if dimensions.next().is_some() {
            return Err("duplicate worksheet dimension".into());
        }
        Ok(Self {
            data,
            rows,
            dimension,
            blocked: blocked_ranges(root)?,
        })
    }

    pub fn allows(&self, point: (u32, u32)) -> bool {
        !self.blocked.iter().any(|range| range.contains(point))
    }

    pub fn insert(self, xml: &str, target: &str, cell: &str) -> Result<String> {
        let (row, column) = point(target).ok_or("invalid cell address")?;
        if !self.allows((row, column)) {
            return Err("cell has validation or is merged".into());
        }
        let mut edits: Vec<(Range<usize>, String)> = Vec::new();
        match self.rows.binary_search_by_key(&row, |(index, _)| *index) {
            Ok(index) => {
                let node = self.rows[index].1;
                let next = node.children().filter(Node::is_element).find(|node| {
                    point(node.attribute("r").unwrap_or_default()).is_some_and(|(_, c)| c >= column)
                });
                if next.is_some_and(|node| node.attribute("r") == Some(target)) {
                    return Err("cell already exists".into());
                }
                edits.push(insert_child(xml, node, next, cell)?);
                if let Some(spans) = node.attribute_node("spans") {
                    // Spans are an optional optimization. A new column can
                    // invalidate the old hint without changing row formatting.
                    edits.push((spans.range(), String::new()));
                }
            }
            Err(index) => {
                let next = self.rows.get(index).map(|(_, node)| *node);
                let row_xml = format!("<row r=\"{}\">{cell}</row>", row + 1);
                edits.push(insert_child(xml, self.data, next, &row_xml)?);
            }
        }
        if let Some((attribute, bounds)) = self.dimension {
            if !bounds.contains((row, column)) {
                let first = address(bounds.first.0.min(row), bounds.first.1.min(column));
                let last = address(bounds.last.0.max(row), bounds.last.1.max(column));
                edits.push((attribute.range_value(), format!("{first}:{last}")));
            }
        }
        edits.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
        let mut updated = xml.to_owned();
        for (range, replacement) in edits {
            updated.replace_range(range, &replacement);
        }
        roxmltree::Document::parse(&updated)?;
        Ok(updated)
    }
}

fn insert_child(
    xml: &str,
    parent: Node<'_, '_>,
    before: Option<Node<'_, '_>>,
    child: &str,
) -> Result<(Range<usize>, String)> {
    if let Some(next) = before {
        let at = next.range().start;
        return Ok((at..at, child.into()));
    }
    let span = parent.range();
    let original = &xml[span.clone()];
    if original.ends_with("/>") {
        let tag = original[1..]
            .split(|c: char| c.is_ascii_whitespace() || c == '/')
            .next()
            .filter(|value| !value.is_empty())
            .ok_or("missing element name")?;
        return Ok((span.end - 2..span.end, format!(">{child}</{tag}>")));
    }
    let offset = original.rfind("</").ok_or("missing closing tag")?;
    let at = span.start + offset;
    Ok((at..at, child.into()))
}
