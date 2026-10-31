//! Shared job table (Step 06d, contract 10): every new long task runs as a
//! job polled by the UI with job_poll and stopped with job_cancel.

use fs_service::{new_cancellation_token, CancellationToken, OpProgress};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// How many unfinished jobs may exist at once.
pub const MAX_JOBS: usize = 32;
/// A finished job nobody polled is dropped after this long.
pub const STALE_AFTER: Duration = Duration::from_secs(600);

/// One job the UI can poll.
pub struct JobEntry {
    progress: OpProgress,
    done: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
    token: CancellationToken,
    finished_at: Option<Instant>,
}

/// What one poll answers (mirrors `JobPoll` in src/services/jobs.ts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobPoll {
    pub progress: OpProgress,
    pub done: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// The app's job table (managed state).
#[derive(Default)]
pub struct Jobs {
    entries: Mutex<HashMap<String, JobEntry>>,
}

impl Jobs {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, JobEntry>>, String> {
        self.entries
            .lock()
            .map_err(|_| "jobs lock poisoned".to_string())
    }

    /// Start a job; the caller keeps the token (or the context does).
    pub fn begin(&self, id: &str, items_total: usize) -> Result<CancellationToken, String> {
        let mut entries = self.lock()?;
        entries.retain(|_, entry| {
            !entry
                .finished_at
                .is_some_and(|at| at.elapsed() > STALE_AFTER)
        });
        if entries.contains_key(id) {
            return Err("jobs.duplicate".to_string());
        }
        if entries.values().filter(|entry| !entry.done).count() >= MAX_JOBS {
            return Err("jobs.too_many".to_string());
        }
        let token = new_cancellation_token();
        entries.insert(
            id.to_string(),
            JobEntry {
                progress: OpProgress {
                    items_done: 0,
                    items_total,
                    bytes_done: 0,
                    bytes_total: 0,
                    current: String::new(),
                },
                done: false,
                result: None,
                error: None,
                token: token.clone(),
                finished_at: None,
            },
        );
        Ok(token)
    }

    pub fn set_progress(&self, id: &str, progress: &OpProgress) {
        if let Ok(mut entries) = self.lock() {
            if let Some(entry) = entries.get_mut(id) {
                entry.progress = progress.clone();
            }
        }
    }

    pub fn finish(&self, id: &str, outcome: Result<serde_json::Value, String>) {
        if let Ok(mut entries) = self.lock() {
            if let Some(entry) = entries.get_mut(id) {
                entry.done = true;
                entry.finished_at = Some(Instant::now());
                match outcome {
                    Ok(value) => entry.result = Some(value),
                    Err(error) => entry.error = Some(error),
                }
            }
        }
    }

    /// The job's state; a finished job is removed once it has been read.
    pub fn poll(&self, id: &str) -> Result<JobPoll, String> {
        let mut entries = self.lock()?;
        let Some(entry) = entries.get(id) else {
            return Err("jobs.unknown".to_string());
        };
        let poll = JobPoll {
            progress: entry.progress.clone(),
            done: entry.done,
            result: entry.result.clone(),
            error: entry.error.clone(),
        };
        if poll.done {
            entries.remove(id);
        }
        Ok(poll)
    }

    /// Ask the work to stop. An unknown id changes nothing: the job may have
    /// finished a moment ago.
    pub fn cancel(&self, id: &str) {
        if let Ok(entries) = self.lock() {
            if let Some(entry) = entries.get(id) {
                entry
                    .token
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}

/// What one job's work can do: read its token and report progress.
pub struct JobContext {
    app: AppHandle,
    id: String,
    token: CancellationToken,
}

impl JobContext {
    pub fn token(&self) -> &CancellationToken {
        &self.token
    }

    pub fn set_progress(&self, progress: &OpProgress) {
        self.app.state::<Jobs>().set_progress(&self.id, progress);
    }
}

/// Run `work` on a blocking thread and store its result in the job table.
pub fn spawn_job<F>(app: AppHandle, id: String, token: CancellationToken, work: F)
where
    F: FnOnce(&JobContext) -> Result<serde_json::Value, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let context = JobContext {
            app: app.clone(),
            id: id.clone(),
            token,
        };
        let outcome = work(&context);
        app.state::<Jobs>().finish(&id, outcome);
    });
}

#[tauri::command]
pub fn job_poll(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    request_id: String,
) -> Result<JobPoll, String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    jobs.poll(&request_id)
}

#[tauri::command]
pub fn job_cancel(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    request_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    jobs.cancel(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Jobs, MAX_JOBS};
    use serde_json::json;
    use std::sync::atomic::Ordering;

    fn progress(done: usize) -> fs_service::OpProgress {
        fs_service::OpProgress {
            items_done: done,
            items_total: 4,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        }
    }

    #[test]
    fn begin_poll_finish() {
        let jobs = Jobs::default();
        jobs.begin("a", 4).unwrap();
        let poll = jobs.poll("a").unwrap();
        assert!(!poll.done);
        assert_eq!(poll.progress.items_done, 0);
        jobs.finish("a", Ok(json!(7)));
        let poll = jobs.poll("a").unwrap();
        assert!(poll.done);
        assert_eq!(poll.result, Some(json!(7)));
        assert_eq!(jobs.poll("a").err().as_deref(), Some("jobs.unknown"));
    }

    #[test]
    fn duplicate_ids_are_refused() {
        let jobs = Jobs::default();
        jobs.begin("a", 1).unwrap();
        assert_eq!(jobs.begin("a", 1).err().as_deref(), Some("jobs.duplicate"));
    }

    #[test]
    fn cancel_sets_the_token() {
        let jobs = Jobs::default();
        let token = jobs.begin("a", 1).unwrap();
        assert!(!token.load(Ordering::Relaxed));
        jobs.cancel("a");
        assert!(token.load(Ordering::Relaxed));
        // An unknown id is not an error.
        jobs.cancel("missing");
    }

    #[test]
    fn too_many_unfinished_jobs() {
        let jobs = Jobs::default();
        for index in 0..MAX_JOBS {
            jobs.begin(&format!("job-{index}"), 1).unwrap();
        }
        assert_eq!(
            jobs.begin("one-more", 1).err().as_deref(),
            Some("jobs.too_many")
        );
    }

    #[test]
    fn errors_are_returned() {
        let jobs = Jobs::default();
        jobs.begin("a", 1).unwrap();
        jobs.set_progress("a", &progress(1));
        jobs.finish("a", Err("archive.corrupt".to_string()));
        let poll = jobs.poll("a").unwrap();
        assert!(poll.done);
        assert_eq!(poll.error.as_deref(), Some("archive.corrupt"));
        assert_eq!(poll.progress.items_done, 1);
    }
}
