//! Read-only Office pages rendered by the verified Office pack and PDF helper.

use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;

use convert::ConversionInput;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::cache::CacheService;
use crate::engine_process::EngineHost;
use crate::engine_session_types::OfficeSessionRenderRequest;
use crate::engine_types::{
    EngineCapabilityId, EngineInput, OfficeFamily, OfficeFormat, OfficeRenderRequest,
    OfficeRenderTarget,
};
use crate::export_snapshots::ExportSnapshots;
use crate::jobs::JobContext;
use crate::office_pool::OfficeReadPool;
use crate::office_view_runtime::OfficeWork;
use crate::office_view_runtime_impl::OfficeAccuratePageSource;
use crate::office_view_types::{
    OfficePage, OfficeQuality, OfficeSection, OfficeSectionKind, OFFICE_MAX_PAGES,
};
use crate::pdf_sessions::PdfSessions;
use crate::pdf_types::{PdfRasterSpec, PdfRenderRequest, PdfRotation, PdfSourceIdentity};
use crate::webview_helper_types::{HelperInputGrant, HelperInputSource, MAX_MEMORY_SOURCE};

pub struct AccurateOfficeSource {
    app: AppHandle,
    pdf_id: Uuid,
    revision: u64,
    pub page_count: u32,
    pub engine_version: String,
    /// Section -> first PDF page and number of pages. Slides remain separate
    /// sections; the PDF's document page index never leaks into slide-local UI.
    sections: BTreeMap<String, (u32, u32)>,
    include_layout_text: bool,
}

fn page_sections(
    family: OfficeFamily,
    sections: &[OfficeSection],
    pages: u32,
) -> Result<BTreeMap<String, (u32, u32)>, String> {
    if !(1..=OFFICE_MAX_PAGES).contains(&pages) {
        return Err("office.engine_failed".into());
    }
    match family {
        OfficeFamily::Writer
            if sections.len() == 1 && sections[0].kind == OfficeSectionKind::Document =>
        {
            Ok(BTreeMap::from([(sections[0].id.clone(), (1, pages))]))
        }
        OfficeFamily::Impress if sections.len() == pages as usize => {
            let mut ordered: Vec<_> = sections.iter().collect();
            ordered.sort_by_key(|section| section.index);
            let mut map = BTreeMap::new();
            for (index, section) in ordered.into_iter().enumerate() {
                if section.kind != OfficeSectionKind::Slide
                    || section.index != index as u32
                    || map
                        .insert(section.id.clone(), (index as u32 + 1, 1))
                        .is_some()
                {
                    return Err("office.changed".into());
                }
            }
            Ok(map)
        }
        _ => Err("office.changed".into()),
    }
}

fn rendered_sections(
    family: OfficeFamily,
    sections: &[OfficeSection],
    pages: u32,
) -> Result<BTreeMap<String, (u32, u32)>, String> {
    // Print pagination does not identify worksheets. Likewise, a legacy
    // presentation may have no structural slide index. Keep the entire PDF
    // in order without attributing pages to unverified source sections.
    if !(1..=OFFICE_MAX_PAGES).contains(&pages) {
        return Err("office.engine_failed".into());
    }
    if family == OfficeFamily::Calc {
        return Ok(BTreeMap::from([("document".into(), (1, pages))]));
    }
    match page_sections(family, sections, pages) {
        Err(_) if family == OfficeFamily::Impress => {
            Ok(BTreeMap::from([("document".into(), (1, pages))]))
        }
        mapped => mapped,
    }
}

impl AccurateOfficeSource {
    pub fn update_sections(&self, sections: &mut Vec<OfficeSection>) {
        if self.sections.contains_key("document") {
            if let Some(section) = sections.iter_mut().find(|section| section.id == "document") {
                section.page_count = self.page_count;
            } else {
                *sections = vec![OfficeSection {
                    id: "document".into(),
                    name: String::new(),
                    kind: OfficeSectionKind::Document,
                    index: 0,
                    page_count: self.page_count,
                    rows: None,
                    columns: None,
                }];
            }
        }
    }

