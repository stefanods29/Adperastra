//! The validated result of opening one Office source.

use std::sync::Arc;

use uuid::Uuid;

use crate::office_view_runtime::{OfficeDocumentLease, OfficeViewRuntime};
use crate::office_view_types::{OfficeSection, OfficeSession, OFFICE_MAX_SECTIONS};

pub struct OfficeOpenedDocument {
    pub session: OfficeSession,
    pub sections: Vec<OfficeSection>,
    pub source_revision: u64,
    pub source_content_id: Option<Uuid>,
    pub runtime: Arc<dyn OfficeViewRuntime>,
    pub lease: Arc<dyn OfficeDocumentLease>,
}

impl OfficeOpenedDocument {
    pub fn validate(&self) -> Result<(), String> {
        if !self.session.is_valid() {
            return Err("office.bad_request".to_string());
        }
        if self.session.source_revision != self.source_revision {
            return Err("office.changed".to_string());
        }
        if self.sections.is_empty() || self.sections.len() > OFFICE_MAX_SECTIONS {
            return Err("office.too_large".to_string());
        }
        if self.sections.len() != self.session.section_count as usize {
            return Err("office.bad_request".to_string());
        }
        let mut seen = std::collections::HashSet::new();
        for section in &self.sections {
            if !section.is_valid() || !seen.insert(section.id.clone()) {
                return Err("office.bad_request".to_string());
            }
        }
        Ok(())
    }
}

pub struct SectionCursor {
    pub session_id: Uuid,
    pub offset: usize,
}
