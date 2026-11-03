//! Production backend for the native extra-view helper (Step 07f T2/T4).
//! It owns one helper process per session, sends bounded JSON lines and turns
//! notebook image files into memory cache leases before they reach the UI.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::cache::CacheService;
use crate::extra_view_helper::{
    HelperImageFile, HelperNotebookCell, HelperNotebookOutput, HelperPage, HelperPayload,
    HelperReply, HELPER_FLAG, HELPER_MEMORY_LIMIT, OPEN_TIMEOUT_MILLIS, PAGE_TIMEOUT_MILLIS,
};
use crate::extra_view_sessions::{ExtraViewBackend, ExtraViewBackendFactory, ExtraViewSummary};
use crate::extra_view_types::{
    ExtraPageRequest, ExtraViewKind, ExtraViewPage, ExtraViewPayload, NotebookCell, NotebookOutput,
    SortDirectionWire,
};
use crate::helper::{HelperLine, HelperProcess};

/// One native parser session.
pub struct NativeHelperBackend {
    helper: HelperProcess,
    app: AppHandle,
    session_id: String,
    kind: ExtraViewKind,
    work_dir: PathBuf,
    leases: Vec<String>,
}

impl NativeHelperBackend {
    fn send(&mut self, value: &serde_json::Value) -> Result<(), String> {
        let text =
            serde_json::to_string(value).map_err(|_| "extra_view.bad_request".to_string())?;
        self.helper.send_line(&text)
    }

    fn receive(&mut self, timeout_millis: u64) -> Result<HelperReply, String> {
        match self.helper.recv(Duration::from_millis(timeout_millis)) {
            Some(HelperLine::Line(text)) => match serde_json::from_str(&text) {
                Ok(reply) => Ok(reply),
                Err(_) => {
                    self.helper.kill();
                    Err("extra_view.corrupt".to_string())
                }
            },
            Some(HelperLine::TooLong) => {
                self.helper.kill();
                Err("extra_view.too_large".to_string())
            }
            Some(HelperLine::Closed) => {
                self.helper.kill();
                Err("extra_view.unavailable".to_string())
            }
            None => {
                self.helper.kill();
                Err("extra_view.unavailable".to_string())
            }
        }
    }

    fn lease_image(&mut self, file: &HelperImageFile) -> Result<cache_store::CacheLease, String> {
        let path = Path::new(&file.path);
        if !path.starts_with(&self.work_dir) {
            return Err("extra_view.bad_request".to_string());
        }
        let metadata =
            std::fs::symlink_metadata(path).map_err(|_| "extra_view.unavailable".to_string())?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("extra_view.bad_request".to_string());
        }
        if metadata.len() > crate::extra_view_types::MAX_BOOK_IMAGE_DECODED_BYTES {
            return Err("extra_view.too_large".to_string());
        }
        let bytes = std::fs::read(path).map_err(|_| "extra_view.unavailable".to_string())?;
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string());
        let cache = self.app.state::<CacheService>();
        let lease = cache.lease_memory(
            Arc::new(Zeroizing::new(bytes)),
            &name,
            &file.mime,
            file.width,
            file.height,
            false,
        )?;
        let _ = std::fs::remove_file(path);
        self.leases.push(lease.lease_id.clone());
        Ok(lease)
    }

    fn convert_page(&mut self, page: HelperPage) -> Result<ExtraViewPage, String> {
        debug_assert_eq!(page.kind, self.kind);
        let payload = match page.payload {
            HelperPayload::Notebook { cells } => ExtraViewPayload::Notebook {
                cells: self.convert_cells(cells)?,
            },
            HelperPayload::Email {
                message,
                attachments,
            } => ExtraViewPayload::Email {
                message,
                attachments,
            },
            HelperPayload::Subtitle { cues } => ExtraViewPayload::Subtitle { cues },
            HelperPayload::Log { lines } => ExtraViewPayload::Log { lines },
            HelperPayload::Sqlite { table, rows } => ExtraViewPayload::Sqlite { table, rows },
        };
        Ok(ExtraViewPage {
            session_id: self.session_id.clone(),
            kind: self.kind,
            payload,
            next_cursor: page.next_cursor,
            complete: page.complete,
            partial: page.partial,
        })
    }

    fn convert_cells(
        &mut self,
        cells: Vec<HelperNotebookCell>,
    ) -> Result<Vec<NotebookCell>, String> {
        let mut output = Vec::with_capacity(cells.len());
        for cell in cells {
            let mut outputs = Vec::with_capacity(cell.outputs.len());
            for output in cell.outputs {
                outputs.push(self.convert_output(output)?);
            }
            output.push(NotebookCell {
                index: cell.index,
                kind: cell.kind,
                source: cell.source,
                language: cell.language,
                outputs,
                next_source_offset: cell.next_source_offset,
            });
        }
        Ok(output)
    }

    fn convert_output(&mut self, output: HelperNotebookOutput) -> Result<NotebookOutput, String> {
        let image = match output.image_file {
            Some(file) => Some(self.lease_image(&file)?),
            None => None,
        };
        Ok(NotebookOutput {
            kind: output.kind,
            text: output.text,
            image,
            html: output.html,
        })
    }
}

