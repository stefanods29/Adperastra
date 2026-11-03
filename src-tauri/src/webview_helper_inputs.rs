#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! Input grants of the trusted WebView helper host (Step 07d E7, persistent
//! input replacement).
//!
//! The parent owns the *allowlist*: which files a child may read, under
//! which grant id, and whether any of them is sensitive. The child owns the
//! *tokens*: the 32-hex URLs its own `adpfile` protocol serves. A replacement
//! is a transaction: the parent sends manifests, the child answers with
//! browser-safe grants, and only that answer swaps the allowlist. Anything
//! else (a malformed body, a stale update id, a reused grant id, a timeout)
//! leaves no half-updated session behind.
//!
//! Nothing here holds a lock while doing disk work, and no sensitive byte is
//! accepted before the private-profile proof (webview_private.rs).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::file_grant_backing::GrantedBacking;
use crate::webview_helper_types::{
    HelperGrantDTO, HelperInputGrant, HelperInputManifest, HelperInputManifestSource,
    HelperInputSource, MAX_AGGREGATE_MEMORY, MAX_GRANT_NAME, MAX_INPUTS, MAX_MEMORY_SOURCE,
    MAX_MIME, MAX_TOKEN_URL,
};

/// The parent's guard around one pinned disk source. The type alias keeps
/// the helper host independent of the fs-service spelling.
pub type PinnedSourceHandle = fs_service::owned_io::PinnedSource;

/// One replacement in flight (native-only).
pub struct PendingUpdate {
    pub update_id: Uuid,
    pub grants: Vec<HelperInputGrant>,
    pub memory_bytes: u64,
}

/// The parent's committed allowlist plus its pending replacement.
#[derive(Default)]
pub struct InputRegistry {
    current: Vec<HelperInputGrant>,
    browser_grants: Vec<HelperGrantDTO>,
    pending: Option<PendingUpdate>,
    sensitive: bool,
    generation: u64,
    next_update: AtomicU64,
}

