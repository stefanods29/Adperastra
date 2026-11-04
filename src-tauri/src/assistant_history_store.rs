//! Encrypted optional assistant history (Step 17a T7/D12).
//!
//! Off by default: no directory and no bytes until the user enables history
//! and a chat is written. Each chat is one DPAPI-protected file under the
//! current profile; sensitive sessions stay in RAM. Clear removes only the
//! files this store owns.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use fs_service::atomic_write;
use uuid::Uuid;

use crate::assistant_credentials::SecretProtector;
use crate::assistant_types::{AssistantConversation, AssistantMessage};

pub const MAX_HISTORY_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_HISTORY_CHATS: usize = 100;
pub const MAX_MESSAGES_PER_CHAT: usize = 200;
pub const RETENTION_DAYS: u64 = 30;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct StoredChat {
    schema_version: u32,
    conversation: AssistantConversation,
    updated_unix: u64,
    sensitive: bool,
}

pub struct HistoryStore {
    root: PathBuf,
    protector: Arc<dyn SecretProtector>,
    enabled: bool,
    sensitive_ram: Mutex<Vec<AssistantConversation>>,
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

impl HistoryStore {
    pub fn new(root: PathBuf, protector: Arc<dyn SecretProtector>, enabled: bool) -> Self {
        Self {
            root,
            protector,
            enabled,
            sensitive_ram: Mutex::new(Vec::new()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    fn history_dir(&self) -> PathBuf {
        self.root.join("assistant-history")
    }

    fn chat_path(&self, chat_id: Uuid) -> PathBuf {
        self.history_dir().join(format!("{chat_id}.enc"))
    }

    /// Append or replace one chat. Disabled history has zero disk effects.
    pub fn append(
        &self,
        conversation: &AssistantConversation,
        sensitive: bool,
    ) -> Result<bool, String> {
        if sensitive {
            if let Ok(mut ram) = self.sensitive_ram.lock() {
                if ram.len() >= MAX_HISTORY_CHATS {
                    ram.remove(0);
                }
                ram.push(conversation.clone());
            }
            return Ok(false);
        }
        if !self.enabled {
            return Ok(false);
        }
        let trimmed = AssistantConversation {
            messages: conversation
                .messages
                .iter()
                .rev()
                .take(MAX_MESSAGES_PER_CHAT)
                .cloned()
                .collect::<Vec<AssistantMessage>>()
                .into_iter()
                .rev()
                .collect(),
            ..conversation.clone()
        };
        let stored = StoredChat {
            schema_version: 1,
            conversation: trimmed,
            updated_unix: now_unix(),
            sensitive: false,
        };
        let plaintext =
            serde_json::to_vec(&stored).map_err(|_| "assistant.history_failed".to_string())?;
        if plaintext.len() as u64 > MAX_HISTORY_BYTES {
            return Err("assistant.history_failed".to_string());
        }
        let ciphertext = self.protector.protect(&plaintext)?;
        let dir = self.history_dir();
        std::fs::create_dir_all(&dir).map_err(|_| "assistant.history_failed".to_string())?;
        atomic_write(&self.chat_path(conversation.id), &ciphertext)
            .map_err(|_| "assistant.history_failed".to_string())?;
        self.trim()?;
        Ok(true)
    }

    /// Read every owned chat. A corrupt file is preserved and reported, never
    /// deleted or silently replaced.
    pub fn load_all(&self) -> Result<Vec<AssistantConversation>, String> {
        if !self.enabled {
            return Ok(Vec::new());
        }
        let dir = self.history_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut chats = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|_| "assistant.history_failed".to_string())? {
            let entry = entry.map_err(|_| "assistant.history_failed".to_string())?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("enc") {
                continue;
            }
            let ciphertext =
                std::fs::read(&path).map_err(|_| "assistant.history_failed".to_string())?;
            let mut plaintext = self
                .protector
                .unprotect(&ciphertext)
                .map_err(|_| "assistant.history_failed".to_string())?;
            let stored: StoredChat = match serde_json::from_slice(&plaintext) {
                Ok(value) => value,
                Err(_) => {
                    plaintext.fill(0);
                    return Err("assistant.history_failed".to_string());
                }
            };
            plaintext.fill(0);
            if now_unix().saturating_sub(stored.updated_unix) <= RETENTION_DAYS * 86_400 {
                chats.push(stored.conversation);
            }
        }
        chats.sort_by_key(|chat| chat.created_unix);
        chats.truncate(MAX_HISTORY_CHATS);
        Ok(chats)
    }

    /// Remove only `.enc` files this store owns. A user's other files stay.
    pub fn clear(&self) -> Result<usize, String> {
        let dir = self.history_dir();
        if !dir.exists() {
            return Ok(0);
        }
        let mut removed = 0;
        for entry in std::fs::read_dir(&dir).map_err(|_| "assistant.history_failed".to_string())? {
            let entry = entry.map_err(|_| "assistant.history_failed".to_string())?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("enc") {
                std::fs::remove_file(&path).map_err(|_| "assistant.history_failed".to_string())?;
                removed += 1;
            }
        }
        if let Ok(mut ram) = self.sensitive_ram.lock() {
            ram.clear();
        }
        Ok(removed)
    }

    fn trim(&self) -> Result<(), String> {
        let dir = self.history_dir();
        let mut files = Vec::new();
        let mut total = 0u64;
        for entry in std::fs::read_dir(&dir).map_err(|_| "assistant.history_failed".to_string())? {
            let entry = entry.map_err(|_| "assistant.history_failed".to_string())?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("enc") {
                continue;
            }
            let meta = entry
                .metadata()
                .map_err(|_| "assistant.history_failed".to_string())?;
            total += meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            files.push((modified, path, meta.len()));
        }
        files.sort_by_key(|(modified, _, _)| *modified);
        while files.len() > MAX_HISTORY_CHATS || total > MAX_HISTORY_BYTES {
            if files.is_empty() {
                break;
            }
            let (_, path, len) = files.remove(0);
            std::fs::remove_file(path).map_err(|_| "assistant.history_failed".to_string())?;
            total = total.saturating_sub(len);
        }
        Ok(())
    }

    /// A portable export never includes credential files.
    pub fn export(&self, dest: &Path) -> Result<Vec<PathBuf>, String> {
        let chats = self.load_all()?;
        let mut written = Vec::new();
        let payload = serde_json::json!({
            "schema_version": 1,
            "chats": chats
        });
        let bytes = serde_json::to_vec(&payload).map_err(|_| "assistant.history_failed".to_string())?;
        // Export never replaces an existing user file (R-SAFE-2).
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest)
            .map_err(|_| "assistant.history_failed".to_string())?;
        use std::io::Write;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "assistant.history_failed".to_string())?;
        written.push(dest.to_path_buf());
        Ok(written)
    }
}
