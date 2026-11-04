//! Fixed read-only policy and 12b section conversion.
#![allow(dead_code)]


use crate::engine_session_types::EngineReadSection;
use crate::office_view_types::{OfficeSection, OfficeSectionKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OfficeReadPolicy {
    pub hidden: bool,
    pub read_only: bool,
    pub macro_execution_mode: i16,
    pub update_doc_mode: i16,
    pub external_join_allowed: bool,
}

pub const OFFICE_READ_POLICY: OfficeReadPolicy = OfficeReadPolicy {
    hidden: true,
    read_only: true,
    macro_execution_mode: 0,
    update_doc_mode: 0,
    external_join_allowed: false,
};

pub fn section_from_engine(section: &EngineReadSection) -> Result<OfficeSection, String> {
    let kind_name = serde_json::to_value(section.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| "office.bad_request".to_string())?;
    let kind = match kind_name.as_str() {
        "document" => OfficeSectionKind::Document,
        "sheet" => OfficeSectionKind::Sheet,
        "slide" => OfficeSectionKind::Slide,
        _ => return Err("office.bad_request".to_string()),
    };
    let result = OfficeSection {
        id: section.id.clone(),
        name: section.name.chars().take(255).collect(),
        kind,
        index: section.index,
        page_count: section.page_count,
        rows: None,
        columns: None,
    };
    if result.is_valid() {
        Ok(result)
    } else {
        Err("office.bad_request".to_string())
    }
}
