//! Current-user DPAPI for recovery records (Step 09h E8). The UI is never
//! shown a protection prompt, the payload identity is the caller's job, and
//! a failure has no plaintext fallback. Step 09j imports these two helpers
//! for its own record kind with a different authenticated magic.

use zeroize::Zeroizing;

/// One protected input or recovered plaintext may not exceed 64 MiB plus the
/// 96-byte authenticated content prefix that recovery frames around the
/// encoded bytes. Metadata blobs are much smaller.
pub const MAX_DPAPI_BYTES: usize = 67_108_960;
/// DPAPI adds a header, salt, key and HMAC around the payload.
pub const MAX_CIPHERTEXT_BYTES: usize = MAX_DPAPI_BYTES + 65_536;

#[cfg(windows)]
mod native {
    use std::ffi::c_void;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN,
        CRYPT_INTEGER_BLOB,
    };
    use zeroize::Zeroizing;

    fn bounded_input(input: &[u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
        if input.is_empty() || input.len() > super::MAX_DPAPI_BYTES {
            return Err("recovery.too_large".to_string());
        }
        let length = u32::try_from(input.len()).map_err(|_| "recovery.too_large".to_string())?;
        Ok(CRYPT_INTEGER_BLOB {
            cbData: length,
            pbData: input.as_ptr() as *mut u8,
        })
    }

    /// Zeroize and release one DPAPI allocation. A null pointer owns nothing.
    fn release(output: CRYPT_INTEGER_BLOB) {
        if output.pbData.is_null() {
            return;
        }
        let length = output.cbData as usize;
        // SAFETY: DPAPI allocated `cbData` bytes at `pbData`; both are valid
        // until `LocalFree`, and clearing a released secret is intentional.
        unsafe {
            if length > 0 {
                std::ptr::write_bytes(output.pbData, 0, length);
            }
            let _ = LocalFree(Some(HLOCAL(output.pbData as *mut c_void)));
        }
    }

    fn take_output(
        output: CRYPT_INTEGER_BLOB,
        cap: usize,
        failure: &str,
    ) -> Result<Vec<u8>, String> {
        let length = output.cbData as usize;
        let valid = length > 0 && length <= cap && !output.pbData.is_null();
        // SAFETY: a valid blob points at `cbData` live bytes from DPAPI.
        let bytes = if valid {
            unsafe { std::slice::from_raw_parts(output.pbData as *const u8, length).to_vec() }
        } else {
            Vec::new()
        };
        release(output);
        if valid {
            Ok(bytes)
        } else if length > cap {
            Err("recovery.too_large".to_string())
        } else {
            Err(failure.to_string())
        }
    }

    pub fn protect(input: &[u8]) -> Result<Vec<u8>, String> {
        let input_blob = bounded_input(input)?;
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: the input points at a live slice, the output is a local
        // that DPAPI fills, and no prompt or entropy pointer is supplied.
        // `CRYPTPROTECT_UI_FORBIDDEN` keeps the protection silent.
        unsafe {
            CryptProtectData(
                &input_blob,
                None::<&PCWSTR>,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| "recovery.io".to_string())?;
        take_output(output, super::MAX_CIPHERTEXT_BYTES, "recovery.io")
    }

    pub fn unprotect(input: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        let input_blob = bounded_input(input)?;
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: same contract as protection; no description pointer is
        // requested and the current user's master key is the only one DPAPI
        // will try. A foreign user or damaged blob fails here.
        unsafe {
            CryptUnprotectData(
                &input_blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| "recovery.corrupt".to_string())?;
        let bytes = take_output(output, super::MAX_DPAPI_BYTES, "recovery.corrupt")?;
        Ok(Zeroizing::new(bytes))
    }
}

#[cfg(not(windows))]
mod native {
    use zeroize::Zeroizing;

    pub fn protect(_input: &[u8]) -> Result<Vec<u8>, String> {
        Err("recovery.unsupported".to_string())
    }

    pub fn unprotect(_input: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("recovery.unsupported".to_string())
    }
}

/// Protect bytes for the current Windows user only. There is no plaintext
/// fallback: the caller keeps its ciphertext when this fails.
pub fn protect_current_user(input: &[u8]) -> Result<Vec<u8>, String> {
    native::protect(input)
}

/// Recover bytes protected by `protect_current_user` for this user. The
/// result is zeroized when dropped; a wrong user, truncation or tampering is
/// `recovery.corrupt` and the ciphertext is retained by the caller.
pub fn unprotect_current_user(input: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    native::unprotect(input)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{protect_current_user, unprotect_current_user, MAX_DPAPI_BYTES};

    #[test]
    fn round_trips_for_the_current_user() {
        let plain = b"recovery revision with \0 and \r\n bytes".to_vec();
        let cipher = protect_current_user(&plain).unwrap();
        assert_ne!(cipher, plain);
        let back = unprotect_current_user(&cipher).unwrap();
        assert_eq!(&*back, &plain);
    }

    #[test]
    fn refuses_more_than_sixty_four_mebibytes_before_protection() {
        let oversized = vec![0u8; MAX_DPAPI_BYTES + 1];
        assert_eq!(
            protect_current_user(&oversized).unwrap_err(),
            "recovery.too_large"
        );
        assert_eq!(
            unprotect_current_user(&oversized).unwrap_err(),
            "recovery.too_large"
        );
    }

    #[test]
    fn a_foreign_or_wrong_user_blob_is_refused() {
        // A blob that cannot be unlocked with this user's master key: DPAPI
        // records the master key id in bytes 24..40, so replacing it makes
        // the OS refuse exactly as it does for another Windows account.
        let cipher = protect_current_user(b"private revision").unwrap();
        assert!(cipher.len() > 40);
        let mut foreign = cipher.clone();
        for byte in &mut foreign[24..40] {
            *byte ^= 0xFF;
        }
        assert_eq!(
            unprotect_current_user(&foreign).unwrap_err(),
            "recovery.corrupt"
        );
        // Random bytes are refused too, never returned as plaintext.
        assert_eq!(
            unprotect_current_user(&[0u8; 64]).unwrap_err(),
            "recovery.corrupt"
        );
    }

    #[test]
    fn a_truncated_blob_is_refused() {
        let cipher = protect_current_user(b"private revision").unwrap();
        let cut = &cipher[..cipher.len() / 2];
        assert_eq!(
            unprotect_current_user(cut).unwrap_err(),
            "recovery.corrupt"
        );
    }
}
