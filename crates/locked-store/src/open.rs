//! Normal unlock (Step 09k D4): decrypt only the selected credential slot,
//! verify its repeated identity and the authenticated index, and never read
//! the other slot. Creation verification is separate (`keyslots`).

use age::secrecy::SecretString;
use std::path::Path;

use crate::crypto::ContainerIdentity;
use crate::error::{LockedError, LockedResult};
use crate::format::ContainerFile;
use crate::keyslots::{open_password_slot, open_recovery_slot};
use crate::limits::Limits;
use crate::types::LockedIndex;
use crate::validation::validate_index;

pub struct OpenedContainer {
    pub file: ContainerFile,
    pub identity: ContainerIdentity,
    pub index: LockedIndex,
}

pub fn unlock_with_password(
    path: &Path,
    password: &SecretString,
    limits: Limits,
) -> LockedResult<OpenedContainer> {
    let file = ContainerFile::open(path, limits)?;
    let header = file.header().clone();
    let identity = open_password_slot(&header, file.password_slot(), password)?;
    finish_open(file, identity, limits)
}

pub fn unlock_with_recovery(
    path: &Path,
    recovery_secret: &str,
    limits: Limits,
) -> LockedResult<OpenedContainer> {
    let file = ContainerFile::open(path, limits)?;
    let header = file.header().clone();
    let identity = open_recovery_slot(&header, file.recovery_slot(), recovery_secret)?;
    finish_open(file, identity, limits)
}

fn finish_open(
    mut file: ContainerFile,
    identity: ContainerIdentity,
    limits: Limits,
) -> LockedResult<OpenedContainer> {
    if identity.recipient() != file.header().content_recipient {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    let index = file.open_index(&identity)?;
    validate_index(&index, &limits)?;
    file.verify_source()?;
    Ok(OpenedContainer {
        file,
        identity,
        index,
    })
}
