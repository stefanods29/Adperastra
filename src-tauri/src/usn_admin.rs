//! Scope checks shared by the optional NTFS helper (Step 11a T6). The
//! elevated child gets a nonce pipe name, an already validated volume root
//! and nothing else. A foreign SID cannot talk to the pipe.
#![allow(dead_code)]


use std::path::PathBuf;

/// A drive root only (`C:\`); no UNC, no subfolder and no traversal.
pub fn validate_volume_root(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() < 2
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || (bytes.len() > 2 && (bytes.len() != 3 || bytes[2] != b'\\'))
    {
        return Err("search.denied".to_string());
    }
    let drive = value[..1].to_ascii_uppercase();
    Ok(PathBuf::from(format!("{drive}:\\")))
}

pub fn new_nonce() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// The pipe name carries a 128-bit nonce so a guessed name is not enough.
pub fn pipe_name(nonce: &str) -> Result<String, String> {
    if !(32..=64).contains(&nonce.len())
        || !nonce
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character.is_ascii_alphanumeric())
    {
        return Err("search.denied".to_string());
    }
    Ok(format!(r"\\.\pipe\adperastra-usn-{nonce}"))
}

/// SID strings are case-insensitive ASCII.
pub fn same_user(expected: &str, actual: &str) -> bool {
    expected.trim().eq_ignore_ascii_case(actual.trim())
}

/// A denied or cancelled UAC prompt leaves ordinary indexing usable.
pub fn elevation_denied_falls_back(result: &Result<(), String>) -> bool {
    match result {
        Ok(()) => false,
        Err(error) => {
            let lower = error.to_lowercase();
            lower.contains("1223")
                || lower.contains("denied")
                || lower.contains("cancelled")
                || lower.contains("canceled")
        }
    }
}

#[cfg(windows)]
pub fn current_user_sid() -> Result<String, String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::TOKEN_QUERY;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = HANDLE::default();
    // SAFETY: the pseudo-handle is valid for the current process and the
    // output handle is closed before returning.
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|_| "search.denied".to_string())?;
    let sid = token_sid(token);
    // SAFETY: token was opened above and is not used afterwards.
    let _ = unsafe { CloseHandle(token) };
    sid
}

#[cfg(windows)]
pub fn process_user_sid(process_id: u32) -> Result<String, String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::TOKEN_QUERY;
    use windows::Win32::System::Threading::{
        OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    // SAFETY: the PID comes from the connected pipe; the handle is closed.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
        .map_err(|_| "search.denied".to_string())?;
    let mut token = HANDLE::default();
    // SAFETY: process is a live handle with query access.
    let opened = unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) };
    if opened.is_err() {
        let _ = unsafe { CloseHandle(process) };
        return Err("search.denied".to_string());
    }
    let sid = token_sid(token);
    let _ = unsafe { CloseHandle(token) };
    let _ = unsafe { CloseHandle(process) };
    sid
}

#[cfg(windows)]
fn token_sid(token: windows::Win32::Foundation::HANDLE) -> Result<String, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_USER};

    let mut needed = 0u32;
    // SAFETY: the first call only asks for the buffer size.
    let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut needed) };
    if needed == 0 {
        return Err("search.denied".to_string());
    }
    // `usize` words keep the buffer aligned for TOKEN_USER; the byte size
    // passed to Windows is the same allocation rounded up.
    let words = (needed as usize + std::mem::size_of::<usize>() - 1)
        / std::mem::size_of::<usize>();
    let mut buffer = vec![0usize; words];
    // SAFETY: the buffer is at least `needed` bytes and the function writes
    // at most that many bytes.
    unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
            needed,
            &mut needed,
        )
    }
    .map_err(|_| "search.denied".to_string())?;
    // SAFETY: Windows wrote a TOKEN_USER at the start of the aligned buffer.
    let token_user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
    let mut text = PWSTR::null();
    // SAFETY: the SID belongs to the token buffer and the output pointer is
    // freed below.
    unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut text) }
        .map_err(|_| "search.denied".to_string())?;
    // SAFETY: ConvertSidToStringSidW returned a NUL-terminated string.
    let value = unsafe { text.to_string() }.map_err(|_| "search.denied".to_string())?;
    // SAFETY: the string was allocated by ConvertSidToStringSidW with
    // LocalAlloc and is freed exactly once.
    unsafe {
        let _ = LocalFree(Some(HLOCAL(text.0 as *mut core::ffi::c_void)));
    }
    Ok(value)
}