impl InputRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn current(&self) -> &[HelperInputGrant] {
        &self.current
    }

    /// The browser-safe grants of the committed allowlist.
    pub fn browser_grants(&self) -> &[HelperGrantDTO] {
        &self.browser_grants
    }

    /// Once true, every later result stays memory-only (sticky, E7).
    pub fn is_sensitive(&self) -> bool {
        self.sensitive
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn pending(&self) -> Option<&PendingUpdate> {
        self.pending.as_ref()
    }

    pub fn aggregate_memory(&self) -> u64 {
        self.current
            .iter()
            .map(|grant| grant.source.memory_bytes())
            .sum()
    }

    /// Begin a complete replacement. A request in flight, an unfinished
    /// replacement, a repeated grant id, a sensitive source without a
    /// private-profile proof, or a budget overflow refuses the whole thing.
    pub fn begin_update(
        &mut self,
        grants: Vec<HelperInputGrant>,
        request_active: bool,
        private_confirmed: bool,
    ) -> Result<Uuid, String> {
        self.begin_update_with_budget(
            grants,
            request_active,
            private_confirmed,
            MAX_AGGREGATE_MEMORY,
        )
    }

    /// `begin_update` with an explicit aggregate budget. The budget is a
    /// constant in production; tests shrink it so they never allocate a
    /// gigabyte to prove the cap holds.
    pub fn begin_update_with_budget(
        &mut self,
        grants: Vec<HelperInputGrant>,
        request_active: bool,
        private_confirmed: bool,
        aggregate_cap: u64,
    ) -> Result<Uuid, String> {
        if request_active || self.pending.is_some() {
            return Err("helper.busy".to_string());
        }
        if grants.len() > MAX_INPUTS || grants.iter().any(|grant| !grant.is_valid()) {
            return Err("pdf.bad_request".to_string());
        }
        let mut seen = std::collections::HashSet::new();
        for grant in &grants {
            if !seen.insert(grant.grant_id) {
                return Err("pdf.bad_request".to_string());
            }
            if self
                .current
                .iter()
                .any(|existing| existing.grant_id == grant.grant_id)
            {
                // A new update must mint fresh grant ids.
                return Err("pdf.bad_request".to_string());
            }
        }
        let memory_bytes: u64 = grants.iter().map(|grant| grant.source.memory_bytes()).sum();
        if memory_bytes > aggregate_cap
            || self.aggregate_memory().saturating_add(memory_bytes) > aggregate_cap
        {
            return Err("helper.too_large".to_string());
        }
        let wants_sensitive = grants.iter().any(|grant| grant.source.is_sensitive());
        if wants_sensitive && !private_confirmed {
            return Err("helper.sensitive_unsupported".to_string());
        }
        self.next_update.fetch_add(1, Ordering::Relaxed);
        let update_id = Uuid::new_v4();
        self.pending = Some(PendingUpdate {
            update_id,
            grants,
            memory_bytes,
        });
        Ok(update_id)
    }

    /// Commit the replacement when the child answered with exactly the same
    /// grant ids and valid tokens. A stale id changes nothing.
    pub fn commit(
        &mut self,
        update_id: Uuid,
        browser_grants: Vec<HelperGrantDTO>,
    ) -> Result<(), String> {
        let Some(pending) = self.pending.as_ref() else {
            return Err("helper.failed".to_string());
        };
        if pending.update_id != update_id {
            return Err("helper.failed".to_string());
        }
        if browser_grants.len() != pending.grants.len()
            || browser_grants
                .iter()
                .any(|grant| !grant.is_valid() || !is_upload_like(&grant.token_url))
        {
            return Err("helper.failed".to_string());
        }
        for expected in &pending.grants {
            let Some(answer) = browser_grants
                .iter()
                .find(|grant| grant.grant_id == expected.grant_id)
            else {
                return Err("helper.failed".to_string());
            };
            if answer.name != expected.name || answer.mime != expected.mime {
                return Err("helper.failed".to_string());
            }
            match (&expected.source, answer.byte_len) {
                (HelperInputSource::Disk { .. }, _) => {}
                (HelperInputSource::Memory { data, .. }, length) => {
                    if length != data.len() as u64 {
                        return Err("helper.failed".to_string());
                    }
                }
                (HelperInputSource::Snapshot { backing, .. }, length) => {
                    if length != backing.length() {
                        return Err("helper.failed".to_string());
                    }
                }
            }
        }
        let sensitive = self.sensitive
            || pending
                .grants
                .iter()
                .any(|grant| grant.source.is_sensitive());
        self.current = pending.grants.clone();
        self.browser_grants = browser_grants;
        self.sensitive = sensitive;
        self.pending = None;
        self.generation += 1;
        Ok(())
    }

    /// Drop the pending replacement. The committed allowlist is unchanged;
    /// only the owned new resources are released (they live in `pending`).
    pub fn abort(&mut self) {
        self.pending = None;
    }
}

fn is_upload_like(token_url: &str) -> bool {
    token_url.len() <= MAX_TOKEN_URL && token_url.starts_with("http://adpfile.localhost/")
}

/// One token the child serves.
pub struct ChildGrant {
    pub grant_id: Uuid,
    pub dto: HelperGrantDTO,
    pub backing: Arc<GrantedBacking>,
}

/// The child's token registry. A token is minted here (the child is the only
/// process that has the bytes), and the parent accepts it only through the
/// matching grant id.
#[derive(Default)]
pub struct ChildGrants {
    by_token: Mutex<HashMap<String, Arc<ChildGrant>>>,
}

impl ChildGrants {
    pub fn new() -> Self {
        Self::default()
    }

