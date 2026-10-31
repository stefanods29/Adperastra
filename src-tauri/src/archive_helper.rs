//! The archive helper (Step 06d): Adperastra.exe --archive-helper reads and
//! extracts archives in its own process (plan/rules.md R-SEC-9).
//!
//! The app sends one JSON request line on stdin and reads JSON message lines
//! on stdout: batches of entries, the format, progress, the items created
//! and finally the report. A later stdin line `cancel`, or the app closing
//! stdin, stops the work.

use crate::helper::{read_capped_line, HelperLine};
use archive::{ArchiveEntry, ArchiveFormat, ExtractReport, ExtractRequest, Limits};
use fs_service::{new_cancellation_token, CancellationToken, OpProgress};
use serde::{Deserialize, Serialize};
use std::io::{BufReader, Write};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// The flag that turns this executable into the archive helper.
pub const HELPER_FLAG: &str = "--archive-helper";
/// How much memory the helper may use (a 1 GiB job object limit).
pub const HELPER_MEMORY_LIMIT: usize = 1_073_741_824;
/// The longest request line the helper accepts.
pub const MAX_REQUEST_LINE: usize = 1_048_576;
/// How many entries travel in one message.
pub const ENTRY_BATCH: usize = 2_000;
/// How often a progress message is sent at most.
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// What the app asks the helper to do.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum HelperRequest {
    List {
        path: String,
    },
    Extract {
        path: String,
        request: ExtractRequest,
    },
}

/// What the helper tells the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HelperMessage {
    Progress {
        progress: OpProgress,
    },
    Entries {
        entries: Vec<ArchiveEntry>,
    },
    Listed {
        format: ArchiveFormat,
        partial: bool,
    },
    Created {
        path: String,
    },
    Extracted {
        report: ExtractReport,
    },
    Failed {
        code: String,
    },
}

/// Entry point of the helper process; returns its exit code.
pub fn run_helper() -> i32 {
    let mut input = BufReader::new(std::io::stdin());
    let request: HelperRequest = match read_capped_line(&mut input, MAX_REQUEST_LINE) {
        HelperLine::Line(line) => match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(_) => {
                send(&HelperMessage::Failed {
                    code: "archive.bad_request".to_string(),
                });
                return 2;
            }
        },
        _ => {
            send(&HelperMessage::Failed {
                code: "archive.bad_request".to_string(),
            });
            return 2;
        }
    };
    let token = new_cancellation_token();
    // An app that disappears (or says "cancel") stops the work.
    let stop = token.clone();
    std::thread::spawn(move || loop {
        match read_capped_line(&mut input, MAX_REQUEST_LINE) {
            HelperLine::Line(line) => {
                if line.trim() == "cancel" {
                    stop.store(true, Ordering::Relaxed);
                    return;
                }
            }
            _ => {
                stop.store(true, Ordering::Relaxed);
                return;
            }
        }
    });
    let mut reporter = Reporter {
        last_progress: Instant::now(),
    };
    match request {
        HelperRequest::List { path } => list(&path, &token, &mut reporter),
        HelperRequest::Extract { path, request } => extract(&path, &request, &token, &mut reporter),
    }
    0
}

fn list(path: &str, token: &CancellationToken, reporter: &mut Reporter) {
    let listing = {
        let mut sink = |progress: &OpProgress| reporter.progress(progress);
        archive::list(Path::new(path), &Limits::default(), token, &mut sink)
    };
    match listing {
        Ok(listing) => {
            for (start, end) in entry_batches(listing.entries.len()) {
                send(&HelperMessage::Entries {
                    entries: listing.entries[start..end].to_vec(),
                });
            }
            send(&HelperMessage::Listed {
                format: listing.format,
                partial: listing.partial,
            });
        }
        Err(error) => send(&HelperMessage::Failed {
            code: error.code().to_string(),
        }),
    }
}

fn extract(
    path: &str,
    request: &ExtractRequest,
    token: &CancellationToken,
    reporter: &mut Reporter,
) {
    match archive::extract(
        Path::new(path),
        request,
        &Limits::default(),
        token,
        reporter,
    ) {
        Ok(report) => send(&HelperMessage::Extracted { report }),
        Err(error) => send(&HelperMessage::Failed {
            code: error.code().to_string(),
        }),
    }
}

