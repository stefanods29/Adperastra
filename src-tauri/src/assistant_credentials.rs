//! Native-owned API credentials (Step 17a T4/D3).
//!
//! The secret is encrypted with DPAPI CurrentUser, written under the current
//! profile with a current-user ACL, and never returned to the WebView. Status
//! exposes only has_key and the last four characters. Removing a key deletes
//! only the file this store owns.
#![allow(dead_code)]


use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use fs_service::atomic_write;

use crate::assistant_provider::{credential_status, last_four};
use crate::assistant_types::{AssistantProviderId, CredentialStatus};

pub const MAX_SECRET_BYTES: usize = 4_096;

pub trait SecretProtector: Send + Sync {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String>;
    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String>;
}

/// The Windows ACL step is a separate reviewed adapter. Without it, storing a
/// key fails closed instead of writing a weakly protected file.
pub trait CredentialAcl: Send + Sync {
    fn restrict_to_current_user(&self, path: &Path) -> Result<(), String>;
}

pub struct CredentialStore {
    profile_dir: PathBuf,
    protector: Arc<dyn SecretProtector>,
    acl: Option<Arc<dyn CredentialAcl>>,
}

fn wipe(bytes: &mut [u8]) {
    for byte in bytes {
        *byte = 0;
    }
}

fn provider_file(provider: AssistantProviderId) -> &'static str {
    match provider {
        AssistantProviderId::Meta => "provider-meta.cred",
        AssistantProviderId::CustomCompatible => "provider-custom.cred",
    }
}

impl CredentialStore {
    /// `profile_dir` is the already-resolved profile root: the legacy base
    /// directory for the default profile and `<base>/profiles/<uuid>` for
    /// every other profile. A relative or traversing root is refused so a
    /// credential can never be written outside the active profile.
    pub fn new(
        profile_dir: PathBuf,
        protector: Arc<dyn SecretProtector>,
        acl: Option<Arc<dyn CredentialAcl>>,
    ) -> Result<Self, String> {
        let confined = profile_dir.is_absolute()
            && !profile_dir
                .components()
                .any(|component| matches!(component, Component::ParentDir));
        if !confined {
            return Err("assistant.key_store".to_string());
        }
        Ok(Self {
            profile_dir,
            protector,
            acl,
        })
    }

    fn credential_path(&self, provider: AssistantProviderId) -> PathBuf {
        self.profile_dir
            .join("assistant")
            .join(provider_file(provider))
    }

    pub fn status(&self, provider: AssistantProviderId) -> Result<CredentialStatus, String> {
        let path = self.credential_path(provider);
        let ciphertext = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(credential_status(provider, None, None));
            }
            Err(_) => return Err("assistant.key_store".to_string()),
        };
        let mut plaintext = self
            .protector
            .unprotect(&ciphertext)
            .map_err(|_| "assistant.key_store".to_string())?;
        let updated = std::fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        let status = credential_status(provider, Some(&plaintext), updated);
        wipe(&mut plaintext);
        Ok(status)
    }

    /// Decrypt one provider key for the native HTTP adapter. The caller must
    /// wipe the returned buffer immediately after the one bounded request.
    /// An absent key is an empty buffer, never a fabricated value.
    pub fn secret(&self, provider: AssistantProviderId) -> Result<Vec<u8>, String> {
        let path = self.credential_path(provider);
        let ciphertext = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("assistant.key_store".to_string()),
        };
        let mut plaintext = self
            .protector
            .unprotect(&ciphertext)
            .map_err(|_| "assistant.key_store".to_string())?;
        if plaintext.len() > MAX_SECRET_BYTES {
            wipe(&mut plaintext);
            return Err("assistant.key_store".to_string());
        }
        Ok(plaintext)
    }

    /// Store one key for one provider. The caller is the native editor; the
    /// secret is never accepted through a general settings command.
    pub fn edit(&self, provider: AssistantProviderId, secret: &[u8]) -> Result<CredentialStatus, String> {
        if secret.is_empty() || secret.len() > MAX_SECRET_BYTES {
            return Err("assistant.key_store".to_string());
        }
        if secret.iter().any(|byte| *byte == 0 || !byte.is_ascii_graphic()) {
            return Err("assistant.key_store".to_string());
        }
        let acl = self
            .acl
            .as_ref()
            .ok_or_else(|| "assistant.key_store".to_string())?;
        let path = self.credential_path(provider);
        let parent = path
            .parent()
            .ok_or_else(|| "assistant.key_store".to_string())?;
        std::fs::create_dir_all(parent).map_err(|_| "assistant.key_store".to_string())?;
        let ciphertext = self.protector.protect(secret)?;
        atomic_write(&path, &ciphertext).map_err(|_| "assistant.key_store".to_string())?;
        if acl.restrict_to_current_user(&path).is_err() {
            // Never leave a protected blob without the intended current-user
            // ACL: remove the file this call just created and fail closed.
            let _ = std::fs::remove_file(&path);
            return Err("assistant.key_store".to_string());
        }
        let mut plaintext = secret.to_vec();
        let updated = std::fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        let status = credential_status(provider, Some(&plaintext), updated);
        wipe(&mut plaintext);
        Ok(status)
    }

    /// Remove only the credential this store owns for this provider.
    pub fn remove(&self, provider: AssistantProviderId) -> Result<CredentialStatus, String> {
        let path = self.credential_path(provider);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(credential_status(provider, None, None)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(credential_status(provider, None, None))
            }
            Err(_) => Err("assistant.key_store".to_string()),
        }
    }

    /// A provider change must never read the other provider's key.
    pub fn belongs_to(&self, provider: AssistantProviderId, path: &Path) -> bool {
        path == self.credential_path(provider)
    }
}

/// DPAPI CurrentUser, using the exact windows 0.61.3 signatures. Buffers are
/// wiped before LocalFree.
#[cfg(windows)]
pub struct WindowsDpapi;

#[cfg(windows)]
impl SecretProtector for WindowsDpapi {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        use windows::Win32::Security::Cryptography::{
            CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };
        let input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input points at a live slice for this call; output is a
        // valid zeroed blob. The description pointer is a static wide string.
        unsafe {
            CryptProtectData(
                &input,
                windows::core::w!("Adperastra assistant credential"),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|_| "assistant.key_store".to_string())?;
            if output.pbData.is_null() {
                return Err("assistant.key_store".to_string());
            }
            let bytes =
                std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
            let _ = windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
                output.pbData as *mut core::ffi::c_void,
            )));
            Ok(bytes)
        }
    }

    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        use windows::Win32::Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };
        let input = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input points at a live slice; output is a valid zeroed
        // blob; no prompt or entropy is supplied.
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|_| "assistant.key_store".to_string())?;
            if output.pbData.is_null() {
                return Err("assistant.key_store".to_string());
            }
            let mut bytes =
                std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
            let _ = windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
                output.pbData as *mut core::ffi::c_void,
            )));
            if bytes.len() > MAX_SECRET_BYTES {
                wipe(&mut bytes);
                return Err("assistant.key_store".to_string());
            }
            Ok(bytes)
        }
    }
}

/// Status for tests and the native editor: only the masked hint leaves.
pub fn masked_status(provider: AssistantProviderId, secret: &[u8]) -> CredentialStatus {
    CredentialStatus {
        provider_id: provider,
        has_key: !secret.is_empty(),
        masked_hint: last_four(secret),
        updated_unix: None,
    }
}
