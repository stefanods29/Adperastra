//! The native extra-view helper (Step 07f D4): `Adperastra.exe
//! --extra-viewer-helper` parses notebooks, EML, subtitles, logs and SQLite
//! in its own process with a 512 MiB job limit. The app sends one JSON line
//! and receives one bounded JSON line per request; no file bytes cross this
//! line protocol.

use std::collections::HashMap;
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use data_views::log::{LogRecord, LogScanner};
use data_views::mail::{EmailAttachment, EmailDoc, EmailSummary};
use data_views::notebook::{
    NotebookCellKind, NotebookDoc, NotebookImage, NotebookOutputKind, NotebookParsedCell,
    NotebookParsedOutput,
};
use data_views::sqlite::{SqliteReader, SqliteSort, SqliteTableInfo};
use data_views::subtitle::{SubtitleCue, SubtitleDoc};
use data_views::viewer_error::ViewerError;
use fs_service::owned_io::{OwnedOutput, PinnedDirectory};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::extra_view_types::{
    ExtraViewKind, SortDirectionWire, MAX_EMAIL_SOURCE_BYTES, MAX_LOG_INITIAL_BYTES,
    MAX_LOG_LINES_PER_BLOCK, MAX_LOG_SOURCE_BYTES, MAX_NOTEBOOK_SOURCE_BYTES, MAX_PAGE_RECORDS,
    MAX_SQLITE_ROWS_PER_PAGE, MAX_SQLITE_SOURCE_BYTES, MAX_SUBTITLE_SOURCE_BYTES,
};
use crate::helper::{read_capped_line, HelperLine};

/// The flag that turns this executable into the extra-view helper.
pub const HELPER_FLAG: &str = "--extra-viewer-helper";
/// The job object limit for this helper.
pub const HELPER_MEMORY_LIMIT: usize = 512 * 1024 * 1024;
/// The longest request line.
pub const MAX_REQUEST_LINE: usize = 1024 * 1024;
/// How long one open may take before the parent kills the helper.
pub const OPEN_TIMEOUT_MILLIS: u64 = 15_000;
/// How long one page may take.
pub const PAGE_TIMEOUT_MILLIS: u64 = 5_000;
/// The most cursors one helper keeps.
pub const MAX_CURSORS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum HelperRequest {
    Open {
        kind: String,
        path: String,
        work_dir: String,
    },
    Page {
        cursor: Option<String>,
        table: Option<String>,
        section: Option<u32>,
        page: Option<u32>,
        sort_column: Option<u32>,
        sort_direction: Option<SortDirectionWire>,
    },
    Attachment {
        attachment_id: String,
    },
    /// The bounded physical-table list of a SQLite session. This is an
    /// additive companion to E3 needed by the handler's table picker; it is
    /// also coordinator-proposed in the handoff.
    Tables,
    Close,
}

