//! bzip2 streams (Step 06e D2): one file, or a tar archive inside bzip2.
//! Concatenated members read as one stream; a CRC failure is a read error.

use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use bzip2::read::MultiBzDecoder;

use crate::entry::{ArchiveFormat, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::list::ProgressMeter;
use crate::read_tar::list_tar;
use fs_service::CancellationToken;

/// The decoder every bzip2 reader uses: all members, never just the first.
pub(crate) fn decoder(file: File) -> MultiBzDecoder<BufReader<File>> {
    MultiBzDecoder::new(BufReader::new(file))
}

/// List a tar archive inside bzip2 through the existing tar reader.
pub(crate) fn list_tar_bz2(
    path: &std::path::Path,
    limits: &Limits,
    token: &CancellationToken,
    counter: Arc<AtomicU64>,
    meter: &mut ProgressMeter<'_>,
) -> Result<Listing, ArchiveError> {
    let file = File::open(path)?;
    list_tar(
        decoder(file),
        ArchiveFormat::TarBz2,
        false,
        limits,
        token,
        counter,
        meter,
    )
}
