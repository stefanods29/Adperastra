//! First-party bounded OOXML worker, also exercised by the preflight binary.

pub fn run_memory_worker(source: &std::path::Path) -> std::result::Result<(), String> {
    protocol::run_memory(source).map_err(|_| "office_edit.failed".to_owned())
}

pub fn run_fixture() -> std::result::Result<(), String> {
    main().map_err(|_| "office_edit.failed".to_owned())
}

include!("main.rs");