// One reply is built, framed and dropped per request; the page variant is the
// largest so it can carry a fully bounded 768 KiB page. Boxing it would add an
// allocation to every page without changing the wire shape.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum HelperReply {
    Opened {
        title: String,
        item_count: u32,
        partial: bool,
    },
    Page {
        page: HelperPage,
    },
    Attachment {
        path: String,
    },
    Tables {
        tables: Vec<SqliteTableInfo>,
    },
    Closed,
    Failed {
        code: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HelperPage {
    pub(crate) kind: ExtraViewKind,
    pub(crate) payload: HelperPayload,
    pub(crate) next_cursor: Option<String>,
    pub(crate) complete: bool,
    pub(crate) partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum HelperPayload {
    Notebook {
        cells: Vec<HelperNotebookCell>,
    },
    Email {
        message: Option<EmailSummary>,
        attachments: Vec<EmailAttachment>,
    },
    Subtitle {
        cues: Vec<SubtitleCue>,
    },
    Log {
        lines: Vec<LogRecord>,
    },
    Sqlite {
        table: SqliteTableInfo,
        rows: Vec<data_views::sqlite::SqliteRow>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HelperNotebookCell {
    pub(crate) index: u32,
    pub(crate) kind: NotebookCellKind,
    pub(crate) source: String,
    pub(crate) language: String,
    pub(crate) outputs: Vec<HelperNotebookOutput>,
    pub(crate) next_source_offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HelperNotebookOutput {
    pub(crate) kind: NotebookOutputKind,
    pub(crate) text: Option<String>,
    pub(crate) html: Option<String>,
    pub(crate) image_file: Option<HelperImageFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HelperImageFile {
    pub(crate) path: String,
    pub(crate) mime: String,
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
}

enum HelperState {
    Notebook {
        doc: NotebookDoc,
        work_dir: PathBuf,
    },
    Email {
        doc: EmailDoc,
        work_dir: PathBuf,
    },
    Subtitle {
        doc: SubtitleDoc,
    },
    Log {
        scanner: LogScanner,
        file: std::fs::File,
        path: PathBuf,
    },
    Sqlite {
        reader: SqliteReader,
    },
}

struct CursorState {
    kind: CursorKind,
    last_used: u64,
}

#[derive(Clone)]
enum CursorKind {
    Notebook {
        next: usize,
    },
    Email {
        next: usize,
    },
    Subtitle {
        next: usize,
    },
    Log,
    Sqlite {
        table: String,
        offset: usize,
        sort_column: Option<usize>,
        sort: SqliteSort,
    },
}

struct Helper {
    kind: Option<ExtraViewKind>,
    state: Option<HelperState>,
    cursors: HashMap<Uuid, CursorState>,
    clock: u64,
}

impl Helper {
    fn new() -> Self {
        Self {
            kind: None,
            state: None,
            cursors: HashMap::new(),
            clock: 0,
        }
    }

    fn handle(&mut self, request: HelperRequest) -> HelperReply {
        match request {
            HelperRequest::Open {
                kind,
                path,
                work_dir,
            } => self.open(&kind, Path::new(&path), Path::new(&work_dir)),
            HelperRequest::Page {
                cursor,
                table,
                section,
                page,
                sort_column,
                sort_direction,
            } => self.page(cursor, table, section, page, sort_column, sort_direction),
            HelperRequest::Attachment { attachment_id } => self.attachment(&attachment_id),
            HelperRequest::Tables => self.tables(),
            HelperRequest::Close => {
                self.state = None;
                self.cursors.clear();
                HelperReply::Closed
            }
        }
    }

    fn open(&mut self, kind: &str, path: &Path, work_dir: &Path) -> HelperReply {
        let kind = match kind {
            "notebook" => ExtraViewKind::Notebook,
            "email" => ExtraViewKind::Email,
            "subtitle" => ExtraViewKind::Subtitle,
            "log" => ExtraViewKind::Log,
            "sqlite" => ExtraViewKind::Sqlite,
            _ => return failed("extra_view.bad_request"),
        };
        let result = match kind {
            ExtraViewKind::Notebook => self.open_notebook(path, work_dir),
            ExtraViewKind::Email => self.open_email(path, work_dir),
            ExtraViewKind::Subtitle => self.open_subtitle(path),
            ExtraViewKind::Log => self.open_log(path),
            ExtraViewKind::Sqlite => self.open_sqlite(path),
            ExtraViewKind::Book => Err(ViewerError::Unsupported),
        };
        match result {
            Ok((title, item_count, partial)) => {
                self.kind = Some(kind);
                HelperReply::Opened {
                    title,
                    item_count,
                    partial,
                }
            }
            Err(error) => failed(error.code()),
        }
    }

    fn open_notebook(
        &mut self,
        path: &Path,
        work_dir: &Path,
    ) -> Result<(String, u32, bool), ViewerError> {
        let bytes = read_source(path, MAX_NOTEBOOK_SOURCE_BYTES)?;
        let doc = data_views::notebook::parse_notebook(&bytes)?;
        let title = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "Notebook".to_string());
        let item_count = doc.cells.len() as u32;
        let partial = doc.partial || doc.unsupported_outputs > 0;
        self.state = Some(HelperState::Notebook {
            doc,
            work_dir: work_dir.to_path_buf(),
        });
        Ok((title, item_count, partial))
    }

    fn open_email(
        &mut self,
        path: &Path,
        work_dir: &Path,
    ) -> Result<(String, u32, bool), ViewerError> {
        let bytes = read_source(path, MAX_EMAIL_SOURCE_BYTES)?;
        let doc = data_views::mail::parse_email(&bytes)?;
        let title = doc.summary.subject.clone();
        let item_count = doc.attachments.len() as u32;
        let partial = doc.partial;
        self.state = Some(HelperState::Email {
            doc,
            work_dir: work_dir.to_path_buf(),
        });
        Ok((
            if title.is_empty() {
                path.file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Email".to_string())
            } else {
                title
            },
            item_count,
            partial,
        ))
    }

    fn open_subtitle(&mut self, path: &Path) -> Result<(String, u32, bool), ViewerError> {
        let bytes = read_source(path, MAX_SUBTITLE_SOURCE_BYTES)?;
        let doc = data_views::subtitle::parse_subtitles(&bytes)?;
        let title = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "Subtitles".to_string());
        let item_count = doc.cues.len() as u32;
        let partial = doc.partial || doc.invalid > 0;
        self.state = Some(HelperState::Subtitle { doc });
        Ok((title, item_count, partial))
    }

    fn open_log(&mut self, path: &Path) -> Result<(String, u32, bool), ViewerError> {
        let metadata = std::fs::metadata(path).map_err(|_| ViewerError::Unavailable)?;
        if metadata.len() > MAX_LOG_SOURCE_BYTES {
            return Err(ViewerError::TooLarge);
        }
        let file = std::fs::File::open(path).map_err(|_| ViewerError::Unavailable)?;
        let title = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "Log".to_string());
        self.state = Some(HelperState::Log {
            scanner: LogScanner::new(0),
            file,
            path: path.to_path_buf(),
        });
        Ok((title, 0, false))
    }

    fn open_sqlite(&mut self, path: &Path) -> Result<(String, u32, bool), ViewerError> {
        if std::fs::metadata(path)
            .map_err(|_| ViewerError::Unavailable)?
            .len()
            > MAX_SQLITE_SOURCE_BYTES
        {
            return Err(ViewerError::TooLarge);
        }
        if path
            .as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .ends_with("-wal")
        {
            return Err(ViewerError::BadRequest);
        }
        let reader = SqliteReader::open(path)?;
        let item_count = reader.tables().len() as u32;
        let title = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "SQLite database".to_string());
        self.state = Some(HelperState::Sqlite { reader });
        Ok((title, item_count, false))
    }

    fn page(
        &mut self,
        cursor: Option<String>,
        table: Option<String>,
        _section: Option<u32>,
        _page: Option<u32>,
        sort_column: Option<u32>,
        sort_direction: Option<SortDirectionWire>,
    ) -> HelperReply {
        let Some(kind) = self.kind else {
            return failed("extra_view.unavailable");
        };
        if kind == ExtraViewKind::Book {
            return failed("extra_view.bad_request");
        }
        let cursor_id = match cursor {
            Some(value) if !value.is_empty() => match Uuid::parse_str(&value) {
                Ok(id) => Some(id),
                Err(_) => return failed("extra_view.bad_request"),
            },
            _ => None,
        };
        let cursor_kind = match cursor_id {
            Some(id) => match self.cursors.get(&id) {
                Some(entry) if cursor_matches(kind, &entry.kind) => Some(entry.kind.clone()),
                _ => return failed("extra_view.bad_request"),
            },
            None => None,
        };
        let Some(mut state) = self.state.take() else {
            return failed("extra_view.unavailable");
        };
        self.clock = self.clock.saturating_add(1);
        let result = match &mut state {
            HelperState::Notebook { doc, work_dir } => notebook_page(
                doc,
                work_dir,
                cursor_kind.as_ref(),
                &mut self.cursors,
                self.clock,
            ),
            HelperState::Email { doc, .. } => {
                email_page(doc, cursor_kind.as_ref(), &mut self.cursors, self.clock)
            }
            HelperState::Subtitle { doc } => {
                subtitle_page(doc, cursor_kind.as_ref(), &mut self.cursors, self.clock)
            }
            HelperState::Log {
                scanner,
                file,
                path,
            } => log_page(
                scanner,
                file,
                path,
                cursor_kind.as_ref(),
                &mut self.cursors,
                self.clock,
            ),
            HelperState::Sqlite { reader } => sqlite_page(
                reader,
                table,
                sort_column,
                sort_direction,
                cursor_kind.as_ref(),
                &mut self.cursors,
                self.clock,
            ),
        };
        self.state = Some(state);
        match result {
            Ok(page) => HelperReply::Page { page },
            Err(error) => failed(error.code()),
        }
    }

    fn tables(&self) -> HelperReply {
        match self.state.as_ref() {
            Some(HelperState::Sqlite { reader }) => HelperReply::Tables {
                tables: reader.tables(),
            },
            _ => failed("extra_view.bad_request"),
        }
    }

    fn attachment(&mut self, attachment_id: &str) -> HelperReply {
        let Some(HelperState::Email { doc, work_dir }) = self.state.as_ref() else {
            return failed("extra_view.bad_request");
        };
        let Some(part) = doc.parts.iter().find(|part| part.id == attachment_id) else {
            return failed("extra_view.bad_request");
        };
        let result = write_attachment(work_dir, &part.name, &part.bytes);
        match result {
            Ok(path) => HelperReply::Attachment {
                path: path.to_string_lossy().to_string(),
            },
            Err(error) => failed(error.code()),
        }
    }
}

fn cursor_matches(kind: ExtraViewKind, cursor: &CursorKind) -> bool {
    matches!(
        (kind, cursor),
        (ExtraViewKind::Notebook, CursorKind::Notebook { .. })
            | (ExtraViewKind::Email, CursorKind::Email { .. })
            | (ExtraViewKind::Subtitle, CursorKind::Subtitle { .. })
            | (ExtraViewKind::Log, CursorKind::Log)
            | (ExtraViewKind::Sqlite, CursorKind::Sqlite { .. })
    )
}

fn notebook_page(
    doc: &NotebookDoc,
    work_dir: &Path,
    cursor: Option<&CursorKind>,
    cursors: &mut HashMap<Uuid, CursorState>,
    clock: u64,
) -> Result<HelperPage, ViewerError> {
    let next = match cursor {
        Some(CursorKind::Notebook { next }) => *next,
        Some(_) => return Err(ViewerError::BadRequest),
        None => 0,
    };
    let page = doc.page(next, MAX_PAGE_RECORDS, 700 * 1024);
    let mut cells = Vec::with_capacity(page.cells.len());
    for cell in &page.cells {
        cells.push(notebook_cell(cell, work_dir)?);
    }
    Ok(HelperPage {
        kind: ExtraViewKind::Notebook,
        payload: HelperPayload::Notebook { cells },
        next_cursor: page
            .next_index
            .map(|next| remember_cursor(cursors, clock, CursorKind::Notebook { next })),
        complete: page.next_index.is_none(),
        partial: page.partial,
    })
}

fn notebook_cell(
    cell: &NotebookParsedCell,
    work_dir: &Path,
) -> Result<HelperNotebookCell, ViewerError> {
    let mut outputs = Vec::with_capacity(cell.outputs.len());
    for output in &cell.outputs {
        outputs.push(notebook_output(output, work_dir)?);
    }
    Ok(HelperNotebookCell {
        index: cell.index,
        kind: cell.kind,
        source: cell.source.clone(),
        language: cell.language.clone(),
        outputs,
        next_source_offset: cell.next_source_offset,
    })
}

fn notebook_output(
    output: &NotebookParsedOutput,
    work_dir: &Path,
) -> Result<HelperNotebookOutput, ViewerError> {
    let image_file = match &output.image {
        Some(image) => Some(write_image(work_dir, image)?),
        None => None,
    };
    Ok(HelperNotebookOutput {
        kind: output.kind,
        text: output.text.clone(),
        html: output.html.clone(),
        image_file,
    })
}

fn write_image(work_dir: &Path, image: &NotebookImage) -> Result<HelperImageFile, ViewerError> {
    std::fs::create_dir_all(work_dir).map_err(|_| ViewerError::Unavailable)?;
    let directory = PinnedDirectory::open(work_dir).map_err(|_| ViewerError::Unavailable)?;
    let mut output =
        OwnedOutput::create(&directory, "notebook-image").map_err(|_| ViewerError::Unavailable)?;
    output
        .file_mut()
        .write_all(&image.bytes)
        .map_err(|_| ViewerError::Unavailable)?;
    output.flush_sync().map_err(|_| ViewerError::Unavailable)?;
    let name = format!("image-{}.bin", Uuid::new_v4());
    let path = output
        .publish_name(&name)
        .map_err(|_| ViewerError::Unavailable)?;
    Ok(HelperImageFile {
        path: path.to_string_lossy().to_string(),
        mime: image.mime.clone(),
        width: image.width,
        height: image.height,
    })
}

fn write_attachment(work_dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, ViewerError> {
    if bytes.len() as u64 > MAX_EMAIL_SOURCE_BYTES {
        return Err(ViewerError::TooLarge);
    }
    std::fs::create_dir_all(work_dir).map_err(|_| ViewerError::Unavailable)?;
    let directory = PinnedDirectory::open(work_dir).map_err(|_| ViewerError::Unavailable)?;
    let mut output =
        OwnedOutput::create(&directory, "attachment").map_err(|_| ViewerError::Unavailable)?;
    output
        .file_mut()
        .write_all(bytes)
        .map_err(|_| ViewerError::Unavailable)?;
    output.flush_sync().map_err(|_| ViewerError::Unavailable)?;
    let safe = if name.is_empty() { "attachment" } else { name };
    let path = output
        .publish_name(safe)
        .map_err(|_| ViewerError::BadRequest)?;
    Ok(path)
}

fn email_page(
    doc: &EmailDoc,
    cursor: Option<&CursorKind>,
    cursors: &mut HashMap<Uuid, CursorState>,
    clock: u64,
) -> Result<HelperPage, ViewerError> {
    let next = match cursor {
        Some(CursorKind::Email { next }) => *next,
        Some(_) => return Err(ViewerError::BadRequest),
        None => 0,
    };
    let page = doc.page(next, MAX_PAGE_RECORDS);
    Ok(HelperPage {
        kind: ExtraViewKind::Email,
        payload: HelperPayload::Email {
            message: page.message,
            attachments: page.attachments,
        },
        next_cursor: page
            .next_index
            .map(|next| remember_cursor(cursors, clock, CursorKind::Email { next })),
        complete: page.next_index.is_none(),
        partial: page.partial,
    })
}

fn subtitle_page(
    doc: &SubtitleDoc,
    cursor: Option<&CursorKind>,
    cursors: &mut HashMap<Uuid, CursorState>,
    clock: u64,
) -> Result<HelperPage, ViewerError> {
    let next = match cursor {
        Some(CursorKind::Subtitle { next }) => *next,
        Some(_) => return Err(ViewerError::BadRequest),
        None => 0,
    };
    let page = doc.page(next, MAX_PAGE_RECORDS);
    Ok(HelperPage {
        kind: ExtraViewKind::Subtitle,
        payload: HelperPayload::Subtitle { cues: page.cues },
        next_cursor: page
            .next_index
            .map(|next| remember_cursor(cursors, clock, CursorKind::Subtitle { next })),
        complete: page.next_index.is_none(),
        partial: page.partial,
    })
}

fn log_page(
    scanner: &mut LogScanner,
    file: &mut std::fs::File,
    path: &Path,
    cursor: Option<&CursorKind>,
    cursors: &mut HashMap<Uuid, CursorState>,
    clock: u64,
) -> Result<HelperPage, ViewerError> {
    if cursor.is_some() && !matches!(cursor, Some(CursorKind::Log)) {
        return Err(ViewerError::BadRequest);
    }
    let metadata = std::fs::metadata(path).map_err(|_| ViewerError::Unavailable)?;
    let length = metadata.len();
    let mut offset = scanner.next_offset();
    if offset > length {
        // The file was truncated. The session notices the source stamp
        // change; this guard keeps the read bounded if it arrives first.
        return Err(ViewerError::Changed);
    }
    let mut lines = Vec::new();
    let mut read_total = 0u64;
    while lines.len() < MAX_LOG_LINES_PER_BLOCK && read_total < MAX_LOG_INITIAL_BYTES {
        if offset >= length {
            break;
        }
        let take = (length - offset).min(64 * 1024);
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| ViewerError::Unavailable)?;
        let mut buffer = vec![0u8; take as usize];
        let read = file
            .read(&mut buffer)
            .map_err(|_| ViewerError::Unavailable)?;
        if read == 0 {
            break;
        }
        offset = offset.saturating_add(read as u64);
        read_total = read_total.saturating_add(read as u64);
        let mut batch = scanner.feed(&buffer[..read])?;
        lines.append(&mut batch);
    }
    let at_end = scanner.next_offset() >= length && scanner.pending_len() == 0;
    let cursor_id = remember_cursor(cursors, clock, CursorKind::Log);
    Ok(HelperPage {
        kind: ExtraViewKind::Log,
        payload: HelperPayload::Log { lines },
        // Following new lines keeps the cursor alive even at the end; a
        // normal pager reads `complete` and stops.
        next_cursor: Some(cursor_id),
        complete: at_end,
        partial: scanner.partial(),
    })
}

fn sqlite_page(
    reader: &mut SqliteReader,
    table: Option<String>,
    sort_column: Option<u32>,
    sort_direction: Option<SortDirectionWire>,
    cursor: Option<&CursorKind>,
    cursors: &mut HashMap<Uuid, CursorState>,
    clock: u64,
) -> Result<HelperPage, ViewerError> {
    let (table_name, offset, sort_column, sort) = match cursor {
        Some(CursorKind::Sqlite {
            table,
            offset,
            sort_column,
            sort,
        }) => (table.clone(), *offset, *sort_column, *sort),
        Some(_) => return Err(ViewerError::BadRequest),
        None => {
            let table = table.ok_or(ViewerError::BadRequest)?;
            let column = sort_column.map(|value| value as usize);
            let sort = match sort_direction {
                Some(SortDirectionWire::Desc) => SqliteSort::Desc,
                _ => SqliteSort::Asc,
            };
            (table, 0usize, column, sort)
        }
    };
    let page = reader.page(
        &table_name,
        sort_column,
        sort,
        offset,
        MAX_SQLITE_ROWS_PER_PAGE,
        &Arc::new(AtomicBool::new(false)),
    )?;
    let next_cursor = page.next_offset.map(|offset| {
        remember_cursor(
            cursors,
            clock,
            CursorKind::Sqlite {
                table: table_name.clone(),
                offset,
                sort_column,
                sort,
            },
        )
    });
    Ok(HelperPage {
        kind: ExtraViewKind::Sqlite,
        payload: HelperPayload::Sqlite {
            table: page.table,
            rows: page.rows,
        },
        next_cursor,
        complete: page.complete,
        partial: false,
    })
}

// Cursors are inserted only after a page was built successfully, so a failed
// page never leaks a cursor.
fn remember_cursor(
    cursors: &mut HashMap<Uuid, CursorState>,
    clock: u64,
    kind: CursorKind,
) -> String {
    if cursors.len() >= MAX_CURSORS {
        if let Some(oldest) = cursors
            .iter()
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(id, _)| *id)
        {
            cursors.remove(&oldest);
        }
    }
    let id = Uuid::new_v4();
    cursors.insert(
        id,
        CursorState {
            kind,
            last_used: clock,
        },
    );
    id.to_string()
}

fn read_source(path: &Path, max: u64) -> Result<Vec<u8>, ViewerError> {
    let metadata = std::fs::metadata(path).map_err(|_| ViewerError::Unavailable)?;
    if metadata.len() > max {
        return Err(ViewerError::TooLarge);
    }
    let file = std::fs::File::open(path).map_err(|_| ViewerError::Unavailable)?;
    let mut bytes = Vec::with_capacity(metadata.len().min(1024 * 1024) as usize);
    file.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| ViewerError::Unavailable)?;
    if bytes.len() as u64 > max {
        return Err(ViewerError::TooLarge);
    }
    Ok(bytes)
}