    /// Install one grant; returns the browser-safe DTO the child reports.
    pub fn install(
        &self,
        grant_id: Uuid,
        name: &str,
        mime: &str,
        backing: Arc<GrantedBacking>,
    ) -> Result<HelperGrantDTO, String> {
        if name.is_empty() || name.len() > MAX_GRANT_NAME || mime.len() > MAX_MIME {
            return Err("pdf.bad_request".to_string());
        }
        let token = Uuid::new_v4().simple().to_string();
        let dto = HelperGrantDTO {
            grant_id,
            token_url: format!(
                "http://adpfile.localhost/{}/{}",
                token,
                percent_encode(name)
            ),
            name: name.to_string(),
            mime: mime.to_string(),
            byte_len: backing.length(),
            sensitive: backing.is_sensitive(),
        };
        if !dto.is_valid() {
            return Err("pdf.bad_request".to_string());
        }
        let grant = Arc::new(ChildGrant {
            grant_id,
            dto: dto.clone(),
            backing,
        });
        let mut map = self
            .by_token
            .lock()
            .map_err(|_| "helper.failed".to_string())?;
        map.insert(token, grant);
        Ok(dto)
    }

    /// Resolve a token to its backing. The returned `Arc` keeps the bytes
    /// valid even if the token is revoked in the middle of a response.
    pub fn resolve(&self, token: &str) -> Option<Arc<GrantedBacking>> {
        if !crate::files::is_valid_token(token) {
            return None;
        }
        self.by_token
            .lock()
            .ok()
            .and_then(|map| map.get(token).map(|grant| grant.backing.clone()))
    }

    pub fn token_of(&self, grant_id: Uuid) -> Option<String> {
        self.by_token.lock().ok().and_then(|map| {
            map.iter()
                .find(|(_, grant)| grant.grant_id == grant_id)
                .map(|(token, _)| token.clone())
        })
    }

    pub fn revoke(&self, token: &str) {
        if let Ok(mut map) = self.by_token.lock() {
            map.remove(token);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut map) = self.by_token.lock() {
            map.clear();
        }
    }

