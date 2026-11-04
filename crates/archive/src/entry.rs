//! One entry of an archive listing (Step 06d). The listing is what the
//! helper process sends to the app; the app never sees raw format data.

use serde::{Deserialize, Serialize};

/// The archive kinds this crate reads, detected by content, never by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveFormat {
    Zip,
    SevenZ,
    Tar,
    TarGz,
    TarXz,
    Gz,
    Xz,
    /// A single bzip2 stream (Step 06e).
    Bz2,
    /// A tar archive inside bzip2 (Step 06e).
    TarBz2,
    /// A RAR archive, read only through a separately installed 7-Zip.
    Rar,
}

/// What an entry is. Links are listed but never extracted (Step 06d D7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Folder,
    Link,
}

/// One entry of an archive, with the inner path already normalized.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntry {
    /// Position among all entries the format's reader yields, counting the
    /// entries left out of the listing, so an extraction can find it again.
    pub index: u32,
    /// Normalized inner path (`/` separators, no trailing `/`); the raw
    /// name with `/` separators when `problem` is set.
    pub path: String,
    /// The last component of `path`.
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// 0 when the format does not say.
    pub packed_size: u64,
    /// Seconds since 1970; 0 when the format does not say.
    pub modified_unix: u64,
    pub encrypted: bool,
    /// `Some("unsafe_path")` or `Some("invalid_name")`: shown as hidden and
    /// never extracted.
    pub problem: Option<String>,
}

/// The index of a folder that the archive does not store as an entry: it
/// is made from the paths of the files below it.
pub const IMPLICIT_INDEX: u32 = u32::MAX;

/// Everything the readers learned about an archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Listing {
    pub format: ArchiveFormat,
    pub entries: Vec<ArchiveEntry>,
    /// The archive is damaged after the entries that were read.
    pub partial: bool,
}