fn failed(code: &str) -> HelperReply {
    HelperReply::Failed {
        code: code.to_string(),
    }
}

fn send(reply: &HelperReply) {
    if let Ok(text) = serde_json::to_string(reply) {
        let stdout = std::io::stdout();
        let mut lock = stdout.lock();
        let _ = lock.write_all(text.as_bytes());
        let _ = lock.write_all(b"\n");
        let _ = lock.flush();
    }
}

/// Entry point of the helper process; returns its exit code.
pub fn run_helper() -> i32 {
    let mut input = BufReader::new(std::io::stdin());
    let mut helper = Helper::new();
    loop {
        match read_capped_line(&mut input, MAX_REQUEST_LINE) {
            HelperLine::Line(line) => {
                if line.trim() == "cancel" {
                    return 0;
                }
                let request: HelperRequest = match serde_json::from_str(&line) {
                    Ok(request) => request,
                    Err(_) => {
                        send(&failed("extra_view.bad_request"));
                        continue;
                    }
                };
                let closing = matches!(&request, HelperRequest::Close);
                let reply = helper.handle(request);
                send(&reply);
                if closing {
                    return 0;
                }
            }
            _ => return 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_kind_is_refused() {
        let mut helper = Helper::new();
        let reply = helper.open("video", Path::new("C:\\none"), Path::new("C:\\temp"));
        assert!(matches!(reply, HelperReply::Failed { code } if code == "extra_view.bad_request"));
    }

    #[test]
    fn an_oversized_source_is_refused_before_parsing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("big.ipynb");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_NOTEBOOK_SOURCE_BYTES + 1).unwrap();
        let mut helper = Helper::new();
        let reply = helper.open("notebook", &path, directory.path());
        assert!(matches!(reply, HelperReply::Failed { code } if code == "extra_view.too_large"));
    }
}