    pub fn len(&self) -> usize {
        self.by_token.lock().map(|map| map.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Percent-encode a file name the way `fileUrl` does (only for the URL's
/// readability; the token is the authority).
fn percent_encode(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for byte in name.as_bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~');
        if keep {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

/// The child's state while an update's bodies arrive.
pub struct ChildInputState {
    grants: ChildGrants,
    accepting: bool,
    sensitive: bool,
    bytes_delivered: u64,
    expected: HashMap<Uuid, u64>,
    bodies: HashMap<Uuid, Vec<u8>>,
    last_update: Option<Uuid>,
}

impl Default for ChildInputState {
    fn default() -> Self {
        Self {
            grants: ChildGrants::new(),
            accepting: false,
            sensitive: false,
            bytes_delivered: 0,
            expected: HashMap::new(),
            bodies: HashMap::new(),
            last_update: None,
        }
    }
}

impl ChildInputState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn grants(&self) -> &ChildGrants {
        &self.grants
    }

    pub fn bytes_delivered(&self) -> u64 {
        self.bytes_delivered
    }

    pub fn is_sensitive(&self) -> bool {
        self.sensitive
    }

    /// Accept the manifests of an update. A sensitive source without the
    /// private-profile proof delivers zero bytes: the caller must close.
    pub fn accept_update(
        &mut self,
        update_id: Uuid,
        manifests: &[HelperInputManifest],
        private_profile: bool,
    ) -> Result<(), String> {
        if !private_profile && manifests.iter().any(manifest_is_sensitive) {
            self.accepting = false;
            return Err("helper.sensitive_unsupported".to_string());
        }
        if manifests.len() > MAX_INPUTS {
            return Err("pdf.bad_request".to_string());
        }
        let mut expected = HashMap::new();
        let mut sensitive = self.sensitive;
        for manifest in manifests {
            match &manifest.source {
                HelperInputManifestSource::Disk { .. } => {
                    expected.insert(manifest.grant_id, 0);
                }
                HelperInputManifestSource::Memory {
                    byte_len,
                    sensitive: is_sensitive,
                    ..
                } => {
                    if *byte_len > MAX_MEMORY_SOURCE {
                        return Err("pdf.too_large".to_string());
                    }
                    sensitive |= *is_sensitive;
                    expected.insert(manifest.grant_id, *byte_len);
                }
            }
        }
        self.expected = expected;
        self.bodies.clear();
        self.accepting = true;
        self.sensitive = sensitive;
        self.last_update = Some(update_id);
        Ok(())
    }

    /// Append one body chunk at its exact offset.
    pub fn accept_body(&mut self, grant_id: Uuid, offset: u64, chunk: &[u8]) -> Result<(), String> {
        if !self.accepting {
            return Err("helper.failed".to_string());
        }
        if chunk.len() > crate::webview_helper_types::MAX_BODY_CHUNK {
            return Err("pdf.too_large".to_string());
        }
        let body = self.bodies.entry(grant_id).or_default();
        if body.len() as u64 != offset {
            return Err("helper.failed".to_string());
        }
        let expected = self.expected.get(&grant_id).copied().unwrap_or(u64::MAX);
        if (body.len() + chunk.len()) as u64 > expected {
            return Err("pdf.too_large".to_string());
        }
        body.extend_from_slice(chunk);
        self.bytes_delivered += chunk.len() as u64;
        Ok(())
    }

    /// Complete a body: the exact length and SHA-256 must match.
    pub fn finish_body(
        &mut self,
        grant_id: Uuid,
        total: u64,
        sha256: &[u8; 32],
    ) -> Result<(), String> {
        if !self.accepting {
            return Err("helper.failed".to_string());
        }
        let Some(body) = self.bodies.remove(&grant_id) else {
            return Err("helper.failed".to_string());
        };
        if body.len() as u64 != total {
            return Err("helper.failed".to_string());
        }
        // The child verifies the SHA-256 it was given; a mismatch is fatal.
        if &body_sha256(&body) != sha256 {
            return Err("helper.failed".to_string());
        }
        self.bodies.insert(grant_id, body);
        Ok(())
    }

    /// The bytes of one finished memory input.
    pub fn take_body(&mut self, grant_id: Uuid) -> Option<Zeroizing<Vec<u8>>> {
        let body = self.bodies.remove(&grant_id)?;
        let expected = self.expected.get(&grant_id).copied().unwrap_or(0);
        if body.len() as u64 != expected {
            return None;
        }
        Some(Zeroizing::new(body))
    }

    pub fn finish_update(&mut self) -> Result<(), String> {
        if !self.accepting {
            return Err("helper.failed".to_string());
        }
        self.accepting = false;
        Ok(())
    }

    pub fn update_id(&self) -> Option<Uuid> {
        self.last_update
    }
}

fn manifest_is_sensitive(manifest: &HelperInputManifest) -> bool {
    matches!(
        &manifest.source,
        HelperInputManifestSource::Memory {
            sensitive: true,
            ..
        }
    )
}

fn body_sha256(bytes: &[u8]) -> [u8; 32] {
    // The child hashes exactly the bytes it received; the parent checks the
    // same SHA-256 on the frame payload (sha2 0.10, already in the plan).
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vectors() {
        assert_eq!(
            body_sha256(b"abc"),
            [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad
            ]
        );
        assert_eq!(
            body_sha256(b""),
            [
                0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14, 0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f,
                0xb9, 0x24, 0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c, 0xa4, 0x95, 0x99, 0x1b,
                0x78, 0x52, 0xb8, 0x55
            ]
        );
    }

    #[test]
    fn percent_encoding_keeps_the_token_authority() {
        assert_eq!(percent_encode("a b.pdf"), "a%20b.pdf");
        assert_eq!(percent_encode("ñandú.pdf"), "%C3%B1and%C3%BA.pdf");
        assert!(is_upload_like("http://adpfile.localhost/abc/x"));
        assert!(!is_upload_like("file:///C:/x"));
        assert!(crate::webview_helper_types::is_upload_token(
            "0123456789abcdef0123456789abcdef"
        ));
    }
}