    pub fn open(
        input: &ConversionInput,
        format: OfficeFormat,
        sections: &[OfficeSection],
        work: &JobContext,
    ) -> Result<Option<Self>, String> {
        let app = work.app();
        let state = app.state::<crate::AppState>();
        let prefer_accurate = state
            .settings
            .lock()
            .map_err(|_| "office.engine_failed")?
            .office_view
            .prefer_accurate;
        let Some(host) = app.try_state::<Arc<EngineHost>>() else {
            return Ok(None);
        };
        if !prefer_accurate && !matches!(input, ConversionInput::Snapshot { .. }) {
            return Ok(None);
        }
        let bridge = format.family() == OfficeFamily::Writer
            && host.capability_verified(EngineCapabilityId::OfficeReadBridge);
        if !bridge && !host.capability_verified(EngineCapabilityId::OfficeConvert) {
            return Ok(None);
        }
        let cache = app.state::<Arc<CacheService>>();
        let snapshots = app.state::<Arc<ExportSnapshots>>();
        let authorized = EngineInput::resolve(0, input.clone(), cache.inner(), snapshots.inner())?;
        let revision = authorized.source_revision();
        let document_id = Uuid::new_v4().to_string();
        let mut rendered = if bridge {
            let pool = app.state::<Arc<OfficeReadPool>>();
            let document = pool.open(authorized, format, work)?;
            let rendered = pool.render(
                &OfficeSessionRenderRequest {
                    document_id: document.document_id,
                    target: OfficeRenderTarget::Pdf,
                    section_ids: vec!["document".into()],
                    ranges: vec![],
                    include_comments: false,
                    include_notes: false,
                },
                work,
            );
            if pool.close_document(document.document_id, work).is_err() {
                pool.close_document_detached(document.document_id);
            }
            rendered?
        } else {
            let (_, directory) = host.new_private_root("office-view")?;
            crate::office_render::render_office(
                host.inner(),
                &OfficeRenderRequest {
                    input: input.clone(),
                    format,
                    target: OfficeRenderTarget::Pdf,
                    include_comments: false,
                    include_notes: false,
                    ranges: vec![],
                },
                authorized,
                directory,
                work,
            )?
        };
        if rendered.source_revision != revision || rendered.artifacts.len() != 1 {
            return Err("office.changed".into());
        }
        let mut artifact = rendered.artifacts.remove(0);
        if artifact.section_id != "document"
            || artifact.format != OfficeRenderTarget::Pdf
            || !(1..=OFFICE_MAX_PAGES).contains(&artifact.page_count)
            || !(1..=MAX_MEMORY_SOURCE).contains(&artifact.output.byte_len)
        {
            return Err("office.engine_failed".into());
        }
        let file = artifact.output.owned_output.file_mut();
        file.seek(SeekFrom::Start(0))
            .map_err(|_| "office.engine_failed")?;
        let mut bytes = Zeroizing::new(Vec::new());
        file.take(artifact.output.byte_len + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "office.engine_failed")?;
        if bytes.len() as u64 != artifact.output.byte_len {
            return Err("office.changed".into());
        }
        let content_id = Uuid::new_v4();
        let section_map = rendered_sections(format.family(), sections, artifact.page_count)?;
        let grant = HelperInputGrant {
            grant_id: Uuid::new_v4(),
            name: "office-layout.pdf".into(),
            mime: "application/pdf".into(),
            source: HelperInputSource::Memory {
                data: Arc::new(bytes),
                document_id: document_id.clone(),
                revision,
                content_id,
                sensitive: false,
            },
        };
        let identity = PdfSourceIdentity::Snapshot {
            document_id,
            revision,
            content_id,
            sensitive: false,
        };
        let pdf = crate::pdf_jobs::open_granted(app, work.token(), (grant, identity, None), None)?;
        let source = Self {
            app: app.clone(),
            pdf_id: pdf.session_id,
            revision,
            page_count: pdf.page_count,
            engine_version: rendered.engine_version,
            sections: section_map,
            include_layout_text: matches!(input, ConversionInput::Snapshot { .. }),
        };
        if pdf.page_count != artifact.page_count {
            return Err("office.changed".into());
        }
        Ok(Some(source))
    }
}

