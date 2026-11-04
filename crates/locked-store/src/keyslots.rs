//! The two standard age key slots (Step 09k D1/D4). Each slot is a separate
//! age file: a scrypt password slot and an independent X25519 recovery slot.
//! Both encrypt the same bounded JSON record, whose repeated container id
//! and recipient are checked again after decryption.

use age::secrecy::SecretString;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{
    decrypt_password_slot, decrypt_recovery_slot, encrypt_password_slot, encrypt_to_recipient,
    ContainerIdentity,
};
use crate::error::{LockedError, LockedResult};
use crate::limits::{KEYS_SLOT_SCHEMA_VERSION, MAX_KEY_SLOT_BYTES};
use crate::types::{LockedHeader, LockedKeySlotPayload};
use crate::validation::validate_keyslot_payload;

pub fn build_payload(identity: &ContainerIdentity, container_id: Uuid) -> LockedKeySlotPayload {
    LockedKeySlotPayload {
        schema_version: KEYS_SLOT_SCHEMA_VERSION,
        container_id,
        content_recipient: identity.recipient().to_string(),
        container_secret: identity.secret().clone(),
    }
}

pub fn seal_password_slot(
    identity: &ContainerIdentity,
    container_id: Uuid,
    password: &SecretString,
) -> LockedResult<Vec<u8>> {
    let payload = build_payload(identity, container_id);
    let bytes = Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| LockedError::Invalid)?);
    let sealed = encrypt_password_slot(password, &bytes)?;
    if sealed.len() as u64 > MAX_KEY_SLOT_BYTES {
        return Err(LockedError::TooLarge);
    }
    Ok(sealed)
}

pub fn seal_recovery_slot(
    identity: &ContainerIdentity,
    container_id: Uuid,
    recovery_recipient: &str,
) -> LockedResult<Vec<u8>> {
    let payload = build_payload(identity, container_id);
    let bytes = Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| LockedError::Invalid)?);
    let sealed = encrypt_to_recipient(recovery_recipient, &bytes)?;
    if sealed.len() as u64 > MAX_KEY_SLOT_BYTES {
        return Err(LockedError::TooLarge);
    }
    Ok(sealed)
}

fn parse_payload(bytes: &[u8], header: &LockedHeader) -> LockedResult<ContainerIdentity> {
    if bytes.len() as u64 > MAX_KEY_SLOT_BYTES {
        return Err(LockedError::TooLarge);
    }
    let payload: LockedKeySlotPayload =
        serde_json::from_slice(bytes).map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    validate_keyslot_payload(&payload, header.container_id, &header.content_recipient)?;
    ContainerIdentity::from_secret(payload.container_secret)
}

pub fn open_password_slot(
    header: &LockedHeader,
    ciphertext: &[u8],
    password: &SecretString,
) -> LockedResult<ContainerIdentity> {
    if ciphertext.len() as u64 > MAX_KEY_SLOT_BYTES {
        return Err(LockedError::TooLarge);
    }
    let plain = decrypt_password_slot(password, ciphertext, MAX_KEY_SLOT_BYTES)?;
    parse_payload(&plain, header)
}

pub fn open_recovery_slot(
    header: &LockedHeader,
    ciphertext: &[u8],
    recovery_secret: &str,
) -> LockedResult<ContainerIdentity> {
    if ciphertext.len() as u64 > MAX_KEY_SLOT_BYTES {
        return Err(LockedError::TooLarge);
    }
    let plain = decrypt_recovery_slot(recovery_secret, ciphertext, MAX_KEY_SLOT_BYTES)?;
    parse_payload(&plain, header)
}

/// Creation verification opens both freshly written slots with the two
/// credentials still held in memory and proves they name one identity.
pub fn verify_both_slots(
    header: &LockedHeader,
    password_slot: &[u8],
    recovery_slot: &[u8],
    password: &SecretString,
    recovery_secret: &str,
) -> LockedResult<ContainerIdentity> {
    let from_password = open_password_slot(header, password_slot, password)?;
    let from_recovery = open_recovery_slot(header, recovery_slot, recovery_secret)?;
    if from_password.recipient() != from_recovery.recipient()
        || from_password.recipient() != header.content_recipient
    {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    Ok(from_password)
}

/// A bounded, zeroizing copy of a slot for the pending-generation writer.
pub fn copy_slot(bytes: &[u8]) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(bytes.to_vec())
}
