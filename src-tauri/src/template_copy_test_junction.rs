//! A privilege-free Windows junction fixture; no shell or external process.

use std::fs;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn DeviceIoControl(
        device: *mut std::ffi::c_void,
        code: u32,
        input: *const std::ffi::c_void,
        input_bytes: u32,
        output: *mut std::ffi::c_void,
        output_bytes: u32,
        returned: *mut u32,
        overlapped: *mut std::ffi::c_void,
    ) -> i32;
}

pub fn create(link: &Path, target: &Path) -> io::Result<()> {
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    let canonical = fs::canonicalize(target)?;
    let display = canonical.to_string_lossy();
    let display = display.strip_prefix(r"\\?\").unwrap_or(&display);
    let substitute = format!(r"\??\{display}");
    let substitute: Vec<u16> = substitute.encode_utf16().collect();
    let print: Vec<u16> = target.as_os_str().encode_wide().collect();
    let path_bytes = (substitute.len() + print.len() + 2) * 2;
    let mut data = vec![0u16; (16 + path_bytes) / 2];
    // REPARSE_DATA_BUFFER for IO_REPARSE_TAG_MOUNT_POINT: an eight-byte
    // header, four u16 offsets/lengths, then the two terminated names.
    data[0] = 0x0003;
    data[1] = 0xA000;
    data[2] = (8 + path_bytes) as u16;
    data[4] = 0;
    data[5] = (substitute.len() * 2) as u16;
    data[6] = ((substitute.len() + 1) * 2) as u16;
    data[7] = (print.len() * 2) as u16;
    data[8..8 + substitute.len()].copy_from_slice(&substitute);
    let print_start = 8 + substitute.len() + 1;
    data[print_start..print_start + print.len()].copy_from_slice(&print);
    fs::create_dir(link)?;
    let file = fs::OpenOptions::new()
        .write(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(link)?;
    let mut returned = 0;
    // SAFETY: file is our empty fixture directory; the input is a complete,
    // aligned mount-point buffer, and no output or OVERLAPPED is requested.
    let result = unsafe {
        DeviceIoControl(
            file.as_raw_handle(),
            0x0009_00A4,
            data.as_ptr().cast(),
            (data.len() * 2) as u32,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
