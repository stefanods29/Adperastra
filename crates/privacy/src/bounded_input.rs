//! Every public adapter enforces the source budget before parser allocation.
use crate::{error::PrivacyError, types::PrivacyContext};
pub(crate) const MAX_INPUT_BYTES: usize = 512 * 1024 * 1024;
pub(crate) fn read(
    input: &mut dyn convert::ReadSeek,
    context: &PrivacyContext,
) -> Result<Vec<u8>, PrivacyError> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        context.check_cancelled()?;
        let read = std::io::Read::read(input, &mut chunk)?;
        if read == 0 {
            return Ok(bytes);
        }
        if bytes
            .len()
            .checked_add(read)
            .is_none_or(|size| size > MAX_INPUT_BYTES)
        {
            return Err(PrivacyError::TooLarge);
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}
