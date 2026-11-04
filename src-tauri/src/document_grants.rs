//! Document grants (Step 09a T2).
//!
//! A thin document-facing layer over the existing `FileGrants` and the
//! Step 07d `GrantedBacking` (E8): this module never defines another
//! backing enum and never changes the token format (exactly 32
//! lower-case hex characters; `path_for` stays `None` for memory).
#![allow(dead_code)]


use std::path::PathBuf;
use std::sync::Arc;

use crate::file_grant_backing::GrantedBacking;
use crate::files::FileGrants;

/// Grant one backing and return its token.
pub fn grant_backing(grants: &FileGrants, backing: Arc<GrantedBacking>) -> Result<String, String> {
    if !backing.is_consistent() {
        return Err("documents.invalid".to_string());
    }
    grants.grant_backing(backing)
}

/// Resolve a token to its backing, when the token is well formed and live.
pub fn resolve_backing(grants: &FileGrants, token: &str) -> Option<Arc<GrantedBacking>> {
    if !crate::document_types::is_document_token(token) {
        return None;
    }
    grants.resolve_backing(token)
}

/// Revoke one token. Bytes already being served finish through their
/// held `Arc`; new reads are refused.
pub fn revoke(grants: &FileGrants, token: &str) {
    grants.revoke(token);
}

/// The OS path behind a token, for disk grants only. Memory grants (a
/// locked container's entries) deliberately have no path, so a document
/// token can never be turned into a filesystem path.
pub fn path_for(grants: &FileGrants, token: &str) -> Option<PathBuf> {
    grants.path_for(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroizing;

    fn grants_with_memory(bytes: &[u8]) -> (FileGrants, String) {
        let grants = FileGrants::default();
        let backing = Arc::new(GrantedBacking::Memory {
            bytes: Arc::new(Zeroizing::new(bytes.to_vec())),
            length: bytes.len() as u64,
            sensitive: true,
        });
        let token = grant_backing(&grants, backing).unwrap();
        (grants, token)
    }

    #[test]
    fn existing_32hex_tokens_are_accepted() {
        let (_, token) = grants_with_memory(b"abc");
        assert_eq!(token.len(), 32);
        assert!(crate::document_types::is_document_token(&token));
    }

    #[test]
    fn hyphenated_uuid_tokens_are_refused() {
        let (grants, _) = grants_with_memory(b"abc");
        assert!(resolve_backing(&grants, &uuid::Uuid::new_v4().to_string()).is_none());
    }

    #[test]
    fn memory_grants_have_no_path() {
        let (grants, token) = grants_with_memory(b"secret");
        assert!(path_for(&grants, &token).is_none());
        assert!(resolve_backing(&grants, &token).is_some());
    }

    #[test]
    fn releasing_one_view_does_not_revoke_another_views_backing() {
        let (grants, token) = grants_with_memory(b"shared");
        let first = resolve_backing(&grants, &token).unwrap();
        let second = resolve_backing(&grants, &token).unwrap();
        drop(first);
        // The second view still reads through its own Arc after the
        // first view released its reference.
        assert_eq!(second.read_range(0, 6).unwrap(), b"shared");
        revoke(&grants, &token);
        assert!(resolve_backing(&grants, &token).is_none());
        // An in-flight read keeps working through the held Arc.
        assert_eq!(second.read_range(0, 6).unwrap(), b"shared");
    }
}
