//! Windows path helpers shared by the Win32 calls in this crate.

use crate::FsError;
use std::path::Path;

/// Win32 `W` functions honour paths longer than 260 characters only with
/// the `\\?\` prefix. Verbatim paths are taken literally, so separators are
/// normalized to backslashes before the prefix is added.
pub(crate) fn long_path_wide(path: &Path) -> Vec<u16> {
    let text = path.to_string_lossy().into_owned();
    let prefixed = if text.starts_with(r"\\?\") || text.starts_with(r"\\.\") {
        text
    } else {
        let text = text.replace('/', "\\");
        if let Some(unc) = text.strip_prefix(r"\\") {
            format!(r"\\?\UNC\{unc}")
        } else if text.len() >= 2 && text.as_bytes()[1] == b':' {
            format!(r"\\?\{text}")
        } else {
            text
        }
    };
    prefixed.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Turn a Win32 failure back into the `std::io::Error` it stands for, so
/// callers can match on the plain error code (for example 183, "already
/// exists").
#[cfg(windows)]
pub(crate) fn win32_error(error: windows::core::Error) -> FsError {
    let code = error.code().0 as u32;
    let raw = if code & 0xFFFF_0000 == 0x8007_0000 {
        (code & 0xFFFF) as i32
    } else {
        code as i32
    };
    FsError::Io(std::io::Error::from_raw_os_error(raw))
}

#[cfg(test)]
mod tests {
    use super::long_path_wide;
    use std::path::Path;

    fn text(path: &str) -> String {
        let wide = long_path_wide(Path::new(path));
        String::from_utf16_lossy(&wide[..wide.len() - 1])
    }

    #[test]
    fn adds_the_verbatim_prefix_once() {
        assert_eq!(text(r"C:\Users\me"), r"\\?\C:\Users\me");
        assert_eq!(text("C:/Users/me"), r"\\?\C:\Users\me");
        assert_eq!(text(r"\\server\share\a"), r"\\?\UNC\server\share\a");
        assert_eq!(text(r"\\?\C:\already"), r"\\?\C:\already");
    }
}
