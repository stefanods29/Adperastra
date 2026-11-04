//! In-memory review sessions for local diagnostics (Step 09h T5). Sessions
//! expire, are bounded and never write a draft report to disk before the
//! user saves the reviewed ZIP.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::diagnostics_archive::{write_zip, SaveEntry};
use crate::diagnostics_collect::collect;
use crate::diagnostics_types::{
    CollectedFile, DiagnosticEdit, DiagnosticsFileKind, DiagnosticsOptions, DiagnosticsSession,
    MAX_FILES, MAX_SESSION_BYTES, MAX_SESSIONS, MAX_TEXT_BYTES, SESSION_TTL_SECONDS,
};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::{ensure_main, AppState};

#[derive(Debug, Clone)]
enum SourceData {
    Text(String),
    Dump(PathBuf),
}

struct SessionRecord {
    public: DiagnosticsSession,
    sources: HashMap<Uuid, SourceData>,
}

#[derive(Default)]
pub struct DiagnosticsSessions {
    sessions: Mutex<HashMap<Uuid, SessionRecord>>,
}

impl DiagnosticsSessions {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, SessionRecord>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "diagnostics lock poisoned".to_string())
    }

    fn cleanup_expired(&self, now: u64) -> Result<(), String> {
        let mut sessions = self.lock()?;
        sessions.retain(|_, record| record.public.expires_unix > now);
        Ok(())
    }

    pub fn insert(
        &self,
        files: Vec<CollectedFile>,
        options: &DiagnosticsOptions,
        now: u64,
    ) -> Result<DiagnosticsSession, String> {
        if files.is_empty() || files.len() > MAX_FILES {
            return Err("diagnostics.invalid".to_string());
        }
        let mut names = HashSet::new();
        for file in &files {
            crate::diagnostics_types::validate_relative_name(&file.relative_name)?;
            if !names.insert(file.relative_name.clone()) {
                return Err("diagnostics.invalid".to_string());
            }
        }
        let total = files.iter().map(CollectedFile::bytes).sum::<u64>();
        if total > MAX_SESSION_BYTES {
            return Err("diagnostics.too_large".to_string());
        }
        self.cleanup_expired(now)?;
        let mut sessions = self.lock()?;
        if sessions.len() >= MAX_SESSIONS {
            return Err("diagnostics.too_large".to_string());
        }
        let already_used = sessions
            .values()
            .flat_map(|record| record.public.files.iter())
            .map(|file| file.bytes)
            .sum::<u64>();
        if already_used.saturating_add(total) > MAX_SESSION_BYTES {
            return Err("diagnostics.too_large".to_string());
        }
        let id = Uuid::new_v4();
        let mut public_files = Vec::new();
        let mut sources = HashMap::new();
        for file in files {
            public_files.push(file.public(true));
            sources.insert(
                file.id,
                match (file.kind, file.text, file.dump) {
                    (DiagnosticsFileKind::Text, Some(text), _) => SourceData::Text(text),
                    (DiagnosticsFileKind::Dump, _, Some(path)) => SourceData::Dump(path),
                    _ => return Err("diagnostics.invalid".to_string()),
                },
            );
        }
        let public = DiagnosticsSession {
            id,
            files: public_files,
            expires_unix: now + SESSION_TTL_SECONDS,
            include_paths: options.include_paths,
            include_dumps: options.include_dumps,
        };
        sessions.insert(
            id,
            SessionRecord {
                public: public.clone(),
                sources,
            },
        );
        Ok(public)
    }

    pub fn get(&self, id: Uuid, now: u64) -> Result<DiagnosticsSession, String> {
        self.cleanup_expired(now)?;
        let sessions = self.lock()?;
        sessions
            .get(&id)
            .map(|record| record.public.clone())
            .ok_or_else(|| "diagnostics.invalid".to_string())
    }

    pub fn edit(
        &self,
        id: Uuid,
        edits: &[DiagnosticEdit],
        now: u64,
    ) -> Result<DiagnosticsSession, String> {
        if edits.len() > MAX_FILES {
            return Err("diagnostics.invalid".to_string());
        }
        self.cleanup_expired(now)?;
        let mut sessions = self.lock()?;
        if !sessions.contains_key(&id) {
            return Err("diagnostics.invalid".to_string());
        }
        // Validate every edit and compute the resulting sizes before any
        // value changes: a refused edit leaves the reviewed session exactly
        // as it was.
        let mut seen = HashSet::new();
        let mut next_bytes: HashMap<Uuid, u64> = sessions
            .get(&id)
            .ok_or_else(|| "diagnostics.invalid".to_string())?
            .public
            .files
            .iter()
            .map(|file| (file.id, file.bytes))
            .collect();
        for edit in edits {
            if !seen.insert(edit.file_id) {
                return Err("diagnostics.invalid".to_string());
            }
            let file = sessions
                .get(&id)
                .and_then(|record| {
                    record
                        .public
                        .files
                        .iter()
                        .find(|file| file.id == edit.file_id)
                })
                .ok_or_else(|| "diagnostics.invalid".to_string())?;
            match file.kind {
                DiagnosticsFileKind::Dump => {
                    if edit.text.is_some() {
                        return Err("diagnostics.invalid".to_string());
                    }
                }
                DiagnosticsFileKind::Text => {
                    if let Some(text) = &edit.text {
                        if text.len() as u64 > MAX_TEXT_BYTES {
                            return Err("diagnostics.too_large".to_string());
                        }
                        next_bytes.insert(edit.file_id, text.len() as u64);
                    }
                }
            }
        }
        let total = next_bytes.values().sum::<u64>();
        if total > MAX_SESSION_BYTES {
            return Err("diagnostics.too_large".to_string());
        }
        let others = sessions
            .iter()
            .filter(|(other, _)| **other != id)
            .flat_map(|(_, other)| other.public.files.iter())
            .map(|file| file.bytes)
            .sum::<u64>();
        if others.saturating_add(total) > MAX_SESSION_BYTES {
            return Err("diagnostics.too_large".to_string());
        }
        let record = sessions
            .get_mut(&id)
            .ok_or_else(|| "diagnostics.invalid".to_string())?;
        for edit in edits {
            if let Some(text) = &edit.text {
                record
                    .sources
                    .insert(edit.file_id, SourceData::Text(text.clone()));
            }
            let file = record
                .public
                .files
                .iter_mut()
                .find(|file| file.id == edit.file_id)
                .ok_or_else(|| "diagnostics.invalid".to_string())?;
            if let Some(text) = &edit.text {
                file.bytes = text.len() as u64;
                file.preview = Some(text.clone());
            }
            file.included = edit.included;
        }
        Ok(record.public.clone())
    }

    /// Detach exactly what the ZIP will contain; the lock is released before
    /// any archive work starts.
    pub fn snapshot(&self, id: Uuid, now: u64) -> Result<Vec<SaveEntry>, String> {
        self.cleanup_expired(now)?;
        let sessions = self.lock()?;
        let record = sessions
            .get(&id)
            .ok_or_else(|| "diagnostics.invalid".to_string())?;
        let mut entries = Vec::new();
        for file in record.public.files.iter().filter(|file| file.included) {
            let source = record
                .sources
                .get(&file.id)
                .ok_or_else(|| "diagnostics.invalid".to_string())?;
            entries.push(match source {
                SourceData::Text(text) => SaveEntry {
                    relative_name: file.relative_name.clone(),
                    kind: DiagnosticsFileKind::Text,
                    text: Some(text.clone()),
                    dump: None,
                },
                SourceData::Dump(path) => SaveEntry {
                    relative_name: file.relative_name.clone(),
                    kind: DiagnosticsFileKind::Dump,
                    text: None,
                    dump: Some(path.clone()),
                },
            });
        }
        if entries.is_empty() {
            return Err("diagnostics.invalid".to_string());
        }
        Ok(entries)
    }

    pub fn close(&self, id: Uuid) -> Result<(), String> {
        let mut sessions = self.lock()?;
        sessions.remove(&id);
        Ok(())
    }
}

