use super::*;
use std::sync::Arc;

use uuid::Uuid;

use crate::assistant_credentials::SecretProtector;
use crate::assistant_history_store::HistoryStore;
use crate::assistant_scope::{add_root, ScopeRecord, ScopeRegistry};
use crate::assistant_types::{AssistantBackend, AssistantConversation};

struct XorProtector;

impl SecretProtector for XorProtector {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(plaintext.iter().map(|byte| byte ^ 0x33).collect())
    }

    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(ciphertext.iter().map(|byte| byte ^ 0x33).collect())
    }
}

fn conversation(text: &str) -> AssistantConversation {
    AssistantConversation {
        id: Uuid::new_v4(),
        backend: AssistantBackend::Local,
        provider_id: None,
        model_id: "qwen3.5-4b".to_string(),
        locale: "en".to_string(),
        revision: 1,
        messages: vec![crate::assistant_types::AssistantMessage {
            id: Uuid::new_v4(),
            role: "assistant".to_string(),
            plain_text: text.to_string(),
            citations: Vec::new(),
            status: "done".to_string(),
            error_code: None,
            backend: AssistantBackend::Local,
            provider_id: None,
            model_id: "qwen3.5-4b".to_string(),
        }],
        created_unix: 1,
    }
}

#[test]
fn default_history_off_zero_disk() {
    let temp = tempfile::tempdir().unwrap();
    let store = HistoryStore::new(
        temp.path().to_path_buf(),
        Arc::new(XorProtector),
        false,
    );
    assert!(!store.append(&conversation("hello"), false).unwrap());
    assert!(!temp.path().join("assistant-history").exists());
}

#[test]
fn dpapi_ciphertext_not_plain() {
    let temp = tempfile::tempdir().unwrap();
    let store = HistoryStore::new(temp.path().to_path_buf(), Arc::new(XorProtector), true);
    let chat = conversation("Secret message");
    assert!(store.append(&chat, false).unwrap());
    let path = temp
        .path()
        .join("assistant-history")
        .join(format!("{}.enc", chat.id));
    let bytes = std::fs::read(path).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("Secret message"));
    let loaded = store.load_all().unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].messages[0].plain_text, "Secret message");
}

#[test]
fn profile_switch_revokes_grants() {
    let temp = tempfile::tempdir().unwrap();
    let registry = ScopeRegistry::default();
    let chat = Uuid::new_v4();
    let mut record = ScopeRecord::new(chat, 1);
    add_root(&mut record, temp.path(), true, true, true).unwrap();
    let scope_id = record.id;
    registry.insert(record).unwrap();
    assert!(registry.get(scope_id).is_ok());
    registry.invalidate_all(2).unwrap();
    assert!(registry.get(scope_id).is_err());
    assert!(registry.get_by_chat(chat).is_err());
}

#[test]
fn corrupt_history_preserved_and_error() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("assistant-history");
    std::fs::create_dir_all(&dir).unwrap();
    let bad = dir.join("bad.enc");
    std::fs::write(&bad, b"not a protected record").unwrap();
    let store = HistoryStore::new(temp.path().to_path_buf(), Arc::new(XorProtector), true);
    assert_eq!(
        store.load_all().unwrap_err(),
        "assistant.history_failed"
    );
    assert!(bad.exists());
}

#[test]
fn clear_keeps_userfiles() {
    let temp = tempfile::tempdir().unwrap();
    let user = temp.path().join("user.txt");
    std::fs::write(&user, b"keep me").unwrap();
    let dir = temp.path().join("assistant-history");
    std::fs::create_dir_all(&dir).unwrap();
    let keep = dir.join("keep.txt");
    std::fs::write(&keep, b"keep me too").unwrap();
    let store = HistoryStore::new(temp.path().to_path_buf(), Arc::new(XorProtector), true);
    store.append(&conversation("chat"), false).unwrap();
    assert!(store.clear().unwrap() >= 1);
    assert!(user.exists());
    assert!(keep.exists());
}

#[test]
fn portable_export_omits_keys() {
    let temp = tempfile::tempdir().unwrap();
    let store = HistoryStore::new(temp.path().to_path_buf(), Arc::new(XorProtector), true);
    store.append(&conversation("chat"), false).unwrap();
    let credential = temp.path().join("profiles/p/assistant/provider-meta.cred");
    std::fs::create_dir_all(credential.parent().unwrap()).unwrap();
    std::fs::write(&credential, b"dummy-secret-value").unwrap();
    let dest = temp.path().join("portable-history.json");
    let written = store.export(&dest).unwrap();
    assert_eq!(written.len(), 1);
    let text = std::fs::read_to_string(&dest).unwrap();
    assert!(!text.contains("dummy-secret-value"));
    assert!(!text.contains("provider-meta.cred"));
    assert!(credential.exists());
}

#[test]
fn schema43_migrates_backendlocal() {
    let migrated = migrate_assistant_settings(&serde_json::json!({}), 43);
    assert_eq!(migrated.backend, AssistantBackend::Local);
    assert_eq!(migrated.provider_id, crate::assistant_types::AssistantProviderId::Meta);
    assert!(!migrated.keep_history);
    assert!(!migrated.enabled);
}