/// Start and end of every entry batch.
pub fn entry_batches(count: usize) -> Vec<(usize, usize)> {
    let mut batches = Vec::new();
    let mut start = 0;
    while start < count {
        let end = (start + ENTRY_BATCH).min(count);
        batches.push((start, end));
        start = end;
    }
    batches
}

/// Writes the helper's messages, at most one progress message per interval.
struct Reporter {
    last_progress: Instant,
}

impl Reporter {
    fn progress(&mut self, progress: &OpProgress) {
        if self.last_progress.elapsed() < PROGRESS_INTERVAL {
            return;
        }
        self.last_progress = Instant::now();
        send(&HelperMessage::Progress {
            progress: progress.clone(),
        });
    }
}

impl archive::ExtractEvents for Reporter {
    fn progress(&mut self, progress: &OpProgress) {
        Reporter::progress(self, progress);
    }

    fn created(&mut self, path: &Path) {
        send(&HelperMessage::Created {
            path: path.to_string_lossy().into_owned(),
        });
    }
}

fn send(message: &HelperMessage) {
    let Ok(json) = serde_json::to_string(message) else {
        return;
    };
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{json}");
    let _ = lock.flush();
}

#[cfg(test)]
mod tests {
    use super::{entry_batches, HelperMessage, HelperRequest};
    use archive::ExtractRequest;

    fn extract_request() -> ExtractRequest {
        ExtractRequest {
            paths: vec!["docs/plan.md".to_string()],
            base: "docs".to_string(),
            dest_dir: "C:\\Out".to_string(),
            new_folder: None,
            expected_size: 1_000,
            expected_modified: 50,
            single_file: true,
            zone: None,
        }
    }

    #[test]
    fn requests_round_trip() {
        let list = HelperRequest::List {
            path: "C:\\a.zip".to_string(),
        };
        let json = serde_json::to_string(&list).unwrap();
        assert!(json.contains("\"op\":\"list\""));
        let back: HelperRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, HelperRequest::List { .. }));

        let extract = HelperRequest::Extract {
            path: "C:\\a.zip".to_string(),
            request: extract_request(),
        };
        let json = serde_json::to_string(&extract).unwrap();
        assert!(json.contains("\"op\":\"extract\""));
        let HelperRequest::Extract { request, .. } = serde_json::from_str(&json).unwrap() else {
            panic!("the extract request comes back");
        };
        assert_eq!(request.paths, ["docs/plan.md"]);
        assert_eq!(request.base, "docs");
        assert!(request.single_file);
    }

    #[test]
    fn messages_round_trip() {
        let failed = HelperMessage::Failed {
            code: "archive.corrupt".to_string(),
        };
        let json = serde_json::to_string(&failed).unwrap();
        assert!(json.contains("\"type\":\"failed\""));
        assert!(json.contains("archive.corrupt"));
        let back: HelperMessage = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, HelperMessage::Failed { .. }));

        let progress = HelperMessage::Progress {
            progress: fs_service::OpProgress {
                items_done: 3,
                items_total: 7,
                bytes_done: 120,
                bytes_total: 400,
                current: "C:\\Out\\a.txt".to_string(),
            },
        };
        let json = serde_json::to_string(&progress).unwrap();
        let back: HelperMessage = serde_json::from_str(&json).unwrap();
        let HelperMessage::Progress { progress } = back else {
            panic!("a progress message comes back");
        };
        assert_eq!(progress.items_done, 3);
        assert_eq!(progress.items_total, 7);
        assert_eq!(progress.bytes_done, 120);
        assert_eq!(progress.bytes_total, 400);
        assert_eq!(progress.current, "C:\\Out\\a.txt");
    }

    #[test]
    fn batches() {
        assert!(entry_batches(0).is_empty());
        assert_eq!(
            entry_batches(5_000),
            [(0, 2_000), (2_000, 4_000), (4_000, 5_000)]
        );
    }
}
