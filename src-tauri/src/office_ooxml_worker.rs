//! First-party helper lifetime. No engine receives a user's source path.
use crate::{
    engine_io::StreamItem,
    engine_security::{ConfinedProcess, EngineLaunch, EngineSandbox, StdoutMode},
    office_edit_types::OfficeEditError as Error,
    office_edit_worker_protocol::{self as wire, WorkerCommand, WorkerPayload},
};
use fs_service::owned_io::{ClosedOutput, OwnedOutput, PinnedDirectory};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    sync::mpsc::{self, Receiver},
    time::Duration,
};
use uuid::Uuid;

pub const FLAG: &str = "--office-ooxml-worker";

pub struct OfficeWorker {
    process: ConfinedProcess,
    replies: Receiver<StreamItem>,
    input: Option<ClosedOutput>,
    pub revision: u64,
    failed: bool,
}

impl Drop for OfficeWorker {
    fn drop(&mut self) {
        self.process.terminate();
        let _ = self.process.wait(Duration::from_millis(250));
        if let Some(input) = self.input.take() {
            let _ = input.dispose();
        }
    }
}

impl OfficeWorker {
    pub fn open(root: &Path, kind: &str, bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty()
            || bytes.len() as u64 > wire::MAX_WORKER_ARCHIVE
            || !matches!(kind, "docx" | "xlsx" | "pptx")
        {
            return Err(Error::Unsupported);
        }
        let path = root.join("office-edit").join(Uuid::new_v4().to_string());
        fs::create_dir_all(&path).map_err(|_| Error::Failed)?;
        let directory = PinnedDirectory::open(&path).map_err(|_| Error::Failed)?;
        let mut input = OwnedOutput::create_named(&directory, &format!("input.{kind}"))
            .map_err(|_| Error::Failed)?;
        input
            .file_mut()
            .write_all(bytes)
            .map_err(|_| Error::Failed)?;
        input.flush_sync().map_err(|_| Error::Failed)?;
        let closed = input.close();
        let result = Self::launch(&path, &closed);
        let (process, replies) = match result {
            Ok(result) => result,
            Err(error) => {
                let _ = closed.dispose();
                return Err(error);
            }
        };
        let mut worker = Self {
            process,
            replies,
            input: Some(closed),
            revision: 1,
            failed: false,
        };
        worker.request(&WorkerCommand::Validate {})?;
        Ok(worker)
    }

    fn launch(
        path: &Path,
        input: &ClosedOutput,
    ) -> Result<(ConfinedProcess, Receiver<StreamItem>), Error> {
        let sandbox = EngineSandbox::prepare().map_err(|_| Error::Failed)?;
        let program = std::env::current_exe().map_err(|_| Error::Failed)?;
        sandbox
            .grant_read(program.parent().ok_or(Error::Failed)?)
            .map_err(|_| Error::Failed)?;
        // The worker can read its private input and never writes a file.
        sandbox.grant_read(path).map_err(|_| Error::Failed)?;
        let arguments = [FLAG.to_owned(), input.path().to_string_lossy().into_owned()]
            .iter()
            .map(|s| crate::media_arguments::quote_argument(s))
            .collect::<Vec<_>>()
            .join(" ");
        let mut process = crate::engine_security::spawn_confined(
            &sandbox,
            &EngineLaunch {
                program: &program,
                arguments,
                working_directory: path,
                environment: vec![(
                    "SystemRoot".to_owned(),
                    std::env::var("SystemRoot").map_err(|_| Error::Failed)?,
                )],
                memory_bytes: 256 * 1024 * 1024,
                cpu_percent: 100,
                stdout_mode: StdoutMode::Raw,
            },
        )
        .map_err(|_| Error::Failed)?;
        let reader = process.take_stdout_reader().ok_or(Error::Failed)?;
        let (sender, receiver) = mpsc::sync_channel(2);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            loop {
                let mut bytes = Vec::new();
                let read = (&mut reader)
                    .take(wire::MAX_WORKER_FRAME as u64 + 1)
                    .read_until(b'\n', &mut bytes);
                let item = match read {
                    Ok(0) => StreamItem::Closed,
                    Ok(_)
                        if bytes.len() <= wire::MAX_WORKER_FRAME
                            && bytes.last() == Some(&b'\n') =>
                    {
                        match String::from_utf8(bytes) {
                            Ok(line) => StreamItem::Line(line),
                            Err(_) => StreamItem::Overflow,
                        }
                    }
                    _ => StreamItem::Overflow,
                };
                let terminal = !matches!(item, StreamItem::Line(_));
                if sender.send(item).is_err() || terminal {
                    break;
                }
            }
        });
        Ok((process, receiver))
    }

    pub fn request(&mut self, command: &WorkerCommand) -> Result<WorkerPayload, Error> {
        if self.failed {
            return Err(Error::Failed);
        }
        let id = Uuid::new_v4();
        let frame = wire::encode(id, self.revision, command)?;
        let timeout = Duration::from_secs(10);
        let deadline = self.process.deadline(timeout).map_err(|_| Error::Failed)?;
        let result = (|| {
            self.process
                .write_stdin(&frame)
                .map_err(|_| Error::Failed)?;
            let line = match self
                .replies
                .recv_timeout(timeout)
                .map_err(|_| Error::Timeout)?
            {
                StreamItem::Line(line) => line,
                _ => return Err(Error::Failed),
            };
            let (revision, payload) = wire::decode(line.as_bytes(), id, self.revision, command)?;
            Ok((revision, payload))
        })();
        let result = if deadline.finish() {
            Err(Error::Timeout)
        } else {
            result.map(|(revision, payload)| {
                self.revision = revision;
                payload
            })
        };
        if matches!(&result, Err(error) if *error != Error::Unsupported && *error != Error::Invalid && *error != Error::TooLarge)
        {
            self.failed = true;
            self.process.terminate();
        }
        result
    }

    pub fn capture(&mut self, output: &mut dyn Write) -> Result<u64, Error> {
        let WorkerPayload::Snapshot(snapshot) = self.request(&WorkerCommand::Snapshot {})? else {
            return Err(Error::Failed);
        };
        let result = (|| {
            let mut offset = 0;
            while offset < snapshot.size_bytes as usize {
                let WorkerPayload::Chunk(chunk) = self.request(&WorkerCommand::SnapshotRead {
                    snapshot_id: snapshot.snapshot_id,
                    offset,
                })?
                else {
                    return Err(Error::Failed);
                };
                if chunk.bytes.len() > snapshot.size_bytes as usize - offset {
                    return Err(Error::Failed);
                }
                output.write_all(&chunk.bytes).map_err(|_| Error::Failed)?;
                offset += chunk.bytes.len();
            }
            Ok(snapshot.size_bytes)
        })();
        let release = self.request(&WorkerCommand::SnapshotRelease {
            snapshot_id: snapshot.snapshot_id,
        });
        result.and_then(|size| release.map(|_| size))
    }
}

pub fn helper() -> i32 {
    let Some(path) = std::env::args_os().nth(2) else {
        return 1;
    };
    i32::from(ooxml_editor_probe::run_memory_worker(Path::new(&path)).is_err())
}