/// Connect the elevated child to the parent-created nonce pipe. The child
/// never chooses a path: the only name it accepts is the validated nonce
/// pipe from the fixed helper argument line.
#[cfg(windows)]
pub fn connect_pipe(name: &str) -> Result<std::fs::File, String> {
    use std::os::windows::io::FromRawHandle;
    use windows::core::{PCWSTR, HSTRING};
    use windows::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_MODE, OPEN_EXISTING,
    };

    let nonce = name
        .strip_prefix(r"\\.\pipe\adperastra-usn-")
        .ok_or_else(|| "search.denied".to_string())?;
    let _ = pipe_name(nonce)?;
    let wide = HSTRING::from(name);
    // SAFETY: the pipe name is a validated nonce name, and the returned
    // handle is owned by the File before this function returns.
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            (GENERIC_READ | GENERIC_WRITE).0,
            FILE_SHARE_MODE(0),
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
    .map_err(|_| "search.denied".to_string())?;
    // SAFETY: the handle is valid and transferred exactly once to File.
    Ok(unsafe { std::fs::File::from_raw_handle(handle.0) })
}

#[cfg(windows)]
pub fn authorize_pipe_client(pipe: windows::Win32::Foundation::HANDLE) -> Result<(), String> {
    use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;

    let mut process_id = 0u32;
    // SAFETY: pipe is a connected named-pipe handle owned by the caller.
    unsafe { GetNamedPipeClientProcessId(pipe, &mut process_id) }
        .map_err(|_| "search.denied".to_string())?;
    let client = process_user_sid(process_id)?;
    let current = current_user_sid()?;
    if same_user(&current, &client) {
        Ok(())
    } else {
        Err("search.denied".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        elevation_denied_falls_back, new_nonce, pipe_name, same_user, validate_volume_root,
    };

    #[test]
    fn only_a_drive_root_is_accepted() {
        assert_eq!(
            validate_volume_root("c:").unwrap(),
            std::path::PathBuf::from(r"C:\")
        );
        assert_eq!(
            validate_volume_root(r"D:\").unwrap(),
            std::path::PathBuf::from(r"D:\")
        );
        assert!(validate_volume_root(r"C:\Windows").is_err());
        assert!(validate_volume_root(r"\\server\share").is_err());
        assert!(validate_volume_root(r"C:\..\Windows").is_err());
    }

    #[test]
    fn a_foreign_sid_is_not_the_same_user() {
        assert!(same_user(
            "S-1-5-21-1-2-3-1001",
            "s-1-5-21-1-2-3-1001"
        ));
        assert!(!same_user(
            "S-1-5-21-1-2-3-1001",
            "S-1-5-21-1-2-3-1002"
        ));
    }

    #[test]
    fn a_denied_or_cancelled_elevation_falls_back() {
        assert!(elevation_denied_falls_back(&Err(
            "ShellExecuteEx failed: 1223".to_string()
        )));
        assert!(elevation_denied_falls_back(&Err("denied".to_string())));
        assert!(!elevation_denied_falls_back(&Err("disk full".to_string())));
        assert!(!elevation_denied_falls_back(&Ok(())));
    }

    #[test]
    fn the_pipe_name_has_a_nonce_and_no_arbitrary_path() {
        let nonce = new_nonce();
        let name = pipe_name(&nonce).unwrap();
        assert!(name.starts_with(r"\\.\pipe\adperastra-usn-"));
        assert!(name.ends_with(&nonce));
        assert!(pipe_name(r"..\evil").is_err());
    }
}