impl ExtraViewBackend for NativeHelperBackend {
    fn page(&mut self, request: &ExtraPageRequest) -> Result<ExtraViewPage, String> {
        let mut value = json!({
            "op": "page",
            "cursor": request.cursor.clone(),
        });
        if let Some(object) = value.as_object_mut() {
            object.insert("table".to_string(), json!(request.table.clone()));
            object.insert("section".to_string(), json!(request.section));
            object.insert("page".to_string(), json!(request.page));
            object.insert("sort_column".to_string(), json!(request.sort_column));
            object.insert(
                "sort_direction".to_string(),
                json!(request.sort_direction.map(sort_wire)),
            );
        }
        self.send(&value)?;
        match self.receive(PAGE_TIMEOUT_MILLIS)? {
            HelperReply::Page { page } => self.convert_page(page),
            HelperReply::Failed { code } => Err(code),
            _ => Err("extra_view.corrupt".to_string()),
        }
    }

    fn attachment(&mut self, attachment_id: &str) -> Result<PathBuf, String> {
        self.send(&json!({ "op": "attachment", "attachment_id": attachment_id }))?;
        match self.receive(PAGE_TIMEOUT_MILLIS)? {
            HelperReply::Attachment { path } => Ok(PathBuf::from(path)),
            HelperReply::Failed { code } => Err(code),
            _ => Err("extra_view.corrupt".to_string()),
        }
    }

    fn tables(&mut self) -> Result<Vec<crate::extra_view_types::SqliteTableInfo>, String> {
        self.send(&json!({ "op": "tables" }))?;
        match self.receive(PAGE_TIMEOUT_MILLIS)? {
            HelperReply::Tables { tables } => Ok(tables),
            HelperReply::Failed { code } => Err(code),
            _ => Err("extra_view.corrupt".to_string()),
        }
    }

    fn close(&mut self) {
        let _ = self.send(&json!({ "op": "close" }));
        let _ = self.receive(250);
        self.helper.kill();
        let cache = self.app.state::<CacheService>();
        for lease in self.leases.drain(..) {
            let _ = cache.release(&lease);
        }
    }
}

fn sort_wire(direction: SortDirectionWire) -> &'static str {
    match direction {
        SortDirectionWire::Asc => "asc",
        SortDirectionWire::Desc => "desc",
    }
}

/// Starts one helper process per open session.
pub struct NativeBackendFactory {
    pub app: AppHandle,
}

impl ExtraViewBackendFactory for NativeBackendFactory {
    fn open(
        &self,
        kind: ExtraViewKind,
        path: &Path,
        _stamp: &fs_service::SourceStamp,
        session_id: &str,
        work_dir: &Path,
    ) -> Result<(Box<dyn ExtraViewBackend>, ExtraViewSummary), String> {
        if kind == ExtraViewKind::Book {
            return Err("extra_view.unsupported".to_string());
        }
        let mut helper = HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT)?;
        let request = json!({
            "op": "open",
            "kind": kind_name(kind),
            "path": path.to_string_lossy(),
            "work_dir": work_dir.to_string_lossy(),
        });
        helper.send_line(&request.to_string())?;
        let reply = match helper.recv(Duration::from_millis(OPEN_TIMEOUT_MILLIS)) {
            Some(HelperLine::Line(text)) => serde_json::from_str::<HelperReply>(&text)
                .map_err(|_| "extra_view.corrupt".to_string())?,
            Some(HelperLine::TooLong) => return Err("extra_view.too_large".to_string()),
            Some(HelperLine::Closed) | None => {
                helper.kill();
                return Err("extra_view.unavailable".to_string());
            }
        };
        match reply {
            HelperReply::Opened {
                title,
                item_count,
                partial,
            } => Ok((
                Box::new(NativeHelperBackend {
                    helper,
                    app: self.app.clone(),
                    session_id: session_id.to_string(),
                    kind,
                    work_dir: work_dir.to_path_buf(),
                    leases: Vec::new(),
                }),
                ExtraViewSummary {
                    title,
                    item_count,
                    partial,
                },
            )),
            HelperReply::Failed { code } => {
                helper.kill();
                Err(code)
            }
            _ => {
                helper.kill();
                Err("extra_view.corrupt".to_string())
            }
        }
    }
}

fn kind_name(kind: ExtraViewKind) -> &'static str {
    match kind {
        ExtraViewKind::Book => "book",
        ExtraViewKind::Notebook => "notebook",
        ExtraViewKind::Email => "email",
        ExtraViewKind::Subtitle => "subtitle",
        ExtraViewKind::Log => "log",
        ExtraViewKind::Sqlite => "sqlite",
    }
}
