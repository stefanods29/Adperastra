//! Actual hardware query for the Local AI settings card (T3, D10).
//!
//! RAM and logical cores come from Windows. The GPU name/VRAM come from the
//! display adapter's registry record; when no dedicated VRAM value exists the
//! field stays `None` and the recommendation never claims a VRAM amount.

use ai_runtime::types::AiTier;
use ai_runtime::types_ui::AiHardwareInfo;

/// small if RAM <= 8 GiB; pro only when RAM >= 16 GiB and VRAM >= 8 GiB.
pub fn recommend_tier(ram_bytes: u64, dedicated_vram_bytes: Option<u64>) -> AiTier {
    const GIB: u64 = 1_073_741_824;
    if ram_bytes <= 8 * GIB {
        return AiTier::Small;
    }
    if ram_bytes >= 16 * GIB && dedicated_vram_bytes.is_some_and(|vram| vram >= 8 * GIB) {
        return AiTier::Pro;
    }
    AiTier::Default
}

#[cfg(windows)]
mod windows_query {
    use super::recommend_tier;
    use ai_runtime::types_ui::AiHardwareInfo;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, KEY_READ, REG_QWORD,
        REG_SZ,
    };
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::{GetActiveProcessorCount, ALL_PROCESSOR_GROUPS};

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn from_wide(value: &[u16]) -> String {
        let end = value.iter().position(|unit| *unit == 0).unwrap_or(value.len());
        OsString::from_wide(&value[..end])
            .to_string_lossy()
            .trim()
            .to_string()
    }

    struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful RegOpenKeyExW and is
            // closed exactly once.
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn open(root: HKEY, path: &str) -> Option<Key> {
        let path = wide(path);
        let mut handle = HKEY::default();
        // SAFETY: the byte string is NUL terminated and lives for the call.
        let status = unsafe {
            RegOpenKeyExW(
                root,
                PCWSTR(path.as_ptr()),
                None,
                KEY_READ,
                &mut handle,
            )
        };
        (status.0 == 0).then_some(Key(handle))
    }

    fn query_string(root: HKEY, path: &str, value: &str) -> Option<String> {
        let key = open(root, path)?;
        let value = wide(value);
        let mut kind = REG_SZ;
        let mut bytes = vec![0u8; 512];
        let mut length = bytes.len() as u32;
        // SAFETY: buffers are valid and their lengths are passed.
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                PCWSTR(value.as_ptr()),
                None,
                Some(&mut kind as *mut _),
                Some(bytes.as_mut_ptr()),
                Some(&mut length as *mut u32),
            )
        };
        if status.0 != 0 || kind != REG_SZ {
            return None;
        }
        let units: Vec<u16> = bytes[..length as usize]
            .as_chunks::<2>().0.iter()
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let text = from_wide(&units);
        (!text.is_empty()).then_some(text)
    }

    fn query_qword(root: HKEY, path: &str, value: &str) -> Option<u64> {
        let key = open(root, path)?;
        let value = wide(value);
        let mut kind = REG_QWORD;
        let mut data = 0u64;
        let mut length = 8u32;
        // SAFETY: `data` is 8 bytes and `length` describes it.
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                PCWSTR(value.as_ptr()),
                None,
                Some(&mut kind as *mut _),
                Some(&mut data as *mut u64 as *mut u8),
                Some(&mut length as *mut u32),
            )
        };
        if status.0 == 0 && kind == REG_QWORD && length == 8 && data > 0 {
            Some(data)
        } else {
            None
        }
    }

    fn registry_gpu() -> Option<(String, Option<u64>)> {
        use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
        let video = open(
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Video",
        )?;
        for index in 0..256u32 {
            let mut name = [0u16; 128];
            let mut length = name.len() as u32;
            // SAFETY: the name buffer and its unit length are valid.
            let status = unsafe {
                RegEnumKeyExW(
                    video.0,
                    index,
                    Some(windows::core::PWSTR(name.as_mut_ptr())),
                    &mut length,
                    None,
                    None,
                    None,
                    None,
                )
            };
            if status.0 != 0 {
                break;
            }
            let adapter = from_wide(&name);
            for suffix in ["0000", "0001"] {
                let path = format!(r"SYSTEM\CurrentControlSet\Control\Video\{adapter}\{suffix}");
                let Some(desc) = query_string(HKEY_LOCAL_MACHINE, &path, "DriverDesc") else {
                    continue;
                };
                let vram = query_qword(
                    HKEY_LOCAL_MACHINE,
                    &path,
                    "HardwareInformation.qwMemorySize",
                );
                if !desc.is_empty() {
                    return Some((desc.chars().take(256).collect(), vram));
                }
            }
        }
        None
    }

    fn display_adapter() -> Option<String> {
        let mut device = DISPLAY_DEVICEW {
            cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        // SAFETY: `device.cb` is set and the adapter index is bounded.
        let ok = unsafe { EnumDisplayDevicesW(PCWSTR::null(), 0, &mut device, 0) };
        if ok.as_bool() {
            let name = from_wide(&device.DeviceString);
            (!name.is_empty()).then_some(name)
        } else {
            None
        }
    }

    pub fn query() -> AiHardwareInfo {
        // SAFETY: MEMORYSTATUSEX is a plain C struct; zero is a valid initial
        // value and dwLength is set before the call.
        let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        // SAFETY: dwLength is initialized as Windows requires.
        let _ = unsafe { GlobalMemoryStatusEx(&mut status) };
        let ram = status.ullTotalPhys;
        let available = status.ullAvailPhys;
        // SAFETY: ALL_PROCESSOR_GROUPS is the documented constant.
        let cores = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) };
        let (gpu_name, vram) = match registry_gpu() {
            Some((name, vram)) => (Some(name), vram),
            None => (display_adapter(), None),
        };
        AiHardwareInfo {
            ram_bytes: ram,
            available_ram_bytes: available,
            logical_cores: cores.min(u32::from(u16::MAX)) as u16,
            gpu_name,
            dedicated_vram_bytes: vram,
            gpu_backend: None,
            recommended_tier: recommend_tier(ram, vram),
        }
    }
}

#[cfg(windows)]
pub fn query_hardware() -> AiHardwareInfo {
    windows_query::query()
}

#[cfg(not(windows))]
pub fn query_hardware() -> AiHardwareInfo {
    AiHardwareInfo {
        ram_bytes: 0,
        available_ram_bytes: 0,
        logical_cores: 1,
        gpu_name: None,
        dedicated_vram_bytes: None,
        gpu_backend: None,
        recommended_tier: AiTier::Small,
    }
}
