#[path = "../../../src-tauri/src/engine_deadline.rs"]
mod engine_deadline;
#[path = "../../../src-tauri/src/engine_desktop.rs"]
mod engine_desktop;
#[path = "../../../src-tauri/src/engine_io.rs"]
mod engine_io;
#[path = "../../../src-tauri/src/engine_security.rs"]
mod engine_security;
#[path = "../../../src-tauri/src/office_kit_arguments.rs"]
mod office_kit_arguments;
mod engine_types {
    pub const MAX_STDERR_CODES: usize = 64;
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum EngineDiagnostic {
        SandboxDenied,
        NoSpace,
        UnsupportedCodec,
        DecoderFailed,
        BadArguments,
        MissingInput,
        MacrosBlocked,
        ExternalLinkBlocked,
        Unknown,
    }
    pub enum EngineError {
        SandboxFailed,
        Failed,
    }
    impl EngineError {
        pub fn message(&self) -> String {
            "engines.sandbox_failed".into()
        }
    }
}
mod engine_session_types {
    pub const MAX_CONTROL_FRAME_BYTES: usize = 786432;
}
mod engine_session_protocol {
    pub fn read_frame<R: std::io::Read>(_: &mut R, _: usize) -> Result<Option<(u8, Vec<u8>)>, ()> {
        panic!("The isolated preflight uses line mode only")
    }
}
use engine_security::{spawn_confined, EngineLaunch, EngineSandbox, StdoutMode};
#[path = "../../../src-tauri/src/office_edit_worker_protocol.rs"]
mod office_edit_worker_protocol;
#[path = "../../../src-tauri/src/office_ooxml_sheet_protocol.rs"]
mod office_ooxml_sheet_protocol;
mod office_edit_types {
    #[derive(Debug)]
    pub enum OfficeEditError {
        Invalid,
        Failed,
        Unsupported,
        TooLarge,
    }
}
mod office_edit_values {
    pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
}
use std::{
    env,
    path::PathBuf,
    time::{Duration, Instant},
};
fn main() -> Result<(), String> {
    let args: Vec<_> = env::args().skip(1).collect();
    let program = PathBuf::from(&args[0]);
    let source = PathBuf::from(&args[1]);
    let kind = source.extension().unwrap().to_string_lossy();
    let scratch = env::temp_dir().join(format!("adp-confined-edit-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&scratch).map_err(|e| e.to_string())?;
    let private = scratch.join("granted");
    let foreign = scratch.join("ungranted");
    std::fs::create_dir(&private).map_err(|e| e.to_string())?;
    std::fs::create_dir(&foreign).map_err(|e| e.to_string())?;
    let input = private.join(format!("input.{kind}"));
    let output = private.join(format!("edited.{kind}"));
    let inaccessible = foreign.join(format!("input.{kind}"));
    let denied_output = foreign.join(format!("edited.{kind}"));
    std::fs::copy(&source, &input).map_err(|e| e.to_string())?;
    std::fs::copy(&source, &inaccessible).map_err(|e| e.to_string())?;
    let sandbox = EngineSandbox::prepare()?;
    sandbox.grant_read(program.parent().ok_or("missing program parent")?)?;
    sandbox.grant_private(&private)?;
    let run = |input: &std::path::Path,
               output: &std::path::Path,
               denial: bool|
     -> Result<(i32, u128), String> {
        let arguments = format!("worker \"{}\" \"{}\"", input.display(), output.display());
        let start = Instant::now();
        let mut child = spawn_confined(
            &sandbox,
            &EngineLaunch {
                program: &program,
                arguments,
                working_directory: &private,
                environment: vec![
                    ("SystemRoot".into(), env::var("SystemRoot").unwrap()),
                    ("TEMP".into(), private.display().to_string()),
                    ("TMP".into(), private.display().to_string()),
                ],
                memory_bytes: 256 * 1024 * 1024,
                cpu_percent: 100,
                stdout_mode: StdoutMode::Lines,
            },
        )?;
        let lines = child.take_stdout_lines().unwrap();
        let mut revision = 1;
        let mut exchange = |expected: u64,
                            command: serde_json::Value|
         -> Result<serde_json::Value, String> {
            let id = uuid::Uuid::new_v4().to_string();
            use office_edit_worker_protocol::{WorkerCommand, WorkerEdit, WorkerValue};
            let typed = match command["kind"].as_str().ok_or("missing command")? {
                "list" => WorkerCommand::List {
                    section_index: command["section_index"].as_u64().unwrap() as usize,
                    start: command["start"].as_u64().unwrap() as usize,
                },
                "edit" => WorkerCommand::Edit {
                    operations: command["operations"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|e| WorkerEdit {
                            selection_id: uuid::Uuid::parse_str(
                                e["selection_id"].as_str().unwrap(),
                            )
                            .unwrap(),
                            value: WorkerValue::Text(e["value"]["value"].as_str().unwrap().into()),
                        })
                        .collect(),
                },
                "undo" => WorkerCommand::Undo {},
                "redo" => WorkerCommand::Redo {},
                "capture" => WorkerCommand::Capture {},
                "close" => WorkerCommand::Close {},
                _ => return Err("unknown fixture command".into()),
            };
            let uuid = uuid::Uuid::parse_str(&id).unwrap();
            let frame = office_edit_worker_protocol::encode(uuid, expected, &typed)
                .map_err(|_| "native request validation")?;
            child.write_stdin(&frame)?;
            let line = match lines
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| "reply deadline")?
            {
                engine_io::StreamItem::Line(line) => line,
                _ => return Err("worker closed or exceeded bound".into()),
            };
            let reply: serde_json::Value =
                serde_json::from_str(&line).map_err(|_| "invalid reply")?;
            if reply["request_id"] != id {
                return Err("wrong reply identity".into());
            }
            if expected == revision {
                match office_edit_worker_protocol::decode(line.as_bytes(), uuid, expected, &typed) {
                    Ok(_) | Err(office_edit_types::OfficeEditError::Unsupported) => {}
                    Err(_) => return Err("native reply validation".into()),
                }
            }
            revision = reply["revision"].as_u64().ok_or("missing revision")?;
            Ok(reply)
        };
        if denial {
            // A read denial may terminate before a reply. A write denial must
            // leave capture absent, then the worker can close normally.
            let captured = exchange(1, serde_json::json!({"kind":"capture"}));
            match captured {
                Ok(reply) if reply["result"].get("Err").is_some() => {
                    exchange(1, serde_json::json!({"kind":"close"}))?;
                }
                Err(_) => {}
                _ => return Err("foreign capture succeeded".into()),
            }
        } else {
            let mut start = 0;
            let selected = loop {
                let reply = exchange(
                    1,
                    serde_json::json!({"kind":"list","section_index":0,"start":start}),
                )?;
                let page = reply["result"].get("Ok").ok_or("list failed")?;
                let items = page["items"].as_array().ok_or("missing listed targets")?;
                if let Some(item) = items.iter().find(|item| {
                    item["address"].as_str().or_else(|| item["text"].as_str())
                        == Some(args[2].as_str())
                }) {
                    break item["id"].clone();
                }
                start = page["next_start"].as_u64().ok_or("target not listed")?;
            };
            let command = serde_json::json!({"kind":"edit","operations":[{"selection_id":selected,"value":{"kind":"text","value":args[3]}}]});
            let edited = exchange(1, command.clone())?;
            if edited["revision"] != 2 || edited["result"].get("Ok").is_none() {
                return Err("edit failed".into());
            }
            let stale = exchange(1, command)?;
            if stale["revision"] != 2 || stale["result"].get("Err").is_none() {
                return Err("stale edit mutated".into());
            }
            let undo = exchange(2, serde_json::json!({"kind":"undo"}))?;
            if undo["revision"] != 3 || undo["result"].get("Ok").is_none() {
                return Err("undo failed".into());
            }
            let redo = exchange(3, serde_json::json!({"kind":"redo"}))?;
            if redo["revision"] != 4 || redo["result"].get("Ok").is_none() {
                return Err("redo failed".into());
            }
            let captured = exchange(4, serde_json::json!({"kind":"capture"}))?;
            if captured["revision"] != 4 || captured["result"].get("Ok").is_none() {
                return Err("capture failed".into());
            }
            let duplicate = exchange(4, serde_json::json!({"kind":"capture"}))?;
            if duplicate["result"].get("Err").is_none() {
                return Err("capture replaced existing output".into());
            }
            exchange(4, serde_json::json!({"kind":"close"}))?;
        }
        drop(exchange);
        child.close_stdin();
        let code = child
            .wait(Duration::from_secs(10))
            .ok_or("worker deadline")?;
        if !denial && revision != 4 {
            return Err("wrong final revision".into());
        }
        Ok((code, start.elapsed().as_millis()))
    };
    let (code, elapsed) = run(&input, &output, false)?;
    if code != 0 || !output.is_file() {
        return Err(format!("confined edit failed: {code}"));
    }
    let forbidden_input_out = private.join("denied-input-output");
    if run(&inaccessible, &forbidden_input_out, true)?.0 == 0 || forbidden_input_out.exists() {
        return Err("worker read an ungranted file".into());
    }
    if run(&input, &denied_output, true)?.0 != 0 || denied_output.exists() {
        return Err("worker wrote outside its work directory".into());
    }
    println!(
        "elapsed_ms={elapsed} output={} denied_foreign_read_and_write=true",
        output.display()
    );
    Ok(())
}
