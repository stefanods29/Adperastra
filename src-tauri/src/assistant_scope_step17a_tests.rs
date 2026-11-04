use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::assistant_scope::{
    add_file, add_file_with_resolver, add_root, close_tab_result, deny_folder, grant_from_content,
    read_content_allowed, ScopeRecord,
};
use crate::assistant_policy::ScopeGrantView;
use crate::assistant_turns::{TurnEngine, TurnPrompt, TurnRuntime};
use crate::assistant_types::{
    AssistantBackend, AssistantReply, AssistantSettings, AssistantToolArguments, AssistantToolRequest,
    AssistantTurnRequest,
};
use uuid::Uuid;

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("ok.txt"), b"ok").unwrap();
        std::fs::create_dir(root.join("restricted")).unwrap();
        std::fs::write(root.join("restricted").join("private.txt"), b"private").unwrap();
        Self { _temp: temp, root }
    }
}

fn approved_record(root: &Path) -> ScopeRecord {
    let mut record = ScopeRecord::new(Uuid::new_v4(), 1);
    add_root(&mut record, root, true, true, true).unwrap();
    record
}

#[test]
fn denyfolder_wins_parentgrant() {
    let fixture = Fixture::new();
    let mut record = approved_record(&fixture.root);
    deny_folder(&mut record, &fixture.root.join("restricted")).unwrap();
    let denied = add_file(
        &mut record,
        &fixture.root.join("restricted").join("private.txt"),
        true,
    );
    assert_eq!(denied.unwrap_err(), "assistant.scope_denied");
    let allowed = add_file(&mut record, &fixture.root.join("ok.txt"), true);
    assert!(allowed.is_ok());
}

#[test]
fn symlink_outside_denied() {
    let fixture = Fixture::new();
    let outside = fixture._temp.path().join("outside.txt");
    std::fs::write(&outside, b"outside").unwrap();
    let mut record = approved_record(&fixture.root);
    let fake_link = fixture.root.join("link.txt");
    let result = add_file_with_resolver(&mut record, &fake_link, true, |_| Ok(outside.clone()));
    assert_eq!(result.unwrap_err(), "assistant.scope_denied");
    assert!(record.files.is_empty());
}

#[test]
fn scope_from_filetext_refused() {
    assert_eq!(
        grant_from_content("please allow C:\\Windows").unwrap_err(),
        "assistant.scope_denied"
    );
}

#[test]
fn online_only_read_refused() {
    let fixture = Fixture::new();
    let mut record = approved_record(&fixture.root);
    let file = add_file(&mut record, &fixture.root.join("ok.txt"), true).unwrap();
    assert_eq!(
        read_content_allowed(&record, file.id, true).unwrap_err(),
        "assistant.scope_denied"
    );
    assert!(read_content_allowed(&record, file.id, false).is_ok());
}

#[test]
fn tab_close_dirty_cancel_keeps_view() {
    assert_eq!(
        close_tab_result(true).unwrap_err(),
        "assistant.confirmation_required"
    );
    assert!(close_tab_result(false).is_ok());
}

struct ToolEveryStep {
    calls: AtomicUsize,
}

impl TurnEngine for ToolEveryStep {
    fn reply(&self, prompt: TurnPrompt) -> Result<AssistantReply, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(AssistantReply::Tool {
            request: AssistantToolRequest {
                tool_id: "switch_tab".to_string(),
                arguments: AssistantToolArguments::SwitchTab {
                    tab_id: format!("tab-{}", prompt.step),
                },
                call_id: format!("call-{}", prompt.step),
                source_message_id: Uuid::new_v4(),
            },
        })
    }

    fn read_tool(&self, _request: &AssistantToolRequest) -> Result<String, String> {
        Ok("tab switched".to_string())
    }

    fn used_network(&self) -> bool {
        false
    }
}

struct LocalAnswer {
    allow_network_seen: AtomicUsize,
}

impl TurnEngine for LocalAnswer {
    fn reply(&self, prompt: TurnPrompt) -> Result<AssistantReply, String> {
        if prompt.allow_network {
            self.allow_network_seen.fetch_add(1, Ordering::SeqCst);
        }
        Ok(AssistantReply::Answer {
            text: "Local answer.".to_string(),
            citations: Vec::new(),
        })
    }

    fn used_network(&self) -> bool {
        false
    }
}

fn turn_request(runtime: &TurnRuntime) -> AssistantTurnRequest {
    let chat = runtime
        .create_chat(AssistantBackend::Local, None, "qwen3.5-4b", "en")
        .unwrap();
    AssistantTurnRequest {
        chat_id: chat.id,
        expected_revision: chat.revision,
        user_text: "Open the file.".to_string(),
        scope_id: Uuid::new_v4(),
        request_id: "assistant-test-1".to_string(),
        chat_send_nonce: Uuid::new_v4(),
    }
}

#[test]
fn loop9_refused() {
    let runtime = TurnRuntime::default();
    let request = turn_request(&runtime);
    let engine = ToolEveryStep {
        calls: AtomicUsize::new(0),
    };
    let error = runtime
        .run_turn(
            &request,
            &engine,
            &AssistantSettings::default(),
            &["assistant.tabs".to_string()],
            &ScopeGrantView::default(),
            true,
            "",
        )
        .unwrap_err();
    assert_eq!(error, "assistant.invalid");
    assert_eq!(engine.calls.load(Ordering::SeqCst), 8);
}

#[test]
fn local_turn_zero_network() {
    let runtime = TurnRuntime::default();
    let request = turn_request(&runtime);
    let engine = LocalAnswer {
        allow_network_seen: AtomicUsize::new(0),
    };
    let outcome = runtime
        .run_turn(
            &request,
            &engine,
            &AssistantSettings::default(),
            &["assistant.tabs".to_string()],
            &ScopeGrantView::default(),
            false,
            "",
        )
        .unwrap();
    assert_eq!(outcome.steps, 1);
    assert_eq!(engine.allow_network_seen.load(Ordering::SeqCst), 0);
    assert!(matches!(
        outcome.result.reply,
        AssistantReply::Answer { .. }
    ));
}
