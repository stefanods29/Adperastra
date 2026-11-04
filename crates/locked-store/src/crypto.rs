//! Standard age operations only (Step 09k D1/D2). No custom cipher, KDF or
//! header format exists here: password slots use age's scrypt recipient and
//! recovery/content slots use age's X25519 recipients, each in its own file.
//! A single age header never mixes a scrypt recipient with X25519 ones.

use std::io::{Cursor, Read};
use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};

use age::secrecy::{ExposeSecret, SecretString};
use zeroize::Zeroizing;

use crate::error::{LockedError, LockedResult};
use crate::limits::{
    MAX_HEADER_BYTES, MAX_INDEX_PLAIN_BYTES, MAX_PASSWORD_BYTES, SCRYPT_MAX_WORK_FACTOR,
    SCRYPT_WORK_FACTOR,
};
use crate::validation::valid_recipient;

/// scrypt allocates hundreds of MiB. Step 09k D2 allows one KDF at a time
/// across every create, unlock and slot verification in this process.
static KDF_GATE: Mutex<()> = Mutex::new(());

fn kdf_gate() -> LockedResult<MutexGuard<'static, ()>> {
    KDF_GATE.lock().map_err(|_| LockedError::Locked)
}

/// A freshly generated X25519 identity. The secret is dropped and zeroized
/// with the value; `Debug` never prints it.
#[derive(Clone)]
pub struct ContainerIdentity {
    secret: SecretString,
    recipient: String,
}

impl std::fmt::Debug for ContainerIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContainerIdentity")
            .field("recipient", &self.recipient)
            .finish_non_exhaustive()
    }
}

impl ContainerIdentity {
    pub fn generate() -> Self {
        let identity = age::x25519::Identity::generate();
        let recipient = identity.to_public().to_string();
        Self {
            secret: identity.to_string(),
            recipient,
        }
    }

    pub fn from_secret(secret: SecretString) -> LockedResult<Self> {
        let identity = age::x25519::Identity::from_str(secret.expose_secret())
            .map_err(|_| LockedError::BadPasswordOrCorrupt)?;
        let recipient = identity.to_public().to_string();
        Ok(Self { secret, recipient })
    }

    pub fn secret(&self) -> &SecretString {
        &self.secret
    }

    pub fn recipient(&self) -> &str {
        &self.recipient
    }

    pub fn x25519_identity(&self) -> LockedResult<age::x25519::Identity> {
        age::x25519::Identity::from_str(self.secret.expose_secret())
            .map_err(|_| LockedError::BadPasswordOrCorrupt)
    }
}

pub fn generate_recovery_identity() -> ContainerIdentity {
    ContainerIdentity::generate()
}

pub fn recipient_of_secret(secret: &str) -> LockedResult<String> {
    let identity = age::x25519::Identity::from_str(secret).map_err(|_| LockedError::Invalid)?;
    Ok(identity.to_public().to_string())
}

pub fn parse_recipient(value: &str) -> LockedResult<age::x25519::Recipient> {
    if !valid_recipient(value) {
        return Err(LockedError::Invalid);
    }
    age::x25519::Recipient::from_str(value).map_err(|_| LockedError::Invalid)
}

/// Encrypt one standalone age file to the container's X25519 recipient.
pub fn encrypt_to_recipient(recipient: &str, plaintext: &[u8]) -> LockedResult<Vec<u8>> {
    let recipient = parse_recipient(recipient)?;
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| LockedError::Unsupported)?;
    let mut writer = encryptor
        .wrap_output(Vec::new())
        .map_err(|_| LockedError::Unsupported)?;
    use std::io::Write;
    writer.write_all(plaintext).map_err(|_| LockedError::Io)?;
    writer.finish().map_err(|_| LockedError::Io)
}

