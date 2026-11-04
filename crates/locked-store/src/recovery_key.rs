//! Explicit recovery-key files (Step 09k D8). The secret exists only in the
//! file the user chose, never beside the container, in settings, logs or a
//! session record. The file is plain UTF-8 JSON and says so in the UI.

use age::secrecy::{ExposeSecret, SecretString};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{recipient_of_secret, ContainerIdentity};
use crate::error::{LockedError, LockedResult};
use crate::limits::{MAX_RECOVERY_FILE_BYTES, RECOVERY_FILE_SCHEMA_VERSION};
use crate::types::LockedRecoveryFile;
use crate::validation::validate_recovery_file;

pub const RECOVERY_EXTENSION: &str = "adprecovery";

pub fn build_recovery_file(container_id: Uuid, identity: &ContainerIdentity) -> LockedRecoveryFile {
    LockedRecoveryFile {
        schema_version: RECOVERY_FILE_SCHEMA_VERSION,
        container_id,
        recovery_secret: identity.secret().clone(),
        recovery_recipient: identity.recipient().to_string(),
    }
}

pub fn encode_recovery_file(file: &LockedRecoveryFile) -> LockedResult<Zeroizing<Vec<u8>>> {
    validate_recovery_file(file)?;
    let mut bytes =
        Zeroizing::new(serde_json::to_vec_pretty(file).map_err(|_| LockedError::Invalid)?);
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_RECOVERY_FILE_BYTES {
        return Err(LockedError::TooLarge);
    }
    Ok(bytes)
}

pub fn parse_recovery_bytes(bytes: &[u8]) -> LockedResult<LockedRecoveryFile> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_RECOVERY_FILE_BYTES {
        return Err(LockedError::Invalid);
    }
    let file: LockedRecoveryFile =
        serde_json::from_slice(bytes).map_err(|_| LockedError::Invalid)?;
    validate_recovery_file(&file)?;
    Ok(file)
}

pub fn parse_recovery_text(text: &str) -> LockedResult<LockedRecoveryFile> {
    parse_recovery_bytes(text.as_bytes())
}

/// Only the public recipient may appear in ordinary metadata.
pub fn public_recipient(file: &LockedRecoveryFile) -> LockedResult<String> {
    let secret = file.recovery_secret.expose_secret();
    let recipient = recipient_of_secret(secret)?;
    if recipient != file.recovery_recipient {
        return Err(LockedError::Invalid);
    }
    Ok(recipient)
}

pub fn recovery_secret(file: &LockedRecoveryFile) -> SecretString {
    file.recovery_secret.clone()
}

/// No caller may print the secret by accident.
pub fn describe_recovery_file(file: &LockedRecoveryFile) -> String {
    let container_id = file.container_id;
    format!("recovery file for {container_id} (secret redacted)")
}