impl OfficeAccuratePageSource for AccurateOfficeSource {
    fn text(
        &self,
        section: &str,
        page: u32,
        work: &dyn OfficeWork,
    ) -> Result<crate::office_view_types::OfficeLayoutText, String> {
        let &(first, count) = self.sections.get(section).ok_or("office.bad_request")?;
        if !self.include_layout_text || page == 0 || page > count {
            return Err("office.bad_request".into());
        }
        let context = work.job_context().ok_or("office.engine_failed")?;
        crate::office_layout_text::read(
            &self.app,
            context.token(),
            self.pdf_id,
            first + page - 1,
            28_800.0,
            28_800.0,
        )
    }
    fn page(
        &self,
        section_id: &str,
        page: u32,
        scale: f64,
        work: &dyn OfficeWork,
    ) -> Result<OfficePage, String> {
        let &(first, count) = self.sections.get(section_id).ok_or("office.bad_request")?;
        if page == 0 || page > count {
            return Err("office.bad_request".into());
        }
        let context = work.job_context().ok_or("office.engine_failed")?;
        let edge = if scale <= 0.5 {
            512
        } else if scale <= 1.0 {
            1024
        } else {
            2048
        };
        let image = crate::pdf_jobs::render_page(
            &self.app,
            context.token(),
            &PdfRenderRequest {
                session_id: self.pdf_id,
                page: first + page - 1,
                raster: PdfRasterSpec::Bucket { edge },
                rotation: PdfRotation::Deg0,
                request_revision: page,
            },
        )?;
        Ok(OfficePage {
            section_id: section_id.into(),
            page,
            image: image.image,
            width_pt: image.info.width_pt,
            height_pt: image.info.height_pt,
            quality: OfficeQuality::Accurate,
            source_revision: self.revision,
        })
    }

    fn close(&self) {
        let _ = self.app.state::<PdfSessions>().close(self.pdf_id);
    }
}

impl Drop for AccurateOfficeSource {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn section(id: &str, kind: OfficeSectionKind, index: u32) -> OfficeSection {
        OfficeSection {
            id: id.into(),
            name: String::new(),
            kind,
            index,
            page_count: 1,
            rows: None,
            columns: None,
        }
    }

    #[test]
    fn accurate_writer_keeps_every_pdf_page() {
        let map = page_sections(
            OfficeFamily::Writer,
            &[section("document", OfficeSectionKind::Document, 0)],
            15,
        )
        .unwrap();
        assert_eq!(map["document"], (1, 15));
    }

    #[test]
    fn accurate_slides_map_section_order_to_pdf_pages() {
        let map = page_sections(
            OfficeFamily::Impress,
            &[
                section("slide-2", OfficeSectionKind::Slide, 1),
                section("slide-1", OfficeSectionKind::Slide, 0),
            ],
            2,
        )
        .unwrap();
        assert_eq!(map["slide-1"], (1, 1));
        assert_eq!(map["slide-2"], (2, 1));
    }

    #[test]
    fn accurate_slides_refuse_missing_or_duplicate_pages() {
        let slides = [
            section("slide-1", OfficeSectionKind::Slide, 0),
            section("slide-2", OfficeSectionKind::Slide, 1),
        ];
        assert!(page_sections(OfficeFamily::Impress, &slides, 1).is_err());
        assert!(page_sections(OfficeFamily::Impress, &slides, 3).is_err());
        let duplicates = [slides[0].clone(), slides[0].clone()];
        assert!(page_sections(OfficeFamily::Impress, &duplicates, 2).is_err());
        assert!(page_sections(OfficeFamily::Writer, &[], 0).is_err());
    }

    #[test]
    fn printed_workbook_pages_do_not_inherit_worksheet_ids() {
        let sheets = [
            section("sheet:0", OfficeSectionKind::Sheet, 0),
            section("sheet:1", OfficeSectionKind::Sheet, 1),
        ];
        let map = rendered_sections(OfficeFamily::Calc, &sheets, 5).unwrap();
        assert_eq!(map, BTreeMap::from([("document".into(), (1, 5))]));
    }

    #[test]
    fn legacy_and_unmatched_slides_keep_all_rendered_pages() {
        let legacy = [section("document", OfficeSectionKind::Document, 0)];
        let slides = [section("slide:0", OfficeSectionKind::Slide, 0)];
        for sections in [&legacy, &slides] {
            let map = rendered_sections(OfficeFamily::Impress, sections, 3).unwrap();
            assert_eq!(map, BTreeMap::from([("document".into(), (1, 3))]));
        }
        assert!(rendered_sections(OfficeFamily::Calc, &[], 0).is_err());
    }
}