/// Encrypt one standalone age file with a password (age scrypt stanza).
pub fn encrypt_password_slot(password: &SecretString, plaintext: &[u8]) -> LockedResult<Vec<u8>> {
    if password.expose_secret().len() > MAX_PASSWORD_BYTES {
        return Err(LockedError::Invalid);
    }
    let _kdf = kdf_gate()?;
    let mut recipient = age::scrypt::Recipient::new(password.clone());
    recipient.set_work_factor(SCRYPT_WORK_FACTOR);
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| LockedError::Unsupported)?;
    let mut writer = encryptor
        .wrap_output(Vec::new())
        .map_err(|_| LockedError::Unsupported)?;
    use std::io::Write;
    writer.write_all(plaintext).map_err(|_| LockedError::Io)?;
    writer.finish().map_err(|_| LockedError::Io)
}

/// The scrypt work factor declared in an age header, parsed without running
/// the KDF. `None` means this is not a scrypt age file.
pub fn scrypt_work_factor(ciphertext: &[u8]) -> Option<u8> {
    let header = &ciphertext[..ciphertext.len().min(MAX_HEADER_BYTES as usize)];
    // The slice continues into binary ciphertext, so header lines are read
    // through a lossy decode and the loop stops at the `---` terminator.
    let text = String::from_utf8_lossy(header);
    for line in text.lines() {
        if line.starts_with("---") {
            break;
        }
        let Some(rest) = line.strip_prefix("-> scrypt ") else {
            continue;
        };
        let mut parts = rest.split_ascii_whitespace();
        let _salt = parts.next()?;
        return parts.next()?.parse::<u8>().ok();
    }
    None
}

/// Refuse an unsupported work factor before any KDF allocation.
pub fn check_work_factor(ciphertext: &[u8]) -> LockedResult<u8> {
    let Some(factor) = scrypt_work_factor(ciphertext) else {
        return Err(LockedError::Unsupported);
    };
    if factor > SCRYPT_MAX_WORK_FACTOR {
        return Err(LockedError::UnsupportedKdf);
    }
    Ok(factor)
}

fn decrypt_with_identity(
    identity: &dyn age::Identity,
    ciphertext: &[u8],
    max_plain: u64,
) -> LockedResult<Zeroizing<Vec<u8>>> {
    let decryptor = age::Decryptor::new(Cursor::new(ciphertext))
        .map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    let reader = decryptor
        .decrypt(std::iter::once(identity))
        .map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    let mut limited = reader.take(max_plain.saturating_add(1));
    let mut output = Zeroizing::new(Vec::new());
    limited
        .read_to_end(&mut output)
        .map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    if output.len() as u64 > max_plain {
        return Err(LockedError::TooLarge);
    }
    Ok(output)
}

pub fn decrypt_password_slot(
    password: &SecretString,
    ciphertext: &[u8],
    max_plain: u64,
) -> LockedResult<Zeroizing<Vec<u8>>> {
    if password.expose_secret().len() > MAX_PASSWORD_BYTES {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    check_work_factor(ciphertext)?;
    let _kdf = kdf_gate()?;
    let mut identity = age::scrypt::Identity::new(password.clone());
    identity.set_max_work_factor(SCRYPT_MAX_WORK_FACTOR);
    decrypt_with_identity(&identity, ciphertext, max_plain)
}

pub fn decrypt_recovery_slot(
    recovery_secret: &str,
    ciphertext: &[u8],
    max_plain: u64,
) -> LockedResult<Zeroizing<Vec<u8>>> {
    let identity = age::x25519::Identity::from_str(recovery_secret)
        .map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    decrypt_with_identity(&identity, ciphertext, max_plain)
}

pub fn decrypt_content(
    identity: &ContainerIdentity,
    ciphertext: &[u8],
    max_plain: u64,
) -> LockedResult<Zeroizing<Vec<u8>>> {
    let identity = identity.x25519_identity()?;
    decrypt_with_identity(&identity, ciphertext, max_plain)
}

/// The largest plaintext an index slot may produce.
pub fn max_index_plain() -> u64 {
    MAX_INDEX_PLAIN_BYTES
}