#[tauri::command]
pub fn diagnostics_create_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    options: DiagnosticsOptions,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    let token = jobs.begin(&request_id, 1)?;
    let data_dir = app.state::<AppState>().data_dir.clone();
    spawn_job(app.clone(), request_id, token, move |_context: &JobContext| {
        let now = crate::unix_now();
        let files = collect(&data_dir, &options, now)?;
        let session = app
            .state::<DiagnosticsSessions>()
            .insert(files, &options, now)?;
        serde_json::to_value(session).map_err(|_| "diagnostics.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn diagnostics_edit(
    window: WebviewWindow,
    sessions: State<'_, DiagnosticsSessions>,
    session_id: String,
    edits: Vec<DiagnosticEdit>,
) -> Result<DiagnosticsSession, String> {
    ensure_main(window.label())?;
    let id = Uuid::parse_str(&session_id).map_err(|_| "diagnostics.invalid".to_string())?;
    sessions.edit(id, &edits, crate::unix_now())
}

#[tauri::command]
pub fn diagnostics_save_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session_id: String,
    dest_path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&dest_path).map_err(|_| "diagnostics.invalid".to_string())?;
    if !dest_path.to_lowercase().ends_with(".zip") {
        return Err("diagnostics.invalid".to_string());
    }
    let id = Uuid::parse_str(&session_id).map_err(|_| "diagnostics.invalid".to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let data_dir = app.state::<AppState>().data_dir.clone();
    spawn_job(app.clone(), request_id, token, move |_context: &JobContext| {
        // Detach the reviewed files only on the background job: a session
        // may carry up to the full 64 MiB budget.
        let entries = app
            .state::<DiagnosticsSessions>()
            .snapshot(id, crate::unix_now())?;
        let result = write_zip(&data_dir, std::path::Path::new(&dest_path), &entries)?;
        serde_json::to_value(result).map_err(|_| "diagnostics.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn diagnostics_close(
    window: WebviewWindow,
    sessions: State<'_, DiagnosticsSessions>,
    session_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let id = Uuid::parse_str(&session_id).map_err(|_| "diagnostics.invalid".to_string())?;
    sessions.close(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(name: &str, body: &str) -> CollectedFile {
        CollectedFile {
            id: Uuid::new_v4(),
            relative_name: name.to_string(),
            kind: DiagnosticsFileKind::Text,
            text: Some(body.to_string()),
            dump: None,
            redacted: true,
        }
    }

    #[test]
    fn edit_exclude_and_snapshot_only_included_files() {
        let sessions = DiagnosticsSessions::default();
        let options = DiagnosticsOptions::default();
        let session = sessions
            .insert(vec![text("a.txt", "one"), text("b.txt", "two")], &options, 1_000)
            .unwrap();
        let first = session.files[0].id;
        let second = session.files[1].id;
        let edited = sessions
            .edit(
                session.id,
                &[
                    DiagnosticEdit {
                        file_id: first,
                        included: true,
                        text: Some("edited".to_string()),
                    },
                    DiagnosticEdit {
                        file_id: second,
                        included: false,
                        text: None,
                    },
                ],
                1_001,
            )
            .unwrap();
        assert_eq!(edited.files[0].preview.as_deref(), Some("edited"));
        assert!(!edited.files[1].included);
        let entries = sessions.snapshot(session.id, 1_002).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text.as_deref(), Some("edited"));
    }

    #[test]
    fn a_refused_edit_leaves_the_previous_text() {
        let sessions = DiagnosticsSessions::default();
        let file = text("a.txt", "one");
        let session = sessions
            .insert(vec![file.clone()], &DiagnosticsOptions::default(), 1_000)
            .unwrap();
        assert_eq!(
            sessions
                .edit(
                    session.id,
                    &[
                        DiagnosticEdit {
                            file_id: file.id,
                            included: true,
                            text: Some("changed".to_string()),
                        },
                        // The same file a second time is invalid; the first
                        // edit must not have been applied.
                        DiagnosticEdit {
                            file_id: file.id,
                            included: false,
                            text: None,
                        },
                    ],
                    1_001,
                )
                .unwrap_err(),
            "diagnostics.invalid"
        );
        let current = sessions.get(session.id, 1_002).unwrap();
        assert_eq!(current.files[0].preview.as_deref(), Some("one"));
        assert_eq!(current.files[0].bytes, 3);
        assert!(current.files[0].included);
    }

    #[test]
    fn a_dump_cannot_be_edited_as_text() {
        let sessions = DiagnosticsSessions::default();
        let dump = CollectedFile {
            id: Uuid::new_v4(),
            relative_name: "crash.dmp".to_string(),
            kind: DiagnosticsFileKind::Dump,
            text: None,
            dump: Some(PathBuf::from("C:\\data\\logs\\crash.dmp")),
            redacted: false,
        };
        let session = sessions
            .insert(vec![dump.clone()], &DiagnosticsOptions::default(), 1_000)
            .unwrap();
        assert_eq!(
            sessions
                .edit(
                    session.id,
                    &[DiagnosticEdit {
                        file_id: dump.id,
                        included: true,
                        text: Some("changed".to_string()),
                    }],
                    1_001,
                )
                .unwrap_err(),
            "diagnostics.invalid"
        );
    }

    #[test]
    fn sessions_expire_and_are_bounded() {
        let sessions = DiagnosticsSessions::default();
        let options = DiagnosticsOptions::default();
        for _ in 0..MAX_SESSIONS {
            sessions.insert(vec![text("a.txt", "x")], &options, 1_000).unwrap();
        }
        assert_eq!(
            sessions
                .insert(vec![text("b.txt", "x")], &options, 1_000)
                .unwrap_err(),
            "diagnostics.too_large"
        );
        let fresh = sessions
            .insert(
                vec![text("c.txt", "x")],
                &options,
                1_000 + SESSION_TTL_SECONDS + 1,
            )
            .unwrap();
        assert_eq!(sessions.get(fresh.id, 1_000 + SESSION_TTL_SECONDS + 2).unwrap().id, fresh.id);
    }

    #[test]
    fn text_over_one_mebibyte_is_refused() {
        let sessions = DiagnosticsSessions::default();
        let file = text("a.txt", "x");
        let session = sessions
            .insert(vec![file.clone()], &DiagnosticsOptions::default(), 1_000)
            .unwrap();
        let oversized = "x".repeat(MAX_TEXT_BYTES as usize + 1);
        assert_eq!(
            sessions
                .edit(
                    session.id,
                    &[DiagnosticEdit {
                        file_id: file.id,
                        included: true,
                        text: Some(oversized),
                    }],
                    1_001,
                )
                .unwrap_err(),
            "diagnostics.too_large"
        );
    }

    #[test]
    fn closing_a_session_removes_it() {
        let sessions = DiagnosticsSessions::default();
        let session = sessions
            .insert(vec![text("a.txt", "x")], &DiagnosticsOptions::default(), 1_000)
            .unwrap();
        sessions.close(session.id).unwrap();
        assert_eq!(
            sessions.get(session.id, 1_001).unwrap_err(),
            "diagnostics.invalid"
        );
    }
}
